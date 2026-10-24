import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCandidates } from '../api';
import { countryName } from '../countries';
import type { Candidate, StatsResponse } from '../types';
import { useLocalStorage } from '../useLocalStorage';
import { ActiveToggle } from './ActiveToggle';
import { CandidateCard } from './CandidateCard';
import { CountrySelect } from './CountrySelect';
import { ChevronIcon, InfoIcon, PencilIcon, Spinner } from './Icons';
import { ConfirmDialog } from './ConfirmDialog';
import { ListingButton } from './ListingButton';
import { Pagination } from './Pagination';
import { SkeletonCards } from './SkeletonCards';

const DEFAULT_TEMPLATE = "Hi {name}! Saw on your profile that you're open to mutuals, just added you :)";
const LEAVE_MS = 250; // matches the fade-out duration in index.css
const COPIED_MS = 1600;
const HIGHLIGHT = 'font-semibold text-pink'; // key phrases in the read-first reminders

/** A permanent reminder: the tool only finds players who *mention* mutuals; whether they want them is for the user to read and judge */
export function ReadFirstHint() {
    return (
        <p className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink/90">
            <InfoIcon size={16} className="mt-0.5 shrink-0 text-muted" />
            <span>
                These players <span className={HIGHLIGHT}>mention mutuals</span> on their profile.{' '}
                <span className={HIGHLIGHT}>Read what they wrote</span> before adding them: some mention mutuals{' '}
                <span className={HIGHLIGHT}>only to say no</span>.
            </span>
        </p>
    );
}

/** Reads the page number from the URL (?page=3); missing or malformed means page 1. */
function readPageFromUrl(): number {
    const page = Math.floor(Number(new URLSearchParams(window.location.search).get('page')));
    return Number.isFinite(page) && page >= 1 ? page : 1;
}

/** Writes the page number back to the URL. Page 1 has no parameter, keeping the URL clean. */
function writePageToUrl(page: number, mode: 'push' | 'replace') {
    const url = new URL(window.location.href);
    if (page === 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(page));
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
}

interface Props {
    loggedIn: boolean;
    defaultCountry: string | null; // the logged-in user's own country
    stats: StatsResponse | null;
    optedOut: boolean; // the logged-in user chose "Don't list me"
    onSetListing: (listed: boolean) => Promise<void>;
    guidelinesAccepted: boolean; // the list only loads once the "Before you start" guidelines are accepted
    onAcceptGuidelines: () => void;
}

