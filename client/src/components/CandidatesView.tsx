import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCandidates } from '../api';
import type { Candidate } from '../types';
import { useLocalStorage } from '../useLocalStorage';
import { CandidateCard } from './CandidateCard';
import { ChevronIcon, PencilIcon, Spinner } from './Icons';
import { Segmented } from './Segmented';

const DEFAULT_TEMPLATE = "Hi {name}! Saw on your profile that you're open to mutuals, just added you :)";
const LEAVE_MS = 250; // 跟 index.css 的 fade-out 時間一致
const COPIED_MS = 1600;

type Level = 'strong' | 'any';

export function CandidatesView({ loggedIn }: { loggedIn: boolean }) {
    const [level, setLevel] = useLocalStorage<Level>('filter.level', 'strong');
    const [active, setActive] = useLocalStorage<number>('filter.active', 30);
    const [template, setTemplate] = useLocalStorage('dm.template', DEFAULT_TEMPLATE);
    const [skipped, setSkipped] = useLocalStorage<number[]>('skipped', []);

    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [leaving, setLeaving] = useState<number[]>([]);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [editingTemplate, setEditingTemplate] = useState(false);
    const copiedTimer = useRef<number | undefined>(undefined);
    // 篩選條件快速切換時，只採用最後一次請求的結果，避免舊結果晚到蓋掉新結果
    const requestId = useRef(0);

    const load = useCallback(
        async (offset: number) => {
            const id = ++requestId.current;
            setLoading(true);
            setError(null);
            try {
                const data = await fetchCandidates({ level, active, offset });
                if (id !== requestId.current) return;
                setCandidates(prev => (offset === 0 ? data.candidates : [...prev, ...data.candidates]));
                setHasMore(data.hasMore);
            } catch (err) {
                if (id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load players.');
            } finally {
                if (id === requestId.current) setLoading(false);
            }
        },
        [level, active],
    );

    useEffect(() => {
        load(0);
    }, [load]);

    const skippedSet = new Set(skipped);
    const visible = candidates.filter(c => !skippedSet.has(c.id));

    function skip(id: number) {
        setLeaving(prev => [...prev, id]);
        window.setTimeout(() => {
            setSkipped(prev => (prev.includes(id) ? prev : [...prev, id]));
            setLeaving(prev => prev.filter(x => x !== id));
        }, LEAVE_MS);
    }

    async function copy(candidate: Candidate) {
        try {
            await navigator.clipboard.writeText(template.replaceAll('{name}', candidate.username));
            setCopiedId(candidate.id);
            window.clearTimeout(copiedTimer.current);
            copiedTimer.current = window.setTimeout(() => setCopiedId(null), COPIED_MS);
        } catch {
            setError('Could not copy to the clipboard. Your browser may be blocking it.');
        }
    }

    return (
        <section>
            <div className="flex flex-wrap items-center gap-3">
                <Segmented<Level>
                    label="Signal strength"
                    value={level}
                    onChange={setLevel}
                    options={[
                        { value: 'strong', label: 'Clearly looking' },
                        { value: 'any', label: 'Include maybes' },
                    ]}
                />
                <Segmented<number>
                    label="Last seen"
                    value={active}
                    onChange={setActive}
                    options={[
                        { value: 7, label: '7 days' },
                        { value: 30, label: '30 days' },
                        { value: 90, label: '90 days' },
                    ]}
                />
                <button
                    type="button"
                    onClick={() => setEditingTemplate(v => !v)}
                    aria-expanded={editingTemplate}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-muted transition-colors hover:text-ink"
                >
                    <PencilIcon size={14} />
                    Message template
                    <ChevronIcon size={14} className={`transition-transform duration-300 ${editingTemplate ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* 用 grid-rows 0fr → 1fr 的技巧做高度展開動畫，不用量測元素高度 */}
            <div
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out-expo ${
                    editingTemplate ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
            >
                <div className="overflow-hidden">
                    <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
                        <label htmlFor="template" className="text-sm text-muted">
                            "Copy message" puts this on your clipboard. <code className="text-pink">{'{name}'}</code> becomes their username.
                            You still send it yourself on osu!.
                        </label>
                        <textarea
                            id="template"
                            value={template}
                            onChange={e => setTemplate(e.target.value)}
                            rows={2}
                            tabIndex={editingTemplate ? 0 : -1}
                            className="mt-2 w-full resize-y rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-pink/60"
                        />
                        <button
                            type="button"
                            onClick={() => setTemplate(DEFAULT_TEMPLATE)}
                            tabIndex={editingTemplate ? 0 : -1}
                            className="mt-1 text-xs text-muted transition-colors hover:text-ink"
                        >
                            Reset to default
                        </button>
                    </div>
                </div>
            </div>

            <p className="mt-4 text-sm text-muted">
                {loggedIn
                    ? 'People already on your friend list are hidden (as of your last sync).'
                    : 'Log in to hide people who are already on your friend list.'}
                {skipped.length > 0 && (
                    <>
                        {' '}
                        <button type="button" onClick={() => setSkipped([])} className="text-pink transition-colors hover:text-pink-2">
                            Show {skipped.length} skipped
                        </button>
                    </>
                )}
            </p>

            {error && <p className="mt-4 animate-fade-in rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

            <ul className="mt-4 grid gap-3">
                {visible.map((c, i) => (
                    <CandidateCard
                        key={c.id}
                        candidate={c}
                        index={i}
                        leaving={leaving.includes(c.id)}
                        copied={copiedId === c.id}
                        onCopy={() => copy(c)}
                        onSkip={() => skip(c.id)}
                    />
                ))}
            </ul>

            {loading && (
                <div className="mt-6 flex animate-fade-in justify-center text-muted">
                    <Spinner size={22} />
                </div>
            )}

            {!loading && !error && visible.length === 0 && (
                <p className="mt-6 animate-fade-in rounded-2xl border border-dashed border-line px-4 py-10 text-center text-muted">
                    No one matches these filters yet. The scanner checks a few players every minute, so check back later or try
                    "Include maybes".
                </p>
            )}

            {!loading && hasMore && (
                <div className="mt-5 flex justify-center">
                    <button
                        type="button"
                        onClick={() => load(candidates.length)}
                        className="animate-fade-in rounded-xl border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:border-pink/50"
                    >
                        Load more
                    </button>
                </div>
            )}
        </section>
    );
}
