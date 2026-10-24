// Shapes of the backend API responses. Field names match the database (snake_case); see the queries in src/index.ts.

export interface SessionUser {
    osuUserId: number;
    username: string;
    avatarUrl: string | null;
    countryCode: string | null;
}

export interface AccountInfo {
    lastSyncedAt: number | null;
    friendLimit: number;
    guidelinesAccepted: boolean; // accepted the current "Before you start" guidelines
}

export interface MeResponse {
    user: SessionUser | null;
    account?: AccountInfo;
    optedOut?: boolean; // chose "Don't list me"
}

/** A piece of an excerpt; parts with hit = true are matched keywords (see src/detect.ts) */
export interface SnippetPart {
    text: string;
    hit: boolean;
}

export interface Candidate {
    id: number;
    username: string;
    avatar_url: string | null;
    country_code: string | null;
    global_rank: number | null;
    country_rank: number | null;
    pp: number | null;
    last_visit: number | null;
    pm_friends_only: number;
    follower_count: number | null;
    snippets: SnippetPart[][];
}

export interface CandidatesResponse {
    candidates: Candidate[];
    hasMore: boolean;
}

/** Candidate list sort order (see CANDIDATE_ORDER in src/index.ts) */
export type CandidateSort = 'recent' | 'rank' | 'followers';

export interface Friend {
    target_id: number;
    username: string;
    avatar_url: string | null;
    country_code: string | null;
    last_visit: number | null;
    mutual: number;
    first_seen_at: number | null;
    mutual_since: number | null;
}

export type FriendEventType = 'added' | 'mutual' | 'unmutual' | 'removed';

export interface FriendEvent {
    target_id: number;
    username: string;
    type: FriendEventType;
    at: number;
}

export interface SyncResult {
    baseline: boolean;
    added: number;
    mutual: number;
    unmutual: number;
    removed: number;
}

export interface FriendsResponse {
    account: AccountInfo;
    friends: Friend[];
    events: FriendEvent[];
    result?: SyncResult | null;
}

/** See getCrawlerProgress in src/crawler.ts */
export interface StatsResponse {
    countries: string; // "all" or comma-separated country codes
    mode: string;
    countriesInPass: number;
    currentCountry: string | null;
    passScanned: number;
    lastPassScanned: number | null;
    mentioned: number | null;
    byCountry: { code: string; count: number }[]; // countries with candidates, largest first (updated hourly)
}
