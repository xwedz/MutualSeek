// src/account.ts —— 登出與刪除使用者資料。
//
// 使用者登入後，資料庫會保存三種資料：
//   accounts       名稱、supporter 狀態、加密後的 token、最後同步時間
//   friendships    好友名單的快照
//   friend_events  誰回加了、誰取消了 mutual 的紀錄
//
// 兩個層級：
//   登出         → 撤銷並清除 token，保留好友快照與紀錄（下次登入可以接著追蹤）
//   刪除我的資料 → 撤銷 token，並刪除上面三種資料裡跟這個人有關的全部內容，無法復原

import type { Env } from './env';
import { getUserToken, revokeToken } from './osu';

/**
 * 向 osu! 撤銷這個人的 token，並從資料庫清除。
 * 目前的同步只在使用者打開網站時進行，登出期間本來就用不到 token，所以清除沒有代價；下次登入會拿到新的。
 *
 * 注意：token 是「整個帳號共用」的，在一台裝置登出，其他裝置也要重新登入才能同步好友名單。
 */
export async function forgetTokens(env: Env, accountId: number): Promise<void> {
    // 拿目前可用的 token 來撤銷（過期的話 getUserToken 會先換新的，再撤銷新的那個）。
    // 拿不到（已經失效、網路錯誤）就跳過撤銷，但資料庫裡的 token 照樣清掉。
    const token = await getUserToken(env, accountId).catch(() => null);
    const revoked = token ? await revokeToken(token) : false;
    console.log(`[account] ${accountId} 的 token：${token ? (revoked ? '已向 osu! 撤銷' : '撤銷失敗') : '已經失效，不需撤銷'}`);

    await env.DB.prepare(`UPDATE accounts SET access_token = '', refresh_token = '', token_expires_at = 0 WHERE osu_user_id = ?`)
        .bind(accountId)
        .run();
}

/** 撤銷 token，並刪除這個人的所有資料。三個刪除放在同一個 batch（交易），不會只刪了一半。 */
export async function deleteAccountData(env: Env, accountId: number): Promise<void> {
    await forgetTokens(env, accountId);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM friend_events WHERE account_id = ?').bind(accountId),
        env.DB.prepare('DELETE FROM friendships WHERE account_id = ?').bind(accountId),
        env.DB.prepare('DELETE FROM accounts WHERE osu_user_id = ?').bind(accountId),
    ]);
    console.log(`[account] ${accountId} 的資料已全部刪除`);
}
