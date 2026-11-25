(function () {
  'use strict';
  const t = i18n.t;
  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.from(document.querySelectorAll(s)); };
  const REGIONS = ['central', 'africa', 'eeurope', 'other'];
  const INACTIVE = ['cancelled', 'returned'];

  const S = { token: null, orders: [], countries: [], rates: {}, open: null, editing: null, tab: 'dashboard' };
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
      S.orders = d.orders; S.rates = d.rates || {}; S.countries = d.countries || [];
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
      S.countries = d.countries || S.countries; renderAll();
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
        S.orders = S.orders.filter(function (o) { return o.id !== S.open; }); S.countries = d.countries || S.countries;
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
        '<td>' + esc(c.currency) + '</td><td class="num">' + c.products.length + '</td><td class="num">' + orderCount(c.code) + '</td>' +
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
      S.countries = d.countries; renderAll(); toast(t('a.cty.saved'));
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
    if (c) h += catalogHTML(c);
    h += '</div>';
    $('#cdlgBody').innerHTML = h;
    const dlg = $('#cdlg'); if (!dlg.open) dlg.showModal();
  }

  function catalogHTML(c) {
    let h = '<div class="catalog"><div class="panel__head"><h3>' + t('a.prod.title') + '</h3>' +
      '<button class="btn btn--sm" type="button" data-act="addProduct">' + t('a.prod.add') + '</button></div>' +
      '<p class="muted small">' + t('a.prod.hint', { cur: esc(c.currency) }) + '</p>';
    h += c.products.map(function (p) {
      const f = function (label, key, val, step) {
        return '<label class="fld"><span>' + label + '</span><input data-f="' + key + '" type="number" min="0" step="' + step + '" value="' + esc(val) + '"></label>';
      };
      return '<div class="prow" data-pid="' + esc(p.id) + '">' +
        '<label class="fld fld--full"><span>' + t('a.prod.name') + '</span><input data-f="name" maxlength="80" value="' + esc(p.name) + '"></label>' +
        f(t('a.prod.price'), 'price', p.price, 'any') + f(t('a.prod.compare'), 'compare', p.compare, 'any') +
        f(t('a.prod.shipping'), 'shipping', p.shipping, 'any') + f(t('a.prod.free'), 'freeShippingQty', p.freeShippingQty, '1') +
        f(t('a.prod.stock'), 'stock', p.stock, '1') +
        '<label class="fld fld--check"><input type="checkbox" data-f="active"' + (p.active ? ' checked' : '') + '><span>' + t('a.prod.active') + '</span></label>' +
        '<div class="prow__act"><button class="btn btn--primary btn--sm" type="button" data-act="saveProduct">' + t('a.prod.save') + '</button>' +
        '<button class="btn btn--danger btn--sm" type="button" data-act="delProduct">' + t('a.prod.delete') + '</button></div></div>';
    }).join('');
    return h + '</div>';
  }

  function markBad(root, fields) {
    $$('#cdlg .bad').forEach(function (el) { el.classList.remove('bad'); });
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
  function readProductRow(row) {
    const o = {};
    $$('#cdlg [data-pid="' + row.dataset.pid + '"] [data-f]').forEach(function (el) {
      o[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return o;
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
        S.countries = d.countries; renderAll(); toast(t('a.cty.saved')); openCountry(d.country.code);
      }).catch(function (x) { if (x.fields) { markBad(root, x.fields); failToast(x); } });
    }
    if (act === 'delCountry' && confirm(t('a.cty.confirmDelete'))) {
      api('DELETE', '/api/admin/countries/' + encodeURIComponent(S.editing)).then(function (d) {
        S.countries = d.countries; dlg.close(); renderAll();
      }).catch(function () {});
    }
    if (act === 'addProduct') {
      api('POST', '/api/admin/countries/' + encodeURIComponent(S.editing) + '/products', {}).then(function (d) {
        S.countries = d.countries; renderAll(); openCountry(S.editing);
      }).catch(function () {});
    }
    const row = b.closest('.prow');
    if (act === 'saveProduct' && row) {
      api('PUT', '/api/admin/countries/' + encodeURIComponent(S.editing) + '/products/' + encodeURIComponent(row.dataset.pid), readProductRow(row)).then(function (d) {
        S.countries = d.countries; renderAll(); toast(t('a.prod.saved'));
      }).catch(function (x) { if (x.fields) { markBad(row, x.fields); failToast(x); } });
    }
    if (act === 'delProduct' && row && confirm(t('a.prod.confirmDelete'))) {
      api('DELETE', '/api/admin/countries/' + encodeURIComponent(S.editing) + '/products/' + encodeURIComponent(row.dataset.pid)).then(function (d) {
        S.countries = d.countries; renderAll(); openCountry(S.editing);
      }).catch(function () {});
    }
  });
  $('#cdlg').addEventListener('close', function () { S.editing = null; });

  /* ---------- CSV export ---------- */
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  $('#export').addEventListener('click', function () {
    const head = ['id', 'date', 'status', 'name', 'phone', 'email', 'region', 'country', 'city', 'address', 'product', 'qty', 'extras', 'currency', 'total_local', 'total_eur', 'note'];
    const rows = filtered().map(function (o) {
      return [o.id, o.createdAt, o.status, o.customer.name, o.customer.phone, o.customer.email, o.shipping.region, o.shipping.country,
        o.shipping.city, o.shipping.address, o.productName || '', o.qty, o.cross.join('+'), o.currency, o.amounts.total, o.totalEUR, o.note].map(cell).join(',');
    });
    const blob = new Blob(['﻿' + [head.join(',')].concat(rows).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'orders-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* ---------- boot ---------- */
  function renderAll() {
    fillFilters(); renderKpis(); renderChart(); renderRegions(); renderCountryTable(); renderSettings(); renderOrders(); renderCountriesPane();
  }
  function paintLang() {
    i18n.apply(); filterSig = '';
    $$('[data-lang]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === i18n.get()); });
    if (!$('#app').hidden) {
      renderAll();
      if (S.open) openDetail(S.open);
      if (S.editing) openCountry(S.editing);
    }
  }
  $$('[data-lang]').forEach(function (b) { b.addEventListener('click', function () { i18n.set(b.dataset.lang); }); });
  document.addEventListener('langchange', paintLang);

  paintLang();
  showTab(S.tab);
  if (S.token) { showApp(true); load().catch(function () { /* logout handled in api() */ }); }
  setInterval(function () {
    if (S.token && !$('#app').hidden && !$('#detail').open && !$('#cdlg').open) load().catch(function () {});
  }, 30000);
})();
