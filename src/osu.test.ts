import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatRateLimit, readRateLimit } from './osu';

describe('readRateLimit', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reads the API rate limit headers', () => {
        const headers = new Headers({ 'X-RateLimit-Limit': '1200', 'X-RateLimit-Remaining': '1187', 'Retry-After': '30' });
        expect(readRateLimit(headers)).toEqual({ limit: 1200, remaining: 1187, retryAfterSeconds: 30 });
    });

    it('turns a Retry-After date into seconds from now', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.UTC(2026, 10, 3, 5, 0, 0));
        const headers = new Headers({ 'Retry-After': 'Tue, 03 Nov 2026 05:02:00 GMT' });
        expect(readRateLimit(headers).retryAfterSeconds).toBe(120);
    });

    it('returns nulls for missing or unreadable headers', () => {
        const headers = new Headers({ 'X-RateLimit-Remaining': '', 'Retry-After': 'soon' });
        expect(readRateLimit(headers)).toEqual({ limit: null, remaining: null, retryAfterSeconds: null });
    });
});

describe('formatRateLimit', () => {
    it('shows what osu! sent', () => {
        expect(formatRateLimit({ limit: 1200, remaining: 1187, retryAfterSeconds: null })).toBe('remaining 1187/1200');
        expect(formatRateLimit({ limit: null, remaining: 0, retryAfterSeconds: 60 })).toBe('remaining 0/?, retry-after 60s');
    });

    it('says so when there were no headers at all', () => {
        expect(formatRateLimit({ limit: null, remaining: null, retryAfterSeconds: null })).toBe('no rate limit headers');
    });
});
