// src/friends.ts —— 同步好友名單，找出「誰回加了、誰取消了 mutual」。
//
// 做法是「快照比對」：資料庫存著上次看到的名單（friendships），
// 這次從 osu! 拿到新名單後逐一比對，把差異記成事件（friend_events）。
//
//   新出現的人          → added（你加了對方）；如果一出現就是 mutual，再記一筆 mutual
//   mutual 從否變成是   → mutual（對方回加了）
//   mutual 從是變成否   → unmutual（對方把你移除了）
//   從名單消失          → removed（你把對方移除了）
//
// 第一次同步沒有「上次」可以比，只建立基準，不產生事件；
// first_seen_at 記成 null，代表「開始追蹤前就是好友，不知道是什麼時候加的」。

import type { Env } from './env';
import { getFriends, getUserToken, OsuApiError, parseTime, type UserRelation } from './osu';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FriendRow {
    target_id: number;
    username: string;
    avatar_url: string | null;
    country_code: string | null;
    last_visit: number | null;
    mutual: number; // SQLite 沒有布林，0 / 1
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

/** 回傳 'relogin' 代表 token 失效，需要使用者重新登入。 */
export async function syncFriends(env: Env, accountId: number): Promise<SyncResult | 'relogin'> {
    const db = env.DB;
    const token = await getUserToken(env, accountId);
    if (!token) return 'relogin';

    let relations: UserRelation[];
    try {
        relations = await getFriends(token);
    } catch (err) {
        // token 還沒過期卻被拒絕：多半是使用者在 osu! 設定頁撤銷了授權
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

        // 只有真的有變才寫入：D1 免費方案每天寫入 10 萬列，好友多的人每次同步全部重寫很浪費。
        // 最後上線時間只比較「哪一天」，不然幾乎每次同步都會有人變動。
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

    // 全部寫入放在同一個 batch：D1 的 batch 是一個交易（transaction），
    // 中途任何一句失敗就整批取消，不會出現「名單更新了、事件卻沒記到」的半套狀態。
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
