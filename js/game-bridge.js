/*
  ゲームとサイト（bosumoti-game）をつなぐスクリプト。ゲームの HTML から読み込んで使う。
  使い方は docs/updating.md「2.4 ゲームの中に、サイトとのつなぎを入れる」。

    <script src="../../js/game-bridge.js"></script>
    <script>
      var site = BosumotiBridge.connect({ game: 'jump', version: '1.0.0' });
      // 1プレイ終わったら
      site.submitScore({ score: 1234 });
    </script>

  やること：
    - サイトに埋め込まれていて、プレイヤー情報（localStorage "bosumoti.player"）があるときだけ動く
    - スコアをランキングAPI（gas/Code.gs）に送る。通信の失敗などは覚えておき、次に開いたときと次の送信が通ったときに送り直す
    - 返事のタグを "bosumoti.player" に書き戻す（ほかの項目は触らない）
    - 結果を親ページ（サイト）に postMessage で知らせる。playerId と secret は入れない
  モジュールではない普通のスクリプトにしている（どんなツールで作ったゲームからでも読めるように）。
*/
(function () {
  'use strict';

  // js/api.js と games/reflex/index.html の RANKING_API_URL と同じ URL にする
  var API_URL = 'https://script.google.com/macros/s/AKfycbxJY00q_a3WjaPIy6fq7LR8RKJIon1S4B6V0zQR_SyByPfMysYGFJJXsBJGOmagH_A9/exec';
  // POST はサーバーのロック待ち（最大10秒）と処理より長く待つ（短いと、記録済みなのに通信エラーになり二重に送る）
  var TIMEOUT_MS = 25000;
  var PLAYER_KEY = 'bosumoti.player';
  var PENDING_KEY_PREFIX = 'bosumoti.pending.';
  var PENDING_MAX = 20;
  // 送り直しても結果が変わらないエラー（未送信として覚えない）
  var NON_RETRYABLE_ERRORS = ['invalid_request', 'invalid_name', 'invalid_score', 'auth_failed', 'unknown_action'];

  var PLAYER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var SECRET_RE = /^[0-9a-f]{64}$/;
  var TAG_RE = /^[0-9A-Z]{4}$/;
  var GAME_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

  var isEmbedded = (function () {
    try {
      return window.parent !== window;
    } catch (e) {
      return true;
    }
  })();

  function readStored(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || 'null');
      return value === null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  /* 保存できたら true、できなかったら false */
  function writeStored(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[bosumoti] save failed:', e);
      return false;
    }
  }

  /* サイトのプレイヤー情報。埋め込まれていないとき、形が正しくないときは null */
  function readPlayer() {
    if (!isEmbedded) return null;
    var p = readStored(PLAYER_KEY, null);
    if (!p || typeof p !== 'object' || !PLAYER_ID_RE.test(p.playerId) || !SECRET_RE.test(p.secret)) return null;
    if (typeof p.name !== 'string' || !p.name.trim()) return null;
    return { playerId: p.playerId, secret: p.secret, name: p.name, tag: TAG_RE.test(p.tag) ? p.tag : '' };
  }

  function writeBackTag(playerId, tag) {
    if (typeof tag !== 'string' || !TAG_RE.test(tag)) return;
    var p = readStored(PLAYER_KEY, null);
    if (!p || typeof p !== 'object' || p.playerId !== playerId || p.tag === tag) return;
    p.tag = tag;
    writeStored(PLAYER_KEY, p);
  }

  /* 通信失敗・タイムアウトは例外。API のエラーは { ok: false, error } のまま返す */
  function postToApi(body) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    return fetch(API_URL, {
      method: 'POST',
      // text/plain にすると CORS のプリフライトが起きない（GAS はプリフライトに答えられない）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || typeof data !== 'object') throw new Error('Invalid response');
      return data;
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  /* 同じプレイヤーなら、いまの名前に替える（古い名前で送って、サーバーの名前を戻さない） */
  function withLatestName(body) {
    var p = readPlayer();
    if (!p || p.playerId !== body.playerId) return body;
    var copy = {};
    Object.keys(body).forEach(function (k) { copy[k] = body[k]; });
    copy.name = p.name;
    return copy;
  }

  function isRetryable(data) {
    return !data.ok && NON_RETRYABLE_ERRORS.indexOf(data.error) === -1;
  }

  /* 親ページ（サイト）へ。宛先は同じオリジンだけ */
  function postToSite(message) {
    if (!isEmbedded) return;
    try {
      window.parent.postMessage(message, location.origin);
    } catch (e) {
      // file:// など、宛先を指定できない環境では送らない
    }
  }

  function connect(options) {
    options = options || {};
    var game = String(options.game || '');
    if (!GAME_ID_RE.test(game)) throw new Error('[bosumoti] game にゲームID（英小文字）を指定してください');
    var version = options.version ? String(options.version) : '';
    var pendingKey = PENDING_KEY_PREFIX + game;
    var currentMode = game;
    var flushing = false;

    function loadPending() {
      var list = readStored(pendingKey, []);
      return Array.isArray(list) ? list : [];
    }

    function savePending(list) {
      return writeStored(pendingKey, list.slice(-PENDING_MAX));
    }

    /* 未送信のスコアを古い順に送り直す。通信できない間は覚えたままにする */
    function flushPending() {
      if (flushing) return Promise.resolve();
      flushing = true;
      var step = function () {
        var pending = loadPending();
        if (pending.length === 0) return Promise.resolve();
        var body = withLatestName(pending[0]);
        return postToApi(body).then(function (data) {
          if (isRetryable(data)) return;
          if (data.ok) writeBackTag(body.playerId, data.tag);
          // 保存できないと先頭が消えず、同じスコアを送り続けてしまう。止める
          if (!savePending(loadPending().slice(1))) return;
          return step();
        });
      };
      return step().catch(function () {}).then(function () { flushing = false; });
    }

    /**
     * 1プレイの結果を送り、サイトに知らせる。
     * result: { score: 画面に出した点数, mode: 省略時はいまのモード, detail: サーバーで採点し直すときの生データ }
     * 戻り値（Promise）：送信の返事（scores を除く）／失敗は { ok: false, error }／送らなかったら null
     */
    function submitScore(result) {
      result = result || {};
      var mode = result.mode ? String(result.mode) : currentMode;
      var score = Number(result.score);
      var player = readPlayer();

      var finish = function (online) {
        postToSite({ type: 'bosumoti:result', game: game, mode: mode, score: score, online: online });
        return online;
      };

      // 点数を渡し忘れたときなどは送らない（送ると 0 点で記録される）。detail があるときはサーバーが採点し直す
      if (result.detail === undefined && !Number.isInteger(score)) {
        console.error('[bosumoti] submitScore: score が整数ではないため送りませんでした:', result.score);
        return Promise.resolve(finish({ ok: false, error: 'invalid_score' }));
      }

      // サイトの外で開いたとき、プレイヤー情報がないときは送らない
      if (!player) return Promise.resolve(finish(null));

      var payload = { action: 'submit', playerId: player.playerId, secret: player.secret, name: player.name, mode: mode, score: score, version: version };
      if (result.detail !== undefined) payload.detail = result.detail;

      return postToApi(payload).then(function (data) {
        if (isRetryable(data)) savePending(loadPending().concat([payload]));
        if (!data.ok) return finish({ ok: false, error: data.error || 'server_error' });
        writeBackTag(player.playerId, data.tag);
        flushPending();
        var online = {};
        Object.keys(data).forEach(function (k) { if (k !== 'scores') online[k] = data[k]; });
        return finish(online);
      }, function () {
        savePending(loadPending().concat([payload]));
        return finish({ ok: false, error: 'network' });
      });
    }

    /** モードのあるゲーム：いま選んでいるモードをサイトに知らせる（ランキングの表示がそのモードになる） */
    function setMode(mode) {
      currentMode = String(mode || game);
      postToSite({ type: 'bosumoti:mode', game: game, mode: currentMode });
    }

    /** 表示用のプレイヤー情報 { name, tag }（仮の名前「ななし」の人は name が null）。サイトの外では null */
    function getPlayer() {
      var p = readPlayer();
      if (!p) return null;
      return { name: p.name === 'ななし' ? null : p.name, tag: p.tag };
    }

    /** サイトでプレイヤー情報（名前・タグ）が変わったときに呼ばれる */
    function onPlayerChange(callback) {
      window.addEventListener('storage', function (e) {
        if (e.key === PLAYER_KEY || e.key === null) callback(getPlayer());
      });
    }

    if (readPlayer()) flushPending();

    return {
      isEmbedded: isEmbedded,
      isSiteMode: function () { return readPlayer() !== null; },
      getPlayer: getPlayer,
      onPlayerChange: onPlayerChange,
      setMode: setMode,
      submitScore: submitScore,
    };
  }

  window.BosumotiBridge = { connect: connect };
})();
