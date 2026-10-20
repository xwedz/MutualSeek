// src/env.ts —— Worker 拿得到的所有綁定（binding）與設定值的型別。
//
// wrangler.jsonc 的 d1_databases / ratelimits / vars 與 .dev.vars 的機密值，
// 都會以 env.XXX 的形式傳進 Worker。在這裡集中宣告，打錯名字時編譯就會報錯。

export interface Env {
    DB: D1Database;
    API_LIMITER?: RateLimit;

    OSU_CLIENT_ID: string;
    OSU_CLIENT_SECRET: string;
    SESSION_SECRET: string;
    TOKEN_ENCRYPTION_KEY: string;

    // 只有本機開發會設定，見 .dev.vars.example
    OSU_REDIRECT_URI?: string;
    FRONTEND_URL?: string;

    SCAN_COUNTRY: string;
    SCAN_MODE: string;
}

/** Hono 用的型別參數：讓 c.env 帶有上面的型別。 */
export type AppEnv = { Bindings: Env };
