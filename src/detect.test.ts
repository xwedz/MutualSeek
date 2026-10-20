// 自動化測試：用 Vitest 執行（npm test）。
// 每個 it(...) 是一個情境，expect(...) 寫下「應該得到什麼」。改了關鍵字後跑一次，就知道有沒有把原本對的弄壞。

import { describe, expect, it } from 'vitest';
import { bbcodeToText, detectMutualMention, type Snippet } from './detect';

/** 把摘錄還原成純文字，關鍵字用 [] 框起來，方便寫測試 */
const render = (snippet: Snippet) => snippet.map(p => (p.hit ? `[${p.text}]` : p.text)).join('');

describe('bbcodeToText', () => {
    it('removes tags but keeps their text', () => {
        expect(bbcodeToText('[centre][b]hi[/b] [color=#ff66aa]there[/color][/centre]')).toBe('hi there');
    });

    it('drops image, video and imagemap contents entirely', () => {
        expect(bbcodeToText('a [img]https://i.imgur.com/mutual.png[/img] b')).toBe('a b');
        expect(bbcodeToText('[imagemap]https://x/y.png\n0 0 10 10 https://osu.ppy.sh mutual[/imagemap]ok')).toBe('ok');
        expect(bbcodeToText('[youtube]abc[/youtube]text')).toBe('text');
    });

    it('drops bare URLs', () => {
        expect(bbcodeToText('my twitter https://twitter.com/mutualbot here')).toBe('my twitter here');
    });
});

describe('detectMutualMention', () => {
    it.each([
        'Looking for mutuals!',
        'I always add back',
        'f4f',
        'follow for follow',
        'followback',
        '歡迎互關～',
        '互粉嗎',
        '相互フォロー歓迎です',
        'フォロバします',
        '맞팔 환영',
    ])('finds a mention in "%s"', text => {
        expect(detectMutualMention(text).mentioned).toBe(true);
    });

    it('also finds people who say no: the user reads the snippet and decides', () => {
        // 工具不判斷語意。"no mutuals" 的人也會列出來，但摘錄會清楚顯示他們寫了什麼
        const result = detectMutualMention('no mutuals please');
        expect(result.mentioned).toBe(true);
        expect(render(result.snippets[0]!)).toBe('no [mutuals] please');
    });

    it.each([
        'I play osu! since 2015. Favorite mapper: Sotarks',
        'add me on discord',
        'follow me on twitch',
        'mutually exclusive', // \b 避免比對到單字的一部分
        '',
    ])('finds nothing in "%s"', text => {
        expect(detectMutualMention(text).mentioned).toBe(false);
    });

    it('does not match "mutual" hidden inside an image', () => {
        expect(detectMutualMention('[img]https://example.com/looking-for-mutuals.png[/img]').mentioned).toBe(false);
    });

    it('marks every keyword inside the snippet', () => {
        const result = detectMutualMention('Looking for mutuals, I always add back!');
        expect(result.count).toBe(2);
        expect(result.snippets).toHaveLength(1); // 兩個關鍵字很近，合成同一段
        expect(render(result.snippets[0]!)).toBe('Looking for [mutuals], I always [add back]!');
    });

    it('adds ellipses when the snippet is cut from a longer page', () => {
        const filler = 'x'.repeat(100);
        const snippet = render(detectMutualMention(`${filler} mutuals welcome ${filler}`).snippets[0]!);
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
        expect(snippet).toContain('[mutuals] welcome');
    });

    it('keeps at most two separate snippets', () => {
        const filler = ' lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt '.repeat(3);
        const result = detectMutualMention(`mutual${filler}f4f${filler}互關${filler}맞팔`);
        expect(result.count).toBe(4);
        expect(result.snippets).toHaveLength(2);
    });

    it('prefers the longer Japanese keyword', () => {
        expect(render(detectMutualMention('相互フォロー歓迎').snippets[0]!)).toBe('[相互フォロー]歓迎');
    });
});
