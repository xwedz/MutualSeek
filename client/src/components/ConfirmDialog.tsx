import { useEffect, useRef, useState, type ReactNode } from 'react';

const CLOSE_MS = 200; // 跟 index.css 的 fade-away 時間一致

interface Props {
    title: string;
    children: ReactNode; // 說明文字
    confirmLabel: string;
    /** 危險操作（例如刪除資料）：確認按鈕改成紅色，而且預設焦點放在「取消」，避免一按 Enter 就執行 */
    danger?: boolean;
    /** 按下確認的當下立刻呼叫：例如要開新分頁時，瀏覽器只允許「使用者點擊當下」開，延遲開會被擋 */
    onConfirm: () => void;
    /** 淡出動畫結束後呼叫，父元件在這時候才把視窗移除 */
    onClose: () => void;
}

/** 確認視窗：背景遮罩淡入、視窗由下往上浮現；關閉時先淡出，再移除。 */
export function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onClose }: Props) {
    const [closing, setClosing] = useState(false);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    // 用 ref 存最新的 onClose，下面只在掛載時註冊一次的鍵盤事件也能呼叫到最新版本
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const close = () => {
        setClosing(true);
        window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
    };

    useEffect(() => {
        // 打開時移動焦點，鍵盤使用者可以直接操作；關閉後把焦點還給原本的按鈕
        const previous = document.activeElement as HTMLElement | null;
        (danger ? cancelRef : confirmRef).current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
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
                onClick={close}
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
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={close}
                        className="rounded-xl px-4 py-2 text-sm text-muted transition-colors hover:text-ink"
                    >
                        Cancel
                    </button>
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
