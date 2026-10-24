import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { fetchCandidates, profileUrl } from '../api';
import { countryName } from '../countries';
import type { Candidate, CandidateSort, StatsResponse } from '../types';
import { useLocalStorage } from '../useLocalStorage';
import { CandidateCard } from './CandidateCard';
import { CountrySelect } from './CountrySelect';
import { ChevronIcon, InfoIcon, PencilIcon, Spinner } from './Icons';
import { ConfirmDialog } from './ConfirmDialog';
import { ListingButton } from './ListingButton';
import { Pagination } from './Pagination';
import { SortSelect } from './SortSelect';

const SORTS: readonly CandidateSort[] = ['recent', 'rank', 'followers'];

const DEFAULT_TEMPLATE = "Hi {name}! Saw on your profile that you're open to mutuals, just added you :)";
const LEAVE_MS = 250; // 跟 index.css 的 fade-out 時間一致
const COPIED_MS = 1600;

/** 從網址讀頁碼（?page=3）；沒有或格式不對就是第 1 頁。 */
function readPageFromUrl(): number {
    const page = Math.floor(Number(new URLSearchParams(window.location.search).get('page')));
    return Number.isFinite(page) && page >= 1 ? page : 1;
}

/** 把頁碼寫回網址。第 1 頁不寫參數，網址保持乾淨。 */
function writePageToUrl(page: number, mode: 'push' | 'replace') {
    const url = new URL(window.location.href);
    if (page === 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(page));
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
}

interface Props {
    loggedIn: boolean;
    defaultCountry: string | null; // 登入者自己的國家
    stats: StatsResponse | null;
    optedOut: boolean; // 登入者選了「Don't list me」
    onSetListing: (listed: boolean) => Promise<void>;
}

export function CandidatesView({ loggedIn, defaultCountry, stats, optedOut, onSetListing }: Props) {
    // 使用者自己選過的國家（記在瀏覽器）；沒選過就用自己的國家，沒登入就看所有國家
    const [chosenCountry, setChosenCountry] = useLocalStorage<string | null>('filter.country', null);
    const country = chosenCountry ?? defaultCountry ?? 'all';
    // 排序也記在瀏覽器；存的值不認得（例如之後拿掉了某個選項）就退回預設
    const [storedSort, setSort] = useLocalStorage<CandidateSort>('filter.sort', 'recent');
    const sort = SORTS.includes(storedSort) ? storedSort : 'recent';
    const [template, setTemplate] = useLocalStorage('dm.template', DEFAULT_TEMPLATE);
    const [skipped, setSkipped] = useLocalStorage<number[]>('skipped', []);
    // 使用者是否已經看過「請先讀對方寫了什麼」的說明視窗
    const [readFirstSeen, setReadFirstSeen] = useLocalStorage('notice.readFirst', false);
    const [dialogFor, setDialogFor] = useState<Candidate | null>(null);

    // 頁碼放在網址（?page=3），重新整理或按瀏覽器的「上一頁」都會回到同一頁
    const [page, setPage] = useState(readPageFromUrl);
    const listRef = useRef<HTMLUListElement>(null);

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

    // 換頁時不先清空列表：舊的卡片會稍微變暗表示載入中，新的到了再淡入取代，畫面不會突然空掉
    const load = useCallback(async () => {
        const id = ++requestId.current;
        setLoading(true);
        setError(null);
        try {
            const data = await fetchCandidates(page, country, sort);
            if (id !== requestId.current) return;
            setCandidates(data.candidates);
            setHasMore(data.hasMore);
        } catch (err) {
            if (id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load players.');
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [page, country, sort]);

    useEffect(() => {
        load();
    }, [load]);

    // 按瀏覽器的「上一頁 / 下一頁」時，網址的頁碼變了，同步回畫面
    useEffect(() => {
        const onPopState = () => setPage(readPageFromUrl());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    // 換頁後要不要捲回列表頂端：等新的卡片畫好之後才決定。
    // 如果在按下的瞬間就捲，新資料到了之後頁面高度會改變（例如最後一頁比較短），瀏覽器會自己再調整，
    // 每次停的位置就會不一樣。
    const scrollAfterLoad = useRef(false);

    useEffect(() => {
        if (loading || !scrollAfterLoad.current) return;
        scrollAfterLoad.current = false;
        const list = listRef.current;
        if (!list) return;
        const MARGIN = 16;
        const top = list.getBoundingClientRect().top;
        // 列表頂端還在畫面裡就不動；被捲出畫面了才捲回去，而且每次都停在同一個位置（離畫面頂端 16px）
        if (top >= MARGIN) return;
        // 減少動態時直接跳過去，不做捲動動畫
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: window.scrollY + top - MARGIN, behavior: smooth ? 'smooth' : 'auto' });
    }, [loading, candidates]);

    /** 換頁：更新網址（留下瀏覽紀錄），新的卡片畫好後再視情況捲回列表頂端。 */
    function goToPage(next: number) {
        scrollAfterLoad.current = true;
        setPage(next);
        writePageToUrl(next, 'push');
    }

    /** 換國家：回到第 1 頁（取代目前的瀏覽紀錄，不然按「上一頁」會回到別的國家的頁碼）。 */
    function changeCountry(next: string) {
        setChosenCountry(next);
        setPage(1);
        writePageToUrl(1, 'replace');
    }

    /** 換排序：同樣回到第 1 頁。 */
    function changeSort(next: CandidateSort) {
        setSort(next);
        setPage(1);
        writePageToUrl(1, 'replace');
    }

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
                <CountrySelect value={country} countries={(stats?.byCountry ?? []).map(c => c.code)} onChange={changeCountry} />
                <SortSelect value={sort} onChange={changeSort} />
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
                <ListingButton loggedIn={loggedIn} optedOut={optedOut} onSetListing={onSetListing} />
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

            <ul
                ref={listRef}
                aria-busy={loading}
                className={`mt-4 grid gap-3 transition-opacity duration-300 ${loading && candidates.length > 0 ? 'opacity-50' : ''}`}
            >
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

            {/* 第一次載入（還沒有任何卡片）才顯示轉圈；換頁時改成讓舊卡片變暗 */}
            {loading && candidates.length === 0 && (
                <div className="mt-6 flex animate-fade-in justify-center text-muted">
                    <Spinner size={22} />
                </div>
            )}

            {!loading && !error && candidates.length === 0 && page === 1 && (
                <p className="mt-6 animate-fade-in rounded-2xl border border-dashed border-line px-4 py-10 text-center text-muted">
                    {country === 'all' ? 'No one to show yet.' : `No one from ${countryName(country)} yet.`} The scanner goes
                    through every country in turn, a few players every minute, so check back later.
                </p>
            )}

            {/* 網址的頁碼超過最後一頁（例如舊的書籤）*/}
            {!loading && !error && candidates.length === 0 && page > 1 && (
                <p className="mt-6 animate-fade-in rounded-2xl border border-dashed border-line px-4 py-10 text-center text-muted">
                    There's no one on this page.{' '}
                    <button type="button" onClick={() => goToPage(1)} className="text-pink transition-colors hover:text-pink-2">
                        Back to page 1
                    </button>
                </p>
            )}

            {/* 這一頁的人全部被略過了 */}
            {!loading && candidates.length > 0 && visible.length === 0 && (
                <p className="mt-6 animate-fade-in rounded-2xl border border-dashed border-line px-4 py-8 text-center text-muted">
                    You skipped everyone on this page.
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

            {(page > 1 || hasMore) && <Pagination page={page} hasNext={hasMore} disabled={loading} onChange={goToPage} />}
        </section>
    );
}
