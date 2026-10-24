import { describe, expect, it } from 'vitest';
import { ringStart, SHUFFLE_RANGE } from './shuffle';

const DAY = 24 * 60 * 60 * 1000;
const NOON = Date.UTC(2026, 9, 24, 12);

describe('ringStart', () => {
    it('stays the same within a UTC day', () => {
        const startOfDay = Date.UTC(2026, 9, 24);
        expect(ringStart(7452418, startOfDay)).toBe(ringStart(7452418, startOfDay + DAY - 1));
        expect(ringStart(7452418, NOON)).toBe(ringStart(7452418, startOfDay));
    });

    it('moves to a different point the next day', () => {
        expect(ringStart(7452418, NOON + DAY)).not.toBe(ringStart(7452418, NOON));
    });

    it('gives different users different start points', () => {
        const starts = new Set(Array.from({ length: 1000 }, (_, i) => ringStart(1000 + i, NOON)));
        expect(starts.size).toBeGreaterThan(990); // collisions are possible but rare
    });

    it('stays inside the key range', () => {
        for (let id = 1; id <= 1000; id++) {
            const start = ringStart(id, NOON);
            expect(Number.isInteger(start)).toBe(true);
            expect(start).toBeGreaterThanOrEqual(0);
            expect(start).toBeLessThan(SHUFFLE_RANGE);
        }
    });

    it('spreads start points across the whole ring', () => {
        // Split the ring into 10 equal parts: 1000 consecutive user ids should land in every part, none overloaded
        const buckets = new Array(10).fill(0);
        for (let id = 1; id <= 1000; id++) buckets[Math.floor((ringStart(id, NOON) / SHUFFLE_RANGE) * 10)]++;
        for (const count of buckets) {
            expect(count).toBeGreaterThan(50);
            expect(count).toBeLessThan(150);
        }
    });
});