export function CandidatesView({ loggedIn, defaultCountry, stats, optedOut, onSetListing, guidelinesAccepted, onAcceptGuidelines }: Props) {
    // The country the user picked (remembered in the browser); otherwise their own country, or all countries when logged out
    const [chosenCountry, setChosenCountry] = useLocalStorage<string | null>('filter.country', null);
    const country = chosenCountry ?? defaultCountry ?? 'all';
    // "Online in the past week" is remembered too
    const [activeOnly, setActiveOnly] = useLocalStorage('filter.active', false);
    const [template, setTemplate] = useLocalStorage('dm.template', DEFAULT_TEMPLATE);
    const [skipped, setSkipped] = useLocalStorage<number[]>('skipped', []);

    // The page lives in the URL (?page=3), so reloading or the browser's back button returns to the same page
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
    // Only the latest request's result is used, so a slow old response can't overwrite a newer one (e.g. switching countries quickly)
    const requestId = useRef(0);

    // The list isn't cleared when changing pages: the old cards dim while loading and the new ones fade in, so the page never goes blank
    const load = useCallback(async () => {
        const id = ++requestId.current;
        setLoading(true);
        setError(null);
        try {
            const data = await fetchCandidates(page, country, activeOnly);
            if (id !== requestId.current) return;
            setCandidates(data.candidates);
            setHasMore(data.hasMore);
        } catch (err) {
            if (id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load players.');
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [page, country, activeOnly]);

    useEffect(() => {
        if (guidelinesAccepted) load();
    }, [load, guidelinesAccepted]);

    // The browser's back / forward buttons change the page in the URL; keep the view in sync
    useEffect(() => {
        const onPopState = () => setPage(readPageFromUrl());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    // Whether to scroll back to the top of the list after changing pages is decided once the new cards have rendered.
    // Scrolling at the moment of the click lets the page height change afterwards (e.g. a shorter last page), the browser
    // adjusts again, and the list ends up somewhere different each time.
    const scrollAfterLoad = useRef(false);

    useEffect(() => {
        if (loading || !scrollAfterLoad.current) return;
        scrollAfterLoad.current = false;
        const list = listRef.current;
        if (!list) return;
        const MARGIN = 16;
        const top = list.getBoundingClientRect().top;
        // Leave it alone if the top of the list is still visible; otherwise scroll back, always to the same spot (16px from the top)
        if (top >= MARGIN) return;
        // With reduced motion, jump instead of animating the scroll
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: window.scrollY + top - MARGIN, behavior: smooth ? 'smooth' : 'auto' });
    }, [loading, candidates]);

    /** Change page: update the URL (adding a history entry), then scroll back to the list if needed once the cards render. */
    function goToPage(next: number) {
        scrollAfterLoad.current = true;
        setPage(next);
        writePageToUrl(next, 'push');
    }

    /** Change country: back to page 1 (replacing the history entry, or "back" would land on another country's page number). */
    function changeCountry(next: string) {
        setChosenCountry(next);
        setPage(1);
        writePageToUrl(1, 'replace');
    }

    /** Toggle "Online in the past week": also back to page 1. */
    function toggleActive() {
        setActiveOnly(v => !v);
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
            <ReadFirstHint />

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <CountrySelect value={country} countries={(stats?.byCountry ?? []).map(c => c.code)} onChange={changeCountry} />
                <ActiveToggle pressed={activeOnly} onToggle={toggleActive} />
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

            {/* The grid-rows 0fr → 1fr trick animates the height without measuring the element */}
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
                        onCopy={() => copy(c)}
                        onSkip={() => skip(c.id)}
                    />
                ))}
            </ul>

            {/* Until the guidelines are accepted, placeholder cards sit behind the dialog and nothing is requested */}
            {!guidelinesAccepted && (
                <div className="mt-4">
                    <SkeletonCards />
                </div>
            )}

            {/* The spinner only shows on the first load (no cards yet); on page changes the old cards dim instead */}
            {guidelinesAccepted && loading && candidates.length === 0 && (
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

            {/* The page in the URL is past the last page (e.g. an old bookmark) */}
            {!loading && !error && candidates.length === 0 && page > 1 && (
                <p className="mt-6 animate-fade-in rounded-2xl border border-dashed border-line px-4 py-10 text-center text-muted">
                    There's no one on this page.{' '}
                    <button type="button" onClick={() => goToPage(1)} className="text-pink transition-colors hover:text-pink-2">
                        Back to page 1
                    </button>
                </p>
            )}

            {/* Everyone on this page was skipped */}
            {!loading && candidates.length > 0 && visible.length === 0 && (
                <p className="mt-6 animate-fade-in rounded-2xl border border-dashed border-line px-4 py-8 text-center text-muted">
                    You skipped everyone on this page.
                </p>
            )}

            {!guidelinesAccepted && (
                // Shown once per account before the list (stored on the server, so a new device or cleared browser doesn't
                // repeat it). Once only on purpose: a dialog that appears every time soon gets dismissed unread (warning fatigue).
                // It can't be dismissed without accepting, since its point is that everyone who sees the list has read it.
                // Accepting happens in onClose (after the fade-out), so the dialog isn't removed mid-animation.
                <ConfirmDialog title="Before you start" confirmLabel="I understand" dismissible={false} onConfirm={() => {}} onClose={onAcceptGuidelines}>
                    <ul className="space-y-2.5">
                        <li>
                            <span className={HIGHLIGHT}>Read what they wrote first.</span> These players mention mutuals on their profile, but
                            some only do it to say no.
                        </li>
                        <li>
                            <span className={HIGHLIGHT}>One message is enough.</span> If they don't follow back or say no, let it go. Don't
                            message again or ask why.
                        </li>
                        <li>
                            <span className={HIGHLIGHT}>Be kind.</span> Everyone on this list is a real person, and osu! lets them block and
                            report anyone who bothers them.
                        </li>
                    </ul>
                </ConfirmDialog>
            )}

            {(page > 1 || hasMore) && <Pagination page={page} hasNext={hasMore} disabled={loading} onChange={goToPage} />}
        </section>
    );
}
