// 顯示用的小工具：相對時間、數字格式。

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(ms: number | null, now = Date.now()): string {
    if (ms === null) return 'hidden';
    const diff = Math.max(0, now - ms);
    if (diff < HOUR) return 'just now';
    if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
    const days = Math.floor(diff / DAY);
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

export const daysSince = (ms: number, now = Date.now()) => Math.floor((now - ms) / DAY);

export const formatNumber = (value: number | null) => (value === null ? '–' : Math.round(value).toLocaleString('en-US'));
