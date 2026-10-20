// 分段選擇器：底下的粉色滑塊會滑到選中的那一格。
// 減少動態時不滑動：滑塊隱藏，改由選中的按鈕自己淡入背景色。

interface Props<T extends string | number> {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: Props<T>) {
    const index = Math.max(
        0,
        options.findIndex(o => o.value === value),
    );

    return (
        <div
            role="radiogroup"
            aria-label={label}
            className="relative inline-grid rounded-xl border border-line bg-surface p-1"
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
            <span
                aria-hidden="true"
                className="absolute top-1 bottom-1 left-1 rounded-lg bg-pink/15 transition-transform duration-300 ease-out-expo motion-reduce:hidden"
                style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
            />
            {options.map(option => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(option.value)}
                        className={`relative rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-300 ${
                            selected ? 'font-semibold text-pink motion-reduce:bg-pink/15' : 'text-muted hover:text-ink'
                        }`}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
