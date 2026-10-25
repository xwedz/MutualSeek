// Runs before every test file: builds the schema in that file's own (empty) database from migrations/.
// Already-applied migrations are skipped, so running it more than once is harmless.
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
