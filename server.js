'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const GS = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
// DATA_DIR lets a hosting provider point storage at a persistent disk (Render: the disk's mount path).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const PW_FILE = path.join(DATA_DIR, 'admin-password.txt');
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || !!process.env.RENDER;

fs.mkdirSync(DATA_DIR, { recursive: true });
// Uploaded product media lives next to store.json, so it sits on the same persistent disk.
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_UPLOAD = 8 * 1024 * 1024;

/* ---------- admin password (env var, or generated once and saved in DATA_DIR) ---------- */
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let generated = false;
if (!ADMIN_PASSWORD) {
  if (fs.existsSync(PW_FILE)) ADMIN_PASSWORD = fs.readFileSync(PW_FILE, 'utf8').trim();
  else {
    ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
    fs.writeFileSync(PW_FILE, ADMIN_PASSWORD + '\n', { mode: 0o600 });
    generated = true;
  }
}
// Derived from the password so admin sessions survive restarts/redeploys; changing the password logs everyone out.
const SECRET = crypto.createHash('sha256').update('ghani-shop-session:' + ADMIN_PASSWORD).digest();

/* ---------- tiny JSON store ----------
   countries:  { code, slug, en, fr, flag, region, currency, dial, active, catSeeded }
   categories: { id, countryCode, en, fr, order, active }               (one independent list per country)
   products:   { id, countryCode, categoryId, name, description, image, colorOptions, rich,
                 price, compare, shipping, freeShippingQty, stock, active }  (prices in the country's currency) */
