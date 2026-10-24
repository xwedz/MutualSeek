import { ChevronIcon } from './Icons';

interface Props {
    page: number;
    hasNext: boolean;
    disabled: boolean; // disabled while loading, so repeated clicks can't skip pages
    onChange: (page: number) => void;
}

/**
 * "‹ Previous   Page 3   Next ›". No total page count: computing it would mean counting every candidate each time,
 * which the free plan's read allowance can't afford. The backend only says whether a next page exists, so this display is always accurate.
 */
export function Pagination({ page, hasNext, disabled, onChange }: Props) {
    const button =
        'inline-flex items-center gap-1 rounded-xl border border-line px-3.5 py-2 text-sm font-medium transition-colors enabled:hover:border-pink/50 disabled:cursor-not-allowed disabled:opacity-40';

    return (
        <nav aria-label="Pages" className="mt-6 flex items-center justify-center gap-3">
            <button type="button" className={button} disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>
                <ChevronIcon size={14} className="rotate-90" />
                Previous
            </button>
            <span className="min-w-16 text-center text-sm text-muted tabular-nums" aria-current="page">
                Page {page}
            </span>
            <button type="button" className={button} disabled={disabled || !hasNext} onClick={() => onChange(page + 1)}>
                Next
                <ChevronIcon size={14} className="-rotate-90" />
            </button>
        </nav>
    );
}
