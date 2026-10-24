// src/shuffle.ts — the order of the candidate list
//
// Every listed player gets a random shuffle_key when first stored (see src/crawler.ts, migration 0008). Picture the
// keys on a ring: each user starts reading at their own point and wraps around at the end. Everyone sees the same
// players, but different users start at different places, so no small group sits at the top of everyone's first page.
// The start point depends on the user and the date (UTC), so it stays put within a day (pages, reloads and the back
// button keep working) and moves the next day.

/** shuffle_key is an integer in [0, SHUFFLE_RANGE) */
export const SHUFFLE_RANGE = 1_000_000_000;

/** SQL expression for a new player's shuffle_key */
export const NEW_SHUFFLE_KEY_SQL = `abs(random() % ${SHUFFLE_RANGE})`;

/** FNV-1a: a small, fast hash that spreads similar inputs (consecutive ids, consecutive days) far apart */
function fnv1a(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0; // as an unsigned 32-bit integer
}

/** Where this user starts reading the ring today */
export function ringStart(osuUserId: number, now: number): number {
    const day = new Date(now).toISOString().slice(0, 10); // e.g. 2026-10-24 (UTC)
    return fnv1a(`${osuUserId}:${day}`) % SHUFFLE_RANGE;
}