let db = { rates: {}, orders: [], seq: 0, countries: [], categories: [], products: [] };
if (fs.existsSync(DB_FILE)) {
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
  catch (e) { console.error('Could not read store.json, starting empty:', e.message); }
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- seed data ---------- */
const DEFAULT_CATEGORIES = [
  ['electronics', 'Electronics', 'Électronique'],
  ['home-kitchen', 'Home & Kitchen', 'Maison & Cuisine'],
  ['beauty-health', 'Beauty & Health', 'Beauté & Santé'],
  ['car-accessories', 'Car Accessories', 'Accessoires auto'],
  ['fashion', 'Fashion', 'Mode'],
  ['gadgets', 'Gadgets', 'Gadgets']
];
const STARTER_COUNTRIES = ['CI', 'SN', 'GN']; // slugs come from TARGET_COUNTRIES below
// The SolarGlow landing page is sold only in these francophone countries
const SOLARGLOW_COUNTRIES = ['CI', 'SN', 'GN'];
// "Pack de 2 sacs PVC" landing page: all sub-Saharan francophone African countries. 19999 CFA = the reference price.
const SACS_COUNTRIES = ['CI', 'SN', 'GN', 'CM', 'CF', 'TD', 'GA', 'CG', 'GQ', 'CD', 'ML', 'BF'];
const SACS_PRICE_CFA = 19999;
// the 3 photos, in this order, stacked on the product page
function SACS_LANDING() {
  return ['pack-de-2', 'organisation', 'capacite'].map(function (f) {
    return { title: '', text: '', media: '/media/sacs-pvc/' + f + '.webp', titleFr: '', textFr: '', mediaFr: '' };
  });
} // only used to fill a brand-new, empty store
// Target countries: each one is inserted at startup if it is missing (existing data is never touched). [code, URL slug]
const TARGET_COUNTRIES = [
  ['CI', 'cote-divoire'], ['SN', 'senegal'], ['GN', 'guinea'],
  ['CM', 'cameroun'], ['CF', 'centrafrique'], ['TD', 'tchad'], ['GA', 'gabon'], ['CG', 'congo'], ['GQ', 'guinee-equatoriale'],
  ['CD', 'rd-congo'], ['ML', 'mali'], ['BF', 'burkina-faso'],
  ['KE', 'kenya'], ['TZ', 'tanzania'], ['ZM', 'zambia'], ['GH', 'ghana'], ['UG', 'uganda'], ['SS', 'south-sudan'],
  ['SK', 'slovakia'], ['SI', 'slovenia'], ['ES', 'spain'], ['AT', 'austria'], ['BG', 'bulgaria'], ['HR', 'croatia'],
  ['CZ', 'czech-republic'], ['FR', 'france'], ['DE', 'germany'], ['GR', 'greece'], ['HU', 'hungary'], ['IT', 'italy'],
  ['MK', 'north-macedonia'], ['PL', 'poland'], ['PT', 'portugal'], ['RO', 'romania']
];
const RESERVED_SLUGS = ['admin', 'api', 'media'];
const REGIONS = ['central', 'africa', 'eeurope', 'other'];

function flagOf(code) {
  return String(code).toUpperCase().replace(/./g, function (ch) { return String.fromCodePoint(127397 + ch.charCodeAt(0)); });
}
function slugify(v) {
  return String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function findCountry(code) { return db.countries.find(function (c) { return c.code === code; }); }
function findBySlug(slug) { return db.countries.find(function (c) { return c.slug === slug; }); }
function findCategory(id) { return db.categories.find(function (c) { return c.id === id; }); }
function findProduct(code, id) { return db.products.find(function (p) { return p.countryCode === code && p.id === id; }); }
function categoriesOf(code) {
  return db.categories.filter(function (c) { return c.countryCode === code; }).sort(function (a, b) { return a.order - b.order; });
}
function productsOf(code) { return db.products.filter(function (p) { return p.countryCode === code; }); }

function ensureCategories(c) {
  if (c.catSeeded) return;
  DEFAULT_CATEGORIES.forEach(function (d, i) {
    db.categories.push({ id: c.code.toLowerCase() + '-' + d[0], countryCode: c.code, en: d[1], fr: d[2], order: i, active: true });
  });
  c.catSeeded = true;
}
function uniqueSlug(slug, code) {
  return db.countries.some(function (c) { return c.slug === slug; }) ? slug + '-' + code.toLowerCase() : slug;
}
function addCountry(code, slug) {
  const g = GS.country(code);
  if (!g || findCountry(code)) return null;
  const c = { code: g.code, slug: uniqueSlug(slug, code), en: g.en, fr: g.fr, flag: flagOf(g.code), region: g.region, currency: g.currency, dial: g.dial, active: true, catSeeded: false };
  db.countries.push(c);
  ensureCategories(c);
  if (SOLARGLOW_COUNTRIES.includes(c.code)) {
    const p = GS.defaultProduct(c.currency, db.rates);
    p.countryCode = c.code; p.categoryId = c.code.toLowerCase() + '-gadgets';
    db.products.push(p);
  }
  return c;
}

function startupSync() {
  const added = [];
  if (!db.countries.length) STARTER_COUNTRIES.forEach(function (code) {
    const t = TARGET_COUNTRIES.find(function (x) { return x[0] === code; });
    if (addCountry(code, t ? t[1] : code.toLowerCase())) added.push(code);
  });

  // older stores kept each country's products inside the country record
  db.countries.forEach(function (c) {
    if (Array.isArray(c.products)) {
      c.products.forEach(function (p) { p.countryCode = c.code; db.products.push(p); });
      delete c.products;
    }
    if (!c.flag) c.flag = flagOf(c.code);
    ensureCategories(c);
  });
  delete db.stock;
  db.products.forEach(function (p) {
    if (p.description === undefined) p.description = '';
    if (p.image === undefined) p.image = '';
    if (p.colorOptions === undefined) p.colorOptions = false;
    if (!Array.isArray(p.gallery)) p.gallery = [];
    if (p.sizesEnabled === undefined) p.sizesEnabled = false;
    if (!Array.isArray(p.sizes) || !p.sizes.length) p.sizes = ['S', 'M', 'L', 'XL'];
    if (!Array.isArray(p.crossSellIds)) p.crossSellIds = [];
    if (!Array.isArray(p.landing)) p.landing = [];
    // the SolarGlow offer keeps its 1 / 2 / 3 quantity tiers; other products start without any
    if (!Array.isArray(p.bundles)) p.bundles = p.id === 'solarglow' ? GS.defaultProduct('EUR', {}).bundles : [];
    if (p.rich === undefined) p.rich = p.id === 'solarglow'; // the SolarGlow offer keeps its full marketing page
    if (!p.categoryId || !findCategory(p.categoryId)) {
      const fallback = findCategory(p.countryCode.toLowerCase() + '-gadgets') || categoriesOf(p.countryCode)[0];
      p.categoryId = fallback ? fallback.id : null;
    }
  });

  // SolarGlow is only for CI / SN / GN: hide it once elsewhere (nothing is deleted; the admin can re-enable it)
  db.products.forEach(function (p) {
    if (p.id === 'solarglow' && !SOLARGLOW_COUNTRIES.includes(p.countryCode) && !p.hiddenOutsideFr) { p.active = false; p.hiddenOutsideFr = true; }
  });

  // upsert the target countries one by one
  TARGET_COUNTRIES.forEach(function (t) { if (addCountry(t[0], t[1])) added.push(t[0]); });

  // stores that already got the first layout (hero image + 2 blocks): switch to the 3 photos in order
  db.products.forEach(function (p) {
    if (p.id === 'sacs-pvc' && p.image === '/media/sacs-pvc/pack-de-2.webp' && (p.landing || []).length === 2) { p.image = ''; p.landing = SACS_LANDING(); }
  });

  // seed the "Pack de 2 sacs PVC" product once per country (never re-created if the admin deletes it)
  SACS_COUNTRIES.forEach(function (code) {
    const c = findCountry(code);
    if (!c || c.sacsSeeded) return;
    c.sacsSeeded = true;
    if (findProduct(code, 'sacs-pvc')) return;
    const cur = GS.CURRENCIES[c.currency] || { rate: 655.957, step: 500 };
    const rate = Number(db.rates && db.rates[c.currency]) || cur.rate;
    const price = cur.fixed ? SACS_PRICE_CFA : Math.round(SACS_PRICE_CFA / 655.957 * rate / cur.step) * cur.step; // XOF/XAF: exactly 19999
    const cat = findCategory(code.toLowerCase() + '-home-kitchen') || categoriesOf(code)[0];
    db.products.push({
      id: 'sacs-pvc', countryCode: code, categoryId: cat ? cat.id : null, active: true, rich: false,
      name: 'Pack of 2 clear PVC storage bags', nameFr: 'Pack de 2 sacs de rangement PVC transparents',
      description: 'Pack of 2 giant (38x24x32 cm) transparent PVC storage bags. Waterproof, rigid and foldable. Cash on delivery.',
      descriptionFr: 'Lot de 2 sacs de rangement géants (38x24x32 cm) en PVC épais, 100% transparents, étanches, rigides et pliables. Paiement à la livraison.',
      image: '', imageFr: '', colorOptions: false, gallery: [], sizesEnabled: false, sizes: ['S', 'M', 'L', 'XL'],
      bundles: [], crossSellIds: [],
      landing: SACS_LANDING(),
      stock: 500, price: price, compare: 0, shipping: 0, freeShippingQty: 1
    });
    added.push(code + ':sacs-pvc');
  });
  save();
  if (added.length) console.log('Added countries: ' + added.join(', '));
}
startupSync();
collectGarbage();

function publicCountry(c) {
  return { code: c.code, slug: c.slug, en: c.en, fr: c.fr, flag: c.flag || flagOf(c.code), currency: c.currency, dial: c.dial, region: c.region, lang: GS.isFrancophone(c.code) ? 'fr' : 'en' };
}
function publicCategory(c) { return { id: c.id, en: c.en, fr: c.fr }; }
// In a francophone country the French version of each field is shown when it exists; other countries keep the original text and images.
function publicProduct(p) {
  const fr = GS.isFrancophone(p.countryCode);
  const gal = p.gallery || [], galFr = p.galleryFr || [];
  return {
    id: p.id, name: fr ? (p.nameFr || p.name) : p.name, description: fr ? (p.descriptionFr || p.description) : p.description,
    image: fr ? (p.imageFr || p.image) : p.image, colorOptions: p.colorOptions, rich: p.rich, categoryId: p.categoryId,
    gallery: fr ? gal.map(function (u, i) { return galFr[i] || u; }) : gal,
    sizesEnabled: p.sizesEnabled, sizes: p.sizes, bundles: p.bundles, crossSellIds: p.crossSellIds,
    landing: (p.landing || []).map(function (x) {
      return fr ? { title: x.titleFr || x.title, text: x.textFr || x.text, media: x.mediaFr || x.media } : { title: x.title, text: x.text, media: x.media };
    }),
    price: p.price, compare: p.compare, shipping: p.shipping, freeShippingQty: p.freeShippingQty, stock: p.stock
  };
}
// What a visitor can see in a country: active products whose category is active
function visibleProducts(code) {
  return productsOf(code).filter(function (p) {
    const cat = findCategory(p.categoryId);
    return p.active && (!cat || cat.active);
  });
}
function snapshot() { return { countries: db.countries, categories: db.categories, products: db.products }; }

/* ---------- helpers ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.ico': 'image/x-icon'
};
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'"
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store' }, SEC_HEADERS, headers));
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function redirect(res, status, location) {
  send(res, status, '', { Location: location });
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > 50 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
function readRaw(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0, over = false; const chunks = [];
    req.on('data', function (c) { // keep draining an oversized upload so the client can still read the 413 answer
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; return; }
      if (!over) chunks.push(c);
    });
    req.on('end', function () { if (over) reject(new Error('too large')); else resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}
// The real type comes from the file's own signature, never from the client-supplied name or Content-Type.
function imageExt(b) {
  if (b.length > 12 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.length > 12 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
  if (b.length > 12 && /^GIF8[79]a$/.test(b.slice(0, 6).toString('latin1'))) return 'gif';
  if (b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
// Delete uploaded files that no product references any more (kept for 24 h so a file uploaded but not yet saved survives).
function collectGarbage() {
  const keep = new Set();
  const add = function (u) { const m = typeof u === 'string' && u.match(/^\/uploads\/([a-f0-9]{24}\.\w+)$/); if (m) keep.add(m[1]); };
  db.products.forEach(function (p) {
    add(p.image); add(p.imageFr); (p.gallery || []).forEach(add); (p.galleryFr || []).forEach(add);
    (p.landing || []).forEach(function (x) { add(x.media); add(x.mediaFr); });
  });
  const cutoff = Date.now() - 24 * 3600 * 1000;
  try {
    fs.readdirSync(UPLOAD_DIR).forEach(function (f) {
      if (keep.has(f) || !/^[a-f0-9]{24}\.\w+$/.test(f)) return;
      const fp = path.join(UPLOAD_DIR, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
}
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
// like clean(), but keeps line breaks (product descriptions)
function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
/* ---------- French translation (Claude for text, Gemini for text inside images) ---------- */
async function translateTexts(items) {
  const idx = [], src = [];
  items.forEach(function (s, i) { if (s.trim()) { idx.push(i); src.push(s); } });
  const out = items.slice();
  if (!src.length) return out;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.TRANSLATE_MODEL || 'claude-haiku-5-5',
      max_tokens: 8000,
      system: 'You translate e-commerce product copy (names, descriptions, landing-page headings and paragraphs) into natural, persuasive French for customers in francophone Africa and France. ' +
        'Keep numbers, units, brand and model names unchanged, keep line breaks, and do not add or remove anything. ' +
        'Reply with ONLY a JSON array of strings: the translations, in the same order and with the same length as the input array.',
      messages: [{ role: 'user', content: JSON.stringify(src) }]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) throw new Error('anthropic ' + r.status);
  const data = await r.json();
  const text = ((data.content || []).find(function (c) { return c.type === 'text'; }) || {}).text || '';
  const m = text.match(/\[[\s\S]*\]/);
  const arr = m ? JSON.parse(m[0]) : null;
  if (!Array.isArray(arr) || arr.length !== src.length) throw new Error('bad translation shape');
  arr.forEach(function (s, k) { out[idx[k]] = String(s); });
  return out;
}
async function loadImageBytes(u) {
  let m;
  if ((m = u.match(/^\/uploads\/([a-f0-9]{24}\.\w+)$/))) return fs.readFileSync(path.join(UPLOAD_DIR, m[1]));
  if (u.startsWith('/media/')) {
    const fp = path.join(PUBLIC, path.normalize(u));
    if (!fp.startsWith(path.join(PUBLIC, 'media'))) throw new Error('bad path');
    return fs.readFileSync(fp);
  }
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('download ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_UPLOAD) throw new Error('too large');
  return buf;
}
async function translateImage(u) {
  const buf = await loadImageBytes(u);
  const ext = imageExt(buf);
  if (!ext) throw new Error('unsupported image');
  if (ext === 'gif') { const e = new Error('gif'); e.code = 'gif'; throw e; } // an animation cannot be redrawn
  const mime = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext];
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + (process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image') + ':generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: 'Edit this product image: translate every piece of English text in it into French. Keep the exact same layout, fonts, colors, product, photos and style; ' +
          'change only the wording of the text. Text that is already French, numbers and brand names stay as they are. Return the edited image.' },
        { inline_data: { mime_type: mime, data: buf.toString('base64') } }
      ] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!r.ok) throw new Error('gemini ' + r.status);
  const data = await r.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const img = parts.find(function (p) { return (p.inlineData || p.inline_data || {}).data; });
  if (!img) throw new Error('no image returned');
  const out = Buffer.from((img.inlineData || img.inline_data).data, 'base64');
  const oext = imageExt(out);
  if (!oext) throw new Error('bad image returned');
  const name = crypto.randomBytes(12).toString('hex') + '.' + oext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), out);
  return '/uploads/' + name;
}
// Behind Render's proxy every connection comes from the proxy, so the real client is in X-Forwarded-For.
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || '';
}

