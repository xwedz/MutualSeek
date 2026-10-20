// src/detect.ts —— 找出個人頁面（BBCode 原文）裡提到 mutual 的地方。
//
// 這是純函式：輸入文字、輸出結果，不碰 API 也不碰資料庫，所以可以單獨測試（見 detect.test.ts）。
//
// 設計原則：工具只負責「找出提到 mutual 的人」，不判斷對方是想要還是不想要。
// 之前試過用規則加權判斷語意，但語言的變化太多（例如 "I'll follow back whoever I want"），
// 規則永遠補不完。所以改成把相關的句子摘錄出來、標出關鍵字，由使用者自己閱讀後決定。
//
// 已知限制：寫在圖片裡的文字讀不到。

/** 摘錄的一小段文字；hit = true 的部分是命中的關鍵字，前端會標上顏色。 */
export interface SnippetPart {
    text: string;
    hit: boolean;
}

export type Snippet = SnippetPart[];

export interface Detection {
    mentioned: boolean;
    count: number; // 關鍵字出現幾次
    snippets: Snippet[]; // 最多 MAX_SNIPPETS 段
}

// 所有關鍵字合成一個正規表達式。
//   - 英文加 \b（單字邊界），避免比對到單字的一部分。中日韓文字沒有單字邊界，所以不加。
//   - 長的寫在短的前面：同一個位置會優先比對到「相互フォロー」，而不是只比對到「相互」。
//   - 不收 "add me"、"follow me"：多半是 "add me on discord"、"follow me on twitch"，跟 mutual 無關。
const KEYWORDS = new RegExp(
    [
        String.raw`\bmutuals?\b`,
        String.raw`\bf4f\b`,
        String.raw`\bfollow\s?(?:4|for)\s?follow\b`,
        String.raw`\badd\s?(?:4|for)\s?add\b`,
        String.raw`\bfollowback\b`,
        String.raw`\b(?:follow|add|friend)(?:ing)?\s+(?:you\s+|u\s+|everyone\s+|people\s+)?back\b`,
        // 中文（繁簡）
        '互相追蹤|互相关注|互關|互关|互粉|回關|回关|回粉|互追|互加|互fo',
        // 日文
        '相互フォロー|フォロバ|相互',
        // 韓文
        '맞팔',
    ].join('|'),
    'gi',
);

const SPAN_BEFORE = 50;
const SPAN_AFTER = 70;
const MAX_SNIPPETS = 2;

/**
 * 把 BBCode 轉成接近「畫面上看到的文字」：
 * 圖片、影片、音訊、imagemap 的內容是網址，整段拿掉；其他標籤只拿掉標籤本身、保留文字。
 */
export function bbcodeToText(raw: string): string {
    return raw
        .replace(/\[(img|imagemap|youtube|audio)(?:=[^\]]*)?\][\s\S]*?\[\/\1\]/gi, ' ')
        .replace(/\[\/?[a-z*]+(?:=[^\]]*)?\]/gi, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function detectMutualMention(raw: string): Detection {
    const text = bbcodeToText(raw);
    const matches = [...text.matchAll(KEYWORDS)].map(m => ({ start: m.index, end: m.index + m[0].length }));
    if (matches.length === 0) return { mentioned: false, count: 0, snippets: [] };

    // 每個命中前後各取一段範圍；範圍重疊（兩個關鍵字離得很近）就合併成同一段摘錄
    const windows: { start: number; end: number; hits: typeof matches }[] = [];
    for (const match of matches) {
        const start = Math.max(0, match.start - SPAN_BEFORE);
        const end = Math.min(text.length, match.end + SPAN_AFTER);
        const last = windows.at(-1);
        if (last && start <= last.end) {
            last.end = Math.max(last.end, end);
            last.hits.push(match);
        } else {
            windows.push({ start, end, hits: [match] });
        }
    }

    const snippets = windows.slice(0, MAX_SNIPPETS).map(({ start, end, hits }) => {
        const parts: Snippet = [];
        let cursor = start;
        for (const hit of hits) {
            if (hit.start > cursor) parts.push({ text: text.slice(cursor, hit.start), hit: false });
            parts.push({ text: text.slice(hit.start, hit.end), hit: true });
            cursor = hit.end;
        }
        if (end > cursor) parts.push({ text: text.slice(cursor, end), hit: false });

        // 不是從頭或到尾的地方加上刪節號，讓使用者知道前後還有內容
        if (start > 0) parts.unshift({ text: '…', hit: false });
        if (end < text.length) parts.push({ text: '…', hit: false });
        return parts;
    });

    return { mentioned: true, count: matches.length, snippets };
}
