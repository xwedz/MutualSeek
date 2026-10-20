// 國家代碼（ISO 3166，例如 TW）轉成國家名稱。
// 用瀏覽器內建的 Intl.DisplayNames，不用自己維護一份 236 國的名稱表。

let names: Intl.DisplayNames | null = null;
try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
    // 很舊的瀏覽器不支援：退回直接顯示代碼
}

export function countryName(code: string): string {
    try {
        return names?.of(code) ?? code;
    } catch {
        return code; // 不是合法代碼時 of() 會丟出例外
    }
}
