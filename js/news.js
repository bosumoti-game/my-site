/*
  お知らせ。新しいものを上に足す。
  type は「新作」「更新」「おしらせ」のどれか。日付は YYYY-MM-DD。
  href は任意。書くと項目がリンクになる（新作ならそのゲームのページなど）。
*/

export const NEWS = [
  // 仮の1件。公開する日に日付を直す
  { id: 'reflex-release', date: '2026-10-27', type: '新作', title: 'REFLEX を公開しました', href: 'play.html?id=reflex' },
];

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/* 日付が YYYY-MM-DD でない、title が文字列でない項目は使わない（1件の書き間違いで、トップとお知らせを止めない） */
function isValidItem(item) {
  const valid = !!item && typeof item.date === 'string' && DATE_RE.test(item.date) && typeof item.title === 'string';
  if (!valid) console.warn('News skipped (date は YYYY-MM-DD、title は文字列):', item);
  return valid;
}

/** 新しい順（同じ日付なら上に書いたものが先） */
export function sortedNews() {
  return NEWS.filter(isValidItem).map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.date.localeCompare(a.item.date) || a.i - b.i)
    .map(x => x.item);
}

/** 新しい順に n 件 */
export function latestNews(n) {
  return sortedNews().slice(0, n);
}

/** 表示用の日付（2026.10.27） */
export function formatNewsDate(date) {
  return date.replace(/-/g, '.');
}

/* http: か https: のときだけリンクにする。相対パスは、ふつうのページの中のパスとして扱う */
export function isSafeHref(href) {
  if (typeof href !== 'string' || !href) return false;
  try {
    const protocol = new URL(href, 'https://example.com/').protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/** その項目へのリンク。href があればそこへ、なければお知らせページのその項目へ */
export function newsLink(item) {
  return isSafeHref(item.href) ? item.href : `news.html#${encodeURIComponent(item.id)}`;
}
