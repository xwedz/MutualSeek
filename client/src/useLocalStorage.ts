// 存在瀏覽器裡的個人偏好（略過的玩家、私訊範本）。
// 只放「遺失了也沒關係」的東西：無痕模式或清除網站資料時，localStorage 可能讀不到或寫入失敗，
// 所以讀寫都包在 try/catch 裡，失敗就退回預設值，畫面照常運作。

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

    // 跟 useState 一樣支援「函式更新」：setX(prev => ...) 拿到的永遠是最新值，
    // 不會因為 setTimeout 之類的延遲執行，用到建立當下的舊值。
    const update = useCallback(
        (next: Update<T>) => {
            setValue(prev => {
                const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
                try {
                    localStorage.setItem(key, JSON.stringify(resolved));
                } catch {
                    // 寫不進去就只保留在這次的頁面狀態裡
                }
                return resolved;
            });
        },
        [key],
    );

    return [value, update];
}
