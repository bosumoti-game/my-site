/*
  ランキングAPI（gas/Code.gs）の呼び出し。使い方は docs/ranking-api.md。
  スコア送信（submit）はゲームが行うので、ここには置かない。
*/

export const API_URL = 'https://script.google.com/macros/s/AKfycbxJY00q_a3WjaPIy6fq7LR8RKJIon1S4B6V0zQR_SyByPfMysYGFJJXsBJGOmagH_A9/exec';

const TIMEOUT_MS = 8000;
// POST はサーバーのロック待ち（最大10秒）と処理より長く待つ（短いと、記録済みなのに通信エラーになる）
const POST_TIMEOUT_MS = 25000;

/* 通信失敗・タイムアウトは例外。API のエラーは { ok: false, error } のまま返す */
async function call(method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), method === 'GET' ? TIMEOUT_MS : POST_TIMEOUT_MS);
  try {
    let res;
    if (method === 'GET') {
      const query = new URLSearchParams(params).toString();
      res = await fetch(`${API_URL}?${query}`, { signal: controller.signal, cache: 'no-store' });
    } else {
      // text/plain にすると CORS のプリフライトが起きない（GAS はプリフライトに答えられない）
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid response');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* period: 'week' | 'month' | 'all'。サイトからは必ず付ける */
export function getLeaderboard(mode, period, playerId) {
  const params = { action: 'leaderboard', mode, period };
  if (playerId) params.playerId = playerId;
  return call('GET', params);
}

export function getMe(playerId) {
  return call('GET', { action: 'me', playerId });
}

/* 登録（未登録のとき）と名前の変更 */
export function postProfile(playerId, secret, name) {
  return call('POST', { action: 'profile', playerId, secret, name });
}
