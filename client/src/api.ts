// Every call to the backend lives here; components never call fetch directly.

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

/** page starts at 1; country = 'all' means every country */
export const fetchCandidates = (page: number, country: string, sort: CandidateSort) =>
    fetch(`/api/candidates?page=${page}&sort=${sort}${country === 'all' ? '' : `&country=${country}`}`).then(res =>
        parse<CandidatesResponse>(res),
    );

export const fetchFriends = () => fetch('/api/friends').then(res => parse<FriendsResponse>(res));

export const syncFriends = () => fetch('/api/friends/sync', { method: 'POST' }).then(res => parse<FriendsResponse>(res));

export const acceptGuidelines = () => fetch('/api/guidelines', { method: 'POST' }).then(res => parse<{ guidelinesAccepted: boolean }>(res));

/** "Don't list me": listed = false removes yourself from the list, true undoes it */
export const setListing = (listed: boolean) =>
    fetch('/api/listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listed }),
    }).then(res => parse<{ optedOut: boolean }>(res));

export const deleteMyData = () => fetch('/api/account/delete', { method: 'POST' }).then(res => parse<{ ok: true }>(res));

export const fetchStats =() => fetch('/api/stats').then(res => parse<StatsResponse>(res));

export const profileUrl = (id: number) => `https://osu.ppy.sh/users/${id}`;
