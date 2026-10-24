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
// FAQ 是獨立的頁面（/faq，可以直接分享連結）；其他都在首頁，用分頁籤切換
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
    // 掃描進度與各國人數：頁尾和國家選單都要用，在這裡抓一次再往下傳
    const [stats, setStats] = useState<StatsResponse | null>(null);

    useEffect(() => {
        fetchStats().then(setStats, () => setStats(null));
    }, []);

    useEffect(() => {
        fetchMe().then(setMe, () => setMe({ user: null }));

        // 登入失敗時後端會導回 /?login=原因：顯示訊息後把網址清乾淨，重新整理才不會再跳一次
        const params = new URLSearchParams(location.search);
        const reason = params.get('login');
        if (reason) {
            setNotice({ text: LOGIN_ERRORS[reason] ?? LOGIN_ERRORS.error!, tone: 'error' });
            history.replaceState(null, '', location.pathname);
        }
    }, []);

    // 瀏覽器的「上一頁 / 下一頁」在首頁和 FAQ 之間切換時，畫面跟著網址走
    useEffect(() => {
        const onPopState = () => setView(viewFromPath());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    useEffect(() => {
        document.title = view === 'faq' ? 'FAQ – MutualSeek' : 'MutualSeek – find osu! mutuals';
    }, [view]);

    const user = me?.user ?? null;

    /** 「Don't list me」：FAQ 和 Find people 都用這一個，兩邊顯示的狀態才會一致 */
    async function updateListing(listed: boolean) {
        const { optedOut } = await setListing(listed);
        setMe(prev => (prev ? { ...prev, optedOut } : prev));
    }

    function openFaq(event: MouseEvent<HTMLAnchorElement>) {
        event.preventDefault(); // 不重新載入整個網站，只切換畫面
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

    // 資料刪除後：後端已經清掉登入狀態，這裡只要更新畫面
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
                {/* me 還沒載入時先留空，避免「Log in」按鈕閃一下又變成頭像 */}
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
                {/* FAQ 是另一個頁面，不是第三個分頁：放在最右邊、顏色較淡、加圖示，跟分頁籤區分開 */}
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

            {/* key 換了就會重新掛載，觸發淡入，切換分頁不會突然跳 */}
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
