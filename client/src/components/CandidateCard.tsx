import { profileUrl } from '../api';
import { countryName } from '../countries';
import { formatNumber, timeAgo } from '../format';
import type { Candidate, SnippetPart } from '../types';
import { Avatar } from './Avatar';
import { CheckIcon, CopyIcon, ExternalIcon, LockIcon, SkipIcon } from './Icons';

interface Props {
    candidate: Candidate;
    index: number;
    leaving: boolean;
    copied: boolean;
    showCountry: boolean; // show the player's country when "All countries" is selected
    onCopy: () => void;
    onSkip: () => void;
}

export function CandidateCard({ candidate: c, index, leaving, copied, showCountry, onCopy, onSkip }: Props) {
    const friendsOnly = c.pm_friends_only === 1;
    return (
        <li
            // Entrances are staggered (up to 8 cards, so scrolling down never waits long); a skipped card fades out before it's removed
            style={{ animationDelay: leaving ? '0ms' : `${Math.min(index, 8) * 45}ms` }}
            className={`lift rounded-2xl border border-line bg-surface p-4 transition duration-200 hover:-translate-y-0.5 hover:border-pink/40 ${
                leaving ? 'animate-fade-out' : 'animate-fade-up'
            }`}
        >
            <div className="flex items-start gap-3">
                <Avatar url={c.avatar_url} name={c.username} />
                <div className="min-w-0 flex-1">
                    <a
                        href={profileUrl(c.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-lg font-semibold text-ink transition-colors hover:text-pink"
                    >
                        {c.username}
                    </a>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
                        {showCountry && c.country_code && <span className="text-ink/80">{countryName(c.country_code)}</span>}
                        {c.country_rank !== null && <span>#{formatNumber(c.country_rank)} in country</span>}
                        <span>{formatNumber(c.pp)}pp</span>
                        {c.follower_count !== null && <span>{formatNumber(c.follower_count)} followers</span>}
                        {/* Candidates have always been online in the last 30 days; for players who hide their status the exact time is unknown, so it just says "this month" */}
                        <span>{c.last_visit === null ? 'active this month' : `seen ${timeAgo(c.last_visit)}`}</span>
                    </p>
                    {/* On osu!, "friends" here means people *they* added (osu-web checkChatPmStart: $target->hasFriended($user)),
                        so adding them yourself doesn't let you message them */}
                    {friendsOnly && (
                        <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-warn">
                            <LockIcon size={13} />
                            Blocks messages from people not on their friends list
                        </p>
                    )}
                </div>
            </div>

            {/* The part of their profile that mentions mutuals, keywords in pink, so users can read what they wrote right on the card */}
            {c.snippets.map((snippet, i) => (
                <Excerpt key={i} snippet={snippet} />
            ))}

            <div className="mt-3 flex flex-wrap gap-2">
                <a
                    href={profileUrl(c.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-pink px-3.5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-pink-2"
                >
                    Open profile
                    <ExternalIcon size={14} />
                </a>
                {/* No Copy message for players who block messages from non-friends: it couldn't be sent */}
                {!friendsOnly && (
                    <button
                        type="button"
                        onClick={onCopy}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:border-pink/50"
                    >
                        {/* Icon and text fade in together instead of the label jumping */}
                        <span key={copied ? 'copied' : 'copy'} className="inline-flex animate-fade-in items-center gap-1.5">
                            {copied ? <CheckIcon size={14} className="text-good" /> : <CopyIcon size={14} />}
                            {/* The text shares one span: otherwise the outer flex gap lands between "Copy" and " message" as a double-width space */}
                            <span>
                                {copied ? (
                                    'Copied'
                                ) : (
                                    <>
                                        Copy<span className="hidden sm:inline"> message</span>
                                    </>
                                )}
                            </span>
                        </span>
                    </button>
                )}
                {/* Icon only on phones, so all three buttons fit on one row */}
                <button
                    type="button"
                    onClick={onSkip}
                    aria-label="Skip"
                    title="Skip: hide this player"
                    className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:text-ink"
                >
                    <SkipIcon size={14} />
                    <span className="hidden sm:inline">Skip</span>
                </button>
            </div>
        </li>
    );
}

/** One excerpt from a player's profile, matched keywords in pink (also used by the logged-out preview) */
export function Excerpt({ snippet }: { snippet: SnippetPart[] }) {
    return (
        <blockquote className="mt-3 rounded-xl border-l-2 border-pink/50 bg-surface-2/60 px-3 py-2 text-sm break-words text-ink/85">
            {snippet.map((part, j) =>
                part.hit ? (
                    <mark key={j} className="rounded bg-pink/15 px-0.5 font-semibold text-pink">
                        {part.text}
                    </mark>
                ) : (
                    <span key={j}>{part.text}</span>
                ),
            )}
        </blockquote>
    );
}
