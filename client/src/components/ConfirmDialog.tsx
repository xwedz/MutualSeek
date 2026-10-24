import { useEffect, useRef, useState, type ReactNode } from 'react';

const CLOSE_MS = 200; // matches the fade-away duration in index.css

interface Props {
    title: string;
    children: ReactNode; // the explanation
    confirmLabel: string;
    /** Dangerous actions (e.g. deleting data): the confirm button turns red and focus starts on Cancel, so Enter alone can't trigger it */
    danger?: boolean;
    /** false: no Cancel button, and Escape or clicking the backdrop doesn't close it; confirming is the only way out */
    dismissible?: boolean;
    /** Called immediately on confirm: e.g. browsers only allow opening a new tab during the click itself, and block delayed ones */
    onConfirm: () => void;
    /** Called after the fade-out finishes; that's when the parent removes the dialog */
    onClose: () => void;
}

/** Confirmation dialog: the backdrop fades in and the dialog rises into place; on close it fades out before being removed. */
export function ConfirmDialog({ title, children, confirmLabel, danger = false, dismissible = true, onConfirm, onClose }: Props) {
    const [closing, setClosing] = useState(false);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    // Keep the latest onClose in a ref so the key handler, registered once on mount below, always calls the current one
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const close = () => {
        setClosing(true);
        window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
    };

    useEffect(() => {
        // Move focus in on open so keyboard users can act right away; give it back to the original button on close
        const previous = document.activeElement as HTMLElement | null;
        (danger ? cancelRef : confirmRef).current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && dismissible) close();
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            previous?.focus();
        };
    }, []);

    return (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
            <div
                className={`absolute inset-0 bg-bg/75 backdrop-blur-sm ${closing ? 'animate-fade-away' : 'animate-fade-in'}`}
                onClick={dismissible ? close : undefined}
                aria-hidden="true"
            />
            <div
                role={danger ? 'alertdialog' : 'dialog'}
                aria-modal="true"
                aria-labelledby="confirm-title"
                aria-describedby="confirm-body"
                className={`relative w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/50 ${
                    closing ? 'animate-fade-out' : 'animate-fade-up'
                }`}
            >
                <h2 id="confirm-title" className="text-lg font-semibold">
                    {title}
                </h2>
                <div id="confirm-body" className="mt-2 space-y-2 text-sm text-ink/85">
                    {children}
                </div>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                    {dismissible && (
                        <button
                            ref={cancelRef}
                            type="button"
                            onClick={close}
                            className="rounded-xl px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        ref={confirmRef}
                        type="button"
                        onClick={() => {
                            onConfirm();
                            close();
                        }}
                        className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                            danger ? 'bg-bad text-bg hover:bg-bad/85' : 'bg-pink text-bg hover:bg-pink-2'
                        }`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
