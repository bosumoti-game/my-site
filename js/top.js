/*
  トップページ。仕様は docs/pages.md「トップ」。
*/

import { getGames } from './games.js';
import { latestNews, formatNewsDate, newsLink } from './news.js';
import { getPlayer, ensureRegistered, renderPlayerName, onPlayerChange, canKeepPlayer, STORAGE_BLOCKED_NOTE } from './player.js';
import { getMe } from './api.js';
import { countUp } from './site.js';

const NEWS_COUNT = 3;

const games = getGames();

/* ===== あなたは ===== */

function renderYou(player) {
  const el = document.querySelector('[data-you]');
  if (!el) return; // 記録を残せないことを伝える文に替えたあと
  const name = renderPlayerName(player.name, player.tag);
  el.textContent = '';
  if (name.childNodes.length > 0) el.appendChild(name);
  else el.textContent = '—';
}

/* ===== ゲーム ===== */

function createCard(game, index) {
  const card = document.createElement('a');
  card.className = index === 0 ? 'game-card game-card--latest' : 'game-card';
  card.href = `play.html?id=${encodeURIComponent(game.id)}`;

  const image = document.createElement('img');
  image.className = 'game-card__image';
  image.src = game.thumbnail;
  image.alt = '';
  image.loading = index === 0 ? 'eager' : 'lazy';
  if (game.thumbnailPosition) image.style.objectPosition = game.thumbnailPosition;

  const info = document.createElement('div');
  info.className = 'game-card__info';

  const nameRow = document.createElement('div');
  nameRow.className = 'game-card__name-row';
  const no = document.createElement('span');
  no.className = 'game-card__no num';
  no.textContent = `No.${String(game.no).padStart(2, '0')}`;
  const name = document.createElement('span');
  name.className = 'game-card__name';
  name.textContent = game.name;
  nameRow.append(no, name);
  if (index === 0) {
    const isNew = document.createElement('span');
    isNew.className = 'game-card__new';
    isNew.textContent = 'NEW';
    nameRow.appendChild(isNew);
  }

  const best = document.createElement('div');
  best.className = 'game-card__best';
  best.dataset.best = game.id;

  info.append(nameRow, best);
  card.append(image, info);
  return card;
}

function renderGames() {
  const grid = document.querySelector('[data-games]');
  grid.textContent = '';
  games.forEach((game, i) => grid.appendChild(createCard(game, i)));
}

/* モードのあるゲーム（REFLEX）は、遊んだモードごとに自己ベストを出す */
function renderBest(game, records) {
  const el = document.querySelector(`[data-best="${game.id}"]`);
  if (!el) return;
  el.textContent = '';
  if (records === null) {
    el.textContent = '—';
    return;
  }
  const modes = game.modes || [{ id: game.id, label: '' }];
  const played = modes.filter(m => records[m.id] && records[m.id].all);
  if (played.length === 0) {
    el.textContent = 'まだ遊んでいません';
    return;
  }
  const label = document.createElement('span');
  label.textContent = 'ベスト';
  el.appendChild(label);
  played.forEach(mode => {
    const item = document.createElement('span');
    item.className = 'game-card__best-item';
    if (mode.label) item.append(mode.label);
    const value = document.createElement('span');
    value.className = 'game-card__best-value';
    item.appendChild(value);
    el.appendChild(item);
    countUp(value, records[mode.id].all.best);
  });
}

async function loadBests(player) {
  let records = null;
  try {
    const data = await getMe(player.playerId);
    if (data.ok) records = (data.registered && data.modes && typeof data.modes === 'object') ? data.modes : {};
  } catch (e) {
    console.warn('My records unavailable:', e);
  }
  games.forEach(game => renderBest(game, records));
}

/* ===== お知らせ ===== */

function renderNews() {
  const list = document.querySelector('[data-news]');
  list.textContent = '';
  const items = latestNews(NEWS_COUNT);
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'news-list__empty';
    li.textContent = 'お知らせはまだありません。';
    list.appendChild(li);
    return;
  }
  items.forEach(item => {
    const li = document.createElement('li');
    const date = document.createElement('time');
    date.className = 'news-list__date';
    date.dateTime = item.date;
    date.textContent = formatNewsDate(item.date);
    const title = document.createElement('a');
    title.className = 'news-list__title';
    title.href = newsLink(item);
    title.textContent = item.title;
    li.append(date, title);
    list.appendChild(li);
  });
}

/* ===== はじめ ===== */

renderYou(getPlayer());
renderGames();
renderNews();
onPlayerChange(renderYou);
ensureRegistered().then((player) => {
  // 記録を残せないときは「あなたは」と「名前を変える」のかわりに、そのことを伝える
  if (canKeepPlayer()) renderYou(player);
  else document.querySelector('.hero__you').textContent = STORAGE_BLOCKED_NOTE;
  loadBests(player);
});
