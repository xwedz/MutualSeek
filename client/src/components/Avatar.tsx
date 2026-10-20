import { useState } from 'react';

/** osu! 頭像。圖片載入失敗時（帳號沒設頭像、網路問題）改顯示名字的第一個字。 */
export function Avatar({ url, name, size = 48 }: { url: string | null; name: string; size?: number }) {
    const [failed, setFailed] = useState(false);
    const style = { width: size, height: size };

    if (!url || failed) {
        return (
            <div
                style={style}
                className="grid shrink-0 place-items-center rounded-xl bg-surface-2 font-semibold text-muted"
                aria-hidden="true"
            >
                {name.slice(0, 1).toUpperCase()}
            </div>
        );
    }
    return (
        <img
            src={url}
            alt=""
            style={style}
            loading="lazy"
            onError={() => setFailed(true)}
            className="shrink-0 rounded-xl bg-surface-2 object-cover"
        />
    );
}
