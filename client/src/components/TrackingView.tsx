import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, deleteMyData, profileUrl, syncFriends } from '../api';
import { daysSince, timeAgo } from '../format';
import type { Friend, FriendEvent, FriendEventType, FriendsResponse } from '../types';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { ChevronIcon, ExternalIcon, LinkIcon, RefreshIcon, Spinner, UnlinkIcon, UserMinusIcon, UserPlusIcon } from './Icons';

// After this many days without a follow-back, suggest removing them to free the friend slot for someone else
const STALE_DAYS = 7;

export function TrackingView({ onDeleted }: { onDeleted: () => void }) {
    const [data, setData] = useState<FriendsResponse | null>(null);
    const [syncing, setSyncing] = useState(true);
    const [error, setError] = useState<{ message: string; relogin: boolean } | null>(null);

    const sync = useCallback(async () => {
        setSyncing(true);
        setError(null);
        try {
            setData(await syncFriends());
        } catch (err) {
            setError({
                message: err instanceof Error ? err.message : 'Could not sync your friend list.',
                relogin: err instanceof ApiError && err.relogin,
            });
        } finally {
            setSyncing(false);
        }
    }, []);

    // Sync once when the page opens (repeat syncs within a minute just return the current data)
    useEffect(() => {
        sync();
    }, [sync]);

    const now = Date.now();
    const friends = data?.friends ?? [];
    const mutuals = friends.filter(f => f.mutual);
    const waiting = friends
        .filter(f => !f.mutual && f.first_seen_at !== null)
        .sort((a, b) => (a.first_seen_at ?? 0) - (b.first_seen_at ?? 0));
    const oneSided = friends.filter(f => !f.mutual && f.first_seen_at === null);
    const result = data?.result;

    return (
        <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">
                    {data?.account.lastSyncedAt ? `Last synced ${timeAgo(data.account.lastSyncedAt, now)}` : 'Not synced yet'}
                </p>
                <button
                    type="button"
                    onClick={sync}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2 text-sm font-medium transition-colors hover:border-pink/50 disabled:opacity-60"
                >
                    {syncing ? <Spinner size={15} /> : <RefreshIcon size={15} />}
                    {syncing ? 'Syncing…' : 'Sync now'}
                </button>
            </div>

            {error && (
                <div className="mt-4 animate-fade-in rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
                    {error.message}{' '}
                    {error.relogin && (
                        <a href="/api/auth/login" className="font-semibold underline">
                            Log in again
                        </a>
                    )}
                </div>
            )}

            {result?.baseline && (
                <p className="mt-4 animate-fade-in rounded-xl border border-pink/30 bg-pink/10 px-4 py-3 text-sm">
                    Tracking starts now. From your next sync on, you will see who followed you back and who removed you.
                </p>
            )}
            {result && !result.baseline && (result.mutual > 0 || result.unmutual > 0 || result.added > 0 || result.removed > 0) && (
                <p className="mt-4 animate-fade-in rounded-xl border border-good/30 bg-good/10 px-4 py-3 text-sm">
                    Since your last sync: {summarize(result)}.
                </p>
            )}

            {data && (
                <div key="loaded" className="animate-fade-in">
                    <div className="mt-5 grid grid-cols-3 gap-3">
                        <Stat label="Friends" value={`${friends.length}`} sub={`of ${data.account.friendLimit}`}>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                                <div
                                    className="h-full rounded-full bg-pink transition-[width] duration-700 ease-out-expo"
                                    style={{ width: `${Math.min(100, (friends.length / data.account.friendLimit) * 100)}%` }}
                                />
                            </div>
                        </Stat>
                        <Stat label="Mutuals" value={`${mutuals.length}`} />
                        <Stat label="Waiting" value={`${waiting.length}`} />
                    </div>

                    <Section title="Waiting for a follow-back" hint={`People you added after tracking started. After ${STALE_DAYS} days you may want to free up the slot.`}>
                        {waiting.length === 0 ? (
                            <Empty>No one is waiting. Find people in the "Find people" tab, add them on osu!, then come back and sync.</Empty>
                        ) : (
                            waiting.map((f, i) => <FriendItem key={f.target_id} friend={f} index={i} now={now} showStale />)
                        )}
                    </Section>

                    <Collapsible title="Recent changes">
                        {data.events.length === 0 ? (
                            <Empty>Nothing yet. Changes show up here after your next sync.</Empty>
                        ) : (
                            data.events.map((e, i) => <EventItem key={`${e.target_id}-${e.type}-${e.at}`} event={e} index={i} now={now} />)
                        )}
                    </Collapsible>

                    {oneSided.length > 0 && <OneSided friends={oneSided} now={now} />}
                </div>
            )}

            {!data && syncing && (
                <div className="mt-10 flex animate-fade-in justify-center text-muted">
                    <Spinner size={22} />
                </div>
            )}

            <DeleteMyData onDeleted={onDeleted} />
        </section>
    );
}

