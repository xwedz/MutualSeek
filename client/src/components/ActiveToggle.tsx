import { CheckIcon } from './Icons';

interface Props {
    pressed: boolean;
    onToggle: () => void;
}

/**
 * "Online in the past week" filter, next to the country menu. A filter rather than a sort: sorting by last visit put
 * whoever had just logged in at the top of everyone's list, while this keeps the shuffled order (see src/shuffle.ts).
 */
export function ActiveToggle({ pressed, onToggle }: Props) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={pressed}
            title="Only players seen online in the last 7 days"
            className={`inline-flex items-center gap-2 rounded-xl border bg-surface px-3 py-2 text-sm transition-colors ${
                pressed ? 'border-pink/60 text-ink' : 'border-line text-muted hover:border-pink/50 hover:text-ink'
            }`}
        >
            <span
                aria-hidden="true"
                className={`grid size-4 place-items-center rounded-[5px] border transition-colors ${
                    pressed ? 'border-pink bg-pink text-bg' : 'border-muted/60'
                }`}
            >
                <CheckIcon size={11} strokeWidth={3} className={`transition-opacity ${pressed ? 'opacity-100' : 'opacity-0'}`} />
            </span>
            Online in the past week
        </button>
    );
}
