// src/encoding.ts —— base64url 與 UTF-8 的轉換。
//
// Workers 預設沒有 Node 的 Buffer，所以用標準的 btoa / atob 自己包一層。
// base64url 是把 base64 的 + / 換成 - _ 並拿掉結尾的 =，放進 cookie 或網址都不用再跳脫。

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Web Crypto 的參數要求「一般的 ArrayBuffer」，但 encode() 的型別宣告是較寬的 ArrayBufferLike，
// 所以包一層 new Uint8Array(...) 讓型別符合。
export const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text));
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

export function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (const byte of view) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 格式錯誤時丟出例外，呼叫端自行決定要當成「無效」處理。 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
