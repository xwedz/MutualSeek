// src/detect.ts —— 判斷一段個人頁面（BBCode 原文）是不是在找 mutual。
//
// 這是純函式：輸入文字、輸出結果，不碰 API 也不碰資料庫，所以可以單獨測試（見 detect.test.ts）。
//
// 做法是「規則加權」：
//   - 每條正面規則有權重，命中的規則權重加總成分數。
//     分數 >= 3 視為 strong（明確在找），1–2 視為 weak（有提到 mutual 但不確定）。
//   - 同一段文字只能被計分一次：權重高的規則先比對，之後的規則若命中位置跟已計分的段落重疊就不算。
//     例如 "add me for mutual" 只算「add me for mutual」3 分，裡面的 "add me"、"mutual" 不再重複加分。
//   - 只要命中任何一條負面規則（例如 "no mutuals"、「不回關」），直接判定 negative，不列入候選人。
//     這是為了避免最糟的情況：把明說不要的人推薦給使用者。
//
// 已知限制：寫在圖片裡的文字讀不到；諷刺、反話也判斷不出來。
// 所以前端會顯示命中的那段文字，讓使用者自己看一眼再決定。

export type MutualLevel = 'none' | 'weak' | 'strong' | 'negative';

export interface Detection {
    level: MutualLevel;
    score: number;
    labels: string[]; // 命中的規則名稱，方便除錯與之後調整
    snippet: string | null; // 命中處前後的一小段原文
}

interface Rule {
    label: string;
    pattern: RegExp;
    weight: number;
}

// 中日韓文字沒有「單字邊界」，\b 對它們無效，所以 CJK 規則不加 \b。
const POSITIVE: Rule[] = [
    {
        label: 'looking for mutuals',
        pattern: /\b(?:looking for|want(?:ing)?|need|accept(?:ing)?|open (?:to|for)|down for|up for|seeking)\s+(?:some\s+|new\s+|more\s+|any\s+)?mutuals?\b/i,
        weight: 3,
    },
    { label: 'add me for mutual', pattern: /\b(?:add|friend|follow)\s+(?:me\s+)?(?:for|4)\s+(?:a\s+)?mutuals?\b/i, weight: 3 },
    // 實際掃描時發現的寫法："dm for mutual"、"pm me for mutuals"、"feel free to ask for mutual"
    { label: 'dm for mutual', pattern: /\b(?:dm|pm|message|msg|ask)\s+(?:me\s+)?(?:for|4)\s+(?:a\s+)?mutuals?\b/i, weight: 3 },
    { label: 'mutuals welcome', pattern: /\bmutuals?\s+(?:are\s+|is\s+)?(?:always\s+)?(?:welcome|accepted|open|ok|okay|appreciated)\b/i, weight: 3 },
    {
        label: 'adds back',
        pattern: /\b(?:add|follow|friend)(?:ing)?\s+(?:you\s+|u\s+|everyone\s+|people\s+|everybody\s+)?back\b/i,
        weight: 3,
    },
    { label: 'f4f', pattern: /\b(?:f4f|follow\s?4\s?follow|follow for follow|add\s?4\s?add|add for add)\b/i, weight: 3 },
    {
        label: 'dm me after adding',
        pattern: /\b(?:dm|pm|message|msg|tell)\s+me\s+(?:if|when|after|once)\s+(?:you\s+|u\s+)?(?:add|follow|friend)/i,
        weight: 3,
    },
    // 同一句話不要被兩條規則重複計分（例如 "feel free to add me" 也包含 "add me"），所以合成一條。
    // 不收 "follow me"：個人頁面常寫 "follow me on twitch"，跟 osu! 好友無關。
    { label: 'add me', pattern: /\b(?:add|friend) me\b/i, weight: 2 },
    { label: 'mentions mutual', pattern: /\bmutuals?\b/i, weight: 1 },

    // 中文（繁簡）
    { label: '互關', pattern: /互關|互关|互粉|回關|回关|回粉|互追|互加|互相追蹤|互相关注|互fo/i, weight: 3 },
    { label: '歡迎加好友', pattern: /歡迎(?:加|追蹤|關注|互)|欢迎(?:加|关注|互)|加我好友|求加好友/, weight: 2 },
    // 日文
    { label: '相互フォロー', pattern: /相互フォロー|相互歓迎|相互募集|相互になりましょう|フォロバ/, weight: 3 },
    // 韓文
    { label: '맞팔', pattern: /맞팔/, weight: 3 },
];

