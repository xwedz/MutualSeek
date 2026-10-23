import { formatNumber } from '../format';
import type { StatsResponse } from '../types';

const MODE_NAMES: Record<string, string> = { osu: 'osu!', taiko: 'osu!taiko', fruits: 'osu!catch', mania: 'osu!mania' };

export function Footer({ stats }: { stats: StatsResponse | null }) {
    const scope = stats?.countries.trim().toLowerCase() === 'all' ? 'every country' : stats?.countries.replaceAll(',', ', ');

    return (
        <footer className="mt-16 border-t border-line pt-6 pb-10 text-sm text-muted">
            {stats && (
                <p className="animate-fade-in">
                    Scanning active {MODE_NAMES[stats.mode] ?? stats.mode} players in {scope} (top 10,000 per country, refreshed about
                    monthly). {formatNumber(stats.passScanned)} profiles checked in the current round
                    {stats.mentioned !== null && <>, {formatNumber(stats.mentioned)} players mention mutuals</>}.
                </p>
            )}
            <p className="mt-2">
                Read-only: this site can see your friend list, but it can't add friends or send messages for you. Not affiliated with
                osu! or ppy Pty Ltd.
            </p>
        </footer>
    );
}
