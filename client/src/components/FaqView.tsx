import { useState, type ReactNode } from 'react';
import { ChevronIcon, Spinner } from './Icons';

/** The "Why do I need to log in?" question, linked from Find people before logging in */
export const WHY_LOG_IN = 'why-log-in';

interface Props {
    loggedIn: boolean;
    optedOut: boolean;
    onSetListing: (listed: boolean) => Promise<void>;
}

/**
 * Frequently asked questions. Each one expands and collapses on its own (several can be open at once).
 * Keep the answers in line with how the site behaves: update them when the scan scope, frequency, keyword languages or stored data change.
 */
export function FaqView({ loggedIn, optedOut, onSetListing }: Props) {
    // A slug gives the question a link (/faq#slug) that opens it on arrival
    const items: { q: string; a: ReactNode; slug?: string }[] = [
        {
            q: 'Why do I need to log in?',
            slug: WHY_LOG_IN,
            a: (
                <>
                    <p>
                        To protect the players on the list. Showing it only to logged-in osu! players keeps it from being browsed or collected
                        anonymously, and makes it easier to stop anyone who misuses it.
                    </p>
                    <p>
                        Logging in only lets the site see who you are and read your friend list. It can't add friends or send messages for you,
                        and you can log out or delete your data at any time. See the questions below for exactly what it keeps.
                    </p>
                </>
            ),
        },
        {
            q: 'What is MutualSeek?',
            a: (
                <p>
                    A small tool for osu! players who want more mutuals. <b>Find people</b> lists players whose profile mentions mutuals, so you
                    can read what they wrote and add them yourself. <b>Follow-backs</b> shows who added you back once you log in.
                </p>
            ),
        },
        {
            q: 'How does it find players?',
            a: (
                <p>
                    About once a month, it goes through each country's osu! standard performance ranking (top 10,000 per country) and reads the
                    profile page of every player who has been online in the last 30 days. Profiles that mention mutuals in English, Chinese,
                    Japanese or Korean are listed with a short excerpt. (More languages may be added later, based on suggestions.)
                </p>
            ),
        },
        {
            q: "Why do some listed players say they don't want mutuals?",
            a: (
                <p>
                    The scanner only looks for words like "mutual" or "follow back". It can't tell whether someone is asking for mutuals or
                    saying no to them, so please read the excerpt, or their profile, before adding anyone.
                </p>
            ),
        },
        {
            q: 'Why is the list in a random order?',
            a: (
                <p>
                    So the same few players don't hear from everyone. The order changes every day. <b>Online in the past week</b> narrows it
                    down to players seen online in the last 7 days (players who hide their online status are left out).
                </p>
            ),
        },
        {
            q: "Why isn't my country, or a certain player, listed?",
            a: (
                <>
                    <p>
                        The scanner goes country by country, starting with the countries that have the most active players, so smaller
                        countries come later in each round.
                    </p>
                    <p>A player also won't appear if they:</p>
                    <ul className="list-disc space-y-1 pl-5">
                        <li>are outside their country's top 10,000, or haven't been online for 30 days</li>
                        <li>don't have a profile page (only players who have had osu!supporter can create one)</li>
                        <li>wrote about mutuals in another language, or inside an image</li>
                        <li>are already on your friend list (when you're logged in)</li>
                    </ul>
                </>
            ),
        },
        {
            q: 'Does it collect anything private?',
            a: (
                <p>
                    No. It only reads what anyone can see on an osu! profile: username, avatar, country, rank, pp, follower count, when they
                    were last online (if they show it), whether they accept messages from non-friends, and the part of their profile page that
                    mentions mutuals. If you log in, it also reads your own friend list, which is only shown to you.
                </p>
            ),
        },
        {
            q: "Even so, I don't want to be listed. What can I do?",
            a: (
                <>
                    <p>
                        That's completely fine. Log in with osu! and choose <b>Don't list me</b>, either below or at the right end of the
                        filters on Find people. You're removed right away, and the scanner won't add you again. You can undo it at any time.
                    </p>
                    <p>
                        Logging in also asks to read your friend list, because the site uses one login for everything. You can log out right
                        afterwards, which revokes that access. Removing the mention from your profile works too, but the list only updates on the
                        next monthly scan.
                    </p>
                    <ListingControl loggedIn={loggedIn} optedOut={optedOut} onSetListing={onSetListing} />
                </>
            ),
        },
        {
            q: 'What does the site keep if I log in?',
            a: (
                <p>
                    Your username, your friend list as of each sync, and a history of who added or removed you, so it can show changes over time.
                    Your osu! access is stored encrypted and is revoked when you log out. <b>Delete my data</b>, at the bottom of Follow-backs,
                    removes all of it. If you chose Don't list me, that choice is kept so you stay unlisted.
                </p>
            ),
        },
        {
            q: 'Can MutualSeek add friends or send messages for me?',
            a: (
                <p>
                    No. It only has permission to see who you are and read your friend list. Adding friends and messaging always happen on osu!
                    itself; <b>Copy message</b> just puts your template on the clipboard.
                </p>
            ),
        },
        {
            q: 'How does Follow-backs work?',
            a: (
                <p>
                    Each time you sync, the site reads your friend list from osu!, which says whether each friend has added you back, and
                    compares it with your previous sync. That's how it can tell you who followed you back, who removed you, and who hasn't added
                    you yet.
                </p>
            ),
        },
        {
            q: 'Is MutualSeek affiliated with osu!?',
            a: <p>No. It's an independent fan project, not affiliated with osu! or ppy Pty Ltd. It uses the public osu! API.</p>,
        },
    ];

    return (
        <section>
            <h2 className="text-lg font-semibold">Frequently asked questions</h2>
            <ul className="mt-4 grid gap-2">
                {items.map((item, i) => (
                    <FaqItem key={i} id={`faq-${i}`} slug={item.slug} question={item.q}>
                        {item.a}
                    </FaqItem>
                ))}
            </ul>
        </section>
    );
}

function FaqItem({ id, slug, question, children }: { id: string; slug?: string; question: string; children: ReactNode }) {
    // Arriving through the question's link (e.g. "Why log in?" on Find people) opens it straight away
    const [open, setOpen] = useState(() => slug !== undefined && window.location.hash === `#${slug}`);
    return (
        <li id={slug} className="rounded-2xl border border-line bg-surface">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                aria-controls={id}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left font-medium transition-colors hover:text-pink"
            >
                {question}
                <ChevronIcon size={16} className={`shrink-0 text-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
            </button>
            {/* grid-rows 0fr → 1fr animates the height (like the message template); inert keeps collapsed buttons out of the Tab order */}
            <div
                id={id}
                inert={!open}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out-expo ${
                    open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
            >
                <div className="overflow-hidden">
                    <div className="space-y-3 px-4 pb-4 text-sm leading-relaxed text-ink/85 [&_b]:font-semibold [&_b]:text-ink">{children}</div>
                </div>
            </div>
        </li>
    );
}

/** The "Don't list me" control in the FAQ: shows a login button when logged out (login returns to the FAQ). */
function ListingControl({ loggedIn, optedOut, onSetListing }: Props) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!loggedIn) {
        return (
            <a
                href="/api/auth/login?return=faq"
                className="inline-block rounded-xl bg-pink px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-pink-2"
            >
                Log in with osu!
            </a>
        );
    }

    async function toggle() {
        setSaving(true);
        setError(null);
        try {
            await onSetListing(optedOut);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
        } finally {
            setSaving(false);
        }
    }

    // Same colours as "Delete my data" on the Follow-backs page
    return (
        <div className="rounded-xl border border-bad/25 p-3">
            {/* A new key remounts and fades in, so the status text never jumps */}
            <p key={String(optedOut)} className="animate-fade-in text-muted">
                {optedOut
                    ? "You won't be listed. If you undo this, you'll appear again after the next scan finds a mention on your profile."
                    : 'You can be listed if your profile mentions mutuals.'}
            </p>
            <button
                type="button"
                onClick={toggle}
                disabled={saving}
                className={`mt-2.5 inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                    optedOut ? 'border-line text-ink hover:border-pink/50' : 'border-bad/50 text-bad hover:bg-bad/10'
                }`}
            >
                {saving && <Spinner size={14} />}
                {optedOut ? 'List me again' : "Don't list me"}
            </button>
            {error && <p className="mt-2 animate-fade-in text-bad">{error}</p>}
        </div>
    );
}
