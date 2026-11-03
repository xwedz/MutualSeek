// relay/relay.mjs — forwards the background scanner's osu! requests from a machine with its own IP address.
//
// Why: a Worker's requests to another Cloudflare site (osu.ppy.sh is one) all arrive from the same address, so
// osu!'s web server rate-limits every Worker calling osu! as one. Through this relay, osu! sees this machine's
// address instead, used by nobody else. See relay/README.md for running it behind a Cloudflare Tunnel.
//
// It only forwards what the scanner needs (rankings, profiles, the app token), only for requests carrying the shared
// secret, and at most 60 a minute, so it can't be used as an open proxy even if its address is found.
// No dependencies: Node.js 18 or later.

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'x-mutualseek-relay'; // src/osu.ts RELAY_MARKER
const MODE = '(osu|taiko|fruits|mania)';
const ALLOWED = [
    { method: 'GET', path: new RegExp(`^/api/v2/rankings/${MODE}/(performance|country)$`) },
    { method: 'GET', path: new RegExp(`^/api/v2/users/\\d+/${MODE}$`) },
    { method: 'POST', path: /^\/oauth\/token$/ },
];
const FORWARDED_REQUEST_HEADERS = ['authorization', 'accept', 'content-type', 'x-api-version'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining'];
const MAX_BODY_BYTES = 16 * 1024;

/**
 * secret: shared with the Worker (OSU_RELAY_SECRET)
 * upstream: where requests go; osu! itself except in tests
 * limitPerMinute: the most requests forwarded in any 60 seconds (the scanner sends at most 9 a minute)
 */
export function createRelay({ secret, upstream = 'https://osu.ppy.sh', limitPerMinute = 60, log = console.log }) {
    if (!secret || secret.length < 32) throw new Error('RELAY_SECRET must be at least 32 characters');
    const expected = Buffer.from(secret);
    const recent = []; // times of requests forwarded in the last minute

    const reply = (res, status, body, headers = {}) => {
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers, [MARKER]: '1' });
        res.end(body);
    };

    return createServer(async (req, res) => {
        const started = Date.now();
        const url = new URL(req.url ?? '/', 'http://relay');
        const done = status => log(`${new Date(started).toISOString()} ${req.method} ${url.pathname}${url.search} ${status} ${Date.now() - started}ms`);

        const given = Buffer.from(String(req.headers['x-relay-secret'] ?? ''));
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
            reply(res, 401, 'relay: wrong or missing secret');
            return done(401);
        }
        if (!ALLOWED.some(rule => rule.method === req.method && rule.path.test(url.pathname))) {
            reply(res, 403, 'relay: this request is not forwarded');
            return done(403);
        }
        while (recent.length > 0 && started - recent[0] >= 60_000) recent.shift();
        if (recent.length >= limitPerMinute) {
            reply(res, 429, `relay: over ${limitPerMinute} requests a minute`, { 'retry-after': '60' });
            return done(429);
        }
        recent.push(started);

        let body;
        if (req.method === 'POST') {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > MAX_BODY_BYTES) {
                    reply(res, 413, 'relay: body too large');
                    return done(413);
                }
                chunks.push(chunk);
            }
            body = Buffer.concat(chunks);
        }

        const headers = {};
        for (const name of FORWARDED_REQUEST_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
        try {
            const upstreamRes = await fetch(`${upstream}${url.pathname}${url.search}`, { method: req.method, headers, body });
            const responseHeaders = { [MARKER]: '1' };
            for (const name of FORWARDED_RESPONSE_HEADERS) {
                const value = upstreamRes.headers.get(name);
                if (value !== null) responseHeaders[name] = value;
            }
            res.writeHead(upstreamRes.status, responseHeaders);
            res.end(Buffer.from(await upstreamRes.arrayBuffer()));
            done(upstreamRes.status);
        } catch (err) {
            reply(res, 502, `relay: osu! could not be reached (${err instanceof Error ? err.message : err})`);
            done(502);
        }
    });
}

// Run directly: node --env-file=relay/.env relay/relay.mjs (not when imported by the tests)
const samePath = (a, b) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));
if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
    const port = Number(process.env.PORT ?? 8787);
    // Only reachable from this machine; the Cloudflare Tunnel connects to it locally
    createRelay({ secret: process.env.RELAY_SECRET }).listen(port, '127.0.0.1', () => {
        console.log(`relay listening on http://127.0.0.1:${port}, forwarding to osu!`);
    });
}
