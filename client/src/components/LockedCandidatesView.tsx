import { useState, type MouseEvent } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { ReadFirstHint } from './CandidatesView';
import { WHY_LOG_IN } from './FaqView';
import { ChevronIcon, PencilIcon } from './Icons';
import { ListingButton } from './ListingButton';

interface Props {
    optedOut: boolean;
    onSetListing: (listed: boolean) => Promise<void>;
    onWhyLogIn: () => void; // opens the FAQ's "Why do I need to log in?"
}

const LOGIN_URL = '/api/auth/login';
const WHY_URL = `/faq#${WHY_LOG_IN}`;
const CONTROL = 'inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm transition-colors hover:border-pink/50';

/**
 * Find people before logging in. The list is only shown to logged-in osu! users, so it can't be browsed or collected
 * anonymously. This view keeps the same layout so people can see what they'd get: the controls look the same but open
 * a login dialog, and the cards are placeholders without any player data.
 */
export function LockedCandidatesView({ optedOut, onSetListing, onWhyLogIn }: Props) {
    const [asking, setAsking] = useState(false);
    const ask = () => setAsking(true);

    // A real link, so it can also be opened in a new tab; a normal click switches views without reloading
    const whyLogIn = (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onWhyLogIn();
    };

    return (
        <section>
            <ReadFirstHint />

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={ask} className={`${CONTROL} text-ink`}>
                    All countries
                    <ChevronIcon size={14} className="text-muted" />
                </button>
                <button type="button" onClick={ask} className={`${CONTROL} text-ink`}>
                    Recently online
                    <ChevronIcon size={14} className="text-muted" />
                </button>
                <button type="button" onClick={ask} className={`${CONTROL} gap-1.5 bg-transparent text-muted hover:text-ink`}>
                    <PencilIcon size={14} />
                    Message template
                    <ChevronIcon size={14} />
                </button>
                {/* Has its own dialog that explains logging in to be removed from the list */}
                <ListingButton loggedIn={false} optedOut={optedOut} onSetListing={onSetListing} />
            </div>

            <div className="relative mt-6">
                {/* Placeholder cards fading out towards the bottom; aria-hidden since they carry no content */}
                <ul aria-hidden="true" className="grid gap-3 [mask-image:linear-gradient(to_bottom,black_30%,transparent)]">
                    {[0, 1, 2].map(i => (
                        <SkeletonCard key={i} index={i} />
                    ))}
                </ul>

                <div className="absolute inset-x-0 top-10 flex justify-center px-2 sm:top-16">
                    <div className="w-full max-w-md animate-fade-up rounded-2xl border border-line bg-surface/95 px-6 py-7 text-center shadow-2xl shadow-black/50 backdrop-blur-sm">
                        <p className="text-lg font-semibold">Log in to see players looking for mutuals</p>
                        <p className="mt-2 text-sm text-muted">
                            Have questions before logging in? The FAQ explains why it's needed and what the site can see.
                        </p>
                        {/* Two choices side by side, so logging in doesn't look like the only thing you can do */}
                        <div className="mt-5 flex flex-wrap justify-center gap-2">
                            <a
                                href={LOGIN_URL}
                                className="rounded-xl bg-pink px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-pink-2"
                            >
                                Log in with osu!
                            </a>
                            <a
                                href={WHY_URL}
                                onClick={whyLogIn}
                                className="rounded-xl border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-pink/50"
                            >
                                Why log in?
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {asking && (
                <ConfirmDialog
                    title="Log in to continue"
                    confirmLabel="Log in with osu!"
                    onConfirm={() => window.location.assign(LOGIN_URL)}
                    onClose={() => setAsking(false)}
                >
                    <p>To protect the players on this list, Find people is only available to logged-in osu! players.</p>
                    <p>
                        The site can read your friend list, but it can't add friends or send messages for you. You can log out at any time.{' '}
                        <a href={WHY_URL} onClick={whyLogIn} className="font-medium text-pink transition-colors hover:text-pink-2">
                            Why log in?
                        </a>
                    </p>
                </ConfirmDialog>
            )}
        </section>
    );
}

/** Same shape as CandidateCard (avatar, name, stats, excerpt, buttons), drawn with plain blocks. Static on purpose: nothing is loading. */
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
