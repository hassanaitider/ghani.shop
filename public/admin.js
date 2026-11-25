(function () {
  'use strict';
  const t = i18n.t;
  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.from(document.querySelectorAll(s)); };
  const REGIONS = ['central', 'africa', 'eeurope', 'other'];
  const INACTIVE = ['cancelled', 'returned'];

  const S = { token: null, orders: [], countries: [], categories: [], products: [], rates: {}, open: null, editing: null, editingProduct: null, catCountry: '', prodCountry: '', tab: 'dashboard' };
  try { S.token = sessionStorage.getItem('gs_admin'); } catch (e) { /* ignore */ }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function eur(n) { return GS.format(n, 'EUR', i18n.get()); }
  function loc(n, cur) { return GS.format(n, cur, i18n.get()); }
  function dateStr(iso) {
    return new Date(iso).toLocaleString(i18n.get(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function flag(code) {
    return /^[A-Za-z]{2}$/.test(code) ? String(code).toUpperCase().replace(/./g, function (ch) { return String.fromCodePoint(127397 + ch.charCodeAt(0)); }) : '';
  }
  function findCountry(code) { return S.countries.find(function (c) { return c.code === code; }); }
  // Name of a country: managed list first, then the built-in list, then the name saved on the order itself
  function cname(code, order) {
    const c = findCountry(code) || GS.country(code);
    if (c) return c[i18n.get()];
    if (order && order.shipping.countryName) return order.shipping.countryName[i18n.get()] || code;
    return code;
  }
  function categoriesOf(code) {
    return S.categories.filter(function (c) { return c.countryCode === code; }).sort(function (a, b) { return a.order - b.order; });
  }
  function productsOf(code) { return S.products.filter(function (p) { return p.countryCode === code; }); }
  // every mutating call returns the full countries/categories/products snapshot
  function applySnap(d) {
    if (d.countries) S.countries = d.countries;
    if (d.categories) S.categories = d.categories;
    if (d.products) S.products = d.products;
  }
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 2400);
  }

  /* ---------- api (relative URLs only: works on localhost and on the production domain) ---------- */
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { Authorization: 'Bearer ' + S.token } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401 && S.token) { logout(); throw new Error('unauthorized'); }
      return r.json().then(function (d) {
        if (!r.ok) { const e = new Error(d.error || 'error'); e.status = r.status; e.fields = d.fields; throw e; }
        return d;
      });
    });
  }
  function load() {
    return api('GET', '/api/admin/data').then(function (d) {
      S.orders = d.orders; S.rates = d.rates || {}; applySnap(d);
      renderAll();
    });
  }

  /* ---------- auth ---------- */
  function showApp(on) { $('#login').hidden = on; $('#app').hidden = !on; }
  function logout() {
    S.token = null; try { sessionStorage.removeItem('gs_admin'); } catch (e) { /* ignore */ }
    showApp(false);
  }
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const err = $('#loginErr'); err.hidden = true;
    api('POST', '/api/admin/login', { password: $('#pw').value }).then(function (d) {
      S.token = d.token; try { sessionStorage.setItem('gs_admin', d.token); } catch (x) { /* ignore */ }
      $('#pw').value = ''; showApp(true); return load();
    }).catch(function (x) {
      err.textContent = x.status === 429 ? t('a.login.rate') : t('a.login.err'); err.hidden = false;
    });
  });
  $('#logout').addEventListener('click', logout);
  $('#refresh').addEventListener('click', function () { load().catch(function () {}); });

  /* ---------- tabs ---------- */
  function showTab(name) {
    S.tab = name;
    $$('[data-tab]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.tab === name); b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    $$('[data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== name; });
  }
  $('#tabs').addEventListener('click', function (e) {
    const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab);
  });

  /* ---------- derived data ---------- */
  function active() { return S.orders.filter(function (o) { return !INACTIVE.includes(o.status); }); }

  function renderKpis() {
    const a = active(), rev = a.reduce(function (s, o) { return s + o.totalEUR; }, 0);
    const pending = S.orders.filter(function (o) { return o.status === 'new'; }).length;
    const done = S.orders.filter(function (o) { return ['delivered', 'returned', 'cancelled'].includes(o.status); });
    const delivered = done.filter(function (o) { return o.status === 'delivered'; }).length;
    const units = a.reduce(function (s, o) { return s + o.qty; }, 0);
    const k = function (cls, label, val) { return '<div class="kpi ' + cls + '"><span>' + label + '</span><b>' + val + '</b></div>'; };
    $('#kpis').innerHTML =
      k('', t('a.kpi.orders'), S.orders.length) +
      k('kpi--accent', t('a.kpi.revenue'), eur(rev)) +
      k('', t('a.kpi.aov'), a.length ? eur(rev / a.length) : '—') +
      k('kpi--warn', t('a.kpi.pending'), pending) +
      k('', t('a.kpi.delivery'), done.length ? Math.round(delivered / done.length * 100) + ' %' : '—') +
      k('', t('a.kpi.units'), units) +
      '<p class="kpinote">' + t('a.kpi.note') + '</p>';
  }

  function renderChart() {
    const days = [], now = new Date();
    for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); days.push(d.toLocaleDateString('sv')); }
    const counts = days.map(function (d) {
      return S.orders.filter(function (o) { return new Date(o.createdAt).toLocaleDateString('sv') === d; }).length;
    });
    const max = Math.max(1, Math.max.apply(null, counts));
    $('#chart').innerHTML = days.map(function (d, i) {
      const h = counts[i] ? Math.max(6, counts[i] / max * 130) : 2;
      return '<div class="chart__col"><span class="chart__v">' + (counts[i] || '') + '</span><div class="chart__bar' + (counts[i] ? '' : ' chart__bar--zero') + '" style="height:' + h + 'px"></div><span>' + d.slice(8) + '</span></div>';
    }).join('');
  }

  function renderRegions() {
    const a = active(), total = a.reduce(function (s, o) { return s + o.totalEUR; }, 0) || 1;
    $('#regions').innerHTML = REGIONS.map(function (r) {
      const list = a.filter(function (o) { return o.shipping.region === r; });
      const rev = list.reduce(function (s, o) { return s + o.totalEUR; }, 0);
      return '<div class="region region--' + r + '"><div class="region__top"><span>' + t('a.region.' + r) + ' · ' + list.length + '</span><span>' + eur(rev) + '</span></div>' +
        '<div class="region__bar"><i style="width:' + Math.round(rev / total * 100) + '%"></i></div></div>';
    }).join('');
  }

  function renderCountryTable() {
    const map = {};
    active().forEach(function (o) {
      const key = o.shipping.country + '|' + o.currency;
      const m = map[key] || (map[key] = { country: o.shipping.country, order: o, cur: o.currency, n: 0, local: 0, eur: 0 });
      m.n++; m.local += o.amounts.total; m.eur += o.totalEUR;
    });
    const rows = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.eur - a.eur; });
    $('#countryTable tbody').innerHTML = rows.length ? rows.map(function (r) {
      return '<tr><td>' + flag(r.country) + ' ' + esc(cname(r.country, r.order)) + '</td><td>' + esc(r.cur) + '</td><td class="num">' + r.n + '</td><td class="num">' + loc(r.local, r.cur) + '</td><td class="num">' + eur(r.eur) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">' + t('a.empty') + '</td></tr>';
  }

  function renderSettings() {
    if (document.activeElement && $('#settings').contains(document.activeElement)) return;
    $('#rates').innerHTML = Object.keys(GS.CURRENCIES).filter(function (c) { return c !== 'EUR'; }).map(function (c) {
      return '<label>' + c + '<input type="number" step="any" min="0" data-cur="' + c + '" value="' + GS.rateOf(c, S.rates) + '"' + (GS.CURRENCIES[c].fixed ? ' disabled title="Fixed (EUR peg)"' : '') + '></label>';
    }).join('');
  }
  $('#settings').addEventListener('submit', function (e) {
    e.preventDefault();
    const rates = {};
    $$('#rates input:not(:disabled)').forEach(function (i) { rates[i.dataset.cur] = Number(i.value); });
    api('PUT', '/api/admin/settings', { rates: rates }).then(function (d) {
      S.rates = d.rates; toast(t('a.set.saved'));
    }).catch(function () {});
  });

  /* ---------- orders, grouped by destination country ---------- */
  let filterSig = '';
  function fillFilters() {
    // countries that exist in the managed list, plus any that only appear on older orders
    const seen = {}, opts = [];
    S.countries.forEach(function (c) { seen[c.code] = 1; opts.push([c.code, c[i18n.get()]]); });
    S.orders.forEach(function (o) { if (!seen[o.shipping.country]) { seen[o.shipping.country] = 1; opts.push([o.shipping.country, cname(o.shipping.country, o)]); } });
    const sig = i18n.get() + JSON.stringify(opts);
    if (sig === filterSig) return;
    filterSig = sig;
    const keep = { s: $('#fStatus').value, r: $('#fRegion').value, c: $('#fCountry').value };
    $('#fStatus').innerHTML = '<option value="">' + t('a.f.status') + '</option>' + GS.STATUSES.map(function (s) { return '<option value="' + s + '">' + t('a.status.' + s) + '</option>'; }).join('');
    $('#fRegion').innerHTML = '<option value="">' + t('a.f.region') + '</option>' + REGIONS.map(function (r) { return '<option value="' + r + '">' + t('a.region.' + r) + '</option>'; }).join('');
    $('#fCountry').innerHTML = '<option value="">' + t('a.f.country') + '</option>' + opts.map(function (c) { return '<option value="' + esc(c[0]) + '">' + esc(flag(c[0]) + ' ' + c[1]) + '</option>'; }).join('');
    $('#fStatus').value = keep.s; $('#fRegion').value = keep.r; $('#fCountry').value = keep.c;
  }
  function filtered() {
    const q = $('#fSearch').value.trim().toLowerCase(), st = $('#fStatus').value, rg = $('#fRegion').value, co = $('#fCountry').value;
    return S.orders.filter(function (o) {
      if (st && o.status !== st) return false;
      if (rg && o.shipping.region !== rg) return false;
      if (co && o.shipping.country !== co) return false;
      if (q && (o.id + ' ' + o.customer.name + ' ' + o.customer.phone + ' ' + o.shipping.city).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function statusSelect(o) {
    return '<select class="statussel badge st-' + o.status + '" data-status="' + esc(o.id) + '">' + GS.STATUSES.map(function (s) {
      return '<option value="' + s + '"' + (s === o.status ? ' selected' : '') + '>' + t('a.status.' + s) + '</option>';
    }).join('') + '</select>';
  }
  function orderRow(o) {
    return '<tr data-id="' + esc(o.id) + '"><td class="id">' + esc(o.id) + '</td><td>' + dateStr(o.createdAt) + '</td>' +
      '<td>' + esc(o.customer.name) + '<small>' + esc(o.customer.phone) + '</small></td>' +
      '<td>' + esc(o.shipping.city) + '<small>' + esc(o.productName || 'SolarGlow') + '</small></td>' +
      '<td class="num">' + o.qty + '</td><td class="num">' + loc(o.amounts.total, o.currency) + '<small>' + eur(o.totalEUR) + '</small></td>' +
      '<td>' + statusSelect(o) + '</td></tr>';
  }
  function renderOrders() {
    const list = filtered();
    $('#shown').textContent = t('a.shown', { n: list.length });
    if (!list.length) { $('#ordersGroups').innerHTML = '<section class="panel"><p class="empty">' + t('a.empty') + '</p></section>'; return; }
    const groups = {};
    list.forEach(function (o) { (groups[o.shipping.country] || (groups[o.shipping.country] = [])).push(o); });
    const head = '<thead><tr><th>' + t('a.col.id') + '</th><th>' + t('a.col.date') + '</th><th>' + t('a.col.customer') + '</th><th>' + t('a.col.place') +
      '</th><th class="num">' + t('a.col.qty') + '</th><th class="num">' + t('a.col.total') + '</th><th>' + t('a.col.status') + '</th></tr></thead>';
    $('#ordersGroups').innerHTML = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; }).map(function (code) {
      const g = groups[code], eurSum = g.filter(function (o) { return !INACTIVE.includes(o.status); }).reduce(function (s, o) { return s + o.totalEUR; }, 0);
      return '<section class="panel cgroup"><div class="cgroup__head"><h3>' + flag(code) + ' ' + esc(cname(code, g[0])) + '</h3>' +
        '<span class="muted small">' + t('a.grp.orders', { n: g.length }) + ' · ' + eur(eurSum) + '</span></div>' +
        '<div class="tablewrap"><table class="table table--orders">' + head + '<tbody>' + g.map(orderRow).join('') + '</tbody></table></div></section>';
    }).join('');
  }
  ['#fSearch', '#fStatus', '#fRegion', '#fCountry'].forEach(function (s) {
    $(s).addEventListener('input', renderOrders);
  });

  function setStatus(id, status) {
    return api('PATCH', '/api/admin/orders/' + encodeURIComponent(id), { status: status }).then(function (d) {
      const i = S.orders.findIndex(function (o) { return o.id === id; });
      if (i >= 0) S.orders[i] = d.order;
      applySnap(d); renderAll();
      if (S.open === id) openDetail(id);
    });
  }
  $('#ordersGroups').addEventListener('change', function (e) {
    const sel = e.target.closest('[data-status]');
    if (sel) setStatus(sel.dataset.status, sel.value).catch(function () { load().catch(function () {}); });
  });
  $('#ordersGroups').addEventListener('click', function (e) {
    if (e.target.closest('select')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });

  /* ---------- order detail dialog ---------- */
  function openDetail(id) {
    const o = S.orders.find(function (x) { return x.id === id; });
    if (!o) return;
    S.open = id;
    const a = o.amounts;
    const crossNames = { cable: t('cs.cable'), stand: t('cs.stand'), panel: t('cs.panel') };
    const digits = o.customer.phone.replace(/\D/g, '');
    const line = function (l, v, cls) { return '<div class="' + (cls || '') + '"><span>' + l + '</span><span>' + v + '</span></div>'; };
    let lines = line(esc(o.productName || 'SolarGlow') + ' × ' + o.qty, loc(a.subtotal, o.currency));
    if (a.discount) lines += line(t('sum.discount'), '−' + loc(a.discount, o.currency));
    if (o.addons && o.addons.length) lines += line(o.addons.map(function (x) { return esc(x.name); }).join(', '), loc(a.addons || 0, o.currency));
    if (o.cross.length) lines += line(o.cross.map(function (c) { return esc(crossNames[c] || c); }).join(', '), loc(a.cross, o.currency));
    lines += line(t('sum.shipping'), a.shipping ? loc(a.shipping, o.currency) : t('sum.free'));
    lines += line('Total · ' + eur(o.totalEUR), loc(a.total, o.currency), 'tot');
    $('#detailBody').innerHTML =
      '<div class="d"><div class="d__head"><div><h2>' + esc(o.id) + '</h2><span class="muted small">' + new Date(o.createdAt).toLocaleString(i18n.get()) + '</span></div>' +
      statusSelect(o) + '</div>' +
      '<div class="d__grid">' +
      '<div class="d__item"><small>' + t('a.col.customer') + '</small>' + esc(o.customer.name) + '</div>' +
      '<div class="d__item"><small>' + t('a.d.phone') + '</small>' + esc(o.customer.phone) + '</div>' +
      '<div class="d__item"><small>' + t('a.col.country') + '</small>' + flag(o.shipping.country) + ' ' + esc(cname(o.shipping.country, o)) + ' · ' + esc(o.shipping.city) + '</div>' +
      '<div class="d__item"><small>' + t('a.d.email') + '</small>' + (esc(o.customer.email) || '—') + '</div>' +
      (o.color ? '<div class="d__item"><small>' + t('f.color') + '</small>' + esc(o.color) + '</div>' : '') +
      (o.size ? '<div class="d__item"><small>' + t('f.size') + '</small>' + esc(o.size) + '</div>' : '') +
      '<div class="d__item d__item--full"><small>' + t('a.d.address') + '</small>' + esc(o.shipping.address) + '</div>' +
      (o.note ? '<div class="d__item d__item--full"><small>' + t('a.d.note') + '</small>' + esc(o.note) + '</div>' : '') +
      '</div><div class="d__lines">' + lines + '</div>' +
      '<div><small class="muted">' + t('a.d.admin') + '</small><textarea id="adminNote" maxlength="500">' + esc(o.adminNote) + '</textarea></div>' +
      '<div class="d__actions"><button class="btn btn--primary" id="saveNote" type="button">' + t('a.d.save') + '</button>' +
      '<a class="btn" href="https://wa.me/' + esc(digits) + '" target="_blank" rel="noopener">' + t('a.d.whatsapp') + '</a>' +
      '<a class="btn" href="tel:+' + esc(digits) + '">' + t('a.d.call') + '</a>' +
      '<button class="btn btn--danger" id="delOrder" type="button">' + t('a.d.delete') + '</button>' +
      '<button class="btn" id="closeDetail" type="button">' + t('a.d.close') + '</button></div>' +
      '<div><small class="muted">' + t('a.d.history') + '</small><ul class="hist">' + o.history.map(function (h) {
        return '<li>' + dateStr(h.at) + ' — ' + t('a.status.' + h.status) + '</li>';
      }).join('') + '</ul></div></div>';
    const dlg = $('#detail');
    if (!dlg.open) dlg.showModal();
  }
  $('#detail').addEventListener('click', function (e) {
    const dlg = $('#detail');
    if (e.target === dlg || e.target.id === 'closeDetail') { dlg.close(); return; }
    if (e.target.id === 'saveNote') {
      api('PATCH', '/api/admin/orders/' + encodeURIComponent(S.open), { adminNote: $('#adminNote').value }).then(function (d) {
        const i = S.orders.findIndex(function (o) { return o.id === S.open; }); if (i >= 0) S.orders[i] = d.order;
        toast(t('a.d.saved'));
      }).catch(function () {});
    }
    if (e.target.id === 'delOrder' && confirm(t('a.d.confirmDelete'))) {
      api('DELETE', '/api/admin/orders/' + encodeURIComponent(S.open)).then(function (d) {
        S.orders = S.orders.filter(function (o) { return o.id !== S.open; }); applySnap(d);
        dlg.close(); renderAll();
      }).catch(function () {});
    }
  });
  $('#detail').addEventListener('change', function (e) {
    const sel = e.target.closest('[data-status]');
    if (sel) setStatus(sel.dataset.status, sel.value).catch(function () {});
  });
  $('#detail').addEventListener('close', function () { S.open = null; });

  /* ---------- countries & per-country catalogs ---------- */
  function orderCount(code) {
    return S.orders.filter(function (o) { return o.shipping.country === code; }).length;
  }
  function renderCountriesPane() {
    $('#countriesTable tbody').innerHTML = S.countries.length ? S.countries.map(function (c) {
      return '<tr data-code="' + esc(c.code) + '"><td>' + flag(c.code) + ' <b>' + esc(c[i18n.get()]) + '</b><small>' + esc(c.code) + ' · +' + esc(c.dial) + ' · ' + esc(t('a.region.' + c.region)) + '</small></td>' +
        '<td><a href="/' + esc(c.slug) + '" target="_blank" rel="noopener">/' + esc(c.slug) + '</a></td>' +
        '<td>' + esc(c.currency) + '</td><td class="num">' + productsOf(c.code).length + '</td><td class="num">' + orderCount(c.code) + '</td>' +
        '<td><label class="switch"><input type="checkbox" data-toggle="' + esc(c.code) + '"' + (c.active ? ' checked' : '') + '><span>' + (c.active ? t('a.cty.on') : t('a.cty.off')) + '</span></label></td>' +
        '<td class="num"><button class="btn btn--sm" type="button" data-edit="' + esc(c.code) + '">' + t('a.cty.edit') + '</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">' + t('a.cty.empty') + '</td></tr>';
  }
  $('#addCountry').addEventListener('click', function () { openCountry(null); });
  $('#countriesTable').addEventListener('click', function (e) {
    const b = e.target.closest('[data-edit]'); if (b) openCountry(b.dataset.edit);
  });
  $('#countriesTable').addEventListener('change', function (e) {
    const cb = e.target.closest('[data-toggle]'); if (!cb) return;
    api('PUT', '/api/admin/countries/' + encodeURIComponent(cb.dataset.toggle), { active: cb.checked }).then(function (d) {
      applySnap(d); renderAll(); toast(t('a.cty.saved'));
    }).catch(function () { load().catch(function () {}); });
  });

  function field(label, name, value, attrs) {
    return '<label class="fld"><span>' + label + '</span><input name="' + name + '" value="' + esc(value) + '" ' + (attrs || '') + '></label>';
  }
  function openCountry(code) {
    const c = code ? findCountry(code) : null;
    S.editing = c ? c.code : null;
    const cur = c ? c.currency : 'XOF';
    const presets = GS.COUNTRIES.filter(function (p) { return !findCountry(p.code); });
    let h = '<div class="d"><div class="d__head"><h2>' + (c ? flag(c.code) + ' ' + esc(c[i18n.get()]) : t('a.cty.add')) + '</h2>' +
      '<button class="btn btn--sm" type="button" data-act="close">' + t('a.cty.close') + '</button></div>';
    h += '<form id="cform" class="cform" novalidate>';
    if (!c) {
      h += '<label class="fld fld--full"><span>' + t('a.cty.preset') + '</span><select id="preset"><option value="">—</option>' +
        presets.map(function (p) { return '<option value="' + p.code + '">' + flag(p.code) + ' ' + esc(p[i18n.get()]) + '</option>'; }).join('') + '</select></label>';
    }
    h += field(t('a.cty.code'), 'code', c ? c.code : '', 'maxlength="2" required' + (c ? ' readonly' : '')) +
      field(t('a.cty.slug'), 'slug', c ? c.slug : '', 'maxlength="30" required') +
      field(t('a.cty.en'), 'en', c ? c.en : '', 'maxlength="60" required') +
      field(t('a.cty.fr'), 'fr', c ? c.fr : '', 'maxlength="60" required') +
      '<label class="fld"><span>' + t('a.col.currency') + '</span><select name="currency">' + Object.keys(GS.CURRENCIES).map(function (k) {
        return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + k + '</option>';
      }).join('') + '</select></label>' +
      field(t('a.cty.dial'), 'dial', c ? c.dial : '', 'maxlength="4" inputmode="numeric" required') +
      '<label class="fld"><span>' + t('a.cty.region') + '</span><select name="region">' + REGIONS.map(function (r) {
        return '<option value="' + r + '"' + (c && c.region === r ? ' selected' : '') + '>' + t('a.region.' + r) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="fld fld--check"><input type="checkbox" name="active"' + (!c || c.active ? ' checked' : '') + '><span>' + t('a.cty.active') + '</span></label>';
    h += '</form><div class="d__actions"><button class="btn btn--primary" type="button" data-act="saveCountry">' + t('a.cty.save') + '</button>' +
      (c ? '<button class="btn btn--danger" type="button" data-act="delCountry">' + t('a.cty.delete') + '</button>' : '') + '</div>';
    h += '</div>';
    $('#cdlgBody').innerHTML = h;
    const dlg = $('#cdlg'); if (!dlg.open) dlg.showModal();
  }

  function markBad(root, fields) {
    $$('dialog .bad').forEach(function (el) { el.classList.remove('bad'); });
    Object.keys(fields || {}).forEach(function (k) {
      const el = root.querySelector('[name="' + k + '"],[data-f="' + k + '"]'); if (el) el.classList.add('bad');
    });
  }
  function failToast(e) {
    const exists = e.fields && Object.keys(e.fields).some(function (k) { return e.fields[k] === 'exists'; });
    toast(exists ? t('a.cty.exists') : t('a.cty.err'));
  }
  function readCountryForm() {
    const f = $('#cform').elements;
    return { code: f.code.value, slug: f.slug.value, en: f.en.value, fr: f.fr.value, currency: f.currency.value, dial: f.dial.value, region: f.region.value, active: f.active.checked };
  }
  $('#cdlg').addEventListener('change', function (e) {
    if (e.target.id !== 'preset') return;
    const p = GS.country(e.target.value), f = $('#cform').elements;
    if (!p) return;
    f.code.value = p.code; f.slug.value = p.code.toLowerCase(); f.en.value = p.en; f.fr.value = p.fr;
    f.currency.value = p.currency; f.dial.value = p.dial; f.region.value = p.region;
  });
  $('#cdlg').addEventListener('click', function (e) {
    const dlg = $('#cdlg');
    if (e.target === dlg) { dlg.close(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, root = $('#cdlgBody');
    if (act === 'close') { dlg.close(); return; }
    if (act === 'saveCountry') {
      const body = readCountryForm();
      const req = S.editing
        ? api('PUT', '/api/admin/countries/' + encodeURIComponent(S.editing), body)
        : api('POST', '/api/admin/countries', body);
      req.then(function (d) {
        applySnap(d); renderAll(); toast(t('a.cty.saved')); openCountry(d.country.code);
      }).catch(function (x) { if (x.fields) { markBad(root, x.fields); failToast(x); } });
    }
    if (act === 'delCountry' && confirm(t('a.cty.confirmDelete'))) {
      api('DELETE', '/api/admin/countries/' + encodeURIComponent(S.editing)).then(function (d) {
        applySnap(d); dlg.close(); renderAll();
      }).catch(function () {});
    }
  });
  $('#cdlg').addEventListener('close', function () { S.editing = null; });

  /* ---------- shared helpers for categories / products ---------- */
  function countryOptions(selected, placeholder) {
    return '<option value="">' + esc(placeholder) + '</option>' + S.countries.map(function (c) {
      return '<option value="' + esc(c.code) + '"' + (c.code === selected ? ' selected' : '') + '>' + esc((c.flag || flag(c.code)) + ' ' + c[i18n.get()]) + '</option>';
    }).join('');
  }
  function hint(msg) { return '<p class="hintbox">' + esc(msg) + '</p>'; }
  function catName(id) { const c = S.categories.find(function (x) { return x.id === id; }); return c ? c[i18n.get()] : '—'; }
  function skip(el, force) { return !force && el.contains(document.activeElement) && document.activeElement !== document.body; }

  /* ---------- categories (independent list per country) ---------- */
  function renderCategories(force) {
    const body = $('#catBody'); if (skip(body, force)) return;
    if (S.catCountry && !findCountry(S.catCountry)) S.catCountry = '';
    $('#catCountry').innerHTML = countryOptions(S.catCountry, t('a.pick.ph'));
    if (!S.catCountry) { body.innerHTML = hint(t('a.pick.first')); return; }
    const cats = categoriesOf(S.catCountry);
    const inUse = function (id) { return S.products.filter(function (p) { return p.categoryId === id; }).length; };
    body.innerHTML =
      '<div class="crow crow--add"><span>＋</span><input data-n="en" maxlength="60" placeholder="' + esc(t('a.cat.en')) + '"><input data-n="fr" maxlength="60" placeholder="' + esc(t('a.cat.fr')) + '"><span></span>' +
      '<div class="crow__act"><button class="btn btn--primary btn--sm" type="button" data-act="addCat">' + t('a.cat.add') + '</button></div></div>' +
      (cats.length ? cats.map(function (c, i) {
        return '<div class="crow" data-cid="' + esc(c.id) + '"><span class="muted small">' + (i + 1) + '</span>' +
          '<input data-f="en" maxlength="60" value="' + esc(c.en) + '"><input data-f="fr" maxlength="60" value="' + esc(c.fr) + '">' +
          '<label class="switch"><input type="checkbox" data-f="active"' + (c.active ? ' checked' : '') + '><span>' + t('a.cty.on') + '</span></label>' +
          '<div class="crow__act"><span class="muted small">' + t('a.cat.count', { n: inUse(c.id) }) + '</span>' +
          '<button class="btn btn--sm" type="button" data-act="upCat"' + (i === 0 ? ' disabled' : '') + ' aria-label="up">↑</button>' +
          '<button class="btn btn--sm" type="button" data-act="downCat"' + (i === cats.length - 1 ? ' disabled' : '') + ' aria-label="down">↓</button>' +
          '<button class="btn btn--primary btn--sm" type="button" data-act="saveCat">' + t('a.cat.save') + '</button>' +
          '<button class="btn btn--danger btn--sm" type="button" data-act="delCat">' + t('a.cat.delete') + '</button></div></div>';
      }).join('') : hint(t('a.cat.empty')));
  }
  $('#catCountry').addEventListener('change', function (e) { S.catCountry = e.target.value; renderCategories(true); });
  $('#catBody').addEventListener('click', function (e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, row = b.closest('[data-cid]');
    const done = function (d) { applySnap(d); renderAll(); renderCategories(true); };
    if (act === 'addCat') {
      const box = b.closest('.crow');
      api('POST', '/api/admin/categories', { countryCode: S.catCountry, en: box.querySelector('[data-n=en]').value, fr: box.querySelector('[data-n=fr]').value })
        .then(function (d) { done(d); toast(t('a.cat.saved')); })
        .catch(function (x) { if (x.fields) { box.querySelectorAll('input').forEach(function (i) { i.classList.toggle('bad', !i.value.trim()); }); toast(t('a.cty.err')); } });
      return;
    }
    if (!row) return;
    const id = row.dataset.cid;
    if (act === 'saveCat') {
      api('PUT', '/api/admin/categories/' + encodeURIComponent(id), { en: row.querySelector('[data-f=en]').value, fr: row.querySelector('[data-f=fr]').value, active: row.querySelector('[data-f=active]').checked })
        .then(function (d) { done(d); toast(t('a.cat.saved')); })
        .catch(function (x) { if (x.fields) { toast(t('a.cty.err')); } });
    }
    if (act === 'delCat' && confirm(t('a.cat.confirmDelete'))) {
      api('DELETE', '/api/admin/categories/' + encodeURIComponent(id)).then(done)
        .catch(function (x) { if (x.status === 409) toast(t('a.cat.inuse')); });
    }
    if (act === 'upCat' || act === 'downCat') {
      const ids = categoriesOf(S.catCountry).map(function (c) { return c.id; });
      const i = ids.indexOf(id), j = act === 'upCat' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      ids[i] = ids[j]; ids[j] = id;
      api('POST', '/api/admin/categories/reorder', { countryCode: S.catCountry, ids: ids }).then(done).catch(function () {});
    }
  });

  /* ---------- products (country first, then that country's categories) ---------- */
  function renderProducts(force) {
    const body = $('#prodBody'); if (skip(body, force)) return;
    if (S.prodCountry && !findCountry(S.prodCountry)) S.prodCountry = '';
    $('#prodCountry').innerHTML = countryOptions(S.prodCountry, t('a.pick.ph'));
    $('#addProduct').disabled = !S.prodCountry;
    if (!S.prodCountry) { body.innerHTML = hint(t('a.pick.first')); return; }
    const c = findCountry(S.prodCountry), list = productsOf(S.prodCountry);
    body.innerHTML = list.length ? '<div class="tablewrap"><table class="table"><thead><tr><th>' + t('a.prod.name') + '</th><th>' + t('a.prod.category') + '</th><th class="num">' +
      t('a.prod.price') + ' (' + esc(c.currency) + ')</th><th class="num">' + t('a.prod.stock') + '</th><th>' + t('a.cty.status') + '</th><th></th></tr></thead><tbody>' +
      list.map(function (p) {
        return '<tr><td>' + (p.image ? '<img class="pimg" src="' + esc(p.image) + '" alt=""> ' : '') + '<b>' + esc(p.name) + '</b><small>/' + esc(c.slug) + '/' + esc(p.id) + (p.colorOptions ? ' · ' + t('f.color') : '') + '</small></td>' +
          '<td>' + esc(catName(p.categoryId)) + '</td><td class="num">' + loc(p.price, c.currency) + '</td><td class="num">' + p.stock + '</td>' +
          '<td><label class="switch"><input type="checkbox" data-ptoggle="' + esc(p.id) + '"' + (p.active ? ' checked' : '') + '><span>' + (p.active ? t('a.cty.on') : t('a.cty.off')) + '</span></label></td>' +
          '<td class="num"><button class="btn btn--sm" type="button" data-pedit="' + esc(p.id) + '">' + t('a.cty.edit') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' : hint(t('a.prod.empty'));
  }
  $('#prodCountry').addEventListener('change', function (e) { S.prodCountry = e.target.value; renderProducts(true); });
  $('#addProduct').addEventListener('click', function () { if (S.prodCountry) openProduct({ code: S.prodCountry, id: null }); });
  $('#prodBody').addEventListener('click', function (e) {
    const b = e.target.closest('[data-pedit]'); if (b) openProduct({ code: S.prodCountry, id: b.dataset.pedit });
  });
  $('#prodBody').addEventListener('change', function (e) {
    const cb = e.target.closest('[data-ptoggle]'); if (!cb) return;
    api('PUT', '/api/admin/products/' + encodeURIComponent(S.prodCountry) + '/' + encodeURIComponent(cb.dataset.ptoggle), { active: cb.checked })
      .then(function (d) { applySnap(d); renderAll(); renderProducts(true); toast(t('a.prod.saved')); })
      .catch(function () { load().catch(function () {}); });
  });

  function categoryOptions(code, selected) {
    const cats = categoriesOf(code);
    return '<option value="">' + esc(cats.length ? t('a.prod.category.ph') : t('a.prod.category.none')) + '</option>' + cats.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c[i18n.get()]) + (c.active ? '' : ' (' + t('a.cty.off') + ')') + '</option>';
    }).join('');
  }

  /* ---------- product editor: landing page builder (media upload, variants, offers) ---------- */
  const MAX_IMG = 8 * 1024 * 1024;
  let draft = null, uploadTarget = null;

  function blankDraft(code) {
    const c = findCountry(code) || { currency: 'EUR' };
    return Object.assign(GS.defaultProduct(c.currency, S.rates), {
      id: '', name: '', rich: false, stock: 0, categoryId: '', description: '', image: '', gallery: [], colorOptions: false,
      nameFr: '', descriptionFr: '', imageFr: '', galleryFr: [],
      sizesEnabled: false, sizes: ['S', 'M', 'L', 'XL'], bundles: [], crossSellIds: [], landing: [], active: true
    });
  }
  function copyDraft(p) { return JSON.parse(JSON.stringify(p)); }
  // French version: only for francophone countries (their product pages are shown in French)
  function draftCode() { const f = $('#pform'); return (f && f.elements.countryCode && f.elements.countryCode.value) || (S.editingProduct && S.editingProduct.code) || ''; }
  function isFr() { return GS.isFrancophone(draftCode()); }
  function normFr() {
    if (!draft) return;
    draft.nameFr = draft.nameFr || ''; draft.descriptionFr = draft.descriptionFr || ''; draft.imageFr = draft.imageFr || '';
    draft.galleryFr = Array.isArray(draft.galleryFr) ? draft.galleryFr : [];
    while (draft.galleryFr.length < draft.gallery.length) draft.galleryFr.push('');
    draft.galleryFr.length = draft.gallery.length;
  }

  // upload one file from this computer; the server keeps it on the persistent disk
  function uploadFile(file) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > MAX_IMG) return Promise.reject(new Error('rejected'));
    return fetch('/api/admin/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + S.token, 'Content-Type': file.type }, body: file })
      .then(function (r) {
        if (r.status === 401) { logout(); throw new Error('unauthorized'); }
        return r.json().then(function (d) { if (!r.ok) throw new Error('rejected'); return d.url; });
      });
  }
  function pickFiles(target, multiple) {
    uploadTarget = target;
    const inp = $('#fileInput'); inp.multiple = !!multiple; inp.click();
  }
  $('#fileInput').addEventListener('change', function (e) {
    const files = Array.from(e.target.files || []); e.target.value = '';
    const target = uploadTarget; if (!files.length || !target || !draft) return;
    syncDraft();
    toast(t('a.m.uploading'));
    files.reduce(function (chain, file) {
      return chain.then(function () {
        return uploadFile(file).then(function (url) {
          normFr();
          if (target.kind === 'primary') draft.image = url;
          else if (target.kind === 'gallery') { if (draft.gallery.length < 8) { draft.gallery.push(url); draft.galleryFr.push(''); } }
          else if (target.kind === 'block' && draft.landing[target.index]) draft.landing[target.index].media = url;
          else if (target.kind === 'primaryFr') draft.imageFr = url;
          else if (target.kind === 'galleryFr' && draft.gallery[target.index]) draft.galleryFr[target.index] = url;
          else if (target.kind === 'blockFr' && draft.landing[target.index]) draft.landing[target.index].mediaFr = url;
        });
      });
    }, Promise.resolve()).then(function () { renderMediaEditor(); renderBlocksEditor(); toast(t('a.m.uploaded')); })
      .catch(function () { renderMediaEditor(); renderBlocksEditor(); toast(t('a.m.uploadErr')); });
  });

  function thumb(url) {
    return '<div class="mthumb">' + (url ? '<img src="' + esc(url) + '" alt="">' : '<span class="mph">＋</span>') + '</div>';
  }
  function renderMediaEditor() {
    if (!draft) return;
    $('#mMedia').innerHTML =
      '<div class="mrow">' + thumb(draft.image) + '<div class="mact"><b>' + t('a.m.primary') + '</b>' +
      '<div><button type="button" class="btn btn--sm" data-act="pickPrimary">' + (draft.image ? t('a.m.replace') : t('a.m.upload')) + '</button>' +
      (draft.image ? ' <button type="button" class="btn btn--sm btn--danger" data-act="rmPrimary">' + t('a.m.remove') + '</button>' : '') + '</div></div></div>' +
      '<div class="mgal">' + draft.gallery.map(function (u, i) {
        return '<div class="mthumb">' + '<img src="' + esc(u) + '" alt=""><button type="button" class="mthumb__x" data-act="rmGallery" data-i="' + i + '" aria-label="remove">×</button></div>';
      }).join('') + (draft.gallery.length < 8 ? '<button type="button" class="mthumb mthumb--add" data-act="pickGallery">＋<small>' + t('a.m.addImages') + '</small></button>' : '') + '</div>';
    renderFrMedia();
  }
  // French versions of the images (francophone countries only): upload one, or let Gemini translate the text inside the original
  function frButtons(kind, i, src, fr) {
    return '<button type="button" class="btn btn--sm" data-act="pickFr" data-k="' + kind + '" data-i="' + i + '">' + (fr ? t('a.m.replace') : t('a.m.upload')) + '</button> ' +
      (src ? '<button type="button" class="btn btn--sm btn--primary" data-act="trImg" data-k="' + kind + '" data-i="' + i + '">' + t('a.fr.trImg') + '</button> ' : '') +
      (fr ? '<button type="button" class="btn btn--sm btn--danger" data-act="rmFr" data-k="' + kind + '" data-i="' + i + '">' + t('a.m.remove') + '</button>' : '');
  }
  function renderFrMedia() {
    const el = $('#mMediaFr'); if (!el) return;
    el.hidden = !isFr();
    if (el.hidden || !draft) { el.innerHTML = ''; return; }
    normFr();
    let h = '<h4>' + t('a.fr.media') + '</h4><div class="mrow">' + thumb(draft.imageFr) + '<div class="mact"><b>' + t('a.m.primary') + '</b><div>' + frButtons('primary', 0, draft.image, draft.imageFr) + '</div></div></div>';
    draft.gallery.forEach(function (u, i) {
      h += '<div class="mrow"><div class="mthumb"><img src="' + esc(u) + '" alt=""></div>' + thumb(draft.galleryFr[i]) +
        '<div class="mact"><b>#' + (i + 1) + '</b><div>' + frButtons('gallery', i, u, draft.galleryFr[i]) + '</div></div></div>';
    });
    el.innerHTML = h;
  }
  function renderBundlesEditor() {
    if (!draft) return;
    $('#mBundles').innerHTML = draft.bundles.map(function (b, i) {
      return '<div class="brow" data-brow="' + i + '">' +
        '<label class="fld"><span>' + t('a.m.bundles.qty') + '</span><input type="number" min="1" max="10" step="1" data-b="qty" value="' + esc(b.qty) + '"></label>' +
        '<label class="fld"><span>' + t('a.m.bundles.off') + '</span><input type="number" min="0" max="90" step="1" data-b="off" value="' + esc(b.off) + '"></label>' +
        '<label class="fld"><span>' + t('a.m.bundles.label') + '</span><input maxlength="30" data-b="label" value="' + esc(b.label) + '"></label>' +
        '<button type="button" class="btn btn--sm btn--danger" data-act="rmBundle" data-i="' + i + '">×</button></div>';
    }).join('') + (draft.bundles.length < 6 ? '<button type="button" class="btn btn--sm" data-act="addBundle">' + t('a.m.bundles.add') + '</button>' : '');
  }
  function renderCrossEditor(code) {
    if (!draft) return;
    const others = S.products.filter(function (p) { return p.countryCode === code && p.id !== draft.id; });
    const cur = (findCountry(code) || { currency: 'EUR' }).currency;
    $('#mCross').innerHTML = others.length ? others.map(function (p) {
      return '<label class="xrow"><input type="checkbox" data-cross="' + esc(p.id) + '"' + (draft.crossSellIds.indexOf(p.id) >= 0 ? ' checked' : '') + '>' +
        '<span>' + esc(p.name) + '</span><small class="muted">' + loc(p.price, cur) + '</small></label>';
    }).join('') : '<p class="muted small">' + t('a.m.cross.none') + '</p>';
  }
  function renderBlocksEditor() {
    if (!draft) return;
    $('#mBlocks').innerHTML = draft.landing.map(function (b, i) {
      return '<div class="lrow" data-lrow="' + i + '"><div class="lrow__media">' + thumb(b.media) +
        '<div><button type="button" class="btn btn--sm" data-act="pickBlock" data-i="' + i + '">' + (b.media ? t('a.m.replace') : t('a.m.upload')) + '</button>' +
        (b.media ? ' <button type="button" class="btn btn--sm btn--danger" data-act="rmBlockMedia" data-i="' + i + '">' + t('a.m.remove') + '</button>' : '') + '</div></div>' +
        '<div class="lrow__text"><label class="fld"><span>' + t('a.m.landing.heading') + '</span><input maxlength="120" data-l="title" value="' + esc(b.title) + '"></label>' +
        '<label class="fld"><span>' + t('a.m.landing.text') + '</span><textarea maxlength="1500" data-l="text">' + esc(b.text) + '</textarea></label></div>' +
        (isFr() ? '<div class="lrow__fr"><b>' + t('a.fr.badge') + '</b><div class="lrow__frmedia">' + thumb(b.mediaFr) + '<div>' + frButtons('block', i, b.media, b.mediaFr) + '</div></div>' +
          '<label class="fld"><span>' + t('a.m.landing.heading') + '</span><input maxlength="120" data-l="titleFr" value="' + esc(b.titleFr || '') + '"></label>' +
          '<label class="fld"><span>' + t('a.m.landing.text') + '</span><textarea maxlength="1500" data-l="textFr">' + esc(b.textFr || '') + '</textarea></label></div>' : '') +
        '<div class="lrow__act"><button type="button" class="btn btn--sm" data-act="upBlock" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn btn--sm" data-act="downBlock" data-i="' + i + '"' + (i === draft.landing.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn btn--sm btn--danger" data-act="rmBlock" data-i="' + i + '">×</button></div></div>';
    }).join('') + (draft.landing.length < 12 ? '<button type="button" class="btn btn--sm" data-act="addBlock">' + t('a.m.landing.add') + '</button>' : '');
  }
  // copy what has been typed in the repeating rows back into the draft before any re-render
  function syncDraft() {
    if (!draft) return;
    $$('#mBundles [data-brow]').forEach(function (row) {
      const b = draft.bundles[Number(row.dataset.brow)]; if (!b) return;
      b.qty = row.querySelector('[data-b=qty]').value; b.off = row.querySelector('[data-b=off]').value; b.label = row.querySelector('[data-b=label]').value;
    });
    $$('#mBlocks [data-lrow]').forEach(function (row) {
      const b = draft.landing[Number(row.dataset.lrow)]; if (!b) return;
      b.title = row.querySelector('[data-l=title]').value; b.text = row.querySelector('[data-l=text]').value;
      const tf = row.querySelector('[data-l=titleFr]'), xf = row.querySelector('[data-l=textFr]');
      if (tf) b.titleFr = tf.value;
      if (xf) b.textFr = xf.value;
    });
    const nf = $('#nameFr'), df = $('#descFr');
    if (nf) draft.nameFr = nf.value;
    if (df) draft.descriptionFr = df.value;
  }

  function trError(e) {
    const m = e && e.message;
    toast(t(m === 'no_anthropic_key' ? 'a.fr.noAnthropic' : m === 'no_gemini_key' ? 'a.fr.noGemini' : m === 'gif' ? 'a.fr.gif' : 'a.fr.err'));
  }
  // fills the empty French text fields with a Claude translation of the originals
  function translateTexts(btn) {
    syncDraft();
    const slots = [];
    const add = function (src, cur, set) { if (String(src || '').trim() && !String(cur || '').trim()) slots.push({ src: src, set: set }); };
    const f = $('#pform').elements;
    add(f.name.value, draft.nameFr, function (v) { draft.nameFr = v; });
    add(f.description.value, draft.descriptionFr, function (v) { draft.descriptionFr = v; });
    draft.landing.forEach(function (x) {
      add(x.title, x.titleFr, function (v) { x.titleFr = v; });
      add(x.text, x.textFr, function (v) { x.textFr = v; });
    });
    if (!slots.length) { toast(t('a.fr.nothing')); return; }
    btn.disabled = true; toast(t('a.fr.translating'));
    api('POST', '/api/admin/translate', { items: slots.map(function (x) { return x.src; }) }).then(function (d) {
      if (!draft) return;
      slots.forEach(function (x, n) { x.set(d.items[n]); });
      $('#nameFr').value = draft.nameFr; $('#descFr').value = draft.descriptionFr;
      renderBlocksEditor(); toast(t('a.fr.done'));
    }).catch(trError).then(function () { btn.disabled = false; });
  }
  // asks Gemini to redraw each image with its English text translated to French (one at a time)
  function translateImages(btn, jobs) {
    syncDraft(); normFr();
    const srcOf = function (j) { return j.k === 'primary' ? draft.image : j.k === 'gallery' ? draft.gallery[j.i] : (draft.landing[j.i] || {}).media; };
    const todo = jobs.filter(srcOf);
    if (!todo.length) { toast(t('a.fr.nothing')); return Promise.resolve(); }
    btn.disabled = true;
    let done = 0, failed = null;
    return todo.reduce(function (chain, j) {
      return chain.then(function () {
        if (!draft) return;
        toast(t('a.fr.translatingImg', { n: done + 1, total: todo.length }));
        return api('POST', '/api/admin/translate-image', { url: srcOf(j) }).then(function (d) {
          if (!draft) return;
          if (j.k === 'primary') draft.imageFr = d.url; else if (j.k === 'gallery') draft.galleryFr[j.i] = d.url; else draft.landing[j.i].mediaFr = d.url;
          done++; syncDraft(); renderMediaEditor(); renderBlocksEditor();
        }).catch(function (e) { failed = failed || e; });
      });
    }, Promise.resolve()).then(function () {
      btn.disabled = false;
      if (failed) trError(failed); else toast(t('a.fr.doneImg', { n: done }));
    });
  }

  function openProduct(ref) {
    S.editingProduct = ref;
    const p = ref.id ? S.products.find(function (x) { return x.countryCode === ref.code && x.id === ref.id; }) : null;
    if (ref.id && !p) return;
    draft = p ? copyDraft(p) : blankDraft(ref.code);
    const c = findCountry(ref.code) || { currency: 'EUR', slug: '' };
    const base = draft;
    const num = function (label, key, val, step) {
      return '<label class="fld"><span>' + label + '</span><input name="' + key + '" type="number" min="0" step="' + step + '" value="' + esc(val) + '"></label>';
    };
    const section = function (title, hintKey, inner) {
      return '<section class="msec"><h3>' + title + '</h3>' + (hintKey ? '<p class="muted small">' + t(hintKey) + '</p>' : '') + inner + '</section>';
    };
    $('#pdlgBody').innerHTML = '<div class="d"><div class="d__head"><h2>' + (p ? esc(p.name) : t('a.prod.new')) + '</h2><div class="d__head-act">' +
      (p ? '<a class="btn btn--sm" target="_blank" rel="noopener" href="/' + esc(c.slug) + '/' + esc(p.id) + '">' + t('a.m.preview') + '</a> ' : '') +
      '<button class="btn btn--sm" type="button" data-act="close">' + t('a.cty.close') + '</button></div></div>' +
      '<form id="pform" class="pform" novalidate>' +
      '<label class="fld"><span>' + t('a.prod.country') + '</span><select name="countryCode"' + (p ? ' disabled title="' + esc(t('a.prod.locked')) + '"' : '') + '>' + countryOptions(ref.code, t('a.pick.ph')) + '</select></label>' +
      '<label class="fld"><span>' + t('a.prod.category') + '</span><select name="categoryId">' + categoryOptions(ref.code, base.categoryId) + '</select></label>' +
      '<label class="fld fld--full"><span>' + t('a.prod.name') + '</span><input name="name" maxlength="80" value="' + esc(base.name) + '"></label>' +
      '<label class="fld fld--full"><span>' + t('a.prod.desc') + '</span><textarea name="description" maxlength="2000">' + esc(base.description) + '</textarea></label>' +
      '<label class="fld fld--check fld--full"><input type="checkbox" name="active"' + (base.active ? ' checked' : '') + '><span>' + t('a.m.published') + '</span></label>' +
      num(t('a.prod.price') + ' (<b id="pcur">' + esc(c.currency) + '</b>)', 'price', base.price, 'any') + num(t('a.prod.compare'), 'compare', base.compare, 'any') +
      num(t('a.prod.shipping'), 'shipping', base.shipping, 'any') + num(t('a.prod.free'), 'freeShippingQty', base.freeShippingQty, '1') +
      num(t('a.prod.stock'), 'stock', base.stock, '1') + '</form>' +
      '<section class="msec msec--fr" id="frSec" hidden><h3>🇫🇷 ' + t('a.fr.title') + '</h3><p class="muted small">' + t('a.fr.hint') + '</p>' +
        '<div class="fr__act"><button type="button" class="btn btn--sm btn--primary" data-act="trTexts">' + t('a.fr.trTexts') + '</button> ' +
        '<button type="button" class="btn btn--sm btn--primary" data-act="trAllImgs">' + t('a.fr.trAllImgs') + '</button></div>' +
        '<label class="fld fld--full"><span>' + t('a.prod.name') + ' (FR)</span><input id="nameFr" maxlength="80" value="' + esc(base.nameFr || '') + '"></label>' +
        '<label class="fld fld--full"><span>' + t('a.prod.desc') + ' (FR)</span><textarea id="descFr" maxlength="2000">' + esc(base.descriptionFr || '') + '</textarea></label></section>' +
      section(t('a.m.media'), 'a.m.media.hint', '<div class="mbox" id="mMedia" data-f="image"></div><div class="mbox mbox--fr" id="mMediaFr" hidden></div>') +
      section(t('a.m.variants'), null,
        '<div class="vgrid"><label class="fld fld--check"><input type="checkbox" id="sizesOn"' + (base.sizesEnabled ? ' checked' : '') + '><span>' + t('a.m.sizes.enable') + '</span></label>' +
        '<label class="fld"><span>' + t('a.m.sizes.list') + '</span><input id="sizesList" maxlength="80" value="' + esc(base.sizes.join(', ')) + '"' + (base.sizesEnabled ? '' : ' disabled') + ' data-f="sizes"></label>' +
        '<label class="fld fld--check"><input type="checkbox" id="colorsOn"' + (base.colorOptions ? ' checked' : '') + '><span>' + t('a.prod.colors') + '</span></label></div>') +
      section(t('a.m.bundles.title'), 'a.m.bundles.hint', '<div class="mbox" id="mBundles" data-f="bundles"></div>') +
      section(t('a.m.cross.title'), 'a.m.cross.hint', '<div class="mbox" id="mCross" data-f="crossSellIds"></div>') +
      section(t('a.m.landing.title'), 'a.m.landing.hint', '<div class="mbox" id="mBlocks" data-f="landing"></div>') +
      '<p class="muted small">' + t('a.prod.hint', { cur: esc(c.currency) }) + '</p>' +
      '<div class="d__actions"><button class="btn btn--primary" type="button" data-act="saveProduct">' + t('a.prod.save') + '</button>' +
      (p ? '<button class="btn btn--danger" type="button" data-act="delProduct">' + t('a.prod.delete') + '</button>' : '') + '</div></div>';
    normFr(); $('#frSec').hidden = !isFr();
    renderMediaEditor(); renderBundlesEditor(); renderCrossEditor(ref.code); renderBlocksEditor();
    const dlg = $('#pdlg'); if (!dlg.open) dlg.showModal();
  }

  $('#pdlg').addEventListener('change', function (e) {
    const el = e.target;
    if (el.name === 'countryCode') {
      // choosing the country loads that country's own categories, currency and complementary products
      syncDraft();
      const code = el.value, f = $('#pform').elements, c = findCountry(code);
      f.categoryId.innerHTML = categoryOptions(code, '');
      $('#pcur').textContent = c ? c.currency : '';
      draft.crossSellIds = [];
      renderCrossEditor(code);
      $('#frSec').hidden = !isFr(); renderMediaEditor(); renderBlocksEditor();
      if (c && S.editingProduct && !S.editingProduct.id) {
        const d = GS.defaultProduct(c.currency, S.rates);
        f.price.value = d.price; f.compare.value = d.compare; f.shipping.value = d.shipping;
      }
    }
    if (el.id === 'sizesOn') $('#sizesList').disabled = !el.checked;
    if (el.dataset && el.dataset.cross && draft) {
      const i = draft.crossSellIds.indexOf(el.dataset.cross);
      if (el.checked && i < 0) draft.crossSellIds.push(el.dataset.cross);
      if (!el.checked && i >= 0) draft.crossSellIds.splice(i, 1);
    }
  });
  $('#pdlg').addEventListener('click', function (e) {
    const dlg = $('#pdlg');
    if (e.target === dlg) { dlg.close(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, ref = S.editingProduct, i = Number(b.dataset.i);
    if (act === 'close') { dlg.close(); return; }
    if (!draft) return;
    const edit = function (fn) { syncDraft(); normFr(); fn(); normFr(); renderMediaEditor(); renderBundlesEditor(); renderBlocksEditor(); };
    const frSet = function (k, n, u) { if (k === 'primary') draft.imageFr = u; else if (k === 'gallery') draft.galleryFr[n] = u; else draft.landing[n].mediaFr = u; };
    if (act === 'pickFr') return pickFiles({ kind: b.dataset.k === 'primary' ? 'primaryFr' : b.dataset.k === 'gallery' ? 'galleryFr' : 'blockFr', index: i }, false);
    if (act === 'rmFr') return edit(function () { frSet(b.dataset.k, i, ''); });
    if (act === 'trTexts') return translateTexts(b);
    if (act === 'trImg') return translateImages(b, [{ k: b.dataset.k, i: i }]);
    if (act === 'trAllImgs') {
      syncDraft(); normFr();
      const jobs = [];
      if (draft.image && !draft.imageFr) jobs.push({ k: 'primary', i: 0 });
      draft.gallery.forEach(function (u, n) { if (u && !draft.galleryFr[n]) jobs.push({ k: 'gallery', i: n }); });
      draft.landing.forEach(function (x, n) { if (x.media && !x.mediaFr) jobs.push({ k: 'block', i: n }); });
      return translateImages(b, jobs);
    }
    if (act === 'pickPrimary') return pickFiles({ kind: 'primary' }, false);
    if (act === 'rmPrimary') return edit(function () { draft.image = ''; });
    if (act === 'pickGallery') return pickFiles({ kind: 'gallery' }, true);
    if (act === 'rmGallery') return edit(function () { draft.gallery.splice(i, 1); draft.galleryFr.splice(i, 1); });
    if (act === 'addBundle') return edit(function () { draft.bundles.push({ qty: draft.bundles.length ? Number(draft.bundles[draft.bundles.length - 1].qty) + 1 : 2, off: 10, label: '' }); });
    if (act === 'rmBundle') return edit(function () { draft.bundles.splice(i, 1); });
    if (act === 'addBlock') return edit(function () { draft.landing.push({ title: '', text: '', media: '' }); });
    if (act === 'rmBlock') return edit(function () { draft.landing.splice(i, 1); });
    if (act === 'rmBlockMedia') return edit(function () { draft.landing[i].media = ''; });
    if (act === 'pickBlock') return pickFiles({ kind: 'block', index: i }, false);
    if (act === 'upBlock' || act === 'downBlock') {
      return edit(function () {
        const j = act === 'upBlock' ? i - 1 : i + 1;
        if (j >= 0 && j < draft.landing.length) { const x = draft.landing[i]; draft.landing[i] = draft.landing[j]; draft.landing[j] = x; }
      });
    }
    if (act === 'saveProduct') {
      syncDraft();
      const f = $('#pform').elements;
      const body = {
        categoryId: f.categoryId.value, name: f.name.value, description: f.description.value, active: f.active.checked,
        nameFr: draft.nameFr || '', descriptionFr: draft.descriptionFr || '', imageFr: draft.imageFr || '', galleryFr: draft.galleryFr || [],
        image: draft.image, gallery: draft.gallery, colorOptions: $('#colorsOn').checked, sizesEnabled: $('#sizesOn').checked, sizes: $('#sizesList').value,
        bundles: draft.bundles.map(function (x) { return { qty: x.qty, off: x.off, label: x.label }; }), crossSellIds: draft.crossSellIds, landing: draft.landing,
        price: f.price.value, compare: f.compare.value, shipping: f.shipping.value, freeShippingQty: f.freeShippingQty.value, stock: f.stock.value
      };
      if (!ref.id) body.countryCode = f.countryCode.value;
      const req = ref.id
        ? api('PUT', '/api/admin/products/' + encodeURIComponent(ref.code) + '/' + encodeURIComponent(ref.id), body)
        : api('POST', '/api/admin/products', body);
      req.then(function (d) {
        applySnap(d);
        if (!ref.id) S.prodCountry = d.product.countryCode;
        dlg.close(); renderAll(); renderProducts(true); toast(t('a.prod.saved'));
      }).catch(function (x) { if (x.fields) { markBad(dlg, x.fields); failToast(x); } });
    }
    if (act === 'delProduct' && confirm(t('a.prod.confirmDelete'))) {
      api('DELETE', '/api/admin/products/' + encodeURIComponent(ref.code) + '/' + encodeURIComponent(ref.id)).then(function (d) {
        applySnap(d); dlg.close(); renderAll(); renderProducts(true);
      }).catch(function () {});
    }
  });
  $('#pdlg').addEventListener('close', function () { S.editingProduct = null; draft = null; });

  /* ---------- CSV export ---------- */
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  $('#export').addEventListener('click', function () {
    const head = ['id', 'date', 'status', 'name', 'phone', 'email', 'region', 'country', 'city', 'address', 'product', 'color', 'size', 'addons', 'qty', 'extras', 'currency', 'total_local', 'total_eur', 'note'];
    const rows = filtered().map(function (o) {
      return [o.id, o.createdAt, o.status, o.customer.name, o.customer.phone, o.customer.email, o.shipping.region, o.shipping.country,
        o.shipping.city, o.shipping.address, o.productName || '', o.color || '', o.size || '', (o.addons || []).map(function (x) { return x.name; }).join('+'), o.qty, o.cross.join('+'), o.currency, o.amounts.total, o.totalEUR, o.note].map(cell).join(',');
    });
    const blob = new Blob(['﻿' + [head.join(',')].concat(rows).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'orders-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* ---------- boot ---------- */
  function renderAll() {
    fillFilters(); renderKpis(); renderChart(); renderRegions(); renderCountryTable(); renderSettings(); renderOrders(); renderCountriesPane(); renderCategories(); renderProducts();
  }
  function paintLang() {
    i18n.apply(); filterSig = '';
    $$('[data-lang]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === i18n.get()); });
    if (!$('#app').hidden) {
      renderAll();
      if (S.open) openDetail(S.open);
      if (S.editing) openCountry(S.editing);
      if (S.editingProduct) openProduct(S.editingProduct);
    }
  }
  $$('[data-lang]').forEach(function (b) { b.addEventListener('click', function () { i18n.set(b.dataset.lang); }); });
  document.addEventListener('langchange', paintLang);

  paintLang();
  showTab(S.tab);
  if (S.token) { showApp(true); load().catch(function () { /* logout handled in api() */ }); }
  setInterval(function () {
    if (S.token && !$('#app').hidden && !$('#detail').open && !$('#cdlg').open && !$('#pdlg').open) load().catch(function () {});
  }, 30000);
})();
