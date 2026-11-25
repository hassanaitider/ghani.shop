/* Shared between browser and server: product, countries, currencies and pricing.
   The server recomputes every order total with this same code. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PRODUCT = {
    id: 'solarglow',
    priceEUR: 29.9,
    compareEUR: 79.9,
    shippingEUR: 3.5,
    freeShippingQty: 2,
    maxQty: 10,
    initialStock: 87
  };

  const BUNDLES = [
    { qty: 1, off: 0 },
    { qty: 2, off: 0.15 },
    { qty: 3, off: 0.25 }
  ];

  const CROSS = [
    { id: 'cable', priceEUR: 5.9, icon: '🔌' },
    { id: 'stand', priceEUR: 7.9, icon: '🪝' },
    { id: 'panel', priceEUR: 14.9, icon: '☀️' }
  ];

  // rate = units of currency per 1 EUR (defaults, editable from the admin dashboard)
  const CURRENCIES = {
    EUR: { sym: '€', dec: 2, step: 0.1, rate: 1, group: 'other' },
    USD: { sym: '$', dec: 2, step: 0.5, rate: 1.08, group: 'other' },
    // XAF and XOF are pegged to the euro by treaty (1 EUR = 655.957), so `fixed` rates ignore admin overrides
    XAF: { sym: 'FCFA', dec: 0, step: 500, rate: 655.957, fixed: true, group: 'central' },
    XOF: { sym: 'FCFA', dec: 0, step: 500, rate: 655.957, fixed: true, group: 'africa' },
    MAD: { sym: 'MAD', dec: 0, step: 5, rate: 10.8, group: 'africa' },
    TZS: { sym: 'TSh', dec: 0, step: 500, rate: 2900, group: 'africa' },
    ZMW: { sym: 'ZK', dec: 0, step: 5, rate: 29, group: 'africa' },
    UGX: { sym: 'USh', dec: 0, step: 500, rate: 4000, group: 'africa' },
    SSP: { sym: 'SSP', dec: 0, step: 500, rate: 6000, group: 'africa' },
    MKD: { sym: 'ден', dec: 0, step: 10, rate: 61.5, group: 'eeurope' },
    CDF: { sym: 'FC', dec: 0, step: 500, rate: 2900, group: 'central' },
    NGN: { sym: '₦', dec: 0, step: 500, rate: 1700, group: 'africa' },
    GHS: { sym: 'GH₵', dec: 0, step: 5, rate: 16, group: 'africa' },
    KES: { sym: 'KSh', dec: 0, step: 10, rate: 140, group: 'africa' },
    ZAR: { sym: 'R', dec: 0, step: 5, rate: 20, group: 'africa' },
    PLN: { sym: 'zł', dec: 0, step: 1, rate: 4.3, group: 'eeurope' },
    RON: { sym: 'lei', dec: 0, step: 1, rate: 4.97, group: 'eeurope' },
    CZK: { sym: 'Kč', dec: 0, step: 10, rate: 25, group: 'eeurope' },
    HUF: { sym: 'Ft', dec: 0, step: 100, rate: 400, group: 'eeurope' },
    UAH: { sym: '₴', dec: 0, step: 10, rate: 44, group: 'eeurope' },
    BGN: { sym: 'лв', dec: 0, step: 1, rate: 1.956, group: 'eeurope' },
    RSD: { sym: 'RSD', dec: 0, step: 50, rate: 117, group: 'eeurope' }
  };

  // [code, English, Français, region, currency, dial code]
  const COUNTRIES = [
    ['CM', 'Cameroon', 'Cameroun', 'central', 'XAF', '237'],
    ['CF', 'Central African Republic', 'République centrafricaine', 'central', 'XAF', '236'],
    ['TD', 'Chad', 'Tchad', 'central', 'XAF', '235'],
    ['GA', 'Gabon', 'Gabon', 'central', 'XAF', '241'],
    ['CG', 'Congo (Brazzaville)', 'Congo (Brazzaville)', 'central', 'XAF', '242'],
    ['GQ', 'Equatorial Guinea', 'Guinée équatoriale', 'central', 'XAF', '240'],
    ['CD', 'DR Congo (Kinshasa)', 'RD Congo (Kinshasa)', 'central', 'CDF', '243'],
    ['SN', 'Senegal', 'Sénégal', 'africa', 'XOF', '221'],
    ['MA', 'Morocco', 'Maroc', 'africa', 'MAD', '212'],
    ['ML', 'Mali', 'Mali', 'africa', 'XOF', '223'],
    ['BF', 'Burkina Faso', 'Burkina Faso', 'africa', 'XOF', '226'],
    ['CI', "Côte d'Ivoire", "Côte d'Ivoire", 'africa', 'XOF', '225'],
    ['NG', 'Nigeria', 'Nigéria', 'africa', 'NGN', '234'],
    ['GH', 'Ghana', 'Ghana', 'africa', 'GHS', '233'],
    ['KE', 'Kenya', 'Kenya', 'africa', 'KES', '254'],
    ['ZA', 'South Africa', 'Afrique du Sud', 'africa', 'ZAR', '27'],
    ['PL', 'Poland', 'Pologne', 'eeurope', 'PLN', '48'],
    ['RO', 'Romania', 'Roumanie', 'eeurope', 'RON', '40'],
    ['CZ', 'Czech Republic', 'République tchèque', 'eeurope', 'CZK', '420'],
    ['HU', 'Hungary', 'Hongrie', 'eeurope', 'HUF', '36'],
    ['BG', 'Bulgaria', 'Bulgarie', 'eeurope', 'BGN', '359'],
    ['RS', 'Serbia', 'Serbie', 'eeurope', 'RSD', '381'],
    ['UA', 'Ukraine', 'Ukraine', 'eeurope', 'UAH', '380'],
    ['SK', 'Slovakia', 'Slovaquie', 'eeurope', 'EUR', '421'],
    ['TZ', 'Tanzania', 'Tanzanie', 'africa', 'TZS', '255'],
    ['ZM', 'Zambia', 'Zambie', 'africa', 'ZMW', '260'],
    ['UG', 'Uganda', 'Ouganda', 'africa', 'UGX', '256'],
    ['SS', 'South Sudan', 'Soudan du Sud', 'africa', 'SSP', '211'],
    ['SI', 'Slovenia', 'Slovénie', 'eeurope', 'EUR', '386'],
    ['HR', 'Croatia', 'Croatie', 'eeurope', 'EUR', '385'],
    ['MK', 'North Macedonia', 'Macédoine du Nord', 'eeurope', 'MKD', '389'],
    ['ES', 'Spain', 'Espagne', 'other', 'EUR', '34'],
    ['AT', 'Austria', 'Autriche', 'other', 'EUR', '43'],
    ['DE', 'Germany', 'Allemagne', 'other', 'EUR', '49'],
    ['GR', 'Greece', 'Grèce', 'other', 'EUR', '30'],
    ['IT', 'Italy', 'Italie', 'other', 'EUR', '39'],
    ['PT', 'Portugal', 'Portugal', 'other', 'EUR', '351'],
    ['FR', 'France', 'France', 'other', 'EUR', '33']
  ].map(function (c) {
    return { code: c[0], en: c[1], fr: c[2], region: c[3], currency: c[4], dial: c[5] };
  });

  const STATUSES = ['new', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled'];

  function rateOf(cur, rates) {
    const c = CURRENCIES[cur];
    if (c.fixed) return c.rate;
    const r = rates && Number(rates[cur]);
    return r > 0 ? r : c.rate;
  }

  function round(v, cur) {
    const c = CURRENCIES[cur];
    return Number((Math.round(v / c.step) * c.step).toFixed(c.dec));
  }

  function conv(eur, cur, rates) {
    return round(eur * rateOf(cur, rates), cur);
  }

  function discountFor(qty) {
    let off = 0;
    BUNDLES.forEach(function (b) { if (qty >= b.qty) off = b.off; });
    return off;
  }

  // A product's quantity offers: [{ qty, off (percent), label }]. The highest tier the quantity reaches applies.
  function bundleOff(bundles, qty) {
    let off = 0, best = 0;
    (bundles || []).forEach(function (b) { if (qty >= b.qty && b.qty >= best) { best = b.qty; off = Number(b.off) / 100; } });
    return off;
  }
  function defaultBundles() {
    return BUNDLES.map(function (b) { return { qty: b.qty, off: Math.round(b.off * 100), label: '' }; });
  }

  /* A country's own product (prices already in the country's currency). */
  function defaultProduct(cur, rates) {
    return {
      id: PRODUCT.id, name: 'SolarGlow 3-en-1', active: true, rich: true, categoryId: null, description: '', image: '', colorOptions: false,
      gallery: [], sizesEnabled: false, sizes: ['S', 'M', 'L', 'XL'], bundles: defaultBundles(), crossSellIds: [], landing: [],
      stock: PRODUCT.initialStock,
      price: conv(PRODUCT.priceEUR, cur, rates), compare: conv(PRODUCT.compareEUR, cur, rates),
      shipping: conv(PRODUCT.shippingEUR, cur, rates), freeShippingQty: PRODUCT.freeShippingQty
    };
  }

  /* quote({qty, cross:[ids], currency, rates, product?}) -> amounts in the local currency.
     With `product` (a country catalog entry) its local prices are used as-is; without it, EUR base prices are converted. */
  function quote(o) {
    const cur = CURRENCIES[o.currency] ? o.currency : 'EUR';
    const qty = Math.min(PRODUCT.maxQty, Math.max(1, Math.floor(Number(o.qty) || 1)));
    const rates = o.rates;
    const p = o.product;
    const unit = p ? Number(p.price) : conv(PRODUCT.priceEUR, cur, rates);
    const compareUnit = p ? Number(p.compare) : conv(PRODUCT.compareEUR, cur, rates);
    const subtotal = unit * qty;
    const off = p ? bundleOff(p.bundles, qty) : discountFor(qty); // a product's own quantity offers
    const discount = round(subtotal * off, cur);
    const crossIds = Array.from(new Set(o.cross || [])).filter(function (id) {
      return CROSS.some(function (c) { return c.id === id; });
    });
    const crossLines = crossIds.map(function (id) {
      const item = CROSS.find(function (c) { return c.id === id; });
      return { id: id, price: conv(item.priceEUR, cur, rates) };
    });
    const crossTotal = crossLines.reduce(function (s, l) { return s + l.price; }, 0);
    const freeQty = p ? Number(p.freeShippingQty) : PRODUCT.freeShippingQty;
    const shipCost = p ? Number(p.shipping) : conv(PRODUCT.shippingEUR, cur, rates);
    const shipping = qty >= freeQty ? 0 : shipCost;
    // complementary products added to the order (the caller passes their local prices)
    const addonLines = (o.addons || []).map(function (a) { return { id: a.id, name: a.name, price: Number(a.price) }; });
    const addonTotal = addonLines.reduce(function (sum, l) { return sum + l.price; }, 0);
    const total = subtotal - discount + crossTotal + addonTotal + shipping;
    return {
      currency: cur, qty: qty, off: off, unit: unit, compareUnit: compareUnit,
      subtotal: subtotal, discount: discount, cross: crossLines, crossTotal: crossTotal, addons: addonLines, addonTotal: addonTotal,
      shipping: shipping, total: Number(total.toFixed(CURRENCIES[cur].dec)),
      totalEUR: Number((total / rateOf(cur, rates)).toFixed(2))
    };
  }

  function format(amount, cur, locale) {
    const c = CURRENCIES[cur];
    const dec = c ? c.dec : 2;
    const n = Number(amount).toLocaleString(locale || 'en', {
      minimumFractionDigits: dec, maximumFractionDigits: dec
    });
    if (!c) return n + ' ' + cur; // legacy orders in a currency that is no longer offered
    return c.sym === '$' ? '$' + n : n + ' ' + c.sym;
  }

  function country(code) {
    return COUNTRIES.find(function (c) { return c.code === code; });
  }

  // Francophone countries: their product pages are shown in French (the French fields of a product, when filled in).
  const FRANCOPHONE = ['CM', 'CF', 'TD', 'GA', 'CG', 'GQ', 'CD', 'SN', 'MA', 'ML', 'BF', 'CI', 'FR'];
  function isFrancophone(code) { return FRANCOPHONE.indexOf(String(code || '').toUpperCase()) >= 0; }

  return {
    isFrancophone: isFrancophone,
    PRODUCT: PRODUCT, BUNDLES: BUNDLES, CROSS: CROSS, CURRENCIES: CURRENCIES,
    COUNTRIES: COUNTRIES, STATUSES: STATUSES,
    quote: quote, bundleOff: bundleOff, format: format, conv: conv, country: country, rateOf: rateOf, defaultProduct: defaultProduct
  };
});
