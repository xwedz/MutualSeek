// src/friends.ts — syncs a user's friend list and works out who followed back or removed them.
//
// It compares snapshots: the database keeps the list seen last time (friendships), and each new list from osu!
// is compared with it, with every difference recorded as an event (friend_events).
//
//   new on the list           → added (you added them); if they're already mutual, a mutual event too
//   mutual goes false → true  → mutual (they added you back)
//   mutual goes true → false  → unmutual (they removed you)
//   gone from the list        → removed (you removed them)
//
// The first sync has nothing to compare against, so it only records a baseline and creates no events;
// first_seen_at is null, meaning "already a friend before tracking started, added at an unknown time".

import type { Env } from './env';
import { getFriends, getUserToken, OsuApiError, parseTime, type UserRelation } from './osu';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FriendRow {
    target_id: number;
    username: string;
    avatar_url: string | null;
    country_code: string | null;
    last_visit: number | null;
    mutual: number; // SQLite has no booleans: 0 / 1
    first_seen_at: number | null;
    mutual_since: number | null;
}

type EventType = 'added' | 'mutual' | 'unmutual' | 'removed';

export interface SyncResult {
    baseline: boolean;
    added: number;
    mutual: number;
    unmutual: number;
    removed: number;
}

const toDay = (ms: number | null) => (ms === null ? null : Math.floor(ms / DAY_MS));

/** Returns 'relogin' when the token no longer works and the user has to log in again. */
export async function syncFriends(env: Env, accountId: number): Promise<SyncResult | 'relogin'> {
    const db = env.DB;
    const token = await getUserToken(env, accountId);
    if (!token) return 'relogin';

    let relations: UserRelation[];
    try {
        relations = await getFriends(token);
    } catch (err) {
        // Rejected before it expired: usually the user revoked access in their osu! settings
        if (err instanceof OsuApiError && err.status === 401) return 'relogin';
        throw err;
    }

    const account = await db.prepare('SELECT last_synced_at FROM accounts WHERE osu_user_id = ?').bind(accountId).first<{ last_synced_at: number | null }>();
    const baseline = account?.last_synced_at == null;
    const now = Date.now();

    const { results: previous } = await db.prepare('SELECT * FROM friendships WHERE account_id = ?').bind(accountId).all<FriendRow>();
    const remaining = new Map(previous.map(row => [row.target_id, row]));

    const upserts: FriendRow[] = [];
    const events: { targetId: number; username: string; type: EventType }[] = [];

    for (const relation of relations) {
        if (relation.relation_type !== 'friend' || !relation.target) continue;
        const target = relation.target;
        const lastVisit = parseTime(target.last_visit);
        const old = remaining.get(relation.target_id);
        remaining.delete(relation.target_id);

        if (!old) {
            upserts.push({
                target_id: relation.target_id,
                username: target.username,
                avatar_url: target.avatar_url ?? null,
                country_code: target.country_code ?? null,
                last_visit: lastVisit,
                mutual: relation.mutual ? 1 : 0,
                first_seen_at: baseline ? null : now,
                mutual_since: relation.mutual && !baseline ? now : null,
            });
            if (!baseline) {
                events.push({ targetId: relation.target_id, username: target.username, type: 'added' });
                if (relation.mutual) events.push({ targetId: relation.target_id, username: target.username, type: 'mutual' });
            }
            continue;
        }

        const mutualChanged = Boolean(old.mutual) !== relation.mutual;
        if (mutualChanged) {
            events.push({ targetId: relation.target_id, username: target.username, type: relation.mutual ? 'mutual' : 'unmutual' });
        }

        // Only write rows that actually changed: D1 Free allows 100,000 rows written a day, and rewriting a large
        // friend list on every sync would waste it. Last visit only compares the day, or nearly every sync would change.
        const changed =
            mutualChanged ||
            old.username !== target.username ||
            old.avatar_url !== (target.avatar_url ?? null) ||
            toDay(old.last_visit) !== toDay(lastVisit);

        if (changed) {
            upserts.push({
                ...old,
                username: target.username,
                avatar_url: target.avatar_url ?? null,
                country_code: target.country_code ?? null,
                last_visit: lastVisit,
                mutual: relation.mutual ? 1 : 0,
                mutual_since: mutualChanged ? (relation.mutual ? now : null) : old.mutual_since,
            });
        }
    }

    const removed = [...remaining.values()];
    for (const row of removed) events.push({ targetId: row.target_id, username: row.username, type: 'removed' });

    // All writes go in one batch: a D1 batch is a transaction, so if any statement fails the whole batch is rolled
    // back and the list can never be updated without its events (or the other way round).
    const statements: D1PreparedStatement[] = [];

    if (upserts.length > 0) {
        statements.push(
            db
                .prepare(
                    `INSERT INTO friendships (account_id, target_id, username, avatar_url, country_code, last_visit,
                                              mutual, first_seen_at, mutual_since)
                     SELECT ?1, f.value ->> 'target_id', f.value ->> 'username', f.value ->> 'avatar_url',
                            f.value ->> 'country_code', f.value ->> 'last_visit', f.value ->> 'mutual',
                            f.value ->> 'first_seen_at', f.value ->> 'mutual_since'
                     FROM json_each(?2) AS f WHERE true
                     ON CONFLICT (account_id, target_id) DO UPDATE SET
                         username = excluded.username,
                         avatar_url = excluded.avatar_url,
                         country_code = excluded.country_code,
                         last_visit = excluded.last_visit,
                         mutual = excluded.mutual,
                         mutual_since = excluded.mutual_since`,
                )
                .bind(accountId, JSON.stringify(upserts)),
        );
    }

    if (removed.length > 0) {
        statements.push(
            db
                .prepare('DELETE FROM friendships WHERE account_id = ?1 AND target_id IN (SELECT value FROM json_each(?2))')
                .bind(accountId, JSON.stringify(removed.map(row => row.target_id))),
        );
    }

    if (events.length > 0) {
        statements.push(
            db
                .prepare(
                    `INSERT INTO friend_events (account_id, target_id, username, type, at)
                     SELECT ?1, e.value ->> 'targetId', e.value ->> 'username', e.value ->> 'type', ?3
                     FROM json_each(?2) AS e`,
                )
                .bind(accountId, JSON.stringify(events), now),
        );
    }

    statements.push(db.prepare('UPDATE accounts SET last_synced_at = ?1 WHERE osu_user_id = ?2').bind(now, accountId));
    await db.batch(statements);

    const count = (type: EventType) => events.filter(e => e.type === type).length;
    return { baseline, added: count('added'), mutual: count('mutual'), unmutual: count('unmutual'), removed: count('removed') };
}
