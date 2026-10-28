/*
  ゲーム詳細ページ（play.html?id=[ゲームID]）。仕様は docs/pages.md「ゲーム詳細」、
  ゲームとのやりとりは docs/ranking-api.md「ゲームとのつなぎ方」。
  スコアはゲームが送る。このページからは送らない。
*/

import { getGame } from './games.js';
import { getPlayer, ensureRegistered, renderPlayerName, onPlayerChange, canKeepPlayer, STORAGE_BLOCKED_NOTE } from './player.js';
import { getLeaderboard, getMe } from './api.js';
import { countUp, cancelCountUp, reducedMotion } from './site.js';

const PERIOD_NOTES = {
  week: (next) => `毎週月曜0時（日本時間）にリセットされます。${next ? `次は${next}です。` : ''}`,
  month: (next) => `毎月1日0時（日本時間）にリセットされます。${next ? `次は${next}です。` : ''}`,
  all: () => '公開からのすべての記録です。',
};
// REFLEX が再送しないエラー（ほかのエラーは REFLEX の未送信キューから送り直される）
const NON_RETRYABLE_ERRORS = ['invalid_request', 'invalid_name', 'invalid_score', 'auth_failed', 'unknown_action'];
const CONFETTI_COLORS = ['--color-game', '--color-rank', '--color-news', '--color-about'];
const CELEBRATE_MS = 2600;
const RANKING_CACHE_MS = 30000;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const game = getGame(new URLSearchParams(location.search).get('id'));

const state = {
  player: getPlayer(),
  mode: game ? game.defaultMode || null : null,
  period: 'week',
  // モードごとの自分の記録 { all, week, month }（GET action=me の modes と同じ形）
  myRecords: {},
  // いま表示しているランキングの自分の順位（leaderboard の me）
  rankingMe: null,
  // いま表示しているランキング（モード|期間）。同じものを取り直すときは表示を残したまま待つ
  rankingKey: null,
};

const els = {
  layout: $('.play-layout'),
  frame: $('[data-frame]'),
  iframe: $('[data-iframe]'),
  curtain: $('[data-curtain]'),
  start: $('[data-start]'),
  celebrate: $('[data-celebrate]'),
  bits: $('[data-bits]'),
  celebrateScore: $('[data-celebrate-score]'),
  best: $('[data-best]'),
  bestUnit: $('[data-best-unit]'),
  weekRank: $('[data-week-rank]'),
  note: $('[data-note]'),
  rankingMode: $('[data-ranking-mode]'),
  rankingList: $('[data-ranking-list]'),
  rankingMessage: $('[data-ranking-message]'),
  rankingMe: $('[data-ranking-me]'),
  periodNote: $('[data-period-note]'),
  howtoMode: $('[data-howto-mode]'),
  howtoText: $('[data-howto-text]'),
  howtoKeys: $('[data-howto-keys]'),
};

/* モードのないゲームは、ゲームID をそのままモードとして扱う（ランキングの mode もゲームID） */
function currentMode() {
  if (game.modes) return game.modes.find(m => m.id === state.mode) || game.modes[0];
  return { id: game.id, label: '', unit: game.unit || 'pts', howto: game.howto || '', keys: game.keys || [] };
}

/* ===== ゲームの情報 ===== */

function renderGameInfo() {
  document.title = `${game.name} ・ bosumoti-game`;
  $$('[data-game-name]').forEach(el => { el.textContent = game.name; });
  $('[data-game-no]').textContent = `No.${String(game.no).padStart(2, '0')}`;
  $('[data-game-meta]').textContent = `約${game.minutes}分 ・ ${game.controls}だけ`;
  els.iframe.title = `${game.name} のゲーム画面`;
}

function renderModeTexts() {
  const mode = currentMode();
  const label = game.modes ? `${mode.label} モード` : '';
  els.rankingMode.textContent = label;
  els.howtoMode.textContent = label;
  els.howtoText.textContent = mode.howto;
  els.howtoKeys.textContent = '';
  mode.keys.forEach(k => {
    const item = document.createElement('span');
    item.className = 'howto__key';
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = k.key;
    item.append(key, k.action);
    els.howtoKeys.appendChild(item);
  });
}

