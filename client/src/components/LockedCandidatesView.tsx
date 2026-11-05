import { useEffect, useState, type MouseEvent } from 'react';
import { fetchPreview } from '../api';
import { countryName } from '../countries';
import type { PreviewPlayer } from '../types';
import { ActiveToggle } from './ActiveToggle';
import { Excerpt } from './CandidateCard';
import { ConfirmDialog } from './ConfirmDialog';
import { ReadFirstHint } from './CandidatesView';
import { WHY_LOG_IN } from './FaqView';
import { ChevronIcon, PencilIcon } from './Icons';
import { ListingButton } from './ListingButton';
import { SkeletonCards } from './SkeletonCards';

interface Props {
    optedOut: boolean;
    onSetListing: (listed: boolean) => Promise<void>;
    onWhyLogIn: () => void; // opens the FAQ's "Why do I need to log in?"
}

const LOGIN_URL = '/api/auth/login';
const WHY_URL = `/faq#${WHY_LOG_IN}`;
const CONTROL = 'inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm transition-colors hover:border-pink/50';

/**
 * Find people before logging in. Who is on the list is only shown to logged-in osu! users, so it can't be browsed or
 * collected anonymously, but a few real excerpts are shown without names so people can see what the site finds before
 * deciding to log in. The controls look the same but open a login dialog.
 */
export function LockedCandidatesView({ optedOut, onSetListing, onWhyLogIn }: Props) {
    const [asking, setAsking] = useState(false);
    const ask = () => setAsking(true);
    // null while loading; if the preview can't be loaded (or is empty), placeholder cards stay instead
    const [preview, setPreview] = useState<PreviewPlayer[] | null>(null);

    useEffect(() => {
        fetchPreview().then(
            data => setPreview(data.players),
            () => setPreview([]),
        );
    }, []);

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
                <ActiveToggle pressed={false} onToggle={ask} />
                <button type="button" onClick={ask} className={`${CONTROL} gap-1.5 bg-transparent text-muted hover:text-ink`}>
                    <PencilIcon size={14} />
                    Message template
                    <ChevronIcon size={14} />
                </button>
                {/* Has its own dialog that explains logging in to be removed from the list */}
                <ListingButton loggedIn={false} optedOut={optedOut} onSetListing={onSetListing} />
            </div>

            <div className="mt-6 animate-fade-up rounded-2xl border border-pink/25 bg-surface px-5 py-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
                <div>
                    <p className="font-semibold">Log in to see who they are</p>
                    <p className="mt-1 text-sm text-muted">
                        These are real excerpts from players' profiles. Log in with osu! to see who wrote them and browse all players.
                    </p>
                </div>
                {/* Two choices side by side, so logging in doesn't look like the only thing you can do */}
                <div className="mt-4 flex shrink-0 flex-wrap gap-2 sm:mt-0">
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

            <div className="mt-4">
                {preview && preview.length > 0 ? (
                    // Fades out towards the bottom: there's more behind the login
                    <ul className="grid gap-3 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
                        {preview.map((player, i) => (
                            <PreviewCard key={i} player={player} index={i} />
                        ))}
                    </ul>
                ) : (
                    <SkeletonCards />
                )}
            </div>

            {asking && (
                <ConfirmDialog
                    title="Log in to continue"
                    confirmLabel="Log in with osu!"
                    onConfirm={() => window.location.assign(LOGIN_URL)}
                    onClose={() => setAsking(false)}
                >
                    <p>Log in with osu! to use Find people.</p>
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

/** A real excerpt with the player's country; where their avatar and name would be, plain blocks like SkeletonCards */
function PreviewCard({ player, index }: { player: PreviewPlayer; index: number }) {
    const bar = 'rounded-full bg-surface-2';
    return (
        <li style={{ animationDelay: `${index * 45}ms` }} className="animate-fade-up rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start gap-3">
                <div aria-hidden="true" className="size-12 shrink-0 rounded-xl bg-surface-2" />
                <div className="flex-1 pt-1">
                    <div aria-hidden="true" className={`${bar} h-4 w-32`} />
                    {player.country_code && <p className="mt-1.5 text-sm text-muted">{countryName(player.country_code)}</p>}
                </div>
            </div>
            <Excerpt snippet={player.snippet} />
        </li>
    );
}
