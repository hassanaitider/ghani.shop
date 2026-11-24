(function () {
  'use strict';
  const t = i18n.t;
  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.from(document.querySelectorAll(s)); };
  const REGIONS = ['central', 'africa', 'eeurope', 'other'];
  const INACTIVE = ['cancelled', 'returned'];

  const S = { token: null, orders: [], stock: 0, rates: {}, open: null };
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
  function cname(code) { const c = GS.country(code); return c ? c[i18n.get()] : code; }
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 2200);
  }

  /* ---------- api ---------- */
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { Authorization: 'Bearer ' + S.token } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401 && S.token) { logout(); throw new Error('unauthorized'); }
      return r.json().then(function (d) { if (!r.ok) { const e = new Error(d.error || 'error'); e.status = r.status; throw e; } return d; });
    });
  }
  function load() {
    return api('GET', '/api/admin/data').then(function (d) {
      S.orders = d.orders; S.stock = d.stock; S.rates = d.rates || {};
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
      const m = map[key] || (map[key] = { country: o.shipping.country, cur: o.currency, n: 0, local: 0, eur: 0 });
      m.n++; m.local += o.amounts.total; m.eur += o.totalEUR;
    });
    const rows = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.eur - a.eur; });
    $('#countryTable tbody').innerHTML = rows.length ? rows.map(function (r) {
      return '<tr><td>' + esc(cname(r.country)) + '</td><td>' + esc(r.cur) + '</td><td class="num">' + r.n + '</td><td class="num">' + loc(r.local, r.cur) + '</td><td class="num">' + eur(r.eur) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">' + t('a.empty') + '</td></tr>';
  }

  function renderSettings() {
    if (document.activeElement && $('#settings').contains(document.activeElement)) return;
    $('#stockInput').value = S.stock;
    $('#rates').innerHTML = Object.keys(GS.CURRENCIES).filter(function (c) { return c !== 'EUR'; }).map(function (c) {
      return '<label>' + c + '<input type="number" step="any" min="0" data-cur="' + c + '" value="' + GS.rateOf(c, S.rates) + '"' + (GS.CURRENCIES[c].fixed ? ' disabled title="Fixed (EUR peg)"' : '') + '></label>';
    }).join('');
  }
  $('#settings').addEventListener('submit', function (e) {
    e.preventDefault();
    const rates = {};
    $$('#rates input:not(:disabled)').forEach(function (i) { rates[i.dataset.cur] = Number(i.value); });
    api('PUT', '/api/admin/settings', { stock: Number($('#stockInput').value), rates: rates }).then(function (d) {
      S.stock = d.stock; S.rates = d.rates; toast(t('a.set.saved'));
    }).catch(function () {});
  });

  /* ---------- orders table ---------- */
  function fillFilters() {
    const keep = { s: $('#fStatus').value, r: $('#fRegion').value, c: $('#fCountry').value };
    $('#fStatus').innerHTML = '<option value="">' + t('a.f.status') + '</option>' + GS.STATUSES.map(function (s) { return '<option value="' + s + '">' + t('a.status.' + s) + '</option>'; }).join('');
    $('#fRegion').innerHTML = '<option value="">' + t('a.f.region') + '</option>' + REGIONS.map(function (r) { return '<option value="' + r + '">' + t('a.region.' + r) + '</option>'; }).join('');
    $('#fCountry').innerHTML = '<option value="">' + t('a.f.country') + '</option>' + GS.COUNTRIES.map(function (c) { return '<option value="' + c.code + '">' + esc(c[i18n.get()]) + '</option>'; }).join('');
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
  function renderOrders() {
    const list = filtered();
    $('#shown').textContent = t('a.shown', { n: list.length });
    $('#orders tbody').innerHTML = list.length ? list.map(function (o) {
      return '<tr data-id="' + esc(o.id) + '"><td class="id">' + esc(o.id) + '</td><td>' + dateStr(o.createdAt) + '</td>' +
        '<td>' + esc(o.customer.name) + '<small>' + esc(o.customer.phone) + '</small></td>' +
        '<td>' + esc(cname(o.shipping.country)) + '<small>' + esc(o.shipping.city) + '</small></td>' +
        '<td class="num">' + o.qty + '</td><td class="num">' + loc(o.amounts.total, o.currency) + '<small>' + eur(o.totalEUR) + '</small></td>' +
        '<td>' + statusSelect(o) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">' + t('a.empty') + '</td></tr>';
  }
  ['#fSearch', '#fStatus', '#fRegion', '#fCountry'].forEach(function (s) {
    $(s).addEventListener('input', renderOrders);
  });

  function setStatus(id, status) {
    return api('PATCH', '/api/admin/orders/' + encodeURIComponent(id), { status: status }).then(function (d) {
      const i = S.orders.findIndex(function (o) { return o.id === id; });
      if (i >= 0) S.orders[i] = d.order;
      S.stock = d.stock; renderAll();
      if (S.open === id) openDetail(id);
    });
  }
  $('#orders').addEventListener('change', function (e) {
    const sel = e.target.closest('[data-status]');
    if (sel) setStatus(sel.dataset.status, sel.value).catch(function () { load().catch(function () {}); });
  });
  $('#orders').addEventListener('click', function (e) {
    if (e.target.closest('select')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });

  /* ---------- detail dialog ---------- */
  function openDetail(id) {
    const o = S.orders.find(function (x) { return x.id === id; });
    if (!o) return;
    S.open = id;
    const a = o.amounts, items = [t('cs.cable'), t('cs.stand'), t('cs.panel')];
    const crossNames = { cable: items[0], stand: items[1], panel: items[2] };
    const digits = o.customer.phone.replace(/\D/g, '');
    const line = function (l, v, cls) { return '<div class="' + (cls || '') + '"><span>' + l + '</span><span>' + v + '</span></div>'; };
    let lines = line('SolarGlow × ' + o.qty, loc(a.subtotal, o.currency));
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
      '<div class="d__item"><small>' + t('a.col.country') + '</small>' + esc(cname(o.shipping.country)) + ' · ' + esc(o.shipping.city) + '</div>' +
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
        S.orders = S.orders.filter(function (o) { return o.id !== S.open; }); S.stock = d.stock;
        dlg.close(); renderAll();
      }).catch(function () {});
    }
  });
  $('#detail').addEventListener('change', function (e) {
    const sel = e.target.closest('[data-status]');
    if (sel) setStatus(sel.dataset.status, sel.value).catch(function () {});
  });
  $('#detail').addEventListener('close', function () { S.open = null; });

  /* ---------- CSV export ---------- */
  function cell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  $('#export').addEventListener('click', function () {
    const head = ['id', 'date', 'status', 'name', 'phone', 'email', 'region', 'country', 'city', 'address', 'qty', 'extras', 'currency', 'total_local', 'total_eur', 'note'];
    const rows = filtered().map(function (o) {
      return [o.id, o.createdAt, o.status, o.customer.name, o.customer.phone, o.customer.email, o.shipping.region, o.shipping.country,
        o.shipping.city, o.shipping.address, o.qty, o.cross.join('+'), o.currency, o.amounts.total, o.totalEUR, o.note].map(cell).join(',');
    });
    const blob = new Blob(['\ufeff' + [head.join(',')].concat(rows).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'orders-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* ---------- boot ---------- */
  function renderAll() {
    renderKpis(); renderChart(); renderRegions(); renderCountryTable(); renderSettings(); renderOrders();
  }
  function paintLang() {
    i18n.apply(); fillFilters();
    $$('[data-lang]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === i18n.get()); });
    if (!$('#app').hidden) { renderAll(); if (S.open) openDetail(S.open); }
  }
  $$('[data-lang]').forEach(function (b) { b.addEventListener('click', function () { i18n.set(b.dataset.lang); }); });
  document.addEventListener('langchange', paintLang);

  paintLang();
  if (S.token) { showApp(true); load().catch(function () { /* logout handled in api() */ }); }
  setInterval(function () { if (S.token && !$('#app').hidden && !$('#detail').open) load().catch(function () {}); }, 30000);
})();
