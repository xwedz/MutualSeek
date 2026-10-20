// 自動化測試：用 Vitest 執行（npm test）。
// 每個 it(...) 是一個情境，expect(...) 寫下「應該得到什麼」。改了規則後跑一次，就知道有沒有把原本對的弄壞。

import { describe, expect, it } from 'vitest';
import { bbcodeToText, detectMutualIntent } from './detect';

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

describe('detectMutualIntent', () => {
    it.each([
        'Looking for mutuals!',
        'add me for mutual :)',
        'I always add back',
        'mutuals are always welcome',
        'f4f',
        'DM me if you added me',
        'dm for mutual',
        'pm me for mutuals',
        'feel free to ask for mutual',
        'feel free to dm for mutual',
        'just ask me for mutuals',
        "don't forget to follow back!",
        '歡迎互關～',
        '相互フォロー歓迎です',
        '맞팔 환영',
    ])('marks "%s" as strong', text => {
        expect(detectMutualIntent(text).level).toBe('strong');
    });

    it.each(['thanks to all my mutuals', 'feel free to add me', "don't hesitate to add me"])('marks "%s" as weak', text => {
        expect(detectMutualIntent(text).level).toBe('weak');
    });

    it.each([
        'no mutuals please',
        'not looking for mutuals',
        "I don't add back, sorry",
        "please don't add me",
        'mutuals closed',
        // 否定詞與動詞中間夾了字
        "I'm not really looking for mutuals",
        'not currently accepting new mutuals',
        "I don't usually add back",
        'no more new mutuals, sorry',
        '不互關 謝謝',
        '相互はしません',
    ])('marks "%s" as negative', text => {
        expect(detectMutualIntent(text).level).toBe('negative');
    });

    it('lets a negative rule win over positive ones', () => {
        // 同時有「add me」與「no mutuals」：寧可漏掉，也不要推薦明說不要的人
        expect(detectMutualIntent('add me on discord! no mutuals though').level).toBe('negative');
    });

    it('counts the same piece of text only once', () => {
        // "add me" 和 "mutual" 都在 "add me for mutual" 裡面，不能再各加一次分
        expect(detectMutualIntent('add me for mutual').score).toBe(3);
        expect(detectMutualIntent('mutual mutual mutual').score).toBe(1);
    });

    it('still counts a weaker rule when it appears elsewhere in the text', () => {
        // 第二個 "add me" 在別的位置，是獨立的訊號：3 + 2
        expect(detectMutualIntent('add me for mutual! or just add me on discord').score).toBe(5);
    });

    it('ignores pages without any signal', () => {
        expect(detectMutualIntent('I play osu! since 2015. Favorite mapper: Sotarks').level).toBe('none');
        expect(detectMutualIntent('').level).toBe('none');
    });

    it('does not match "mutual" hidden inside an image', () => {
        expect(detectMutualIntent('[img]https://example.com/looking-for-mutuals.png[/img]').level).toBe('none');
    });

    it('returns a snippet around the strongest match', () => {
        const result = detectMutualIntent('Hi, I am a mania player. Looking for mutuals, DM me anytime.');
        expect(result.snippet).toContain('Looking for mutuals');
        expect(result.labels).toContain('looking for mutuals');
    });
});
