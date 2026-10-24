// src/account.ts — logging out and deleting a user's data.
//
// After a user logs in, the database keeps three kinds of data:
//   accounts       name, supporter status, encrypted tokens, last sync time
//   friendships    snapshots of the friend list
//   friend_events  history of who followed back or removed them
//
// Two levels:
//   log out        → revoke and clear the tokens, keep the friend snapshots and history (tracking continues on next login)
//   delete my data → revoke the tokens and delete everything above about this user; can't be undone

import type { Env } from './env';
import { getUserToken, revokeToken } from './osu';

/**
 * Revokes this user's token on osu! and clears it from the database.
 * Syncing only happens while the user has the site open, so tokens aren't needed while logged out and clearing them
 * costs nothing; the next login gets new ones.
 *
 * Note: tokens are shared by the whole account, so logging out on one device means other devices have to log in
 * again to sync.
 */
export async function forgetTokens(env: Env, accountId: number): Promise<void> {
    // Revoke whichever token currently works (if it expired, getUserToken refreshes it first and the new one is revoked).
    // If none can be obtained (already invalid, network error), skip revoking but still clear the stored tokens.
    const token = await getUserToken(env, accountId).catch(() => null);
    const revoked = token ? await revokeToken(token) : false;
    console.log(`[account] ${accountId} token: ${token ? (revoked ? 'revoked on osu!' : 'revoke failed') : 'already invalid, nothing to revoke'}`);

    await env.DB.prepare(`UPDATE accounts SET access_token = '', refresh_token = '', token_expires_at = 0 WHERE osu_user_id = ?`)
        .bind(accountId)
        .run();
}

/** Revokes the tokens and deletes all of this user's data. The three deletes share one batch (a transaction), so it never half-finishes. */
export async function deleteAccountData(env: Env, accountId: number): Promise<void> {
    await forgetTokens(env, accountId);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM friend_events WHERE account_id = ?').bind(accountId),
        env.DB.prepare('DELETE FROM friendships WHERE account_id = ?').bind(accountId),
        env.DB.prepare('DELETE FROM accounts WHERE osu_user_id = ?').bind(accountId),
    ]);
    console.log(`[account] all data for ${accountId} deleted`);
}