/* ---------- auth: signed expiring token ---------- */
function makeToken() {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  const sig = crypto.createHmac('sha256', SECRET).update(exp).digest('base64url');
  return exp + '.' + sig;
}
function validToken(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2 || Number(parts[0]) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(parts[0]).digest();
  const given = Buffer.from(parts[1], 'base64url');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
function isAdmin(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') && validToken(h.slice(7));
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ---------- naive rate limiting ---------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(function (t) { return now - t < windowMs; });
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(function () { hits.clear(); }, 3600 * 1000).unref();

/* ---------- order logic ---------- */
function holdsStock(status) { return status !== 'cancelled' && status !== 'returned'; }

function createOrder(b) {
  const errors = {};
  const name = clean(b.name, 80);
  const phoneDigits = clean(b.phone, 25).replace(/\D/g, '');
  const country = db.countries.find(function (c) { return c.code === clean(b.country, 2) && c.active; });
  const city = clean(b.city, 80);
  const address = clean(b.address, 200);
  const email = clean(b.email, 100);
  const note = clean(b.note, 300);
  if (name.length < 2) errors.name = 1;
  if (!country) errors.country = 1;
  if (phoneDigits.length < 6 || phoneDigits.length > 15) errors.phone = 1;
  if (city.length < 2) errors.city = 1;
  if (address.length < 5) errors.address = 1;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 1;
  let product = null, color = '', size = '';
  const addonProducts = [];
  if (country) {
    const live = visibleProducts(country.code);
    product = b.productId ? live.find(function (p) { return p.id === b.productId; }) : live[0];
    if (!product) errors.product = 1;
    else {
      if (product.colorOptions) { color = clean(b.color, 40); if (!color) errors.color = 1; }
      if (product.sizesEnabled) { size = clean(b.size, 10); if (!product.sizes.includes(size)) errors.size = 1; }
      // complementary products: only the ones this product offers, from the same country, in stock
      const wanted = Array.isArray(b.addons) ? Array.from(new Set(b.addons.map(String))) : [];
      wanted.forEach(function (id) {
        const ap = live.find(function (x) { return x.id === id; });
        if (ap && ap.id !== product.id && product.crossSellIds.includes(id) && ap.stock > 0) addonProducts.push(ap);
        else errors.addons = 1;
      });
    }
  }
  if (Object.keys(errors).length) return { status: 400, body: { error: 'validation', fields: errors } };

  // Cash on delivery is collected in the destination country's currency, at that country's own prices
  const cross = product.rich && Array.isArray(b.cross) ? b.cross : [];
  const addons = addonProducts.map(function (a) { return { id: a.id, name: a.name, price: a.price }; });
  const q = GS.quote({ qty: b.qty, cross: cross, addons: addons, currency: country.currency, rates: db.rates, product: product });
  if (q.qty > product.stock) return { status: 409, body: { error: 'stock', stock: product.stock } };

  db.seq += 1;
  product.stock -= q.qty;
  addonProducts.forEach(function (a) { a.stock -= 1; });
  const phone = '+' + (phoneDigits.startsWith(country.dial) && phoneDigits.length > country.dial.length + 6
    ? phoneDigits : country.dial + phoneDigits.replace(/^0+/, ''));
  const order = {
    id: 'GS-' + String(1000 + db.seq),
    createdAt: new Date().toISOString(),
    status: 'new',
    stockHeld: true,
    customer: { name: name, phone: phone, email: email },
    shipping: { country: country.code, countryName: { en: country.en, fr: country.fr }, region: country.region, city: city, address: address },
    productId: product.id,
    productName: product.name,
    color: color,
    size: size,
    qty: q.qty,
    cross: q.cross.map(function (l) { return l.id; }),
    addons: q.addons,
    currency: q.currency,
    amounts: { unit: q.unit, subtotal: q.subtotal, discount: q.discount, cross: q.crossTotal, addons: q.addonTotal, shipping: q.shipping, total: q.total },
    totalEUR: q.totalEUR,
    lang: b.lang === 'fr' ? 'fr' : 'en',
    note: note,
    adminNote: '',
    history: [{ status: 'new', at: new Date().toISOString() }]
  };
  db.orders.unshift(order);
  save();
  return { status: 201, body: { order: {
    id: order.id, qty: order.qty, cross: order.cross, currency: order.currency,
    amounts: order.amounts, name: name, phone: phone, city: city, country: country.code
  }, stock: product.stock } };
}

function orderProduct(o) {
  return findProduct(o.shipping.country, o.productId);
}

// The stock an order holds: its product (qty units) and each complementary product (1 unit).
// Products that have since been deleted are skipped.
function stockLines(o) {
  const lines = [];
  const p = orderProduct(o);
  if (p) lines.push([p, o.qty]);
  (o.addons || []).forEach(function (a) { const ap = findProduct(o.shipping.country, a.id); if (ap) lines.push([ap, 1]); });
  return lines;
}

function updateOrder(id, b) {
  const o = db.orders.find(function (x) { return x.id === id; });
  if (!o) return { status: 404, body: { error: 'not found' } };
  if (b.status !== undefined) {
    if (!GS.STATUSES.includes(b.status)) return { status: 400, body: { error: 'bad status' } };
    if (b.status !== o.status) {
      const wantHeld = holdsStock(b.status);
      if (o.stockHeld && !wantHeld) { stockLines(o).forEach(function (l) { l[0].stock += l[1]; }); o.stockHeld = false; }
      else if (!o.stockHeld && wantHeld) { stockLines(o).forEach(function (l) { l[0].stock = Math.max(0, l[0].stock - l[1]); }); o.stockHeld = true; }
      o.status = b.status;
      o.history.push({ status: b.status, at: new Date().toISOString() });
    }
  }
  if (b.adminNote !== undefined) o.adminNote = clean(b.adminNote, 500);
  save();
  return { status: 200, body: Object.assign({ order: o }, snapshot()) };
}

/* ---------- admin: validation ---------- */
function num(v, min, max) {
  const n = Number(v);
  return isFinite(n) && n >= min && n <= max ? n : null;
}

// Validates the editable fields of a country; `existing` is the country being edited (null when creating).
function readCountry(b, existing) {
  const out = {}, errors = {};
  if (!existing) {
    const code = clean(b.code, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) errors.code = 1;
    else if (findCountry(code)) errors.code = 'exists';
    out.code = code;
  }
  const src = existing || {};
  const slug = b.slug !== undefined ? clean(b.slug, 30).toLowerCase() : (src.slug || String(out.code || '').toLowerCase());
  if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(slug) || RESERVED_SLUGS.includes(slug)) errors.slug = 1;
  else if (db.countries.some(function (c) { return c.slug === slug && c !== existing; })) errors.slug = 'exists';
  out.slug = slug;
  ['en', 'fr'].forEach(function (k) {
    const v = b[k] !== undefined ? clean(b[k], 60) : src[k];
    if (!v) errors[k] = 1; else out[k] = v;
  });
  const currency = b.currency !== undefined ? clean(b.currency, 3).toUpperCase() : src.currency;
  if (!GS.CURRENCIES[currency]) errors.currency = 1; else out.currency = currency;
  const dial = b.dial !== undefined ? clean(b.dial, 4).replace(/\D/g, '') : src.dial;
  if (!/^\d{1,4}$/.test(dial || '')) errors.dial = 1; else out.dial = dial;
  const region = b.region !== undefined ? clean(b.region, 10) : src.region;
  if (!REGIONS.includes(region)) errors.region = 1; else out.region = region;
  out.active = b.active !== undefined ? !!b.active : (existing ? existing.active : true);
  if (!existing && !errors.code) out.flag = flagOf(out.code);
  return Object.keys(errors).length ? { errors: errors } : { value: out };
}

function readCategory(b, existing) {
  const src = existing || {}, out = {}, errors = {};
  ['en', 'fr'].forEach(function (k) {
    const v = b[k] !== undefined ? clean(b[k], 60) : src[k];
    if (!v) errors[k] = 1; else out[k] = v;
  });
  out.active = b.active !== undefined ? !!b.active : (existing ? existing.active : true);
  return Object.keys(errors).length ? { errors: errors } : { value: out };
}
function newCategoryId(code, en) {
  const base = code.toLowerCase() + '-' + (slugify(en) || 'category');
  let id = base, i = 2;
  while (findCategory(id)) id = base + '-' + (i++);
  return id;
}
function newProductId(code, name) {
  const base = slugify(name) || 'product';
  let id = base, i = 2;
  while (findProduct(code, id)) id = base + '-' + (i++);
  return id;
}

// Product media is an uploaded file (/uploads/<id>.<ext>); older https:// and /media/ paths stay valid.
function validMedia(u) {
  return u === '' || /^\/uploads\/[a-f0-9]{24}\.(?:jpg|png|webp|gif)$/.test(u) || /^(https:\/\/[^\s"'<>]+|\/media\/[A-Za-z0-9._\/-]+)$/.test(u);
}

// Validates a product for `countryCode`; `existing` is null when creating.
function readProduct(b, existing, countryCode) {
  const src = existing || {}, out = {}, errors = {};
  const name = b.name !== undefined ? clean(b.name, 80) : src.name;
  if (!name) errors.name = 1; else out.name = name;
  out.description = b.description !== undefined ? cleanText(b.description, 2000) : (src.description || '');
  const image = b.image !== undefined ? clean(b.image, 500) : (src.image || '');
  if (!validMedia(image)) errors.image = 1; else out.image = image;
  out.colorOptions = b.colorOptions !== undefined ? !!b.colorOptions : !!src.colorOptions;

  // French version (shown in francophone countries only)
  out.nameFr = b.nameFr !== undefined ? clean(b.nameFr, 80) : (src.nameFr || '');
  out.descriptionFr = b.descriptionFr !== undefined ? cleanText(b.descriptionFr, 2000) : (src.descriptionFr || '');
  const imageFr = b.imageFr !== undefined ? clean(b.imageFr, 500) : (src.imageFr || '');
  if (!validMedia(imageFr)) errors.imageFr = 1; else out.imageFr = imageFr;

  // extra gallery images / GIFs
  const gallery = b.gallery !== undefined ? b.gallery : (src.gallery || []);
  if (!Array.isArray(gallery) || gallery.length > 8 || !gallery.every(function (u) { return typeof u === 'string' && u && validMedia(u); })) errors.gallery = 1;
  else out.gallery = gallery.slice();
  // French versions of the gallery images, in the same order ('' = use the original)
  const galleryFr = b.galleryFr !== undefined ? b.galleryFr : (src.galleryFr || []);
  if (!Array.isArray(galleryFr) || !galleryFr.every(function (u) { return typeof u === 'string' && validMedia(u); })) errors.galleryFr = 1;
  else out.galleryFr = Array.from({ length: (out.gallery || []).length }, function (_, i) { return galleryFr[i] || ''; });

  // size variants (S, M, L, XL …)
  out.sizesEnabled = b.sizesEnabled !== undefined ? !!b.sizesEnabled : !!src.sizesEnabled;
  let sizes = b.sizes !== undefined ? b.sizes : (src.sizes || ['S', 'M', 'L', 'XL']);
  if (typeof sizes === 'string') sizes = sizes.split(/[,;\n]/);
  if (!Array.isArray(sizes)) errors.sizes = 1;
  else {
    sizes = Array.from(new Set(sizes.map(function (x) { return clean(x, 10); }).filter(Boolean)));
    if (sizes.length > 12 || (out.sizesEnabled && !sizes.length)) errors.sizes = 1; else out.sizes = sizes;
  }

  // quantity offers (bundles) with a discount
  const rawBundles = b.bundles !== undefined ? b.bundles : (src.bundles || []);
  if (!Array.isArray(rawBundles) || rawBundles.length > 6) errors.bundles = 1;
  else {
    const seen = {}, list = [];
    rawBundles.forEach(function (x) {
      const qty = num(x && x.qty, 1, 10), off = num(x && x.off, 0, 90);
      if (qty === null || off === null || seen[Math.floor(qty)]) { errors.bundles = 1; return; }
      seen[Math.floor(qty)] = 1;
      list.push({ qty: Math.floor(qty), off: Math.round(off), label: clean(x.label, 30) });
    });
    out.bundles = list.sort(function (p, q) { return p.qty - q.qty; });
  }

  // complementary products (cross-sell): other products of the same country
  const cross = b.crossSellIds !== undefined ? b.crossSellIds : (src.crossSellIds || []);
  if (!Array.isArray(cross) || cross.length > 6 || !cross.every(function (id) {
    return typeof id === 'string' && (!existing || id !== existing.id) && !!findProduct(countryCode, id);
  })) errors.crossSellIds = 1;
  else out.crossSellIds = Array.from(new Set(cross));

  // landing page blocks: heading + text + image/GIF
  const landing = b.landing !== undefined ? b.landing : (src.landing || []);
  if (!Array.isArray(landing) || landing.length > 12) errors.landing = 1;
  else {
    const blocks = [];
    landing.forEach(function (x) {
      const blk = {
        title: clean(x && x.title, 120), text: cleanText(x && x.text, 1500), media: clean(x && x.media, 500),
        titleFr: clean(x && x.titleFr, 120), textFr: cleanText(x && x.textFr, 1500), mediaFr: clean(x && x.mediaFr, 500)
      };
      if (!validMedia(blk.media) || !validMedia(blk.mediaFr)) { errors.landing = 1; return; }
      if (blk.title || blk.text || blk.media || blk.titleFr || blk.textFr || blk.mediaFr) blocks.push(blk);
    });
    out.landing = blocks;
  }
  const catId = b.categoryId !== undefined ? clean(b.categoryId, 80) : src.categoryId;
  const cat = findCategory(catId);
  if (!cat || cat.countryCode !== countryCode) errors.categoryId = 1; else out.categoryId = cat.id;
  [['price', 0.01, 1e9], ['compare', 0, 1e9], ['shipping', 0, 1e9]].forEach(function (f) {
    const n = num(b[f[0]] !== undefined ? b[f[0]] : src[f[0]], f[1], f[2]);
    if (n === null) errors[f[0]] = 1; else out[f[0]] = n;
  });
  const free = num(b.freeShippingQty !== undefined ? b.freeShippingQty : src.freeShippingQty, 1, 99);
  if (free === null) errors.freeShippingQty = 1; else out.freeShippingQty = Math.floor(free);
  const stock = num(b.stock !== undefined ? b.stock : src.stock, 0, 100000);
  if (stock === null) errors.stock = 1; else out.stock = Math.floor(stock);
  out.active = b.active !== undefined ? !!b.active : (existing ? existing.active : true);
  return Object.keys(errors).length ? { errors: errors } : { value: out };
}

/* ---------- routing ---------- */
async function handleApi(req, res, url) {
  const ip = clientIp(req);
  const route = req.method + ' ' + url.pathname;
  try {
    if (route === 'GET /api/countries') {
      return json(res, 200, { countries: db.countries.filter(function (c) { return c.active; }).map(publicCountry) });
    }

    if (route === 'GET /api/config') {
      const slug = clean(url.searchParams.get('country'), 30).toLowerCase();
      if (!slug) return json(res, 200, { rates: db.rates });
      const c = findBySlug(slug);
      if (!c || !c.active) return json(res, 404, { error: 'unknown country' });
      return json(res, 200, {
        country: publicCountry(c),
        categories: categoriesOf(c.code).filter(function (x) { return x.active; }).map(publicCategory),
        products: visibleProducts(c.code).map(publicProduct),
        rates: db.rates
      });
    }

    if (route === 'POST /api/orders') {
      if (limited('order:' + ip, 10, 3600 * 1000)) return json(res, 429, { error: 'rate' });
      const b = await readBody(req);
      if (b.website) return json(res, 201, { order: { id: 'GS-0000' }, stock: 0 }); // honeypot
      const r = createOrder(b);
      return json(res, r.status, r.body);
    }

    if (route === 'POST /api/admin/login') {
      // per-IP limit plus a global ceiling, so a spoofed X-Forwarded-For cannot bypass brute-force protection
      if (limited('login:' + ip, 8, 15 * 60 * 1000) || limited('login:all', 60, 15 * 60 * 1000)) return json(res, 429, { error: 'rate' });
      const b = await readBody(req);
      if (!safeEqual(b.password || '', ADMIN_PASSWORD)) return json(res, 401, { error: 'invalid' });
      return json(res, 200, { token: makeToken() });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'unauthorized' });

      /* media upload: the raw image bytes are the request body */
      if (route === 'POST /api/admin/uploads') {
        const buf = await readRaw(req, MAX_UPLOAD);
        const ext = imageExt(buf);
        if (!ext) return json(res, 415, { error: 'unsupported' });
        const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
        fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
        return json(res, 201, { url: '/uploads/' + name, size: buf.length });
      }

      /* French translation helpers (francophone countries). Keys come from the host's environment, never from the browser. */
      if (route === 'POST /api/admin/translate') {
        const b = await readBody(req);
        const items = Array.isArray(b.items) ? b.items.slice(0, 60).map(function (x) { return String(x == null ? '' : x).slice(0, 2000); }) : null;
        if (!items) return json(res, 400, { error: 'validation' });
        if (!process.env.ANTHROPIC_API_KEY) return json(res, 503, { error: 'no_anthropic_key' });
        try { return json(res, 200, { items: await translateTexts(items) }); }
        catch (e) { console.error('translate failed:', e.message); return json(res, 502, { error: 'translate_failed' }); }
      }
      if (route === 'POST /api/admin/translate-image') {
        const b = await readBody(req);
        const src = clean(b.url, 500);
        if (!src || !validMedia(src)) return json(res, 400, { error: 'validation' });
        if (!process.env.GEMINI_API_KEY) return json(res, 503, { error: 'no_gemini_key' });
        try { return json(res, 200, { url: await translateImage(src) }); }
        catch (e) { console.error('image translate failed:', e.message); return json(res, e.code === 'gif' ? 415 : 502, { error: e.code || 'translate_failed' }); }
      }

      if (route === 'GET /api/admin/data') return json(res, 200, Object.assign({ orders: db.orders, rates: db.rates }, snapshot()));

      if (route === 'PUT /api/admin/settings') {
        const b = await readBody(req);
        if (b.rates && typeof b.rates === 'object') {
          Object.keys(b.rates).forEach(function (cur) {
            const v = Number(b.rates[cur]);
            if (GS.CURRENCIES[cur] && !GS.CURRENCIES[cur].fixed && v > 0 && isFinite(v)) {
              if (v === GS.CURRENCIES[cur].rate) delete db.rates[cur]; else db.rates[cur] = v;
            }
          });
        }
        save();
        return json(res, 200, { rates: db.rates });
      }

      /* countries */
      if (route === 'POST /api/admin/countries') {
        const r = readCountry(await readBody(req), null);
        if (r.errors) return json(res, 400, { error: 'validation', fields: r.errors });
        r.value.catSeeded = false;
        db.countries.push(r.value);
        ensureCategories(r.value);
        const p = GS.defaultProduct(r.value.currency, db.rates);
        p.countryCode = r.value.code; p.categoryId = r.value.code.toLowerCase() + '-gadgets';
        db.products.push(p);
        save();
        return json(res, 201, Object.assign({ country: r.value }, snapshot()));
      }
      const mc = url.pathname.match(/^\/api\/admin\/countries\/([A-Za-z]{2})$/);
      if (mc) {
        const c = findCountry(mc[1].toUpperCase());
        if (!c) return json(res, 404, { error: 'not found' });
        if (req.method === 'PUT') {
          const r = readCountry(await readBody(req), c);
          if (r.errors) return json(res, 400, { error: 'validation', fields: r.errors });
          Object.assign(c, r.value);
          save();
          return json(res, 200, Object.assign({ country: c }, snapshot()));
        }
        if (req.method === 'DELETE') {
          db.countries.splice(db.countries.indexOf(c), 1);
          db.categories = db.categories.filter(function (x) { return x.countryCode !== c.code; });
          db.products = db.products.filter(function (x) { return x.countryCode !== c.code; });
          save(); collectGarbage();
          return json(res, 200, Object.assign({ ok: true }, snapshot()));
        }
      }

      /* categories: an independent list per country */
      if (route === 'POST /api/admin/categories/reorder') {
        const b = await readBody(req);
        const code = clean(b.countryCode, 2).toUpperCase();
        const list = categoriesOf(code);
        const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
        if (!findCountry(code) || ids.length !== list.length || !list.every(function (c) { return ids.includes(c.id); })) {
          return json(res, 400, { error: 'validation' });
        }
        ids.forEach(function (id, i) { findCategory(id).order = i; });
        save();
        return json(res, 200, snapshot());
      }
      if (route === 'POST /api/admin/categories') {
        const b = await readBody(req);
        const code = clean(b.countryCode, 2).toUpperCase();
        if (!findCountry(code)) return json(res, 400, { error: 'validation', fields: { countryCode: 1 } });
        const r = readCategory(b, null);
        if (r.errors) return json(res, 400, { error: 'validation', fields: r.errors });
        const order = categoriesOf(code).reduce(function (m, c) { return Math.max(m, c.order + 1); }, 0);
        const cat = Object.assign({ id: newCategoryId(code, r.value.en), countryCode: code, order: order }, r.value);
        db.categories.push(cat);
        save();
        return json(res, 201, Object.assign({ category: cat }, snapshot()));
      }
      const mk = url.pathname.match(/^\/api\/admin\/categories\/([A-Za-z0-9_-]+)$/);
      if (mk) {
        const cat = findCategory(mk[1]);
        if (!cat) return json(res, 404, { error: 'not found' });
        if (req.method === 'PUT') {
          const r = readCategory(await readBody(req), cat);
          if (r.errors) return json(res, 400, { error: 'validation', fields: r.errors });
          Object.assign(cat, r.value);
          save();
          return json(res, 200, Object.assign({ category: cat }, snapshot()));
        }
        if (req.method === 'DELETE') {
          const used = db.products.filter(function (p) { return p.categoryId === cat.id; }).length;
          if (used) return json(res, 409, { error: 'in use', count: used });
          db.categories.splice(db.categories.indexOf(cat), 1);
          categoriesOf(cat.countryCode).forEach(function (c, i) { c.order = i; });
          save();
          return json(res, 200, Object.assign({ ok: true }, snapshot()));
        }
      }

      /* products: each belongs to one country and one of that country's categories */
      if (route === 'POST /api/admin/products') {
        const b = await readBody(req);
        const country = findCountry(clean(b.countryCode, 2).toUpperCase());
        if (!country) return json(res, 400, { error: 'validation', fields: { countryCode: 1 } });
        const base = GS.defaultProduct(country.currency, db.rates);
        base.stock = 0; base.rich = false;
        const r = readProduct(Object.assign({}, { price: base.price, compare: base.compare, shipping: base.shipping, freeShippingQty: base.freeShippingQty, stock: 0 }, b), null, country.code);
        if (r.errors) return json(res, 400, { error: 'validation', fields: r.errors });
        const p = Object.assign({ id: newProductId(country.code, r.value.name), countryCode: country.code, rich: false }, r.value);
        db.products.push(p);
        save();
        return json(res, 201, Object.assign({ product: p }, snapshot()));
      }
      const mp = url.pathname.match(/^\/api\/admin\/products\/([A-Za-z]{2})\/([A-Za-z0-9_-]+)$/);
      if (mp) {
        const code = mp[1].toUpperCase();
        const p = findProduct(code, mp[2]);
        if (!p) return json(res, 404, { error: 'not found' });
        if (req.method === 'PUT') {
          const b = await readBody(req);
          if (b.countryCode !== undefined && clean(b.countryCode, 2).toUpperCase() !== code) {
            return json(res, 400, { error: 'validation', fields: { countryCode: 1 } }); // a product never changes country
          }
          const r = readProduct(b, p, code);
          if (r.errors) return json(res, 400, { error: 'validation', fields: r.errors });
          Object.assign(p, r.value);
          save(); collectGarbage();
          return json(res, 200, Object.assign({ product: p }, snapshot()));
        }
        if (req.method === 'DELETE') {
          db.products.splice(db.products.indexOf(p), 1);
          // other products no longer offer a deleted product as an add-on
          db.products.forEach(function (x) { if (x.countryCode === code) x.crossSellIds = x.crossSellIds.filter(function (id) { return id !== p.id; }); });
          save(); collectGarbage();
          return json(res, 200, Object.assign({ ok: true }, snapshot()));
        }
      }

      /* orders */
      const m = url.pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9-]+)$/);
      if (m && req.method === 'PATCH') {
        const r = updateOrder(m[1], await readBody(req));
        return json(res, r.status, r.body);
      }
      if (m && req.method === 'DELETE') {
        const i = db.orders.findIndex(function (x) { return x.id === m[1]; });
        if (i < 0) return json(res, 404, { error: 'not found' });
        const o = db.orders[i];
        if (o.stockHeld) stockLines(o).forEach(function (l) { l[0].stock += l[1]; });
        db.orders.splice(i, 1);
        save();
        return json(res, 200, Object.assign({ ok: true }, snapshot()));
      }
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, e.message === 'too large' ? 413 : 400, { error: e.message });
  }
}

