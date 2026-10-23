// splitRankingPage：一頁排行榜裡，誰要掃描、誰跳過（npm test）。

import { describe, expect, it } from 'vitest';
import { splitRankingPage } from './crawler';
import type { RankingResponse } from './osu';

/** 只填判斷會用到的欄位 */
const entry = (id: number, user: { is_active?: boolean; is_supporter?: boolean }) =>
    ({ user: { id, ...user }, global_rank: null, pp: null }) as unknown as RankingResponse['ranking'][number];

describe('splitRankingPage', () => {
    it('skips inactive players regardless of supporter status', () => {
        const page = splitRankingPage([entry(1, { is_active: false, is_supporter: true })], new Set([1]));
        expect(page).toEqual({ toScan: [], inactive: [1], skipped: 0 });
    });

    it('skips known non-supporters who are still not supporters', () => {
        const page = splitRankingPage([entry(1, { is_active: true, is_supporter: false })], new Set([1]));
        expect(page).toEqual({ toScan: [], inactive: [], skipped: 1 });
    });

    it('scans known non-supporters who have become supporters since', () => {
        const page = splitRankingPage([entry(1, { is_active: true, is_supporter: true })], new Set([1]));
        expect(page.toScan).toEqual([1]);
    });

    it('scans non-supporters we have not recorded yet (first pass)', () => {
        const page = splitRankingPage([entry(1, { is_active: true, is_supporter: false })], new Set());
        expect(page.toScan).toEqual([1]);
    });

    it('scans when the API leaves a field out, rather than risk missing someone', () => {
        const page = splitRankingPage([entry(1, {}), entry(2, { is_active: true })], new Set([1, 2]));
        expect(page).toEqual({ toScan: [1, 2], inactive: [], skipped: 0 });
    });

    it('keeps ranking order for the players to scan', () => {
        const page = splitRankingPage(
            [
                entry(3, { is_active: true, is_supporter: true }),
                entry(1, { is_active: true, is_supporter: false }),
                entry(2, { is_active: false }),
                entry(4, { is_active: true, is_supporter: false }),
            ],
            new Set([1]),
        );
        expect(page).toEqual({ toScan: [3, 4], inactive: [2], skipped: 1 });
    });
});
