// src/detect.ts — finds where a profile page (raw BBCode) mentions mutuals.
//
// These are pure functions: text in, result out, no API or database, so they can be tested on their own (detect.test.ts).
//
// Design: the tool only finds players who *mention* mutuals; it doesn't judge whether they want them or not.
// An earlier version scored sentences with weighted rules, but language varies too much
// (e.g. "I'll follow back whoever I want") and the rules could never cover it all. So instead the relevant
// sentences are excerpted with the keywords highlighted, and the user reads them and decides.
//
// Known limitation: text inside images can't be read.

/** A piece of an excerpt; parts with hit = true are matched keywords, which the frontend highlights. */
export interface SnippetPart {
    text: string;
    hit: boolean;
}

export type Snippet = SnippetPart[];

export interface Detection {
    mentioned: boolean;
    count: number; // how many times a keyword appears
    snippets: Snippet[]; // at most MAX_SNIPPETS excerpts
}

// All keywords combined into one regular expression.
//   - English keywords use \b (word boundaries) so they don't match inside other words. Chinese, Japanese and
//     Korean have no word boundaries, so they don't.
//   - Longer keywords come before shorter ones: at the same position 相互フォロー matches before just 相互.
//   - "add me" and "follow me" aren't included: they're mostly "add me on discord" or "follow me on twitch".
const KEYWORDS = new RegExp(
    [
        String.raw`\bmutuals?\b`,
        String.raw`\bf4f\b`,
        String.raw`\bfollow\s?(?:4|for)\s?follow\b`,
        String.raw`\badd\s?(?:4|for)\s?add\b`,
        String.raw`\bfollowback\b`,
        String.raw`\b(?:follow|add|friend)(?:ing)?\s+(?:you\s+|u\s+|everyone\s+|people\s+)?back\b`,
        // Chinese (traditional and simplified)
        '互相追蹤|互相关注|互關|互关|互粉|回關|回关|回粉|互追|互加|互fo',
        // Japanese
        '相互フォロー|フォロバ|相互',
        // Korean
        '맞팔',
    ].join('|'),
    'gi',
);

const SPAN_BEFORE = 50;
const SPAN_AFTER = 70;
const MAX_SNIPPETS = 2;

/**
 * Turns BBCode into roughly the text shown on the page:
 * images, videos, audio and imagemaps only contain URLs, so they're dropped entirely; other tags lose the tag but keep the text.
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

    // Take a window around each match; overlapping windows (two keywords close together) merge into one excerpt
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

        // Add an ellipsis where the excerpt doesn't reach the start or end, so the user knows there's more
        if (start > 0) parts.unshift({ text: '…', hit: false });
        if (end < text.length) parts.push({ text: '…', hit: false });
        return parts;
    });

    return { mentioned: true, count: matches.length, snippets };
}
