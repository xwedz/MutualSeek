import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { EyeOffIcon, Spinner } from './Icons';

interface Props {
    loggedIn: boolean;
    optedOut: boolean;
    onSetListing: (listed: boolean) => Promise<void>;
}

/**
 * Find people 篩選列最右邊的「Don't list me」（FAQ 裡也有同樣的設定）。
 * 放在主畫面很顯眼，誤按的機會比較高，所以移除自己之前先跳確認視窗；沒登入時視窗改成說明並引導登入。
 * 「List me again」是恢復，不需要確認。
 */
export function ListingButton({ loggedIn, optedOut, onSetListing }: Props) {
    const [confirming, setConfirming] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function save(listed: boolean) {
        setSaving(true);
        setError(null);
        try {
            await onSetListing(listed);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save. Please try again.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="ml-auto flex flex-col items-end">
            <button
                type="button"
                onClick={() => (loggedIn && optedOut ? save(true) : setConfirming(true))}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl px-2 py-2 text-sm text-muted transition-colors hover:text-ink disabled:opacity-60"
            >
                {saving ? <Spinner size={14} /> : <EyeOffIcon size={14} />}
                {/* key 換了就重新掛載並淡入，文字不會突然跳 */}
                <span key={String(optedOut)} className="animate-fade-in">
                    {loggedIn && optedOut ? 'List me again' : "Don't list me"}
                </span>
            </button>
            {error && <p className="animate-fade-in text-xs text-bad">{error}</p>}

            {confirming &&
                (loggedIn ? (
                    <ConfirmDialog
                        title="Remove yourself from the list?"
                        confirmLabel="Don't list me"
                        onConfirm={() => save(false)}
                        onClose={() => setConfirming(false)}
                    >
                        <p>You'll disappear from Find people right away, and future scans won't add you again.</p>
                        <p>You can undo this at any time with List me again.</p>
                    </ConfirmDialog>
                ) : (
                    <ConfirmDialog
                        title="Don't want to be listed?"
                        confirmLabel="Log in with osu!"
                        onConfirm={() => window.location.assign('/api/auth/login')}
                        onClose={() => setConfirming(false)}
                    >
                        <p>Log in with osu! to remove yourself from this list. It takes effect right away, and you can undo it at any time.</p>
                        <p>Logging in also asks to read your friend list, because the site uses one login for everything. You can log out right afterwards.</p>
                    </ConfirmDialog>
                ))}
        </div>
    );
}
