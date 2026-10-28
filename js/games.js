/*
  ゲームの一覧と、ゲームごとの設定（docs/pages.md「ゲーム画面の設定」）。
  ゲームを足すときはここに1件足す。ランキングに載せるには gas/Code.gs にもモードを足す。

  書く項目：
    id          ゲームID（games/[id]/ のフォルダ名。英小文字）。モードのないゲームは、これがランキングの mode になる
    no          No.（いちばん大きいものが最新として横長・NEW になる）
    name / minutes / controls   ゲーム名・1プレイの目安（分）・操作（「約2分 ・ 矢印キーだけ」のように出る）
    src / thumbnail             ゲームの HTML とカードの画像
    モードのないゲーム：unit（スコアの単位）・howto（あそびかた1〜2文）・keys（[{ key, action }]）
    モードのあるゲーム：defaultMode と modes（REFLEX を見本に）
    frame / minGameWidth / thumbnailPosition は、既定と違うときだけ書く
*/

/* 設定の既定値。ゲームごとに上書きする */
const DEFAULTS = {
  // 枠の決め方。aspect：縦横比で決める／viewport：画面の高さ − ヘッダー（最低 minHeight）
  frame: { fit: 'aspect', ratio: '16 / 9' },
  // ゲームの列にこの幅が取れないときは、ランキングをゲーム画面の下に置く
  minGameWidth: 600,
};

const GAMES = [
  {
    id: 'reflex',
    no: 1,
    name: 'REFLEX',
    minutes: 1,
    controls: 'クリックとキー',
    src: 'games/reflex/index.html',
    // カードの画像。真ん中を切り抜いて、横長（最新）でも4:3でも使う
    thumbnail: 'games/reflex/thumbnail.jpg',
    // 横長に切り抜くとき、上の表示（SIGNAL STATUS）が切れないよう少し上に寄せる
    thumbnailPosition: '50% 8%',
    frame: { fit: 'viewport', minHeight: 550 },
    minGameWidth: 760,
    // モードはゲームの中で選ぶ。サイトは bosumoti:mode を受けて表示を合わせる
    defaultMode: 'click',
    modes: [
      {
        id: 'click',
        label: 'CLICK',
        unit: 'pts',
        howto: '30秒のあいだ、あちこちに出る円をタップする。1回当てるごとに1点。',
        keys: [{ key: 'クリック', action: '円をタップ' }],
      },
      {
        id: 'move',
        label: 'MOVE',
        unit: '列',
        howto: '落ちてくるブロックの隙間に入ってよける。よけた列の数がスコア。だんだん速くなり、ぶつかったら終わり。',
        keys: [{ key: 'Q W E R U I O P', action: 'レーンを選ぶ' }],
      },
      {
        id: 'racer',
        label: 'RACER',
        unit: 'pts',
        howto: '5ラウンド。落ちてきたボールを、落ちた側のキーでつかむ。速いほど高得点（1ラウンド10点まで）。早押しと逆押しは0点。',
        keys: [{ key: 'F', action: '左' }, { key: 'J', action: '右' }],
      },
      {
        id: 'signal',
        label: 'SIGNAL',
        unit: 'pts',
        howto: '3つのランプがすべてつき、消えた瞬間に押す。1000から反応時間（ミリ秒）を引いた数がスコア。消える前に押すと0点。',
        keys: [{ key: 'Space', action: '押す' }],
      },
    ],
  },
];

export function getGame(id) {
  const game = GAMES.find(g => g.id === id);
  return game ? { ...DEFAULTS, ...game } : null;
}

/** 新しい順（No. の大きい順） */
export function getGames() {
  return GAMES.map(g => ({ ...DEFAULTS, ...g })).sort((a, b) => b.no - a.no);
}
