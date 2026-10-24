import { useState } from 'react';

/** osu! avatar. If the image fails to load (no avatar set, network issues), the first letter of the name is shown instead. */
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