/* ===== 並べ方と枠 ===== */

function setupFrame() {
  els.frame.dataset.fit = game.frame.fit;
  if (game.frame.fit === 'viewport') {
    els.frame.style.setProperty('--frame-min', `${game.frame.minHeight}px`);
  } else {
    els.frame.style.setProperty('--frame-ratio', game.frame.ratio);
  }
}

/* ゲームの列に最小幅が取れるならランキングを右に、取れないならゲーム画面の下に置く */
function updateLayout() {
  const style = getComputedStyle(els.layout);
  const rankWidth = parseFloat(style.getPropertyValue('--rank-w')) || 280;
  const gap = parseFloat(style.getPropertyValue('--layout-gap')) || 32;
  const side = els.layout.clientWidth - gap - rankWidth >= game.minGameWidth;
  els.layout.dataset.layout = side ? 'side' : 'stack';
}

/* ===== スタートの幕 ===== */

function focusGame() {
  els.iframe.focus({ preventScroll: true });
  try {
    els.iframe.contentWindow.focus();
  } catch (e) {
    // 読み込み前など。iframe 要素へのフォーカスだけで続ける
  }
}

function handleStart() {
  els.curtain.hidden = true;
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (isTouch && typeof els.iframe.requestFullscreen === 'function') {
    // スマホはフルスクリーンで遊ぶ。iPhone の Safari は非対応のため枠のまま
    els.iframe.requestFullscreen().catch(() => {});
  } else {
    const rect = els.frame.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      els.frame.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }
  focusGame();
}

/* ===== あなたのベスト・今週の順位 ===== */

function renderMyBest({ animate = false } = {}) {
  const mode = currentMode();
  const record = mode ? state.myRecords[mode.id] : null;
  els.bestUnit.textContent = record && record.all && mode ? mode.unit : '';
  cancelCountUp(els.best); // 動いているカウントアップが、前のモードの値を書き戻さないように
  if (record && record.all) {
    if (animate) countUp(els.best, record.all.best);
    else els.best.textContent = Number(record.all.best).toLocaleString('ja-JP');
  } else {
    els.best.textContent = '—';
  }
  els.weekRank.textContent = record && record.week ? String(record.week.rank) : '—';
}

// 結果で更新したモードの記録。あとから届いた古い me の返事で戻さないために覚えておく
const updatedByResult = {};

async function loadMyRecords() {
  try {
    const data = await getMe(state.player.playerId);
    if (!data.ok) return;
    const modes = (data.registered && data.modes && typeof data.modes === 'object') ? data.modes : {};
    // 待っている間に結果で更新したモードは、古い返事で上書きしない
    state.myRecords = { ...modes, ...updatedByResult };
    renderMyBest({ animate: true });
  } catch (e) {
    console.warn('My records unavailable:', e);
  }
}

/* ===== ランキング ===== */

let rankingSeq = 0;
const rankingCache = new Map();

function formatResetDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' }).format(date);
}

function showRankingMessage(text, withRetry = false) {
  els.rankingList.textContent = '';
  els.rankingMessage.textContent = text;
  if (withRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'ranking__retry';
    retry.textContent = 'もう一度読み込む';
    retry.addEventListener('click', () => loadRanking());
    els.rankingMessage.appendChild(retry);
  }
  els.rankingMessage.hidden = false;
}

function rankText(rank) {
  return String(Math.max(1, Math.floor(Number(rank)) || 1)).padStart(2, '0');
}

function renderRow(rank, nameEl, score) {
  const r = document.createElement('span');
  r.className = 'ranking__rank';
  r.textContent = rank;
  const n = document.createElement('span');
  n.className = 'ranking__name';
  n.append(...nameEl);
  const s = document.createElement('span');
  s.className = 'ranking__score';
  s.textContent = score;
  return [r, n, s];
}

function renderMeRow() {
  const me = state.rankingMe;
  const label = document.createElement('span');
  label.className = 'ranking__me-label';
  label.textContent = 'あなた';
  const row = document.createElement('div');
  row.className = 'ranking__me-row';
  row.append(...renderRow(
    me ? rankText(me.rank) : '—',
    [label, renderPlayerName(state.player.name, state.player.tag)],
    me ? Number(me.score).toLocaleString('ja-JP') : '—'
  ));
  els.rankingMe.textContent = '';
  els.rankingMe.appendChild(row);
}

