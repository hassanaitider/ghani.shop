(function () {
  'use strict';
  const t = i18n.t;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };

  /* To use real GIFs/videos instead of the built-in animated scenes, drop the files in /media
     and set the path here, e.g. cut: 'media/power-cut.gif' */
  const MEDIA = { cut: null, charge: null, solar: null, sos: null };

  const state = { cur: 'EUR', rates: {}, qty: 1, cross: new Set(), stock: GS.PRODUCT.initialStock, scene: 'cut' };

  /* ---------------- icons ---------------- */
  const ICONS = {
    battery: '<rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="13" x2="23" y2="11"/>',
    sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/>',
    return: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
  };
  function svgIcon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  function paintIcons(root) {
    $$('[data-icon]', root).forEach(function (el) { el.innerHTML = svgIcon(el.dataset.icon); });
    $$('[data-stars]', root).forEach(function (el) {
      el.innerHTML = Array(Number(el.dataset.stars)).fill('<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>').join('');
    });
  }

  /* ---------------- animated scenes (GIF-style loops) ---------------- */
  function lantern(x, y, s, cls) {
    return '<g class="lan ' + (cls || '') + '" transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<circle class="glow" cx="50" cy="66" r="72"/>' +
      '<path class="l-handle" d="M30 24 Q50 -10 70 24"/>' +
      '<rect class="l-panel" x="26" y="19" width="48" height="8" rx="2"/>' +
      '<rect class="l-body" x="24" y="26" width="52" height="10" rx="4"/>' +
      '<rect class="l-glass" x="28" y="36" width="44" height="62" rx="8"/>' +
      '<line class="l-rib" x1="40" y1="38" x2="40" y2="96"/><line class="l-rib" x1="50" y1="38" x2="50" y2="96"/><line class="l-rib" x1="60" y1="38" x2="60" y2="96"/>' +
      '<rect class="l-body" x="24" y="98" width="52" height="14" rx="5"/>' +
      '<circle class="l-led" cx="50" cy="105" r="2.2"/></g>';
  }
  const SCENES = {
    cut: function () {
      return '<svg class="scene scene--cut" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">' +
        '<rect width="320" height="200" fill="#f3e6cc"/><rect y="150" width="320" height="50" fill="#d9c4a0"/>' +
        '<rect x="224" y="38" width="64" height="80" rx="4" fill="#9fd0ff" stroke="#c9b48c" stroke-width="5"/>' +
        '<line x1="256" y1="38" x2="256" y2="118" stroke="#c9b48c" stroke-width="3"/>' +
        '<line x1="160" y1="0" x2="160" y2="24" stroke="#8a7a5d" stroke-width="2"/><circle class="bulb" cx="160" cy="30" r="9"/>' +
        '<rect class="dark" width="320" height="200" fill="#050914"/>' +
        lantern(100, 52, 1.1, 'lan--cut') + '</svg>';
    },
    charge: function () {
      return '<svg class="scene scene--charge" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">' +
        '<rect width="320" height="200" fill="#0b1220"/><rect y="156" width="320" height="44" fill="#131c30"/>' +
        lantern(40, 48, 1.1, 'lan--on') +
        '<path class="cable" d="M96 138 C 140 160, 170 160, 206 142"/>' +
        '<rect x="204" y="62" width="70" height="116" rx="12" fill="#1c2742" stroke="#2f3d63" stroke-width="3"/>' +
        '<rect x="212" y="72" width="54" height="96" rx="6" fill="#0e1628"/>' +
        '<rect class="ph-fill" x="212" y="72" width="54" height="96" rx="6"/>' +
        '<path class="bolt" d="M243 100 l-12 20 h9 l-3 18 l12 -20 h-9 z"/></svg>';
    },
    solar: function () {
      return '<svg class="scene scene--solar" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">' +
        '<rect class="sky" width="320" height="200"/>' +
        '<g class="sun"><circle class="sun__halo" r="30"/><circle r="15" fill="#ffd04a"/></g>' +
        '<rect y="150" width="320" height="50" fill="#2a2f45"/><rect y="146" width="320" height="8" fill="#3a405c"/>' +
        lantern(110, 38, 1.1, 'lan--solar') +
        '<rect x="214" y="160" width="84" height="18" rx="9" fill="#0e1628" stroke="#3a405c" stroke-width="2"/>' +
        '<rect class="bat-fill" x="217" y="163" width="78" height="12" rx="6"/></svg>';
    },
    sos: function () {
      return '<svg class="scene scene--sos" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">' +
        '<rect width="320" height="200" fill="#0a0f1d"/>' +
        '<polygon points="0,200 70,120 140,200" fill="#101a31"/><polygon points="180,200 250,108 320,200" fill="#0e1830"/>' +
        '<circle class="ring r1" cx="160" cy="100" r="30"/><circle class="ring r2" cx="160" cy="100" r="30"/>' +
        lantern(110, 34, 1.1, 'lan--sos') +
        '<text class="sos-txt" x="160" y="186" text-anchor="middle">SOS · · · — — — · · ·</text></svg>';
    }
  };
  function sceneHTML(name) {
    if (MEDIA[name]) return '<img class="scene" src="' + MEDIA[name] + '" alt="" loading="lazy">';
    return SCENES[name]();
  }

  const GALLERY = ['cut', 'charge', 'solar', 'sos'];
  function renderGallery() {
    $('#stage').innerHTML = sceneHTML(state.scene);
    $('#thumbs').innerHTML = GALLERY.map(function (n, i) {
      return '<button type="button" role="tab" class="thumb' + (n === state.scene ? ' is-active' : '') + '" data-scene="' + n + '" aria-selected="' + (n === state.scene) + '">' +
        '<span class="thumb__n">' + (i + 1) + '</span><span>' + t('gallery.' + (i + 1)) + '</span></button>';
    }).join('');
  }
  function renderDemo() {
    const names = ['cut', 'charge', 'solar'];
    $('#demoGrid').innerHTML = names.map(function (n, i) {
      return '<article class="demo"><div class="demo__media">' + sceneHTML(n) + '<span class="demo__tag">GIF</span></div>' +
        '<div class="demo__body"><span class="step">' + (i + 1) + '</span><h3>' + t('demo.' + (i + 1) + '.t') + '</h3><p>' + t('demo.' + (i + 1) + '.d') + '</p></div></article>';
    }).join('');
  }

  /* ---------------- currency ---------------- */
  const TZ = {
    'Africa/Dakar': 'XOF', 'Africa/Abidjan': 'XOF', 'Africa/Douala': 'XAF', 'Africa/Bangui': 'XAF', 'Africa/Ndjamena': 'XAF',
    'Africa/Libreville': 'XAF', 'Africa/Brazzaville': 'XAF', 'Africa/Malabo': 'XAF', 'Africa/Kinshasa': 'CDF',
    'Africa/Lagos': 'NGN', 'Africa/Accra': 'GHS', 'Africa/Nairobi': 'KES',
    'Africa/Johannesburg': 'ZAR', 'Europe/Warsaw': 'PLN', 'Europe/Bucharest': 'RON', 'Europe/Prague': 'CZK',
    'Europe/Budapest': 'HUF', 'Europe/Sofia': 'BGN', 'Europe/Belgrade': 'RSD', 'Europe/Kyiv': 'UAH', 'Europe/Kiev': 'UAH'
  };
  function initialCurrency() {
    try {
      const saved = localStorage.getItem('gs_cur');
      if (saved && GS.CURRENCIES[saved]) return saved;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (TZ[tz]) return TZ[tz];
    } catch (e) { /* ignore */ }
    return 'EUR';
  }
  function fmt(amount) { return GS.format(amount, state.cur, i18n.get()); }
  function eurText(eur) { return fmt(GS.conv(eur, state.cur, state.rates)); }

  function renderCurrencySelect() {
    const groups = { central: [], africa: [], eeurope: [], other: [] };
    Object.keys(GS.CURRENCIES).forEach(function (c) { groups[GS.CURRENCIES[c].group].push(c); });
    $('#currency').innerHTML = ['central', 'africa', 'eeurope', 'other'].map(function (g) {
      return '<optgroup label="' + t('cur.group.' + g) + '">' + groups[g].map(function (c) {
        return '<option value="' + c + '">' + c + ' (' + GS.CURRENCIES[c].sym + ')</option>';
      }).join('') + '</optgroup>';
    }).join('');
    $('#currency').value = state.cur;
  }
  function setCurrency(cur) {
    if (!GS.CURRENCIES[cur]) return;
    state.cur = cur;
    try { localStorage.setItem('gs_cur', cur); } catch (e) { /* ignore */ }
    $('#currency').value = cur;
    renderPrices();
  }
  function renderPrices() {
    $$('[data-eur]').forEach(function (el) { el.textContent = eurText(Number(el.dataset.eur)); });
    const q = GS.quote({ qty: 1, currency: state.cur, rates: state.rates });
    $('#saveTag').textContent = t('price.save', { p: Math.round((1 - q.unit / q.compareUnit) * 100) });
    renderCross(); renderBundles(); renderSummary();
  }

  /* ---------------- stock ---------------- */
  function renderStock() {
    const n = state.stock;
    $('#stockText').innerHTML = n > 0 ? t('stock.left', { n: n }) : t('stock.out');
    const pct = Math.max(3, Math.min(100, Math.round(n / GS.PRODUCT.initialStock * 100)));
    $('#stockBar').style.width = (n > 0 ? pct : 0) + '%';
    $('#stockBox').classList.toggle('is-low', n <= 25);
    $('#submitBtn').disabled = n <= 0;
  }
  function loadConfig() {
    return fetch('/api/config', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) {
      state.stock = c.stock; state.rates = c.rates || {};
      renderStock(); renderPrices();
    }).catch(function () { /* offline: keep defaults */ });
  }

  /* ---------------- FAQ ---------------- */
  function initFaq() {
    $('#faqList').addEventListener('click', function (e) {
      const btn = e.target.closest('.faq__q');
      if (!btn) return;
      const item = btn.parentElement, open = !item.classList.contains('is-open');
      $$('.faq__item.is-open').forEach(function (it) {
        it.classList.remove('is-open');
        $('.faq__q', it).setAttribute('aria-expanded', 'false');
        $('.faq__a', it).style.maxHeight = null;
      });
      if (open) {
        item.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        const a = $('.faq__a', item);
        a.style.maxHeight = a.scrollHeight + 'px';
      }
    });
    $('.faq__item').classList.add('is-open');
    const first = $('.faq__item .faq__a'); first.style.maxHeight = first.scrollHeight + 'px';
    $('.faq__q').setAttribute('aria-expanded', 'true');
  }

  /* ---------------- cross-sell ---------------- */
  function renderCross() {
    $('#crossGrid').innerHTML = GS.CROSS.map(function (c) {
      const on = state.cross.has(c.id);
      return '<article class="cross' + (on ? ' is-on' : '') + '"><div class="cross__img" aria-hidden="true">' + c.icon + '</div>' +
        '<h3>' + t('cross.' + c.id + '.n') + '</h3><p>' + t('cross.' + c.id + '.d') + '</p>' +
        '<div class="cross__foot"><b>' + eurText(c.priceEUR) + '</b>' +
        '<button type="button" class="btn ' + (on ? 'btn--ok' : 'btn--ghost') + ' btn--sm" data-cross="' + c.id + '">' +
        (on ? t('cross.added') : t('cross.add')) + '</button></div></article>';
    }).join('');
  }

  /* ---------------- bundles / quantity / summary ---------------- */
  function renderBundles() {
    $('#bundles').innerHTML = GS.BUNDLES.map(function (b, i) {
      const q = GS.quote({ qty: b.qty, currency: state.cur, rates: state.rates });
      const active = state.qty === b.qty || (b.qty === 3 && state.qty > 3);
      return '<button type="button" class="bundle' + (active ? ' is-active' : '') + '" data-qty="' + b.qty + '">' +
        (b.qty === 2 ? '<span class="bundle__pop">' + t('bundle.pop') + '</span>' : '') +
        '<b>' + t('bundle.' + (i + 1) + '.t') + '</b><small>' + t('bundle.' + (i + 1) + '.d') + '</small>' +
        '<span class="bundle__p">' + fmt(q.subtotal - q.discount) + '</span>' +
        (b.qty > 1 ? '<span class="muted small">' + fmt((q.subtotal - q.discount) / b.qty) + ' ' + t('bundle.each') + '</span>' : '') +
        '</button>';
    }).join('');
  }
  function currentQuote() {
    return GS.quote({ qty: state.qty, cross: Array.from(state.cross), currency: state.cur, rates: state.rates });
  }
  function renderSummary() {
    const q = currentQuote();
    let h = '<h4>' + t('sum.title') + '</h4>' +
      row(t('sum.product', { n: q.qty }), fmt(q.subtotal));
    if (q.discount) h += row(t('sum.discount') + ' (−' + Math.round(q.off * 100) + '%)', '−' + fmt(q.discount), 'green');
    q.cross.forEach(function (l) { h += row(t('cs.' + l.id), fmt(l.price)); });
    h += row(t('sum.shipping'), q.shipping ? fmt(q.shipping) : t('sum.free'), q.shipping ? '' : 'green');
    h += '<div class="sum__total"><span>' + t('sum.total') + '</span><b>' + fmt(q.total) + '</b></div>';
    $('#summary').innerHTML = h;
    $('#qtyVal').textContent = state.qty;
    $('#qtyMinus').disabled = state.qty <= 1;
    $('#qtyPlus').disabled = state.qty >= Math.min(GS.PRODUCT.maxQty, Math.max(1, state.stock));
  }
  function row(a, b, cls) { return '<div class="sum__row"><span>' + a + '</span><span class="' + (cls || '') + '">' + b + '</span></div>'; }
  function setQty(n) {
    state.qty = Math.max(1, Math.min(GS.PRODUCT.maxQty, n));
    renderBundles(); renderSummary();
  }

  /* ---------------- countries ---------------- */
  function renderCountries() {
    const sel = $('#orderForm [name=country]'), keep = sel.value, lang = i18n.get();
    let h = '<option value="" disabled selected>' + t('f.country.ph') + '</option>';
    ['central', 'africa', 'eeurope', 'other'].forEach(function (g) {
      h += '<optgroup label="' + t('cur.group.' + g) + '">' + GS.COUNTRIES.filter(function (c) { return c.region === g; })
        .map(function (c) { return '<option value="' + c.code + '">' + c[lang] + '</option>'; }).join('') + '</optgroup>';
    });
    sel.innerHTML = h;
    if (keep) sel.value = keep;
  }

  /* ---------------- form ---------------- */
  function validate(form) {
    const v = function (n) { return form.elements[n].value.trim(); };
    const bad = {
      name: v('name').length < 2,
      country: !GS.country(v('country')),
      phone: v('phone').replace(/\D/g, '').length < 6,
      city: v('city').length < 2,
      address: v('address').length < 5,
      email: !!v('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))
    };
    let first = null;
    Object.keys(bad).forEach(function (n) {
      const f = form.elements[n].closest('.field');
      f.classList.toggle('invalid', bad[n]);
      if (bad[n] && !first) first = form.elements[n];
    });
    return first;
  }
  function showError(msg) { const e = $('#formErr'); e.textContent = msg; e.hidden = !msg; }

  function submit(e) {
    e.preventDefault();
    showError('');
    const form = e.currentTarget, firstBad = validate(form);
    if (firstBad) { firstBad.focus(); return; }
    const btn = $('#submitBtn');
    btn.disabled = true; btn.textContent = t('order.sending');
    const payload = {
      name: form.elements.name.value, phone: form.elements.phone.value, country: form.elements.country.value,
      city: form.elements.city.value, address: form.elements.address.value, email: form.elements.email.value,
      note: form.elements.note.value, website: form.elements.website.value,
      qty: state.qty, cross: Array.from(state.cross), currency: state.cur, lang: i18n.get()
    };
    fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (r) {
        if (r.status === 201) return success(r.d);
        if (r.status === 409) { state.stock = r.d.stock; renderStock(); renderSummary(); showError(t('order.err.stock', { n: r.d.stock })); }
        else if (r.status === 429) showError(t('order.err.rate'));
        else if (r.status === 400 && r.d.fields) {
          Object.keys(r.d.fields).forEach(function (n) { const el = form.elements[n]; if (el) el.closest('.field').classList.add('invalid'); });
        } else showError(t('order.err.net'));
      })
      .catch(function () { showError(t('order.err.net')); })
      .then(function () { btn.disabled = state.stock <= 0; btn.textContent = t('order.submit'); });
  }

  let lastOrder = null;
  function success(d) {
    lastOrder = d.order; state.stock = d.stock; renderStock();
    renderConfirm();
    $('#orderForm').hidden = true; $('#confirm').hidden = false;
    $('#confirm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function renderConfirm() {
    if (!lastOrder) return;
    $('#okMsg').textContent = t('ok.msg', { name: lastOrder.name || '', phone: lastOrder.phone || '' });
    $('#okId').textContent = lastOrder.id;
    $('#okTotal').textContent = lastOrder.amounts ? GS.format(lastOrder.amounts.total, lastOrder.currency, i18n.get()) : '';
  }

  /* ---------------- boot ---------------- */
  function renderAll() {
    renderCurrencySelect(); renderGallery(); renderDemo(); renderCountries();
    paintIcons(); renderStock(); renderPrices(); renderConfirm();
    $('#reviewCount').textContent = t('hero.reviews', { n: '1 284' });
    $$('[data-lang]').forEach(function (b) { b.classList.toggle('is-active', b.dataset.lang === i18n.get()); });
    const open = $('.faq__item.is-open .faq__a'); if (open) open.style.maxHeight = open.scrollHeight + 'px';
  }

  function init() {
    state.cur = initialCurrency();
    $('#year').textContent = new Date().getFullYear();
    i18n.apply(); renderAll(); initFaq();

    document.addEventListener('langchange', function () { renderAll(); });
    $$('[data-lang]').forEach(function (b) { b.addEventListener('click', function () { i18n.set(b.dataset.lang); }); });
    $('#currency').addEventListener('change', function (e) {
      setCurrency(e.target.value);
      // COD is always charged in the destination country's currency, so a mismatching country is cleared
      const sel = $('#orderForm').elements.country, c = GS.country(sel.value);
      if (c && c.currency !== state.cur) { sel.value = ''; $('#dial').textContent = '+'; }
    });
    $('#thumbs').addEventListener('click', function (e) {
      const b = e.target.closest('[data-scene]'); if (!b) return;
      state.scene = b.dataset.scene; renderGallery();
    });
    $('#crossGrid').addEventListener('click', function (e) {
      const b = e.target.closest('[data-cross]'); if (!b) return;
      const id = b.dataset.cross;
      if (state.cross.has(id)) state.cross.delete(id); else state.cross.add(id);
      renderCross(); renderSummary();
    });
    $('#bundles').addEventListener('click', function (e) {
      const b = e.target.closest('[data-qty]'); if (b) setQty(Number(b.dataset.qty));
    });
    $('#qtyMinus').addEventListener('click', function () { setQty(state.qty - 1); });
    $('#qtyPlus').addEventListener('click', function () { setQty(state.qty + 1); });

    const form = $('#orderForm');
    form.elements.country.addEventListener('change', function (e) {
      const c = GS.country(e.target.value); if (!c) return;
      $('#dial').textContent = '+' + c.dial;
      setCurrency(c.currency);
    });
    form.addEventListener('input', function (e) { const f = e.target.closest('.field'); if (f) f.classList.remove('invalid'); });
    form.addEventListener('submit', submit);
    $('#again').addEventListener('click', function () {
      form.reset(); state.cross.clear(); state.qty = 1; lastOrder = null;
      $('#dial').textContent = '+'; $('#confirm').hidden = true; form.hidden = false;
      renderCross(); renderBundles(); renderSummary();
    });

    loadConfig();
    setInterval(loadConfig, 20000);
  }
  init();
})();
