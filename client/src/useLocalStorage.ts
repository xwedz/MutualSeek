// Personal preferences kept in the browser (skipped players, the message template).
// Only things that are fine to lose: in private browsing or after clearing site data, localStorage may fail to read or write,
// so every read and write is wrapped in try/catch and falls back to the default, and the page keeps working.

import { useCallback, useState } from 'react';

type Update<T> = T | ((prev: T) => T);

export function useLocalStorage<T>(key: string, initial: T): [T, (update: Update<T>) => void] {
    const [value, setValue] = useState<T>(() => {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? initial : (JSON.parse(raw) as T);
        } catch {
            return initial;
        }
    });

    // Supports functional updates like useState: setX(prev => ...) always receives the latest value,
    // even when called later (e.g. from setTimeout), never a stale value captured earlier.
    const update = useCallback(
        (next: Update<T>) => {
            setValue(prev => {
                const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
                try {
                    localStorage.setItem(key, JSON.stringify(resolved));
                } catch {
                    // if it can't be written, it only lives in this page's state
                }
                return resolved;
            });
        },
        [key],
    );

    return [value, update];
}
