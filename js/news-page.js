/*
  お知らせページ（news.html?page=[番号]）。仕様は docs/pages.md「お知らせ」。
  データは js/news.js。news.html#[id] で開くと、その項目のあるページを出す。
*/

import { sortedNews, formatNewsDate, isSafeHref } from './news.js';
import { reducedMotion } from './site.js';

const PAGE_SIZE = 10;

const items = sortedNews();
const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

function pageUrl(page) {
  return page === 1 ? 'news.html' : `news.html?page=${page}`;
}

function targetId() {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch (e) {
    return '';
  }
}

function currentPage() {
  const index = items.findIndex(item => item.id === targetId());
  if (index !== -1) return Math.floor(index / PAGE_SIZE) + 1;
  const page = parseInt(new URLSearchParams(location.search).get('page'), 10);
  return Number.isInteger(page) ? Math.min(Math.max(page, 1), pageCount) : 1;
}

function createItem(item) {
  const li = document.createElement('li');
  li.className = 'news-item';
  li.id = item.id;

  // http: / https: の href だけリンクにする。それ以外は href がない項目と同じ
  const linked = isSafeHref(item.href);
  const row = document.createElement(linked ? 'a' : 'div');
  row.className = 'news-item__row';
  if (linked) row.href = item.href;

  const date = document.createElement('time');
  date.className = 'news-item__date';
  date.dateTime = item.date;
  date.textContent = formatNewsDate(item.date);

  const type = document.createElement('span');
  type.className = 'news-item__type';
  type.textContent = item.type;

  const title = document.createElement('span');
  title.className = 'news-item__title';
  const text = document.createElement('span');
  text.className = 'news-item__title-text';
  text.textContent = item.title;
  title.appendChild(text);

  row.append(date, type, title);
  li.appendChild(row);
  return li;
}

function renderList(page) {
  const list = document.querySelector('[data-news]');
  list.textContent = '';
  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'news-items__empty';
    li.textContent = 'お知らせはまだありません。';
    list.appendChild(li);
    return;
  }
  items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).forEach(item => list.appendChild(createItem(item)));
}

function pagerLink(text, page, className) {
  const a = document.createElement('a');
  a.href = pageUrl(page);
  a.textContent = text;
  if (className) a.className = className;
  return a;
}

/* 1ページで収まるときはページ送りを出さない */
function renderPager(page) {
  const pager = document.querySelector('[data-pager]');
  pager.textContent = '';
  if (pageCount <= 1) {
    pager.hidden = true;
    return;
  }
  if (page > 1) pager.appendChild(pagerLink('← まえへ', page - 1, 'pager__step'));
  for (let p = 1; p <= pageCount; p++) {
    const a = pagerLink(String(p), p);
    if (p === page) a.setAttribute('aria-current', 'page');
    pager.appendChild(a);
  }
  if (page < pageCount) pager.appendChild(pagerLink('つぎへ →', page + 1, 'pager__step'));
  pager.hidden = false;
}

/* news.html#[id] で来たときは、その項目までスクロールしてタイトルに印を付ける */
function showTarget() {
  const id = targetId();
  if (!id) return;
  const el = document.getElementById(id);
  if (!el || !el.classList.contains('news-item')) return;
  el.classList.add('is-target');
  el.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

const page = currentPage();
renderList(page);
renderPager(page);
showTarget();
