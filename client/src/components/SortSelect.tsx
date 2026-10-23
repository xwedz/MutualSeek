import type { CandidateSort } from '../types';
import { ChevronIcon } from './Icons';

const OPTIONS: { value: CandidateSort; label: string }[] = [
    { value: 'recent', label: 'Recently online' },
    { value: 'rank', label: 'Highest rank' },
    { value: 'followers', label: 'Most followers' },
];

interface Props {
    value: CandidateSort;
    onChange: (value: CandidateSort) => void;
}

/** 排序選單。外觀和 CountrySelect 一樣，用原生 <select>（理由見 CountrySelect）。 */
export function SortSelect({ value, onChange }: Props) {
    return (
        <label className="relative inline-flex items-center">
            <span className="sr-only">Sort by</span>
            <select
                value={value}
                onChange={e => onChange(e.target.value as CandidateSort)}
                className="appearance-none rounded-xl border border-line bg-surface py-2 pr-9 pl-3 text-sm text-ink transition-colors hover:border-pink/50 focus:border-pink/60 focus:outline-none"
            >
                {OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>
            <ChevronIcon size={14} className="pointer-events-none absolute right-3 text-muted" />
        </label>
    );
}
