// Tests run inside the Workers runtime (workerd) through Cloudflare's Vitest plugin, with a local D1 database:
// nothing here touches the production database or the osu! API.
//   src/**/*.test.ts   unit tests for single functions
//   test/**/*.test.ts  API tests: real requests to the Worker, backed by a fresh database built from migrations/
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
    // Read in Node.js here, then handed to the tests as a binding and applied in test/apply-migrations.ts
    const migrations = await readD1Migrations('./migrations');

    return {
        plugins: [
            cloudflareTest({
                wrangler: { configPath: './wrangler.jsonc' },
                // These take precedence over wrangler.jsonc and .dev.vars, so tests never depend on local secrets
                miniflare: {
                    bindings: {
                        TEST_MIGRATIONS: migrations,
                        SESSION_SECRET: 'test-session-secret',
                        TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // 32 zero bytes, base64url
                        OSU_CLIENT_ID: '0',
                        OSU_CLIENT_SECRET: 'test',
                    },
                    // Every test request comes from the same address; a high limit keeps the per-IP rate limit out of the way
                    ratelimits: { API_LIMITER: { namespace_id: '1001', simple: { limit: 100_000, period: 60 } } },
                },
            }),
        ],
        test: {
            include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
            setupFiles: ['./test/apply-migrations.ts'],
        },
    };
});
