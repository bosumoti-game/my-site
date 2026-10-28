/*
  この端末のプレイヤー情報（localStorage "bosumoti.player"）。
  サイトが作り、ゲーム（REFLEX）も読む。REFLEX は tag だけを書き戻す。
  決まりは docs/ranking-api.md の「プレイヤーの固有の値」。
*/

import { postProfile } from './api.js';

export const PLAYER_KEY = 'bosumoti.player';
// 名前を決めていない人の仮の名前。一度決めたら変えない（登録済みの人の表示がずれる）
export const DEFAULT_NAME = 'ななし';
export const NAME_MAX_LENGTH = 10;
// プレイヤー情報を残せない（ブラウザの設定で localStorage に保存できない）ときに画面に出す文
export const STORAGE_BLOCKED_NOTE = 'このブラウザの設定では記録を残せません。サイトデータの保存を許可してください。';

const PLAYER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;
const TAG_RE = /^[0-9A-Z]{4}$/;
// gas/Code.gs の normalizeName_ と同じ文字を消す（制御文字・ゼロ幅文字・文字の向きを変える記号）
const NAME_STRIP_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const NAME_FORBIDDEN_LEAD_RE = /^[=+\-@]/;

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/* crypto.randomUUID は安全でない環境（http の別ホストなど）で使えないため、なければ自前で作る */
function generatePlayerId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = randomHex(16).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function readStored() {
  try {
    const p = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
    return (p && typeof p === 'object' && !Array.isArray(p)) ? p : null;
  } catch (e) {
    return null;
  }
}

/* localStorage に書けなかったときの、このページの中だけのプレイヤー（呼ぶたびに別の人にならないように） */
let memoryPlayer = null;

/* 読んでから必要な項目だけ変えて書く（REFLEX が tag を書き戻すことがあるため） */
function writeFields(fields) {
  const p = readStored() || (memoryPlayer ? { ...memoryPlayer } : {});
  Object.assign(p, fields);
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
  } catch (e) {
    console.warn('Player save failed:', e);
    if (memoryPlayer) Object.assign(memoryPlayer, fields);
  }
  return p;
}

/** 見えない文字を消して、前後の空白を落とす */
function stripName(raw) {
  return raw.replace(NAME_STRIP_RE, '').trim();
}

/** サーバーと同じ規則で名前を整える。使えない名前なら null。2回かけても同じ結果になる */
export function normalizeName(raw) {
  if (typeof raw !== 'string') return null;
  let name = stripName(raw).slice(0, NAME_MAX_LENGTH);
  // 10文字目が絵文字などだと半分で切れる。残った上位サロゲートを落とす
  const last = name.charCodeAt(name.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) name = name.slice(0, -1);
  name = name.trim();
  if (!name || NAME_FORBIDDEN_LEAD_RE.test(name)) return null;
  return name;
}

/**
 * プレイヤー情報を返す。なければ作って保存する（名前は仮の名前）。
 * ゲームの iframe を読み込む前に呼ぶ（REFLEX が読み込み時にこれを読むため）。
 */
export function getPlayer() {
  const p = readStored();
  if (p && PLAYER_ID_RE.test(p.playerId) && SECRET_RE.test(p.secret)) {
    const name = normalizeName(p.name) || DEFAULT_NAME;
    const tag = TAG_RE.test(p.tag) ? p.tag : '';
    if (name !== p.name || tag !== p.tag) writeFields({ name, tag });
    return { playerId: p.playerId, secret: p.secret, name, tag };
  }
  if (memoryPlayer) return { ...memoryPlayer };
  const player = { playerId: generatePlayerId(), secret: randomHex(32), name: DEFAULT_NAME, tag: '' };
  try {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
  } catch (e) {
    console.warn('Player save failed:', e);
    memoryPlayer = { ...player };
  }
  return { ...player };
}

