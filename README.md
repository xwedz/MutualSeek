# MutualSeek

Find osu! players looking for mutuals, and see who followed you back.

Many players write things like "add me for mutuals" or "I follow back" on their osu! profile, but there's no way to find them unless you happen to open their profile. MutualSeek scans the rankings for active players whose profile mentions mutuals and lists them with the relevant excerpt, so you can read what they wrote and add them yourself.

## Features

- **Find people**: players whose profile mentions mutuals, with the matching part of their profile highlighted. Filter by country or by who was online in the past week, and copy a message template to send on osu!. The list is shuffled so the same few players aren't contacted by everyone (see below). The list is only shown after logging in and accepting a few short guidelines (read what they wrote, don't take it personally, be kind).
- **Follow-backs**: log in with osu! to see who added you back, who removed you, and who never did, by comparing your friend list between syncs.
- **Don't list me**: any listed player can log in and remove themselves from the list. Future scans won't add them back.
- **Read-only**: the site only asks for `identify` and `friends.read`. It can't add friends or send messages for you.

## How it works

**Scanning.** A Cron Trigger runs the scanner once a minute. Each run handles a small batch: it reads a page of a country's performance ranking (top 10,000 per country, osu! standard), then fetches the profiles of the active players on it. A full pass goes through every country, starting with those that have the most active players, and passes are spread out over about a month.

**Detection.** `src/detect.ts` converts the profile's BBCode to plain text and looks for keywords in English, Chinese, Japanese and Korean (e.g. "mutual", "follow back", "互關", "相互フォロー", "맞팔"). It doesn't try to judge meaning: someone who writes "no mutuals" is listed too, and the excerpt shows exactly what they wrote so the user can decide.

**What's stored.** Only players who mention mutuals are kept in the database, along with their public profile data (name, avatar, country, rank, pp, followers, last visit, the excerpt). Players who have never had osu!supporter can't create a profile page, so they're remembered by id and skipped in later passes.

**Order.** With a fixed order, everyone would see the same few players at the top. Instead, each listed player gets a random key once, and the keys form a ring: every user starts reading at their own point (derived from their id and the date, so it's stable for a day) and wraps around at the end. The ring is read as two index range scans, so a page only reads the rows it needs (`src/shuffle.ts`, `/api/candidates`).

**Follow-backs.** `/friends` (API version `20241022`) includes a `mutual` flag for every friend. Each sync compares the new list with the previous snapshot and records what changed.

**Security.** Sessions are HMAC-signed cookies (`SameSite=Lax`). osu! tokens are encrypted with AES-GCM before they're stored, and are revoked when you log out. Users can delete all of their data from the Follow-backs page.

## Tech stack

- **Backend**: Cloudflare Workers, [Hono](https://hono.dev), Cloudflare D1 (SQLite), Cron Triggers, Workers Rate Limiting
- **Frontend**: React, Vite, Tailwind CSS v4
- **Language**: TypeScript
- **Tests**: Vitest

## Project structure

```
src/                 Worker (API, OAuth, scanner)
  index.ts           API routes and the scheduled handler
  crawler.ts         background scanner
  detect.ts          mutual-mention detection
  friends.ts         friend list sync and follow-back events
  auth.ts            osu! OAuth login
  osu.ts             osu! API client and token handling
client/              React frontend (served as static assets)
migrations/          D1 schema migrations
wrangler.jsonc       Worker configuration
```

## Running locally

Requirements: a current Node.js LTS release and an [osu! OAuth application](https://osu.ppy.sh/home/account/edit) (at the bottom of the page) with the callback URL `http://localhost:3000/api/auth/callback`.

```sh
npm install
npm --prefix client install

cp .dev.vars.example .dev.vars   # then fill in your own values
npm run db:migrate               # create the local D1 database

npm run dev                      # Worker on http://localhost:3000
npm run client                   # frontend on http://localhost:5173 (in another terminal)
```

The scanner doesn't run on its own during local development. Trigger one run with:

```sh
curl "http://localhost:3000/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"
```

Run the checks with `npm test` and `npm run typecheck`.

## Tests

Tests run inside the Workers runtime with [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/), each test file against its own fresh local D1 database built from `migrations/`. They never touch the production database or the osu! API, and don't need `.dev.vars`.

- `src/**/*.test.ts`: unit tests (mutual-mention detection, ranking page handling, the shuffle start point).
- `test/**/*.test.ts`: API tests that send real requests to the Worker: who can see the list (login and guidelines), paging, the shuffled order, filters, hiding friends, and Don't list me.
- `test/crawler.test.ts`: the scanner against a fake osu! API (`test/fake-osu.ts`): at most 9 requests per run one second apart, the 30-day gap between passes, what gets stored or removed, skipping players who never had supporter, and how API errors are handled.

## Deploying

1. Create the database with `npx wrangler d1 create osu-mutual-tool`, put its id in `wrangler.jsonc`, and run `npm run db:migrate:remote`.
2. Create a separate osu! OAuth application for production, with the callback URL `https://<your-domain>/api/auth/callback`.
3. Set the secrets (use new values, not the ones from `.dev.vars`):
   ```sh
   npx wrangler secret put OSU_CLIENT_ID
   npx wrangler secret put OSU_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   ```
4. `npm run deploy`

Scanning can be paused without losing progress by setting `SCAN_PAUSE` in `wrangler.jsonc` (`"now"`, or a country code to stop after that country) and deploying again.

## Disclaimer

MutualSeek is an independent fan project and is not affiliated with osu! or ppy Pty Ltd.
