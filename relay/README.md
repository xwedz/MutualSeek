# Relay

An optional relay for the background scanner's osu! requests.

## Why

A Worker's requests to another site on Cloudflare (osu.ppy.sh is one) all reach that site from the same address: Cloudflare sets `CF-Connecting-IP` to `2a06:98c0:3600::103` for every cross-zone Worker subrequest ([Cloudflare docs](https://developers.cloudflare.com/fundamentals/reference/http-headers/)). In November 2026 the scanner started getting `429 Too Many Requests` pages from osu!'s web server while sending at most 9 requests a minute, even though the API itself reported almost all of the app's own limit left (`X-RateLimit-Remaining: 1198/1200`). The likely cause is a limit shared by every Worker calling osu!.

The relay runs on a machine with its own IP address, so osu! sees that address instead. The scanner sends the same requests at the same rate; only where they come from changes. Logins and friend lists still go to osu! directly.

## What it allows

- Only the requests the scanner makes: country rankings, performance rankings, user profiles (`GET`), and the app token (`POST /oauth/token`).
- Only with the shared secret in `X-Relay-Secret`.
- At most 60 requests a minute (the scanner sends at most 9).
- It only listens on `127.0.0.1`; the internet reaches it through a Cloudflare Tunnel.

Everything it answers carries an `x-mutualseek-relay` header. When the scanner gets an answer without it (for example Cloudflare's error page while the machine is off) or can't reach the relay at all, it calls osu! directly, so turning the machine off only slows scanning down.

## Running it

Requires Node.js 18 or later and [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

1. Create `relay/.env` (gitignored) with a long random secret:
   ```sh
   node -e "console.log('RELAY_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))" > relay/.env
   ```
2. Give the Worker the same secret: `npx wrangler secret put OSU_RELAY_SECRET`
3. Create a tunnel to a hostname on a domain in your Cloudflare account (once):
   ```sh
   cloudflared tunnel login
   cloudflared tunnel create mutualseek-relay
   cloudflared tunnel route dns mutualseek-relay mutualseek-relay.example.com
   ```
4. Set `OSU_RELAY_URL` in `wrangler.jsonc` to `https://mutualseek-relay.example.com` and deploy.
5. Keep both running:
   ```sh
   npm run relay
   cloudflared tunnel run --url http://127.0.0.1:8787 mutualseek-relay
   ```

To stop using it, set `OSU_RELAY_URL` back to `""` and deploy.

## Tests

`npm run test:relay` runs the relay against a fake osu! server on the same machine (also part of `npm test`).
