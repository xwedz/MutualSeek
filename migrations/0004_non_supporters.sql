-- 從沒當過 supporter 的玩家，只存 id（見 src/crawler.ts 的 splitRankingPage）。
--
-- osu! 規定第一次建立個人頁面（me!）時必須「現在或過去曾經是 supporter」（osu-web 的 checkUserPageEdit），
-- 所以這些人不可能寫了個人頁面。第二輪起，排行榜顯示他們目前也不是 supporter，就不用再抓他們的個人頁面。
--
-- 為什麼要自己記：「曾經是 supporter」（has_supported）只有單一使用者的 API 才有，
-- 排行榜上只有 is_supporter（目前是不是），所以只能在掃描個人頁面時順便記下來。
-- 之後買了 supporter 的人，排行榜上 is_supporter 會變成 true，照常掃描，掃到時再從這裡移除。

CREATE TABLE non_supporters (
    id INTEGER PRIMARY KEY
) WITHOUT ROWID;
