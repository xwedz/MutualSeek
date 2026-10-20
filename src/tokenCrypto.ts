// src/tokenCrypto.ts —— 把 osu! 的 token 加密後才存進資料庫。
//
// 為什麼要存 token：要知道「誰回加了你」，就得定期讀你的 /friends，
// 不能像 Higher or Lower 那樣登入時用一次就丟掉。
//
// 為什麼要加密：萬一資料庫外洩，拿到的只是一堆亂碼，必須同時拿到 TOKEN_ENCRYPTION_KEY
// （存在 Cloudflare 的 secret 裡，不在資料庫）才能解開。
//
// AES-GCM 是「加密 + 防竄改」一次做完的演算法：解密時會檢查完整性，被改過就直接失敗。
// 每次加密都要用新的隨機 IV（初始向量），同一把金鑰絕對不能重複使用同一個 IV。

import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './encoding';

const IV_BYTES = 12; // AES-GCM 建議的 IV 長度

let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function getKey(secret: string): Promise<CryptoKey> {
    if (cachedKey?.secret !== secret) {
        const raw = fromBase64Url(secret);
        if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY 必須是 32 bytes 的 base64url');
        cachedKey = { secret, key: crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) };
    }
    return cachedKey.key;
}

/** 回傳 "iv.密文"（都是 base64url）。 */
export async function encryptToken(secret: string, plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(secret), utf8(plaintext));
    return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function decryptToken(secret: string, value: string): Promise<string> {
    const [iv, ciphertext] = value.split('.');
    if (!iv || !ciphertext) throw new Error('加密 token 的格式不正確');
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(iv) },
        await getKey(secret),
        fromBase64Url(ciphertext),
    );
    return fromUtf8(new Uint8Array(plaintext));
}