function renderRanking(key, data) {
  state.rankingKey = key;
  els.rankingList.removeAttribute('aria-busy');
  els.rankingMessage.hidden = true;
  els.rankingList.textContent = '';
  const top = Array.isArray(data.top) ? data.top : [];
  if (top.length === 0) {
    showRankingMessage('まだ誰も記録していません。最初の1人になれます。');
  }
  top.forEach(entry => {
    const li = document.createElement('li');
    li.className = 'ranking__row';
    li.append(...renderRow(
      rankText(entry.rank),
      [renderPlayerName(String(entry.name || ''), String(entry.tag || ''))],
      Number(entry.score || 0).toLocaleString('ja-JP')
    ));
    els.rankingList.appendChild(li);
  });
  state.rankingMe = data.me && typeof data.me === 'object' ? data.me : null;
  renderMeRow();
  els.periodNote.textContent = PERIOD_NOTES[state.period](formatResetDate(data.nextReset));
}

async function loadRanking({ force = false } = {}) {
  const mode = currentMode();
  if (!mode) return;
  const seq = ++rankingSeq;
  const key = `${mode.id}|${state.period}`;
  const cached = rankingCache.get(key);
  if (!force && cached && Date.now() - cached.at < RANKING_CACHE_MS) {
    renderRanking(key, cached.data);
    return;
  }
  if (state.rankingKey === key) {
    els.rankingList.setAttribute('aria-busy', 'true');
  } else {
    state.rankingKey = null;
    showRankingMessage('読み込み中…');
    els.periodNote.textContent = PERIOD_NOTES[state.period]('');
  }
  try {
    const data = await getLeaderboard(mode.id, state.period, state.player.playerId);
    if (seq !== rankingSeq) return;
    if (!data.ok) throw new Error(data.error || 'Invalid response');
    rankingCache.set(key, { at: Date.now(), data });
    renderRanking(key, data);
  } catch (e) {
    if (seq !== rankingSeq) return;
    state.rankingKey = null;
    els.rankingList.removeAttribute('aria-busy');
    console.warn('Ranking unavailable:', e);
    showRankingMessage('ランキングを読み込めませんでした。', true);
  }
}

