import { ChevronIcon } from './Icons';

interface Props {
    page: number;
    hasNext: boolean;
    disabled: boolean; // 載入中先停用，避免連按跳過頭
    onChange: (page: number) => void;
}

/**
 * 「‹ Previous   Page 3   Next ›」。不顯示總頁數：要算總數就得每次把所有候選人數一遍，
 * 免費方案的讀取額度負擔不起；後端只回答「還有沒有下一頁」，所以這樣顯示永遠是準的。
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