/** この端末にプレイヤー情報を残せるか。残せないと、ページを開くたびに別のプレイヤーになる */
export function canKeepPlayer() {
  const player = getPlayer();
  const stored = readStored();
  return !!stored && stored.playerId === player.playerId;
}

/**
 * タグがまだなければ profile で登録する。通信に失敗したら次に開いたときに呼び直す
 * （REFLEX がスコアを送れば、そこでも登録される）。
 * プレイヤー情報を残せないときは登録しない（開くたびにサーバーのプレイヤーが増えるため）。
 */
export async function ensureRegistered() {
  const player = getPlayer();
  if (player.tag || !canKeepPlayer()) return player;
  try {
    const data = await postProfile(player.playerId, player.secret, player.name);
    if (!data.ok) {
      console.warn('Profile rejected:', data.error);
      return player;
    }
    return saveProfileResult(player, data);
  } catch (e) {
    console.warn('Profile unavailable:', e);
    return player;
  }
}

function saveProfileResult(player, data) {
  const fields = {};
  if (typeof data.name === 'string' && normalizeName(data.name)) fields.name = data.name;
  if (typeof data.tag === 'string' && TAG_RE.test(data.tag)) fields.tag = data.tag;
  const p = writeFields(fields);
  return { playerId: player.playerId, secret: player.secret, name: p.name, tag: p.tag };
}

/** GET action=me で受け取ったサーバーの名前とタグに合わせる（違っていたときだけ書く） */
export function syncFromServer(name, tag) {
  const player = getPlayer();
  if (normalizeName(name) !== name || !TAG_RE.test(tag)) return player;
  if (player.name === name && player.tag === tag) return player;
  return saveProfileResult(player, { name, tag });
}

/** 入力された名前をチェックする。使えるなら { name }、使えないなら { error: 表示する文 } */
export function checkNewName(raw) {
  if (typeof raw === 'string' && NAME_FORBIDDEN_LEAD_RE.test(stripName(raw))) {
    return { error: '先頭に = + - @ は使えません' };
  }
  const name = normalizeName(raw);
  if (!name) return { error: '名前を入れてください' };
  if (name === DEFAULT_NAME) return { error: `「${DEFAULT_NAME}」は使えません` };
  return { name };
}

/** 名前を変える。成功すると { ok: true, player }、失敗すると { ok: false, error } */
export async function rename(raw) {
  const checked = checkNewName(raw);
  if (checked.error) return { ok: false, error: checked.error };
  // 残せないプレイヤーの名前を変えると、サーバーにだけ新しいプレイヤーができる
  if (!canKeepPlayer()) return { ok: false, error: 'storage' };
  const player = getPlayer();
  try {
    const data = await postProfile(player.playerId, player.secret, checked.name);
    if (!data.ok) return { ok: false, error: data.error };
    return { ok: true, player: saveProfileResult(player, data) };
  } catch (e) {
    return { ok: false, error: 'network' };
  }
}

/** 表示用：仮の名前の人は name を null にする（番号だけで表示する） */
export function displayParts(name, tag) {
  return { name: name === DEFAULT_NAME ? null : name, tag: tag || '' };
}

/** 「名前#番号」の要素を作る。名前は太く、番号は DM Mono で小さく薄く */
export function renderPlayerName(name, tag) {
  const parts = displayParts(name, tag);
  const wrap = document.createElement('span');
  wrap.className = 'player-name';
  if (parts.name) {
    const n = document.createElement('span');
    n.className = 'player-name__name';
    n.textContent = parts.name;
    wrap.appendChild(n);
  }
  if (parts.tag) {
    const t = document.createElement('span');
    t.className = 'player-name__tag';
    t.textContent = `#${parts.tag}`;
    wrap.appendChild(t);
  }
  return wrap;
}

/** ほかのタブやゲーム（REFLEX）がプレイヤー情報を書き換えたときに呼ぶ */
export function onPlayerChange(callback) {
  window.addEventListener('storage', (e) => {
    if (e.key === PLAYER_KEY || e.key === null) callback(getPlayer());
  });
}
