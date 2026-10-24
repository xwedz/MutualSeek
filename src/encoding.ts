// src/encoding.ts — base64url and UTF-8 conversion.
//
// Workers don't have Node's Buffer by default, so this wraps the standard btoa / atob.
// base64url replaces base64's + and / with - and _ and drops the trailing =, so it can go into cookies and URLs as is.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Web Crypto expects a plain ArrayBuffer, but encode() is typed with the wider ArrayBufferLike,
// so it's wrapped in new Uint8Array(...) to satisfy the types.
export const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text));
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

export function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (const byte of view) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on malformed input; the caller decides whether that simply means "invalid". */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
