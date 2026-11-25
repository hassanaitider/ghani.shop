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

/* ---------- tiny JSON store ---------- */
let db = { rates: {}, orders: [], seq: 0, countries: [] };
if (fs.existsSync(DB_FILE)) {
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
  catch (e) { console.error('Could not read store.json, starting empty:', e.message); }
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- countries & per-country catalogs ---------- */
const SEED_COUNTRIES = ['MA', 'CI', 'GA', 'ML', 'BF', 'SN']; // default cash-on-delivery targets
const RESERVED_SLUGS = ['admin', 'api', 'media'];
const REGIONS = ['central', 'africa', 'eeurope', 'other'];

function seedCountries() {
  // Stock that used to be global becomes each seeded country's own stock.
  const legacy = Number(db.stock);
  SEED_COUNTRIES.forEach(function (code) {
    const c = GS.country(code);
    if (!c) return;
    const p = GS.defaultProduct(c.currency, db.rates);
    if (isFinite(legacy) && legacy >= 0 && db.stock !== undefined) p.stock = Math.floor(legacy);
    db.countries.push({
      code: c.code, slug: c.code.toLowerCase(), en: c.en, fr: c.fr, region: c.region,
      currency: c.currency, dial: c.dial, active: true, products: [p]
    });
  });
  delete db.stock;
  save();
  console.log('Seeded default countries: ' + SEED_COUNTRIES.join(', '));
}
if (!Array.isArray(db.countries) || !db.countries.length) { db.countries = []; seedCountries(); }

function findCountry(code) { return db.countries.find(function (c) { return c.code === code; }); }
function findBySlug(slug) { return db.countries.find(function (c) { return c.slug === slug; }); }
function findProduct(c, id) { return c && c.products.find(function (p) { return p.id === id; }); }
function publicCountry(c) {
  return { code: c.code, slug: c.slug, en: c.en, fr: c.fr, currency: c.currency, dial: c.dial, region: c.region };
}
function publicProduct(p) {
  return { id: p.id, name: p.name, price: p.price, compare: p.compare, shipping: p.shipping, freeShippingQty: p.freeShippingQty, stock: p.stock };
}

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
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
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
  let product = null;
  if (country) {
    const live = country.products.filter(function (p) { return p.active; });
    product = b.productId ? live.find(function (p) { return p.id === b.productId; }) : live[0];
    if (!product) errors.product = 1;
  }
  if (Object.keys(errors).length) return { status: 400, body: { error: 'validation', fields: errors } };

  // Cash on delivery is collected in the destination country's currency, at that country's own prices
  const q = GS.quote({ qty: b.qty, cross: Array.isArray(b.cross) ? b.cross : [], currency: country.currency, rates: db.rates, product: product });
  if (q.qty > product.stock) return { status: 409, body: { error: 'stock', stock: product.stock } };

  db.seq += 1;
  product.stock -= q.qty;
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
    qty: q.qty,
    cross: q.cross.map(function (l) { return l.id; }),
    currency: q.currency,
    amounts: { unit: q.unit, subtotal: q.subtotal, discount: q.discount, cross: q.crossTotal, shipping: q.shipping, total: q.total },
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
  return findProduct(findCountry(o.shipping.country), o.productId);
}

function updateOrder(id, b) {
  const o = db.orders.find(function (x) { return x.id === id; });
  if (!o) return { status: 404, body: { error: 'not found' } };
  const prod = orderProduct(o); // null for orders whose product/country has since been deleted
  if (b.status !== undefined) {
    if (!GS.STATUSES.includes(b.status)) return { status: 400, body: { error: 'bad status' } };
    if (b.status !== o.status) {
      const wantHeld = holdsStock(b.status);
      if (o.stockHeld && !wantHeld) { if (prod) prod.stock += o.qty; o.stockHeld = false; }
      else if (!o.stockHeld && wantHeld) { if (prod) prod.stock = Math.max(0, prod.stock - o.qty); o.stockHeld = true; }
      o.status = b.status;
      o.history.push({ status: b.status, at: new Date().toISOString() });
    }
  }
  if (b.adminNote !== undefined) o.adminNote = clean(b.adminNote, 500);
  save();
  return { status: 200, body: { order: o, countries: db.countries } };
}

