import { profileUrl } from '../api';
import { formatNumber, timeAgo } from '../format';
import type { Candidate } from '../types';
import { Avatar } from './Avatar';
import { CheckIcon, CopyIcon, ExternalIcon, LockIcon, SkipIcon } from './Icons';

interface Props {
    candidate: Candidate;
    index: number;
    leaving: boolean;
    copied: boolean;
    onCopy: () => void;
    onSkip: () => void;
}

export function CandidateCard({ candidate: c, index, leaving, copied, onCopy, onSkip }: Props) {
    const strong = c.mutual_level === 'strong';

    return (
        <li
            // 進場依序錯開（最多錯開 8 張，避免往下捲時等太久）；按「略過」時淡出後才從列表移除
            style={{ animationDelay: leaving ? '0ms' : `${Math.min(index, 8) * 45}ms` }}
            className={`lift rounded-2xl border border-line bg-surface p-4 transition duration-200 hover:-translate-y-0.5 hover:border-pink/40 ${
                leaving ? 'animate-fade-out' : 'animate-fade-up'
            }`}
        >
            <div className="flex items-start gap-3">
                <Avatar url={c.avatar_url} name={c.username} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <a
                            href={profileUrl(c.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-lg font-semibold text-ink transition-colors hover:text-pink"
                        >
                            {c.username}
                        </a>
                        <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                strong ? 'bg-pink/15 text-pink' : 'bg-surface-2 text-muted'
                            }`}
                            title={strong ? 'Their profile clearly asks for mutuals' : 'Their profile mentions mutuals'}
                        >
                            {strong ? 'Looking for mutuals' : 'Mentions mutuals'}
                        </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
                        {c.country_rank !== null && <span>#{formatNumber(c.country_rank)} in country</span>}
                        <span>{formatNumber(c.pp)}pp</span>
                        {c.follower_count !== null && <span>{formatNumber(c.follower_count)} followers</span>}
                        {/* 候選人一定是 30 天內上線過的人；隱藏上線狀態的人看不到確切時間，只能說「這個月有上線」 */}
                        <span>{c.last_visit === null ? 'active this month' : `seen ${timeAgo(c.last_visit)}`}</span>
                    </p>
                    {c.pm_friends_only === 1 && (
                        <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-warn">
                            <LockIcon size={13} />
                            Only accepts messages from friends: add them first, then message
                        </p>
                    )}
                </div>
            </div>

            {c.mutual_snippet && (
                <blockquote className="mt-3 rounded-xl border-l-2 border-pink/50 bg-surface-2/60 px-3 py-2 text-sm break-words text-ink/85">
                    {c.mutual_snippet}
                </blockquote>
            )}

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
                <button
                    type="button"
                    onClick={onCopy}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:border-pink/50"
                >
                    {/* 圖示與文字一起淡入切換，不要突然跳字 */}
                    <span key={copied ? 'copied' : 'copy'} className="inline-flex animate-fade-in items-center gap-1.5">
                        {copied ? <CheckIcon size={14} className="text-good" /> : <CopyIcon size={14} />}
                        {/* 文字包在同一個 span 裡：不然外層 flex 的間距會加在 "Copy" 和 " message" 之間，變成兩倍寬的空白 */}
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
                {/* 手機上只顯示圖示，三顆按鈕才排得進同一行 */}
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
