/*
  ダーク／ライト。<head> で普通の script として読み込む（描画前にテーマを決めて、ちらつきを防ぐ）。
  最初は prefers-color-scheme に従い、切り替えたら localStorage に保存してページをまたいで保つ。
*/
(function () {
  var THEME_KEY = 'bosumoti.theme';
  var root = document.documentElement;

  try {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch (e) {}

  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateButtons() {
    var dark = currentTheme() === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-label', dark ? 'ライトテーマに切り替え' : 'ダークテーマに切り替え');
      btn.setAttribute('data-current', dark ? 'dark' : 'light');
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!btn) return;
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (err) {}
    updateButtons();
  });

  // ほかのページで切り替えたとき
  window.addEventListener('storage', function (e) {
    if (e.key !== THEME_KEY) return;
    if (e.newValue === 'light' || e.newValue === 'dark') root.setAttribute('data-theme', e.newValue);
    else root.removeAttribute('data-theme');
    updateButtons();
  });

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', updateButtons);
  }

  document.addEventListener('DOMContentLoaded', updateButtons);
})();
