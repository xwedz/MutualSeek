import { useEffect, useRef, useState } from 'react';

const CLOSE_MS = 200; // 跟 index.css 的 fade-away 時間一致

interface Props {
    username: string;
    /** 按下確認的當下立刻呼叫（在這裡開新分頁）：瀏覽器只允許「使用者點擊當下」開分頁，延遲開會被擋 */
    onConfirm: () => void;
    /** 淡出動畫結束後呼叫，父元件在這時候才把視窗移除 */
    onClose: () => void;
}

/**
 * 第一次按「Open profile」時出現的說明視窗。按「I understand」之後就不再出現（由父元件記在 localStorage）。
 * 只出現一次是刻意的：同樣的視窗每次都跳，使用者很快就會不看內容直接關掉（警告疲勞），提醒反而失效。
 */
export function ReadFirstDialog({ username, onConfirm, onClose }: Props) {
    const [closing, setClosing] = useState(false);
    const confirmRef = useRef<HTMLButtonElement>(null);
    // 用 ref 存最新的 onClose，下面只在掛載時註冊一次的鍵盤事件也能呼叫到最新版本
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // 先播淡出動畫，結束後才真正移除
    const close = () => {
        setClosing(true);
        window.setTimeout(() => onCloseRef.current(), CLOSE_MS);
    };

    useEffect(() => {
        // 打開時把焦點移到主要按鈕，鍵盤使用者可以直接按 Enter；關閉後把焦點還給原本的按鈕
        const previous = document.activeElement as HTMLElement | null;
        confirmRef.current?.focus();
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
                role="dialog"
                aria-modal="true"
                aria-labelledby="read-first-title"
                aria-describedby="read-first-body"
                className={`relative w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/50 ${
                    closing ? 'animate-fade-out' : 'animate-fade-up'
                }`}
            >
                <h2 id="read-first-title" className="text-lg font-semibold">
                    Before you add {username}
                </h2>
                <div id="read-first-body" className="mt-2 space-y-2 text-sm text-ink/85">
                    <p>
                        This list shows players whose profile <span className="font-semibold text-pink">mentions</span> mutuals. It can't
                        tell whether they actually want them. Some people mention mutuals only to say no.
                    </p>
                    <p>Please read what they wrote yourself before adding or messaging them, so you don't bother anyone who isn't looking.</p>
                </div>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
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
                        className="rounded-xl bg-pink px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-pink-2"
                    >
                        I understand, open profile
                    </button>
                </div>
            </div>
        </div>
    );
}
