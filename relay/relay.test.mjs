// Tests for the relay against a fake osu! server on this machine. Run with: npm run test:relay
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createRelay, MARKER } from './relay.mjs';

const SECRET = 'a'.repeat(32);

/** Starts a server on a free port and returns its base URL */
const listen = server =>
    new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

describe('relay', () => {
    let upstream, upstreamUrl, relay, relayUrl;
    const received = []; // what the fake osu! server was sent

    before(async () => {
        upstream = createServer(async (req, res) => {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
            res.writeHead(200, { 'content-type': 'application/json', 'x-ratelimit-limit': '1200', 'x-ratelimit-remaining': '1199', 'set-cookie': 'x=1' });
            res.end(JSON.stringify({ ok: true }));
        });
        upstreamUrl = await listen(upstream);
        relay = createRelay({ secret: SECRET, upstream: upstreamUrl, limitPerMinute: 5, log: () => {} });
        relayUrl = await listen(relay);
    });

    after(() => {
        relay.close();
        upstream.close();
    });

    beforeEach(() => {
        received.length = 0;
    });

    const get = (path, headers = {}) => fetch(`${relayUrl}${path}`, { headers: { 'x-relay-secret': SECRET, ...headers } });

    it('refuses to start with a short secret', () => {
        assert.throws(() => createRelay({ secret: 'short' }), /at least 32 characters/);
    });

    it('rejects requests without the right secret, and forwards nothing', async () => {
        for (const headers of [{}, { 'x-relay-secret': 'b'.repeat(32) }, { 'x-relay-secret': SECRET.slice(1) }]) {
            const res = await fetch(`${relayUrl}/api/v2/users/1/osu`, { headers });
            assert.equal(res.status, 401);
            assert.equal(res.headers.get(MARKER), '1');
        }
        assert.equal(received.length, 0);
    });

    it('only forwards what the scanner needs', async () => {
        for (const path of ['/api/v2/me', '/api/v2/friends', '/api/v2/users/1/osu/extra', '/api/v2/users/abc/osu', '/home', '/']) {
            const res = await get(path);
            assert.equal(res.status, 403, path);
        }
        const post = await fetch(`${relayUrl}/api/v2/users/1/osu`, { method: 'POST', headers: { 'x-relay-secret': SECRET } });
        assert.equal(post.status, 403);
        assert.equal(received.length, 0);
    });

    it('forwards a profile request with its token and passes back the answer and rate limit headers', async () => {
        const res = await get('/api/v2/users/7452418/osu?key=id', { authorization: 'Bearer token-1', 'x-api-version': '20241022', cookie: 'secret' });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { ok: true });
        assert.equal(res.headers.get(MARKER), '1');
        assert.equal(res.headers.get('x-ratelimit-remaining'), '1199');
        assert.equal(res.headers.get('set-cookie'), null); // only the headers the scanner reads come back

        const [sent] = received;
        assert.equal(sent.url, '/api/v2/users/7452418/osu?key=id');
        assert.equal(sent.headers.authorization, 'Bearer token-1');
        assert.equal(sent.headers['x-api-version'], '20241022');
        assert.equal(sent.headers['x-relay-secret'], undefined); // the secret stays between the Worker and the relay
        assert.equal(sent.headers.cookie, undefined);
    });

    it('forwards the app token request with its body', async () => {
        const body = JSON.stringify({ grant_type: 'client_credentials', scope: 'public' });
        const res = await fetch(`${relayUrl}/oauth/token`, {
            method: 'POST',
            headers: { 'x-relay-secret': SECRET, 'content-type': 'application/json' },
            body,
        });
        assert.equal(res.status, 200);
        assert.equal(received[0].method, 'POST');
        assert.equal(received[0].body, body);
    });

    it('stops forwarding past its per-minute limit', async () => {
        // limitPerMinute is 5 here, and the earlier tests already forwarded 2
        const statuses = [];
        for (let i = 0; i < 5; i++) statuses.push((await get('/api/v2/rankings/osu/performance?country=KR&page=1')).status);
        assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
        assert.equal(received.length, 3);
    });
});

describe('relay when osu! is unreachable', () => {
    it('answers 502 itself, still marked as the relay', async () => {
        const relay = createRelay({ secret: SECRET, upstream: 'http://127.0.0.1:1', log: () => {} });
        const url = await listen(relay);
        const res = await fetch(`${url}/api/v2/users/1/osu`, { headers: { 'x-relay-secret': SECRET } });
        relay.close();
        assert.equal(res.status, 502);
        assert.equal(res.headers.get(MARKER), '1');
    });
});
