import { useEffect, useState } from 'react';
import { fetchMe, fetchStats, logout } from './api';
import { Avatar } from './components/Avatar';
import { CandidatesView } from './components/CandidatesView';
import { Footer } from './components/Footer';
import { LogoMark, LogoutIcon } from './components/Icons';
import { TrackingView } from './components/TrackingView';
import type { MeResponse, StatsResponse } from './types';

type Tab = 'find' | 'track';

const LOGIN_ERRORS: Record<string, string> = {
    denied: 'Login was cancelled on osu!.',
    invalid: 'Login expired or was invalid. Please try again.',
    error: 'Something went wrong while logging in. Please try again.',
};

export default function App() {
    const [me, setMe] = useState<MeResponse | null>(null);
    const [tab, setTab] = useState<Tab>('find');
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

    const user = me?.user ?? null;

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
                {tabs.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        aria-current={tab === t.id ? 'page' : undefined}
                        className={`relative flex-1 py-3 text-sm font-medium transition-colors duration-300 sm:flex-none sm:px-5 ${
                            tab === t.id ? 'text-ink' : 'text-muted hover:text-ink'
                        }`}
                    >
                        {t.label}
                        <span
                            aria-hidden="true"
                            className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-pink transition-opacity duration-300 ${
                                tab === t.id ? 'opacity-100' : 'opacity-0'
                            }`}
                        />
                    </button>
                ))}
            </nav>

            {/* key 換了就會重新掛載，觸發淡入，切換分頁不會突然跳 */}
            <main key={tab} className="mt-6 animate-fade-up">
                {tab === 'find' && <CandidatesView loggedIn={Boolean(user)} defaultCountry={user?.countryCode ?? null} stats={stats} />}
                {tab === 'track' &&
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