// 計分用的版本：依權重由高到低排序（權重相同時維持原本順序），
// 並加上 g 旗標，matchAll 才能逐一找出文字中的每個命中位置。
const POSITIVE_BY_WEIGHT: Rule[] = [...POSITIVE]
    .sort((a, b) => b.weight - a.weight)
    .map(rule => ({ ...rule, pattern: new RegExp(rule.pattern.source, `${rule.pattern.flags}g`) }));

// 否定詞和動詞之間允許夾 0–2 個字，例如 "not really looking for"、"don't usually add back"。
// 但夾的字不能是 forget / hesitate："don't forget to follow back" 字面有 don't，意思卻是正面的。
const FILLER = String.raw`(?:(?!forget|hesitate)[a-z']+\s+){0,2}?`;

const NEGATIVE: Rule[] = [
    { label: 'no mutuals', pattern: /\bno\s+(?:(?:any|more|new)\s+){0,2}mutuals?\b/i, weight: 0 },
    {
        label: 'not looking for mutuals',
        pattern: new RegExp(
            String.raw`\b(?:not|don'?t|do not|doesn'?t|never)\s+${FILLER}(?:looking for|accepting|doing|interested in|want(?:ing)?|need|taking|adding)\s+(?:(?:any|more|new)\s+){0,2}mutuals?\b`,
            'i',
        ),
        weight: 0,
    },
    { label: 'stop asking for mutuals', pattern: /\bstop asking (?:for|about)\s+(?:any\s+)?mutuals?\b/i, weight: 0 },
    { label: 'mutuals closed', pattern: /\bmutuals?\s+(?:are\s+)?(?:closed|full)\b/i, weight: 0 },
    { label: 'no f4f', pattern: /\bno\s+(?:f4f|follow\s?4\s?follow|follow for follow)\b/i, weight: 0 },
    {
        label: "doesn't add back",
        pattern: new RegExp(
            String.raw`\b(?:don'?t|do not|doesn'?t|won'?t|will not|never|rarely)\s+${FILLER}(?:add|follow|friend)\s+(?:you\s+|u\s+|people\s+|anyone\s+)?back\b`,
            'i',
        ),
        weight: 0,
    },
    // 這條刻意不允許夾字：要避開 "don't hesitate to add me"、"don't forget to add me"
    { label: "don't add me", pattern: /\b(?:don'?t|do not|pls don'?t|please don'?t)\s+add me\b/i, weight: 0 },
    { label: '不互關', pattern: /不(?:互關|互关|回關|回关|互粉|回粉|接受互)|拒絕互關|拒绝互关/, weight: 0 },
    { label: '相互お断り', pattern: /相互(?:お断り|はしません|しません|不可)/, weight: 0 },
];

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

function snippetAround(text: string, index: number, length: number): string {
    const SPAN_BEFORE = 40;
    const SPAN_AFTER = 60;
    const start = Math.max(0, index - SPAN_BEFORE);
    const end = Math.min(text.length, index + length + SPAN_AFTER);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export function detectMutualIntent(raw: string): Detection {
    const text = bbcodeToText(raw);
    if (!text) return { level: 'none', score: 0, labels: [], snippet: null };

    for (const rule of NEGATIVE) {
        const match = rule.pattern.exec(text);
        if (match) {
            return { level: 'negative', score: 0, labels: [rule.label], snippet: snippetAround(text, match.index, match[0].length) };
        }
    }

    let score = 0;
    const labels: string[] = [];
    // 已經計分過的文字範圍 [起點, 終點)。第一個（權重最高的）命中就是摘錄的位置。
    const counted: [number, number][] = [];
    const overlaps = (start: number, end: number) => counted.some(([s, e]) => start < e && s < end);

    for (const rule of POSITIVE_BY_WEIGHT) {
        // 找這條規則在文字中「第一個沒跟已計分段落重疊」的命中；同一條規則最多只算一次
        for (const match of text.matchAll(rule.pattern)) {
            const start = match.index;
            const end = start + match[0].length;
            if (overlaps(start, end)) continue;
            score += rule.weight;
            labels.push(rule.label);
            counted.push([start, end]);
            break;
        }
    }

    const best = counted[0];
    if (!best) return { level: 'none', score: 0, labels: [], snippet: null };
    return {
        level: score >= 3 ? 'strong' : 'weak',
        score,
        labels,
        snippet: snippetAround(text, best[0], best[1] - best[0]),
    };
}
