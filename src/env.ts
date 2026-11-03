// src/env.ts — types for every binding and setting the Worker receives.
//
// d1_databases / ratelimits / vars from wrangler.jsonc and the secrets from .dev.vars all arrive as env.XXX.
// Declaring them in one place means a typo in a name fails at compile time.

export interface Env {
    DB: D1Database;
    API_LIMITER?: RateLimit;

    OSU_CLIENT_ID: string;
    OSU_CLIENT_SECRET: string;
    SESSION_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;

    // Only set for local development, see .dev.vars.example
    OSU_REDIRECT_URI?: string;
    FRONTEND_URL?: string;

    // "all" = every country (most active players first); or comma-separated country codes, e.g. "TW,JP"
    SCAN_COUNTRIES: string;
    SCAN_MODE: string;
    // Pauses the background scanner (no more osu! API calls): "now" = pause right away;
    // a country code (e.g. "US") = pause once that country is done this pass and its queue is empty;
    // empty = don't pause. Clear it and redeploy to continue from where it stopped.
    SCAN_PAUSE?: string;
    // Optional relay for the background scanner's osu! requests (see relay/README.md). Both must be set to use it;
    // when the relay doesn't answer, the scanner calls osu! directly. The secret is a Worker secret, not a var.
    OSU_RELAY_URL?: string;
    OSU_RELAY_SECRET?: string;
}

/** Type parameter for Hono, so c.env has the types above. */
export type AppEnv = { Bindings: Env };
