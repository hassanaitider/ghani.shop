(function () {
  'use strict';
  const $ = function (s) { return document.querySelector(s); };
  let countries = [];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function flag(code) {
    return String(code).toUpperCase().replace(/./g, function (ch) { return String.fromCodePoint(127397 + ch.charCodeAt(0)); });
  }

  function render() {
    const lang = i18n.get(), cur = GS.CURRENCIES;
    $('#empty').hidden = countries.length > 0;
    $('#countries').innerHTML = countries.map(function (c) {
      return '<a class="country" href="/' + esc(c.slug) + '"><span class="country__flag">' + flag(c.code) + '</span>' +
        '<span class="country__name">' + esc(c[lang]) + '</span>' +
        '<span class="country__cur">' + esc(c.currency) + (cur[c.currency] ? ' · ' + esc(cur[c.currency].sym) : '') + '</span></a>';
    }).join('');
  }

  function load() {
    return fetch('/api/countries', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      countries = d.countries || []; render();
    }).catch(function () { /* keep what is on screen */ });
  }

  document.querySelectorAll('[data-lang]').forEach(function (b) {
    b.addEventListener('click', function () { i18n.set(b.dataset.lang); });
  });
  document.addEventListener('langchange', function () {
    i18n.apply();
    document.querySelectorAll('[data-lang]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === i18n.get()); });
    render();
  });
  $('#year').textContent = new Date().getFullYear();
  i18n.apply();
  document.querySelectorAll('[data-lang]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === i18n.get()); });
  load();
})();
