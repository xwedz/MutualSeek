// src/tokenCrypto.ts — osu! tokens are encrypted before they're stored in the database.
//
// Why store tokens at all: to know who followed you back, the site has to read your /friends again later,
// so a token can't just be used once at login and thrown away.
//
// Why encrypt them: if the database ever leaked, it would only contain gibberish. Decrypting needs
// TOKEN_ENCRYPTION_KEY, which lives in Cloudflare's secrets, not in the database.
//
// AES-GCM encrypts and protects against tampering in one step: decryption checks integrity and fails if anything changed.
// Every encryption needs a fresh random IV (initialisation vector); an IV must never be reused with the same key.

import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './encoding';

const IV_BYTES = 12; // the recommended IV length for AES-GCM

let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function getKey(secret: string): Promise<CryptoKey> {
    if (cachedKey?.secret !== secret) {
        const raw = fromBase64Url(secret);
        if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64url encoded');
        cachedKey = { secret, key: crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) };
    }
    return cachedKey.key;
}

/** Returns "iv.ciphertext" (both base64url). */
export async function encryptToken(secret: string, plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(secret), utf8(plaintext));
    return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function decryptToken(secret: string, value: string): Promise<string> {
    const [iv, ciphertext] = value.split('.');
    if (!iv || !ciphertext) throw new Error('Malformed encrypted token');
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(iv) },
        await getKey(secret),
        fromBase64Url(ciphertext),
    );
    return fromUtf8(new Uint8Array(plaintext));
}
