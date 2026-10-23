// 所有跟後端溝通的地方都集中在這裡，元件本身不直接碰 fetch。

import type { CandidateSort, CandidatesResponse, FriendsResponse, MeResponse, StatsResponse } from './types';

export class ApiError extends Error {
    constructor(message: string, public status: number, public relogin = false) {
        super(message);
    }
}

async function parse<T>(res: Response): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
        throw new ApiError(data.error || 'The site is very busy right now. Please try again in a while.', 429);
    }
    if (!res.ok) throw new ApiError(data.error || `Server error (${res.status})`, res.status, Boolean(data.relogin));
    return data as T;
}

export const fetchMe = () => fetch('/api/me').then(res => parse<MeResponse>(res));

export const logout = () => fetch('/api/auth/logout', { method: 'POST' }).then(res => parse<{ ok: true }>(res));

/** page 從 1 開始；country = 'all' 代表所有國家 */
export const fetchCandidates = (page: number, country: string, sort: CandidateSort) =>
    fetch(`/api/candidates?page=${page}&sort=${sort}${country === 'all' ? '' : `&country=${country}`}`).then(res =>
        parse<CandidatesResponse>(res),
    );

export const fetchFriends = () => fetch('/api/friends').then(res => parse<FriendsResponse>(res));

export const syncFriends = () => fetch('/api/friends/sync', { method: 'POST' }).then(res => parse<FriendsResponse>(res));

export const deleteMyData = () => fetch('/api/account/delete', { method: 'POST' }).then(res => parse<{ ok: true }>(res));

export const fetchStats =() => fetch('/api/stats').then(res => parse<StatsResponse>(res));

export const profileUrl = (id: number) => `https://osu.ppy.sh/users/${id}`;
