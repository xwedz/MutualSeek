import { useEffect, useState, type MouseEvent } from 'react';
import { fetchMe, fetchStats, logout, setListing } from './api';
import { Avatar } from './components/Avatar';
import { CandidatesView } from './components/CandidatesView';
import { FaqView } from './components/FaqView';
import { Footer } from './components/Footer';
import { LogoMark, LogoutIcon, QuestionIcon } from './components/Icons';
import { TrackingView } from './components/TrackingView';
import type { MeResponse, StatsResponse } from './types';

type Tab = 'find' | 'track';
// The FAQ is its own page (/faq, so it can be linked directly); everything else is on the home page, switched with tabs
type View = 'main' | 'faq';
const viewFromPath = (): View => (window.location.pathname === '/faq' ? 'faq' : 'main');

const LOGIN_ERRORS: Record<string, string> = {
    denied: 'Login was cancelled on osu!.',
    invalid: 'Login expired or was invalid. Please try again.',
    error: 'Something went wrong while logging in. Please try again.',
};

export default function App() {
    const [me, setMe] = useState<MeResponse | null>(null);
    const [tab, setTab] = useState<Tab>('find');
    const [view, setView] = useState<View>(viewFromPath);
    const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);
    // Scanner progress and per-country counts: used by the footer and the country menu, so fetched once here
    const [stats, setStats] = useState<StatsResponse | null>(null);

    useEffect(() => {
        fetchStats().then(setStats, () => setStats(null));
    }, []);

    useEffect(() => {
        fetchMe().then(setMe, () => setMe({ user: null }));

        // A failed login redirects back with ?login=<reason>: show the message, then clean the URL so a reload doesn't show it again
        const params = new URLSearchParams(location.search);
        const reason = params.get('login');
        if (reason) {
            setNotice({ text: LOGIN_ERRORS[reason] ?? LOGIN_ERRORS.error!, tone: 'error' });
            history.replaceState(null, '', location.pathname);
        }
    }, []);

    // When the browser's back / forward moves between the home page and the FAQ, the view follows the URL
    useEffect(() => {
        const onPopState = () => setView(viewFromPath());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    useEffect(() => {
        document.title = view === 'faq' ? 'FAQ – MutualSeek' : 'MutualSeek – find osu! mutuals';
    }, [view]);

    const user = me?.user ?? null;

    /** "Don't list me": shared by the FAQ and Find people, so both always show the same state */
    async function updateListing(listed: boolean) {
        const { optedOut } = await setListing(listed);
        setMe(prev => (prev ? { ...prev, optedOut } : prev));
    }

    function openFaq(event: MouseEvent<HTMLAnchorElement>) {
        event.preventDefault(); // switch views without reloading the site
        if (view === 'faq') return;
        window.history.pushState(null, '', '/faq');
        setView('faq');
    }

    function selectTab(next: Tab) {
        if (view === 'faq') {
            window.history.pushState(null, '', '/');
            setView('main');
        }
        setTab(next);
    }

    // After deleting data: the backend has already ended the session, so only the view needs updating
    function handleDeleted() {
        setMe({ user: null });
        setTab('find');
        setNotice({ text: "Your data has been deleted and this site's access to your osu! account was revoked.", tone: 'success' });
    }

    async function handleLogout() {
        await logout().catch(() => {});
        setMe({ user: null });
        setTab('find');
    }

    const tabs: { id: Tab; label: string }[] = [
        { id: 'find', label: 'Find people' },
        { id: 'track', label: 'Follow-backs' },
    ];

    return (
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <header className="flex items-center justify-between gap-3 pt-6 pb-2">
                <div>
                    <div className="flex items-center gap-2.5">
                        <LogoMark />
                        <h1 className="text-xl font-bold tracking-tight">MutualSeek</h1>
                    </div>
                    <p className="mt-0.5 text-sm text-muted">Find osu! players looking for mutuals, and see who followed you back.</p>
                </div>
                {/* Empty until `me` loads, so the Log in button doesn't flash before turning into the avatar */}
                {me && (
                    <div className="animate-fade-in">
                        {user ? (
                            <div className="flex items-center gap-2">
                                <Avatar url={user.avatarUrl} name={user.username} size={32} />
                                <span className="hidden text-sm font-medium sm:inline">{user.username}</span>
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    aria-label="Log out"
                                    title="Log out"
                                    className="rounded-lg p-2 text-muted transition-colors hover:text-ink"
                                >
                                    <LogoutIcon size={16} />
                                </button>
                            </div>
                        ) : (
                            <a
                                href="/api/auth/login"
                                className="rounded-xl bg-pink px-4 py-2 text-sm font-semibold whitespace-nowrap text-bg transition-colors hover:bg-pink-2"
                            >
                                Log in with osu!
                            </a>
                        )}
                    </div>
                )}
            </header>

            {notice && (
                <p
                    key={notice.text}
                    className={`mt-3 animate-fade-in rounded-xl border px-4 py-3 text-sm ${
                        notice.tone === 'error' ? 'border-bad/40 bg-bad/10 text-bad' : 'border-good/40 bg-good/10 text-good'
                    }`}
                >
                    {notice.text}
                </p>
            )}

            <nav className="relative mt-5 flex border-b border-line" aria-label="Sections">
                {tabs.map(t => {
                    const active = view === 'main' && tab === t.id;
                    return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => selectTab(t.id)}
                            aria-current={active ? 'page' : undefined}
                            className={`relative flex-1 py-3 text-sm font-medium transition-colors duration-300 sm:flex-none sm:px-5 ${
                                active ? 'text-ink' : 'text-muted hover:text-ink'
                            }`}
                        >
                            {t.label}
                            <span
                                aria-hidden="true"
                                className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-pink transition-opacity duration-300 ${
                                    active ? 'opacity-100' : 'opacity-0'
                                }`}
                            />
                        </button>
                    );
                })}
                {/* The FAQ is another page, not a third tab: placed at the far right, dimmer and with an icon, to set it apart from the tabs */}
                <a
                    href="/faq"
                    onClick={openFaq}
                    aria-current={view === 'faq' ? 'page' : undefined}
                    className={`relative ml-auto inline-flex items-center gap-1.5 px-2 py-3 text-sm transition-colors duration-300 sm:px-3 ${
                        view === 'faq' ? 'text-ink' : 'text-muted hover:text-ink'
                    }`}
                >
                    <QuestionIcon size={15} />
                    FAQ
                    <span
                        aria-hidden="true"
                        className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-pink transition-opacity duration-300 ${
                            view === 'faq' ? 'opacity-100' : 'opacity-0'
                        }`}
                    />
                </a>
            </nav>

            {/* A new key remounts the content and replays the fade-in, so switching tabs never jumps */}
            <main key={view === 'faq' ? 'faq' : tab} className="mt-6 animate-fade-up">
                {view === 'faq' && (
                    <FaqView loggedIn={Boolean(user)} optedOut={me?.optedOut ?? false} onSetListing={updateListing} />
                )}
                {view === 'main' && tab === 'find' && (
                    <CandidatesView
                        loggedIn={Boolean(user)}
                        defaultCountry={user?.countryCode ?? null}
                        stats={stats}
                        optedOut={me?.optedOut ?? false}
                        onSetListing={updateListing}
                    />
                )}
                {view === 'main' && tab === 'track' &&
                    (user ? (
                        <TrackingView onDeleted={handleDeleted} />
                    ) : (
                        <div className="rounded-2xl border border-line bg-surface px-6 py-10 text-center">
                            <p className="text-lg font-semibold">See who followed you back</p>
                            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                                Log in with osu! and this page compares your friend list over time: who followed you back, who removed
                                you, and who never did. It only asks for permission to read your friend list.
                            </p>
                            <a
                                href="/api/auth/login"
                                className="mt-5 inline-block rounded-xl bg-pink px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-pink-2"
                            >
                                Log in with osu!
                            </a>
                        </div>
                    ))}
            </main>

            <Footer stats={stats} />
        </div>
    );
}