/* URL structure:  /  country picker   ·   /<country>  that country's categories + products   ·   /<country>/<product>  product page */
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.startsWith('/uploads/')) {
    // uploaded media: the file name is a random id, so it can be cached for a long time
    const m = p.match(/^\/uploads\/([a-f0-9]{24}\.(?:jpg|png|webp|gif))$/);
    if (!m) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    return sendFile(req, res, path.join(UPLOAD_DIR, m[1]), 'public, max-age=31536000, immutable');
  }
  if (p === '/index.html' || p === '/country.html') return redirect(res, 301, '/');
  if (p === '/') p = '/home.html';
  else if (p === '/admin') p = '/admin.html';
  else {
    const m = p.match(/^\/([a-z0-9-]+)(?:\/([A-Za-z0-9_-]+))?(\/?)$/);
    const c = m && findBySlug(m[1]);
    if (c) {
      if (!c.active) return redirect(res, 302, '/');
      if (!m[2]) {
        if (m[3]) return redirect(res, 301, '/' + c.slug); // relative links need the URL without a trailing slash
        p = '/country.html';
      } else {
        const prod = visibleProducts(c.code).find(function (x) { return x.id === m[2]; });
        if (!prod) return redirect(res, 302, '/' + c.slug);
        if (m[3]) return redirect(res, 301, '/' + c.slug + '/' + prod.id);
        p = '/index.html';
      }
    }
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  sendFile(req, res, file, path.extname(file).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=300');
}

function sendFile(req, res, file, cache) {
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache
    }, SEC_HEADERS));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(function (req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'Bad request'); }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  try { serveStatic(req, res, url); } catch (e) { send(res, 400, 'Bad request'); }
});

server.listen(PORT, function () {
  console.log('Ghani Shop running:  http://localhost:' + PORT);
  console.log('Admin dashboard:     http://localhost:' + PORT + '/admin');
  console.log('Data directory:      ' + DATA_DIR);
  if (generated) console.log('Admin password (generated, saved in ' + PW_FILE + '): ' + ADMIN_PASSWORD);
  else if (!process.env.ADMIN_PASSWORD) console.log('Admin password is in ' + PW_FILE);
});
