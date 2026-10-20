import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { fetchCandidates, profileUrl } from '../api';
import { countryName } from '../countries';
import type { Candidate, StatsResponse } from '../types';
import { useLocalStorage } from '../useLocalStorage';
import { CandidateCard } from './CandidateCard';
import { CountrySelect } from './CountrySelect';
import { ChevronIcon, InfoIcon, PencilIcon, Spinner } from './Icons';
import { ConfirmDialog } from './ConfirmDialog';

const DEFAULT_TEMPLATE = "Hi {name}! Saw on your profile that you're open to mutuals, just added you :)";
const LEAVE_MS = 250; // 跟 index.css 的 fade-out 時間一致
const COPIED_MS = 1600;

interface Props {
    loggedIn: boolean;
    defaultCountry: string | null; // 登入者自己的國家
    stats: StatsResponse | null;
}

export function CandidatesView({ loggedIn, defaultCountry, stats }: Props) {
    // 使用者自己選過的國家（記在瀏覽器）；沒選過就用自己的國家，沒登入就看所有國家
    const [chosenCountry, setChosenCountry] = useLocalStorage<string | null>('filter.country', null);
    const country = chosenCountry ?? defaultCountry ?? 'all';
    const [template, setTemplate] = useLocalStorage('dm.template', DEFAULT_TEMPLATE);
    const [skipped, setSkipped] = useLocalStorage<number[]>('skipped', []);
    // 使用者是否已經看過「請先讀對方寫了什麼」的說明視窗
    const [readFirstSeen, setReadFirstSeen] = useLocalStorage('notice.readFirst', false);
    const [dialogFor, setDialogFor] = useState<Candidate | null>(null);

    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [leaving, setLeaving] = useState<number[]>([]);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [editingTemplate, setEditingTemplate] = useState(false);
    const copiedTimer = useRef<number | undefined>(undefined);
    // 只採用最後一次請求的結果，避免舊結果晚到蓋掉新結果（例如快速切換國家時）
    const requestId = useRef(0);

    const load = useCallback(
        async (offset: number) => {
            const id = ++requestId.current;
            setLoading(true);
            setError(null);
            // 換國家（從頭載入）時先清空，不要讓上一個國家的人留在畫面上
            if (offset === 0) setCandidates([]);
            try {
                const data = await fetchCandidates(offset, country);
                if (id !== requestId.current) return;
                setCandidates(prev => (offset === 0 ? data.candidates : [...prev, ...data.candidates]));
                setHasMore(data.hasMore);
            } catch (err) {
                if (id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load players.');
            } finally {
                if (id === requestId.current) setLoading(false);
            }
        },
        [country],
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

    // 第一次開個人頁面時，先攔下連結、顯示說明視窗；看過之後就讓連結照常開新分頁
    function open(event: MouseEvent<HTMLAnchorElement>, candidate: Candidate) {
        if (readFirstSeen) return;
        event.preventDefault();
        setDialogFor(candidate);
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
            {/* 固定的提醒：工具只找「有提到」mutual 的人，想不想要由使用者讀了再判斷 */}
            <p className="flex items-start gap-2.5 rounded-xl border border-pink/25 bg-pink/5 px-4 py-3 text-sm text-ink/90">
                <InfoIcon size={16} className="mt-0.5 shrink-0 text-pink" />
                <span>
                    These players <span className="font-semibold">mention</span> mutuals on their profile. Read what they wrote before
                    adding them: some mention mutuals only to say no.
                </span>
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <CountrySelect value={country} countries={(stats?.byCountry ?? []).map(c => c.code)} onChange={setChosenCountry} />
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
                        showCountry={country === 'all'}
                        index={i}
                        leaving={leaving.includes(c.id)}
                        copied={copiedId === c.id}
                        onOpen={e => open(e, c)}
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
                    {country === 'all' ? 'No one to show yet.' : `No one from ${countryName(country)} yet.`} The scanner goes
                    through every country in turn, a few players every minute, so check back later.
                </p>
            )}

            {dialogFor && (
                // 第一次開個人頁面時的說明，按確認後就不再出現。
                // 只出現一次是刻意的：同樣的視窗每次都跳，使用者很快就會不看內容直接關掉（警告疲勞）。
                <ConfirmDialog
                    title={`Before you add ${dialogFor.username}`}
                    confirmLabel="I understand, open profile"
                    onConfirm={() => {
                        setReadFirstSeen(true);
                        // 在點擊當下開分頁；noopener 讓新分頁拿不到這個頁面的 window 物件
                        window.open(profileUrl(dialogFor.id), '_blank', 'noopener,noreferrer');
                    }}
                    onClose={() => setDialogFor(null)}
                >
                    <p>
                        This list shows players whose profile <span className="font-semibold text-pink">mentions</span> mutuals. It can't
                        tell whether they actually want them. Some people mention mutuals only to say no.
                    </p>
                    <p>Please read what they wrote yourself before adding or messaging them, so you don't bother anyone who isn't looking.</p>
                </ConfirmDialog>
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
