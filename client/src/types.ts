// 後端 API 回傳的資料形狀。欄位名稱跟資料庫一致（snake_case），對照 src/index.ts 的查詢。

export interface SessionUser {
    osuUserId: number;
    username: string;
    avatarUrl: string | null;
}

export interface AccountInfo {
    lastSyncedAt: number | null;
    friendLimit: number;
}

export interface MeResponse {
    user: SessionUser | null;
    account?: AccountInfo;
}

/** 摘錄的一小段文字；hit = true 的部分是命中的關鍵字（對照 src/detect.ts） */
export interface SnippetPart {
    text: string;
    hit: boolean;
}

export interface Candidate {
    id: number;
    username: string;
    avatar_url: string | null;
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

export interface StatsResponse {
    country: string;
    mode: string;
    rankingNextPage: number | null;
    stats: { players: number; scanned: number; mentioned: number; updatedAt: number } | null;
}