function setPeriod(period) {
  if (period === state.period) return;
  state.period = period;
  $$('[data-period]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.period === period)));
  loadRanking();
}

function setMode(modeId) {
  if (!game.modes || !game.modes.some(m => m.id === modeId) || modeId === state.mode) return;
  state.mode = modeId;
  renderModeTexts();
  renderMyBest();
  loadRanking();
}

/* ===== 自己ベスト更新の演出 ===== */

let celebrateTimer = null;

function hideCelebrate() {
  if (els.celebrate.hidden || els.celebrate.classList.contains('is-leaving')) return;
  clearTimeout(celebrateTimer);
  els.celebrate.classList.add('is-leaving');
  setTimeout(() => {
    els.celebrate.hidden = true;
    els.celebrate.classList.remove('is-leaving');
    els.bits.textContent = '';
  }, reducedMotion.matches ? 0 : 300);
}

/* ゲームの結果画面がもう閉じていたら（次のプレイに進んでいたら）重ねない */
function isGameResultShowing() {
  try {
    const result = els.iframe.contentDocument && els.iframe.contentDocument.getElementById('result-screen');
    return !result || result.classList.contains('active');
  } catch (e) {
    return true;
  }
}

function celebrate(score) {
  if (!isGameResultShowing()) return;
  clearTimeout(celebrateTimer);
  els.celebrateScore.textContent = Number(score).toLocaleString('ja-JP');
  els.bits.textContent = '';
  if (!reducedMotion.matches) {
    const fall = `${els.frame.clientHeight + 24}px`;
    for (let i = 0; i < 18; i++) {
      const bit = document.createElement('span');
      bit.className = 'celebrate__bit';
      bit.style.left = `${(i * 37) % 96 + 2}%`;
      bit.style.background = `var(${CONFETTI_COLORS[i % CONFETTI_COLORS.length]})`;
      bit.style.animationDelay = `${((i % 6) * 0.12).toFixed(2)}s`;
      bit.style.setProperty('--fall', fall);
      els.bits.appendChild(bit);
    }
  }
  els.celebrate.classList.remove('is-leaving');
  els.celebrate.hidden = false;
  celebrateTimer = setTimeout(hideCelebrate, CELEBRATE_MS);
}

/* 演出はゲームの操作を邪魔しない。ゲームの中でキーやポインタが動いたら消す */
function watchGameInput() {
  try {
    const win = els.iframe.contentWindow;
    win.addEventListener('keydown', hideCelebrate, true);
    win.addEventListener('pointerdown', hideCelebrate, true);
  } catch (e) {
    // 触れなくても、時間がたてば消える
  }
}

/* ===== ゲームからの知らせ ===== */

function periodRecord(online, period) {
  if (period === 'all') return { best: online.best, isBest: online.isBest, rank: online.rank };
  return online.periods && online.periods[period] ? online.periods[period] : null;
}

function handleResult(msg) {
  if (typeof msg.mode === 'string') setMode(msg.mode);
  const online = msg.online;

  if (online === null || online === undefined) {
    els.note.textContent = 'ランキングにつながっていないため、この記録は送っていません。';
    return;
  }
  if (!online.ok) {
    els.note.textContent = NON_RETRYABLE_ERRORS.includes(online.error)
      ? 'この記録はランキングに載りませんでした。'
      : '記録を送れませんでした。あとで送り直します。';
    return;
  }

  els.note.textContent = '';
  const record = {};
  ['all', 'week', 'month'].forEach(p => {
    const r = periodRecord(online, p);
    record[p] = r ? { best: r.best, rank: r.rank } : null;
  });
  state.myRecords[msg.mode] = record;
  updatedByResult[msg.mode] = record;
  state.player = getPlayer(); // ゲームが tag を書き戻していることがある
  renderMyBest({ animate: true });

  rankingCache.clear();
  loadRanking({ force: true });

  const viewed = periodRecord(online, state.period);
  if (viewed && viewed.isBest) celebrate(online.score);
}

function handleMessage(event) {
  if (event.origin !== location.origin) return;
  if (event.source !== els.iframe.contentWindow) return;
  const msg = event.data;
  if (!msg || typeof msg !== 'object' || msg.game !== game.id) return;
  // games.js にないモードは無視する（モードのないゲームは、ゲームID がモード）
  if (!(game.modes ? game.modes.some(m => m.id === msg.mode) : msg.mode === game.id)) return;
  if (msg.type === 'bosumoti:mode') setMode(msg.mode);
  else if (msg.type === 'bosumoti:result') handleResult(msg);
}

/* ===== はじめ ===== */

function showNotFound() {
  const main = $('.play-main');
  main.textContent = '';
  const p = document.createElement('p');
  p.textContent = 'ゲームが見つかりませんでした。';
  const a = document.createElement('a');
  a.href = 'index.html';
  a.textContent = 'ゲームの一覧にもどる';
  main.append(p, a);
}

function init() {
  if (!game) {
    showNotFound();
    return;
  }
  renderGameInfo();
  renderModeTexts();
  setupFrame();
  updateLayout();
  if ('ResizeObserver' in window) new ResizeObserver(updateLayout).observe(els.layout);
  else window.addEventListener('resize', updateLayout);

  // 読み込み時の bosumoti:mode を取りこぼさないよう、src より先に登録する
  window.addEventListener('message', handleMessage);
  els.iframe.addEventListener('load', watchGameInput);
  els.iframe.src = game.src;

  els.start.addEventListener('click', handleStart);
  $$('[data-period]').forEach(btn => btn.addEventListener('click', () => setPeriod(btn.dataset.period)));

  // ゲームが tag を書き戻したときなど
  onPlayerChange((player) => {
    state.player = player;
    renderMeRow();
  });

  renderMyBest();
  renderMeRow();
  loadRanking();
  ensureRegistered().then((player) => {
    state.player = player;
    renderMeRow();
    loadMyRecords();
    if (!canKeepPlayer()) els.note.textContent = STORAGE_BLOCKED_NOTE;
  });
}

init();