/** "Delete my data" at the bottom of the page: asks for confirmation before actually deleting anything. */
function DeleteMyData({ onDeleted }: { onDeleted: () => void }) {
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function remove() {
        setDeleting(true);
        setError(null);
        try {
            await deleteMyData();
            onDeleted();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete your data. Please try again.');
            setDeleting(false);
        }
    }

    return (
        <div className="mt-14 rounded-2xl border border-bad/25 px-4 py-4">
            <h2 className="font-semibold">Delete my data</h2>
            <p className="mt-1 text-sm text-muted">
                Removes your friend list snapshots and follow-back history from this site, revokes its access to your osu! account, and logs
                you out. Logging out alone keeps your history but also revokes access.
            </p>
            <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={deleting}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-bad/50 px-3.5 py-2 text-sm font-medium text-bad transition-colors hover:bg-bad/10 disabled:opacity-60"
            >
                {deleting && <Spinner size={14} />}
                {deleting ? 'Deleting…' : 'Delete my data'}
            </button>
            {error && <p className="mt-2 animate-fade-in text-sm text-bad">{error}</p>}

            {confirming && (
                <ConfirmDialog
                    title="Delete all your data?"
                    confirmLabel="Delete everything"
                    danger
                    onConfirm={remove}
                    onClose={() => setConfirming(false)}
                >
                    <p>This permanently deletes your friend list snapshots and your follow-back history. It can't be undone.</p>
                    <p>You can log in again later, but tracking will start over from scratch.</p>
                </ConfirmDialog>
            )}
        </div>
    );
}

function summarize(r: NonNullable<FriendsResponse['result']>) {
    const parts: string[] = [];
    if (r.mutual) parts.push(`${r.mutual} followed you back`);
    if (r.unmutual) parts.push(`${r.unmutual} removed you`);
    if (r.added) parts.push(`you added ${r.added}`);
    if (r.removed) parts.push(`you removed ${r.removed}`);
    return parts.join(', ');
}

function Stat({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: ReactNode }) {
    return (
        <div className="rounded-2xl border border-line bg-surface px-4 py-3">
            <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            {/* The hint gets its own line: the three columns are narrow on phones and it would wrap badly next to the number */}
            {sub && <p className="text-xs text-muted">{sub}</p>}
            {children}
        </div>
    );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return (
        <div className="mt-8">
            <h2 className="text-lg font-semibold">{title}</h2>
            {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
            <ul className="mt-3 grid gap-2">{children}</ul>
        </div>
    );
}

const Empty = ({ children }: { children: ReactNode }) => (
    <li className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</li>
);

function FriendItem({ friend: f, index, now, showStale }: { friend: Friend; index: number; now: number; showStale?: boolean }) {
    const days = f.first_seen_at === null ? null : daysSince(f.first_seen_at, now);
    const stale = showStale && days !== null && days >= STALE_DAYS;

    return (
        <li
            style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
            className="flex animate-fade-up items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5"
        >
            <Avatar url={f.avatar_url} name={f.username} size={36} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <a href={profileUrl(f.target_id)} target="_blank" rel="noreferrer" className="font-medium transition-colors hover:text-pink">
                        {f.username}
                    </a>
                    {stale && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs text-warn">No follow-back yet</span>}
                </div>
                <p className="text-xs text-muted">
                    {days !== null && <>added {days === 0 ? 'today' : `${days}d ago`} · </>}
                    seen {timeAgo(f.last_visit, now)}
                </p>
            </div>
            <a
                href={profileUrl(f.target_id)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${f.username}'s profile`}
                className="rounded-lg p-2 text-muted transition-colors hover:text-ink"
            >
                <ExternalIcon size={15} />
            </a>
        </li>
    );
}

const EVENT_STYLE: Record<FriendEventType, { text: string; className: string; Icon: typeof LinkIcon }> = {
    mutual: { text: 'followed you back', className: 'text-good', Icon: LinkIcon },
    unmutual: { text: 'removed you', className: 'text-bad', Icon: UnlinkIcon },
    added: { text: 'was added by you', className: 'text-muted', Icon: UserPlusIcon },
    removed: { text: 'was removed by you', className: 'text-muted', Icon: UserMinusIcon },
};

function EventItem({ event: e, index, now }: { event: FriendEvent; index: number; now: number }) {
    const style = EVENT_STYLE[e.type];
    return (
        <li
            style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
            className="flex animate-fade-up items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-surface"
        >
            <style.Icon size={16} className={style.className} />
            <p className="min-w-0 flex-1 text-sm">
                <a href={profileUrl(e.target_id)} target="_blank" rel="noreferrer" className="font-medium transition-colors hover:text-pink">
                    {e.username}
                </a>{' '}
                <span className={style.className}>{style.text}</span>
            </p>
            <span className="text-xs text-muted">{timeAgo(e.at, now)}</span>
        </li>
    );
}

/** People added before tracking started who never followed back */
function OneSided({ friends, now }: { friends: Friend[]; now: number }) {
    return (
        <Collapsible title={`Not following you back (${friends.length})`} hint="Added before tracking started, so we don't know when.">
            {friends.map((f, i) => (
                <FriendItem key={f.target_id} friend={f} index={i} now={now} />
            ))}
        </Collapsible>
    );
}

/**
 * A section that starts collapsed so the page doesn't get too long; the arrow opens it.
 * The list is only rendered once first opened (long lists cost nothing until then), and stays rendered afterwards so
 * closing can animate the height instead of the content vanishing at once.
 */
function Collapsible({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [opened, setOpened] = useState(false);
    return (
        <div className="mt-8">
            <button
                type="button"
                onClick={() => {
                    setOpen(v => !v);
                    setOpened(true);
                }}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-3 text-left"
            >
                <span>
                    <span className="text-lg font-semibold">{title}</span>
                    {hint && <span className="block text-sm text-muted">{hint}</span>}
                </span>
                <ChevronIcon size={18} className={`shrink-0 text-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
            </button>
            <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out-expo ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                {/* inert while closed: the hidden links can't be reached with Tab */}
                <div className="overflow-hidden" inert={!open}>
                    {opened && <ul className="mt-3 grid gap-2">{children}</ul>}
                </div>
            </div>
        </div>
    );
}
