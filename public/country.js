(function () {
  'use strict';
  const $ = function (s) { return document.querySelector(s); };
  const SLUG = location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  const S = { country: null, categories: [], products: [], rates: {}, cat: null };

  try { S.cat = new URLSearchParams(location.search).get('c'); } catch (e) { /* ignore */ }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderCats() {
    const lang = i18n.get();
    // no filter row when the country has a single category (or none)
    $('#cats').hidden = S.categories.length < 2;
    $('#cats').innerHTML = ['<button type="button" class="chip' + (S.cat ? '' : ' is-active') + '" data-cat="">' + i18n.t('cat.all') + '</button>']
      .concat(S.categories.map(function (c) {
        return '<button type="button" class="chip' + (S.cat === c.id ? ' is-active' : '') + '" data-cat="' + esc(c.id) + '">' + esc(c[lang]) + '</button>';
      })).join('');
  }

  function renderProducts() {
    const lang = i18n.get(), cur = S.country.currency;
    const list = S.products.filter(function (p) { return !S.cat || p.categoryId === S.cat; });
    $('#empty').hidden = list.length > 0;
    $('#products').innerHTML = list.map(function (p) {
      const q = GS.quote({ qty: 1, currency: cur, rates: S.rates, product: p });
      const cat = S.categories.find(function (c) { return c.id === p.categoryId; });
      const img = p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '<span class="pcard__ph">⚡</span>';
      return '<a class="pcard" href="/' + esc(S.country.slug) + '/' + esc(p.id) + '"><div class="pcard__img">' + img + '</div>' +
        '<div class="pcard__body">' + (cat ? '<span class="pcard__cat">' + esc(cat[lang]) + '</span>' : '') +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="pcard__price"><b>' + GS.format(q.unit, cur, lang) + '</b>' +
        (q.compareUnit > q.unit ? ' <s>' + GS.format(q.compareUnit, cur, lang) + '</s>' : '') + '</div>' +
        (p.stock > 0 ? '' : '<span class="pcard__out">' + i18n.t('stock.out') + '</span>') + '</div></a>';
    }).join('');
  }

  function render() {
    if (!S.country) return;
    const lang = i18n.get();
    $('#title').textContent = S.country.flag + ' ' + S.country[lang];
    document.title = S.country[lang] + ' — Ghani Shop';
    renderCats(); renderProducts();
  }

  function load() {
    return fetch('/api/config?country=' + encodeURIComponent(SLUG), { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) { location.replace('/'); throw new Error('unknown country'); }
      return r.json();
    }).then(function (c) {
      S.country = c.country; S.categories = c.categories; S.products = c.products; S.rates = c.rates || {};
      if (S.cat && !S.categories.some(function (x) { return x.id === S.cat; })) S.cat = null;
      render();
    }).catch(function () { /* keep what is on screen */ });
  }

  $('#cats').addEventListener('click', function (e) {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    S.cat = b.dataset.cat || null;
    try { history.replaceState(null, '', S.cat ? '?c=' + encodeURIComponent(S.cat) : location.pathname); } catch (x) { /* ignore */ }
    renderCats(); renderProducts();
  });
  document.querySelectorAll('[data-lang]').forEach(function (b) {
    b.addEventListener('click', function () { i18n.set(b.dataset.lang); });
  });
  function paintLang() {
    i18n.apply();
    document.querySelectorAll('[data-lang]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === i18n.get()); });
    render();
  }
  document.addEventListener('langchange', paintLang);
  $('#year').textContent = new Date().getFullYear();
  paintLang();
  load();
  setInterval(load, 30000);
})();
