import { useEffect, useState } from 'react';
import { fetchStats } from '../api';
import { formatNumber } from '../format';
import type { StatsResponse } from '../types';

const MODE_NAMES: Record<string, string> = { osu: 'osu!', taiko: 'osu!taiko', fruits: 'osu!catch', mania: 'osu!mania' };

export function Footer() {
    const [stats, setStats] = useState<StatsResponse | null>(null);

    useEffect(() => {
        fetchStats().then(setStats, () => setStats(null));
    }, []);

    const s = stats?.stats;

    return (
        <footer className="mt-16 border-t border-line pt-6 pb-10 text-sm text-muted">
            {stats && (
                <p className="animate-fade-in">
                    Scanning active players in the {stats.country} {MODE_NAMES[stats.mode] ?? stats.mode} ranking
                    {s
                        ? `: ${formatNumber(s.scanned)} of ${formatNumber(s.players)} profiles checked, ${formatNumber(s.strong)} clearly looking for mutuals.`
                        : '. The first results will show up within a few minutes.'}
                </p>
            )}
            <p className="mt-2">
                Read-only: this site can see your friend list, but it can't add friends or send messages for you. Not affiliated with
                osu! or ppy Pty Ltd.
            </p>
        </footer>
    );
}
