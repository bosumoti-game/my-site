/*
  この端末の記録。仕様は docs/pages.md「この端末の記録」。
  記録は GET action=me でまとめて取る。名前の変更は profile。
*/

import { getGames } from './games.js';
import {
  getPlayer, ensureRegistered, renderPlayerName, onPlayerChange,
  syncFromServer, rename, checkNewName, displayParts, NAME_MAX_LENGTH,
  canKeepPlayer, STORAGE_BLOCKED_NOTE,
} from './player.js';
import { getMe } from './api.js';
import './site.js';

const RENAME_ERRORS = {
  network: '通信できませんでした。もう一度試してください。',
  busy: '混み合っています。少し待ってから試してください。',
  rate_limited: '続けて保存しすぎました。少し待ってから試してください。',
  invalid_name: 'この名前は使えません。',
  auth_failed: 'この端末のプレイヤー情報が合わず、保存できませんでした。',
  storage: STORAGE_BLOCKED_NOTE,
};

const games = getGames();

const els = {
  player: document.querySelector('[data-player]'),
  played: document.querySelector('[data-played]'),
  records: document.querySelector('[data-records]'),
  form: document.querySelector('[data-name-form]'),
  input: document.querySelector('[data-name-input]'),
  save: document.querySelector('[data-name-save]'),
  message: document.querySelector('[data-name-message]'),
  hint: document.querySelector('[data-name-hint]'),
};

/* ===== 名前#番号 ===== */

function renderPlayer(player) {
  const name = renderPlayerName(player.name, player.tag);
  els.player.textContent = '';
  if (name.childNodes.length > 0) els.player.appendChild(name);
  else els.player.textContent = '—';
  els.hint.textContent = player.tag
    ? `後ろの番号（#${player.tag}）は自動で付きます。同じ名前の人がいても大丈夫です。`
    : '後ろの番号は自動で付きます。同じ名前の人がいても大丈夫です。';
}

/* 名前を決めていない人は入力欄を空にしておく（仮の名前を入れておかない） */
function fillNameInput(player) {
  els.input.value = displayParts(player.name, player.tag).name || '';
}

/* ===== 表 ===== */

function cell(className, content) {
  const td = document.createElement('td');
  if (className) td.className = className;
  if (content !== undefined) td.append(content);
  return td;
}

function valueCells(record, unit) {
  if (!record || !record.all) {
    const empty = document.createElement('span');
    empty.className = 'is-empty';
    empty.textContent = 'まだ遊んでいません';
    return [cell('is-num', empty), cell('is-num is-empty', '—')];
  }
  const best = document.createElement('span');
  best.className = 'records-table__value';
  best.textContent = Number(record.all.best).toLocaleString('ja-JP');
  if (unit) {
    const u = document.createElement('span');
    u.className = 'records-table__unit';
    u.textContent = unit;
    best.appendChild(u);
  }
  const rank = document.createElement('span');
  if (record.week) {
    rank.className = 'records-table__value';
    rank.textContent = `${record.week.rank}位`;
  } else {
    // 全期間の記録はあるが、今週はまだ遊んでいない
    rank.className = 'is-empty';
    rank.textContent = '—';
  }
  return [cell('is-num', best), cell('is-num', rank)];
}

function gameLink(game) {
  const a = document.createElement('a');
  a.className = 'records-table__game';
  a.href = `play.html?id=${encodeURIComponent(game.id)}`;
  a.textContent = game.name;
  return a;
}

function renderRecords(records) {
  els.records.textContent = '';
  games.forEach(game => {
    const no = cell('records-table__no', String(game.no).padStart(2, '0'));
    if (!game.modes) {
      const tr = document.createElement('tr');
      tr.append(no, cell('', gameLink(game)), ...valueCells(records[game.id], game.unit));
      els.records.appendChild(tr);
      return;
    }
    // モードのあるゲーム（REFLEX）は、ゲームの行の下にモードごとの行を並べる
    const head = document.createElement('tr');
    head.className = 'is-game-with-modes';
    head.append(no, cell('', gameLink(game)), cell('is-num'), cell('is-num'));
    els.records.appendChild(head);
    game.modes.forEach((mode, i) => {
      const tr = document.createElement('tr');
      tr.className = i === game.modes.length - 1 ? 'is-mode is-mode-last' : 'is-mode';
      tr.append(cell(''), cell('records-table__mode', mode.label), ...valueCells(records[mode.id], mode.unit));
      els.records.appendChild(tr);
    });
  });

  const played = games.filter(game => (game.modes || [game]).some(m => records[m.id] && records[m.id].all));
  els.played.textContent = `${played.length} / ${games.length}`;
}

function renderRecordsMessage(text, withRetry = false) {
  els.records.textContent = '';
  const tr = document.createElement('tr');
  tr.className = 'records-table__message';
  const td = cell('', text);
  td.colSpan = 4;
  if (withRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'records-table__retry';
    retry.textContent = 'もう一度読み込む';
    retry.addEventListener('click', () => loadRecords());
    td.appendChild(retry);
  }
  tr.appendChild(td);
  els.records.appendChild(tr);
}

async function loadRecords() {
  renderRecordsMessage('読み込み中…');
  const before = getPlayer();
  try {
    const data = await getMe(before.playerId);
    if (!data.ok) throw new Error(data.error || 'Invalid response');
    const now = getPlayer();
    // 待っている間に名前が変わっていたら（保存した、ほかのタブで変えた）、古い返事で上書きしない。保存の途中も合わせない
    const unchanged = now.name === before.name && now.tag === before.tag;
    if (data.registered && unchanged && !els.save.disabled) {
      const synced = syncFromServer(data.name, data.tag);
      renderPlayer(synced);
      if (document.activeElement !== els.input) fillNameInput(synced);
    }
    renderRecords(data.registered && data.modes && typeof data.modes === 'object' ? data.modes : {});
  } catch (e) {
    console.warn('My records unavailable:', e);
    renderRecordsMessage('記録を読み込めませんでした。', true);
  }
}

/* ===== 名前の変更 ===== */

async function handleRename(e) {
  e.preventDefault();
  const checked = checkNewName(els.input.value);
  if (checked.error) {
    els.message.textContent = checked.error;
    return;
  }
  if (checked.name === getPlayer().name) {
    els.message.textContent = 'いまの名前と同じです。';
    return;
  }
  els.save.disabled = true;
  els.message.textContent = '保存しています…';
  const result = await rename(checked.name);
  els.save.disabled = false;
  if (!result.ok) {
    els.message.textContent = RENAME_ERRORS[result.error] || '保存できませんでした。';
    return;
  }
  renderPlayer(result.player);
  fillNameInput(result.player);
  els.message.textContent = '保存しました。ランキングにもこの名前で出ます。';
}

/* ===== はじめ ===== */

els.input.maxLength = NAME_MAX_LENGTH;
const first = getPlayer();
renderPlayer(first);
fillNameInput(first);
els.played.textContent = `— / ${games.length}`;
els.form.addEventListener('submit', handleRename);
els.input.addEventListener('input', () => { els.message.textContent = ''; });
onPlayerChange(renderPlayer);
ensureRegistered().then((player) => {
  renderPlayer(player);
  // 記録を残せないときは、名前を変えられないことを伝える
  if (!canKeepPlayer()) {
    els.input.disabled = true;
    els.save.disabled = true;
    els.message.textContent = STORAGE_BLOCKED_NOTE;
  }
  loadRecords();
});
