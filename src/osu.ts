// src/osu.ts — osu! API v2 types and calls.
//
// Types only declare the fields we actually use (osu! returns many more).
// Field names follow osu-web's UserCompactTransformer / UserRelationTransformer.

import type { Env } from './env';
import { decryptToken, encryptToken } from './tokenCrypto';

const OSU = 'https://osu.ppy.sh';

/**
 * With x-api-version >= 20241022, /friends returns UserRelation objects that include a `mutual` field;
 * older versions only return a list of users without it. The whole follow-back feature relies on this.
 */
const FRIENDS_API_VERSION = '20241022';

export interface OsuUserCompact {
    id: number;
    username: string;
    avatar_url: string;
    country_code: string;
    // Online in the last 30 days (osu-web's User::isActive); false is what greys out a name in the rankings.
    // It uses the real last visit time, so it's set even when the player hides their online status.
    is_active: boolean;
    is_bot: boolean;
    is_deleted: boolean;
    is_supporter: boolean;
    last_visit: string | null; // null when the player hides their online status
    pm_friends_only: boolean;
}

export interface OsuUser extends OsuUserCompact {
    follower_count: number;
    has_supported: boolean; // has had supporter now or in the past (ranking data doesn't include this)
    page: { html: string; raw: string };
    // /users/{id}/{mode} includes that mode's statistics (rank, pp), which are refreshed while scanning
    statistics?: { global_rank: number | null; country_rank: number | null; pp: number | null };
}

export interface CountryRankingEntry {
    code: string;
    active_users: number;
}

export interface CountryRankingResponse {
    ranking: CountryRankingEntry[];
    cursor: { page: number } | null;
}

export interface RankingEntry {
    user: OsuUserCompact;
    global_rank: number | null;
    pp: number | null;
}

export interface RankingResponse {
    ranking: RankingEntry[];
    cursor: { page: number } | null; // null = this is the last page
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
    refresh_token?: string; // client credentials tokens have no refresh token
    expires_in: number; // seconds
}

export class OsuApiError extends Error {
    constructor(public status: number, path: string, body: string) {
        super(`osu! API ${path} failed (${status}): ${body.slice(0, 200)}`);
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

/** Converts osu!'s last_visit (an ISO string) to Unix milliseconds; null if missing or unparseable. */
export function parseTime(value: string | null): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

// ---------- The app's own token (for the background scanner) ----------

const APP_TOKEN_KEY = 'osu:app_token';
const EXPIRY_MARGIN_MS = 5 * 60 * 1000; // renew 5 minutes early so a token never expires mid-request

/**
 * The scanner doesn't act for any user, so it uses client credentials to get a token that can only read public data.
 * The token lasts about a day and is cached in the kv table instead of being requested every minute.
 *
 * forceNew: ignore the cache and request a new one. Used when the API returns 401: the token may have stopped working
 * before it expired (e.g. the OAuth app was replaced or the client secret regenerated), so the cached expiry is wrong.
 */
export async function getAppToken(env: Env, forceNew = false): Promise<string> {
    const row = forceNew ? null : await env.DB.prepare('SELECT value FROM kv WHERE key = ?').bind(APP_TOKEN_KEY).first<{ value: string }>();
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

/**
 * Revokes this token on osu!, together with its refresh token (osu-web's revokeRecursive).
 * Any token may revoke itself (require-scopes:any), so no special scope is needed.
 * Returns whether it worked. It never throws: revoking is best effort and must not block logging out or deleting data.
 */
export async function revokeToken(accessToken: string): Promise<boolean> {
    try {
        const res = await fetch(`${OSU}/api/v2/oauth/tokens/current`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        return res.ok;
    } catch {
        return false;
    }
}

// ---------- Users' tokens (for reading friend lists) ----------

interface AccountTokenRow {
    access_token: string;
    refresh_token: string;
    token_expires_at: number;
}

/** Called after a successful login: creates or updates the account and stores its tokens encrypted. */
export async function saveAccount(
    env: Env,
    user: { id: number; username: string; is_supporter: boolean },
    tokens: TokenResponse,
): Promise<void> {
    if (!tokens.refresh_token) throw new Error('The authorization code flow should return a refresh token');
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
 * Returns a usable access token for a user, refreshing it with the refresh token if it has expired.
 * null means the user has to log in again: they never logged in, their tokens were cleared on logout (see account.ts),
 * or the refresh token no longer works (e.g. they revoked access on osu!).
 */
export async function getUserToken(env: Env, accountId: number): Promise<string | null> {
    const row = await env.DB.prepare('SELECT access_token, refresh_token, token_expires_at FROM accounts WHERE osu_user_id = ?')
        .bind(accountId)
        .first<AccountTokenRow>();
    if (!row || !row.refresh_token) return null;

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
        // 400 / 401: the refresh token is invalid, so the user has to log in again. Other errors (osu! down, network) are rethrown.
        if (err instanceof OsuApiError && (err.status === 400 || err.status === 401)) return null;
        throw err;
    }

    await env.DB.prepare('UPDATE accounts SET access_token = ?1, refresh_token = ?2, token_expires_at = ?3 WHERE osu_user_id = ?4')
        .bind(
            await encryptToken(env.TOKEN_ENCRYPTION_KEY, res.access_token),
            // osu! issues a new refresh token on refresh; if it ever doesn't, keep the old one
            res.refresh_token ? await encryptToken(env.TOKEN_ENCRYPTION_KEY, res.refresh_token) : row.refresh_token,
            Date.now() + res.expires_in * 1000,
            accountId,
        )
        .run();
    return res.access_token;
}
