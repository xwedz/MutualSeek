// src/osu.ts —— osu! API v2 的型別與呼叫方式。
//
// 型別只宣告我們真的會用到的欄位（osu! 回傳的欄位多很多）。
// 欄位名稱對照 osu-web 原始碼的 UserCompactTransformer / UserRelationTransformer。

import type { Env } from './env';
import { decryptToken, encryptToken } from './tokenCrypto';

const OSU = 'https://osu.ppy.sh';

/**
 * /friends 在 x-api-version >= 20241022 時，回傳的是帶 `mutual` 欄位的 UserRelation，
 * 舊版本只回傳使用者列表、沒有 mutual。這是整個「追蹤回加」功能的基礎。
 */
const FRIENDS_API_VERSION = '20241022';

export interface OsuUserCompact {
    id: number;
    username: string;
    avatar_url: string;
    country_code: string;
    // 30 天內上線過（osu-web 的 User::isActive）。官方網站排行榜上名字變暗就是這個值為 false。
    // 用的是真實的最後上線時間，對方隱藏上線狀態時也照樣有值。
    is_active: boolean;
    is_bot: boolean;
    is_deleted: boolean;
    is_supporter: boolean;
    last_visit: string | null; // 對方隱藏上線狀態時是 null
    pm_friends_only: boolean;
}

export interface OsuUser extends OsuUserCompact {
    follower_count: number;
    page: { html: string; raw: string };
}

export interface RankingEntry {
    user: OsuUserCompact;
    global_rank: number | null;
    pp: number | null;
}

export interface RankingResponse {
    ranking: RankingEntry[];
    cursor: { page: number } | null; // null = 已經是最後一頁
    total: number;
}

export interface UserRelation {
    target_id: number;
    relation_type: 'friend' | 'block';
    mutual: boolean;
    target: OsuUserCompact;
}

interface TokenResponse {
    access_token: string;
    refresh_token?: string; // client credentials 沒有 refresh token
    expires_in: number; // 秒
}

export class OsuApiError extends Error {
    constructor(public status: number, path: string, body: string) {
        super(`osu! API ${path} 失敗 (${status}): ${body.slice(0, 200)}`);
    }
}

async function osuFetch<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${OSU}${path}`, init);
    if (!res.ok) throw new OsuApiError(res.status, path, await res.text().catch(() => ''));
    return res.json<T>();
}

export function apiGet<T>(path: string, token: string, apiVersion?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (apiVersion) headers['x-api-version'] = apiVersion;
    return osuFetch<T>(`/api/v2${path}`, { headers });
}

export const getFriends = (token: string) => apiGet<UserRelation[]>('/friends', token, FRIENDS_API_VERSION);

export function requestToken(env: Env, params: Record<string, string>): Promise<TokenResponse> {
    return osuFetch<TokenResponse>('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: env.OSU_CLIENT_ID, client_secret: env.OSU_CLIENT_SECRET, ...params }),
    });
}

/** osu! 的 last_visit（ISO 字串）轉成 Unix 毫秒；null 或無法解析時回傳 null。 */
export function parseTime(value: string | null): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

// ---------- App 自己的 token（背景掃描用） ----------

const APP_TOKEN_KEY = 'osu:app_token';
const EXPIRY_MARGIN_MS = 5 * 60 * 1000; // 提早 5 分鐘換新，避免剛好在請求途中過期

/**
 * 背景掃描不代表任何使用者，所以用 client credentials 換一個只能讀公開資料的 token。
 * token 有效期約一天，存在 kv 表裡重複使用，不用每分鐘都重新申請。
 */
export async function getAppToken(env: Env): Promise<string> {
    const row = await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(APP_TOKEN_KEY).first<{ value: string }>();
    if (row) {
        const cached = JSON.parse(row.value) as { token: string; expiresAt: number };
        if (cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
            return decryptToken(env.TOKEN_ENCRYPTION_KEY, cached.token);
        }
    }

    const res = await requestToken(env, { grant_type: 'client_credentials', scope: 'public' });
    const value = JSON.stringify({
        token: await encryptToken(env.TOKEN_ENCRYPTION_KEY, res.access_token),
        expiresAt: Date.now() + res.expires_in * 1000,
    });
    await env.DB.prepare('INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2')
        .bind(APP_TOKEN_KEY, value)
        .run();
    return res.access_token;
}

// ---------- 使用者的 token（讀好友名單用） ----------

interface AccountTokenRow {
    access_token: string;
    refresh_token: string;
    token_expires_at: number;
}

/** 登入成功時呼叫：建立或更新帳號，並把 token 加密存起來。 */
export async function saveAccount(
    env: Env,
    user: { id: number; username: string; is_supporter: boolean },
    tokens: TokenResponse,
): Promise<void> {
    if (!tokens.refresh_token) throw new Error('授權碼流程應該要拿到 refresh token');
    const now = Date.now();
    await env.DB.prepare(
        `INSERT INTO accounts (osu_user_id, username, is_supporter, access_token, refresh_token, token_expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (osu_user_id) DO UPDATE SET
             username = excluded.username,
             is_supporter = excluded.is_supporter,
             access_token = excluded.access_token,
             refresh_token = excluded.refresh_token,
             token_expires_at = excluded.token_expires_at`,
    )
        .bind(
            user.id,
            user.username,
            user.is_supporter ? 1 : 0,
            await encryptToken(env.TOKEN_ENCRYPTION_KEY, tokens.access_token),
            await encryptToken(env.TOKEN_ENCRYPTION_KEY, tokens.refresh_token),
            now + tokens.expires_in * 1000,
            now,
        )
        .run();
}

/**
 * 取得某位使用者可用的 access token。過期了就用 refresh token 換新的。
 * 回傳 null 代表需要使用者重新登入（從沒登入過、或 refresh token 也失效了，例如對方在 osu! 撤銷了授權）。
 */
export async function getUserToken(env: Env, accountId: number): Promise<string | null> {
    const row = await env.DB.prepare('SELECT access_token, refresh_token, token_expires_at FROM accounts WHERE osu_user_id = ?')
        .bind(accountId)
        .first<AccountTokenRow>();
    if (!row) return null;

    if (row.token_expires_at - EXPIRY_MARGIN_MS > Date.now()) {
        return decryptToken(env.TOKEN_ENCRYPTION_KEY, row.access_token);
    }

    let res: TokenResponse;
    try {
        res = await requestToken(env, {
            grant_type: 'refresh_token',
            refresh_token: await decryptToken(env.TOKEN_ENCRYPTION_KEY, row.refresh_token),
        });
    } catch (err) {
        // 400 / 401：refresh token 無效，只能請使用者重新登入。其他錯誤（osu! 掛了、網路問題）往上丟。
        if (err instanceof OsuApiError && (err.status === 400 || err.status === 401)) return null;
        throw err;
    }

    await env.DB.prepare('UPDATE accounts SET access_token = ?1, refresh_token = ?2, token_expires_at = ?3 WHERE osu_user_id = ?4')
        .bind(
            await encryptToken(env.TOKEN_ENCRYPTION_KEY, res.access_token),
            // osu! 換發時會給新的 refresh token；萬一沒給，就沿用舊的
            res.refresh_token ? await encryptToken(env.TOKEN_ENCRYPTION_KEY, res.refresh_token) : row.refresh_token,
            Date.now() + res.expires_in * 1000,
            accountId,
        )
        .run();
    return res.access_token;
}