/* ---------- admin: countries & products ---------- */
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
  return Object.keys(errors).length ? { errors: errors } : { value: out };
}

function readProduct(b, existing) {
  const src = existing || {}, out = {}, errors = {};
  const name = b.name !== undefined ? clean(b.name, 80) : src.name;
  if (!name) errors.name = 1; else out.name = name;
  const fields = [['price', 0.01, 1e9], ['compare', 0, 1e9], ['shipping', 0, 1e9]];
  fields.forEach(function (f) {
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

function newProductId(c) {
  let i = c.products.length + 1;
  while (c.products.some(function (p) { return p.id === 'p' + i; })) i++;
  return 'p' + i;
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
        products: c.products.filter(function (p) { return p.active; }).map(publicProduct),
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

      if (route === 'GET /api/admin/data') return json(res, 200, { orders: db.orders, rates: db.rates, countries: db.countries });

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
        r.value.products = [GS.defaultProduct(r.value.currency, db.rates)];
        db.countries.push(r.value);
        save();
        return json(res, 201, { country: r.value, countries: db.countries });
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
          return json(res, 200, { country: c, countries: db.countries });
        }
        if (req.method === 'DELETE') {
          db.countries.splice(db.countries.indexOf(c), 1);
          save();
          return json(res, 200, { ok: true, countries: db.countries });
        }
      }

      /* products (each country has its own catalog) */
      const mp = url.pathname.match(/^\/api\/admin\/countries\/([A-Za-z]{2})\/products(?:\/([A-Za-z0-9_-]+))?$/);
      if (mp) {
        const c = findCountry(mp[1].toUpperCase());
        if (!c) return json(res, 404, { error: 'not found' });
        if (req.method === 'POST' && !mp[2]) {
          const body = await readBody(req);
          const base = GS.defaultProduct(c.currency, db.rates);
          base.name = clean(body.name, 80) || 'New product';
          base.stock = 0;
          const r = readProduct(Object.assign({}, base, body, { name: base.name }), null);
          if (r.errors) return json(res, 400, { error: 'validation', fields: r.errors });
          r.value.id = newProductId(c);
          c.products.push(r.value);
          save();
          return json(res, 201, { product: r.value, countries: db.countries });
        }
        const p = mp[2] && findProduct(c, mp[2]);
        if (!p) return json(res, 404, { error: 'not found' });
        if (req.method === 'PUT') {
          const r = readProduct(await readBody(req), p);
          if (r.errors) return json(res, 400, { error: 'validation', fields: r.errors });
          Object.assign(p, r.value);
          save();
          return json(res, 200, { product: p, countries: db.countries });
        }
        if (req.method === 'DELETE') {
          c.products.splice(c.products.indexOf(p), 1);
          save();
          return json(res, 200, { ok: true, countries: db.countries });
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
        if (o.stockHeld) { const prod = orderProduct(o); if (prod) prod.stock += o.qty; }
        db.orders.splice(i, 1);
        save();
        return json(res, 200, { ok: true, countries: db.countries });
      }
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, e.message === 'too large' ? 413 : 400, { error: e.message });
  }
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/index.html') return redirect(res, 301, '/');
  if (p === '/') p = '/home.html';
  else if (p === '/admin') p = '/admin.html';
  else {
    const m = p.match(/^\/([a-z0-9-]+)(\/?)$/);
    const c = m && findBySlug(m[1]);
    if (c) {
      if (!c.active) return redirect(res, 302, '/');
      if (m[2]) return redirect(res, 301, '/' + c.slug); // relative assets need the URL without a trailing slash
      p = '/index.html';
    }
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
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
