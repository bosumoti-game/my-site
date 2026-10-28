/*
  どのページにも共通の動き：ヘッダーの高さ、ロゴのイースターエッグ、数字のカウントアップ。
*/

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ヘッダーの高さを CSS 変数 --header-h に入れる（ゲーム画面の枠の高さに使う） */
function trackHeaderHeight() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const update = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  update();
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(header);
  else window.addEventListener('resize', update);
}

/* "/repo/" と "/repo/index.html" を同じページとして扱う */
function pagePath(url) {
  const path = new URL(url, location.href).pathname;
  return path.endsWith('/') ? `${path}index.html` : path;
}

/* ロゴのぼすもちを3回クリックすると跳ねる。トップにいるときはページを読み直さない */
function setupLogo() {
  const logo = document.querySelector('.site-logo');
  if (!logo) return;
  const mochi = logo.querySelector('.site-logo__mochi');
  let pokes = 0;
  let pokeTimer = null;
  logo.addEventListener('click', (e) => {
    if (pagePath(logo.href) !== pagePath(location.href)) return;
    e.preventDefault();
    clearTimeout(pokeTimer);
    pokes++;
    pokeTimer = setTimeout(() => { pokes = 0; }, 1500);
    if (pokes < 3) return;
    pokes = 0;
    if (!mochi || reducedMotion.matches) return;
    mochi.classList.remove('is-jumping');
    void mochi.offsetWidth;
    mochi.classList.add('is-jumping');
  });
}

/*
  見出しのマーカー（design/tokens.css の .mark）は、スクロールに合わせて引かれ、
  見出しが画面のある高さ（animation-range の終わり）まで上がると引き終わる。
  ページの下のほうの見出しは、いちばん下までスクロールしてもそこまで上がらず、途中で止まって見える。
  そういう見出しだけ、引き終わる位置を「いちばん下までスクロールしたところ」にずらす。
*/
const supportsScrollMarks = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timeline: view()');

function fitMarkRanges() {
  const marks = document.querySelectorAll('.mark');
  marks.forEach((el) => { el.style.animationRange = ''; el.style.animation = ''; });
  const viewport = window.innerHeight;
  const maxScroll = document.documentElement.scrollHeight - viewport;
  marks.forEach((el) => {
    // 引き終わる位置（例：cover 40%）。読めなければ何もしない
    const end = /cover\s+([\d.]+)%/.exec(getComputedStyle(el).animationRangeEnd || '');
    if (!end) return;
    const rect = el.getBoundingClientRect();
    const height = rect.height;
    const coverStart = rect.top + window.scrollY - viewport; // 見出しの上端が画面の下端に来るスクロール位置
    const endScroll = coverStart + (parseFloat(end[1]) / 100) * (viewport + height);
    if (endScroll <= maxScroll) return;
    const startScroll = coverStart + 0.3 * height; // tokens.css の entry 30%
    if (maxScroll <= startScroll) {
      // ほとんど見えないまま終わる見出しは、最初から引いておく
      el.style.animation = 'none';
      return;
    }
    // 小数の誤差で引き残さないよう、少しだけ手前で引き終える
    const percent = Math.max(0, ((maxScroll - coverStart) / (viewport + height)) * 100 - 0.5);
    el.style.animationRange = `entry 30% cover ${percent.toFixed(2)}%`;
  });
}

function setupMarks() {
  if (!supportsScrollMarks) return;
  let frame = null;
  const schedule = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = null; fitMarkRanges(); });
  };
  schedule();
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  // ゲームやお知らせを読み込んで、ページの長さが変わったとき
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(document.body);
}

/** 動いているカウントアップを止める（そのあとに値を書き込むときに呼ぶ） */
export function cancelCountUp(el) {
  if (el._countUpFrame) cancelAnimationFrame(el._countUpFrame);
  el._countUpFrame = 0;
}

/** 数字を0からカウントアップして表示する（約0.9秒）。動きを止める設定ならすぐ表示する */
export function countUp(el, value) {
  const target = Math.max(0, Math.floor(Number(value) || 0));
  cancelCountUp(el);
  if (reducedMotion.matches || target === 0) {
    el.textContent = target.toLocaleString('ja-JP');
    return;
  }
  const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-countup')) * 1000 || 900;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased).toLocaleString('ja-JP');
    if (t < 1) el._countUpFrame = requestAnimationFrame(step);
  };
  el._countUpFrame = requestAnimationFrame(step);
}

trackHeaderHeight();
setupLogo();
setupMarks();
