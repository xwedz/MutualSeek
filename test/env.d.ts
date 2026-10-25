// Types for the test runtime: `env` from cloudflare:workers gets the Worker's own bindings (src/env.ts) plus the
// test-only migrations, and `exports` gets the main module's handlers.
import type { D1Migration } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/env';

declare global {
    namespace Cloudflare {
        interface Env extends WorkerEnv {
            TEST_MIGRATIONS: D1Migration[];
        }
        interface GlobalProps {
            mainModule: typeof import('../src/index');
        }
    }
}

export {};
