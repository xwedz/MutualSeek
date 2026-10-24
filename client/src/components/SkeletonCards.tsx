/**
 * Placeholder cards with the same shape as CandidateCard, fading out towards the bottom. Used where the list isn't
 * shown yet (logged out, or the guidelines not accepted). Static on purpose: nothing is loading. aria-hidden since
 * they carry no content.
 */
export function SkeletonCards() {
    return (
        <ul aria-hidden="true" className="grid gap-3 [mask-image:linear-gradient(to_bottom,black_30%,transparent)]">
            {[0, 1, 2].map(i => (
                <SkeletonCard key={i} index={i} />
            ))}
        </ul>
    );
}

/** Avatar, name, stats, excerpt and buttons, drawn with plain blocks */
function SkeletonCard({ index }: { index: number }) {
    const bar = 'rounded-full bg-surface-2';
    return (
        <li style={{ animationDelay: `${index * 45}ms` }} className="animate-fade-up rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
                <div className="size-12 shrink-0 rounded-xl bg-surface-2" />
                <div className="flex-1 pt-1">
                    <div className={`${bar} h-4 w-32`} />
                    <div className="mt-2.5 flex gap-3">
                        <div className={`${bar} h-3 w-20`} />
                        <div className={`${bar} h-3 w-14`} />
                        <div className={`${bar} hidden h-3 w-20 sm:block`} />
                    </div>
                </div>
            </div>
            <div className="mt-3 space-y-2 rounded-xl border-l-2 border-pink/20 bg-surface-2/40 px-3 py-3">
                <div className={`${bar} h-3 w-11/12`} />
                <div className={`${bar} h-3 w-2/3`} />
            </div>
            <div className="mt-3 flex gap-2">
                <div className="h-9 w-28 rounded-xl bg-pink/20" />
                <div className="h-9 w-32 rounded-xl border border-line" />
            </div>
        </li>
    );
}
