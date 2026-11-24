'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const GS = require('./public/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const PW_FILE = path.join(DATA_DIR, 'admin-password.txt');

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- admin password (env var, or generated once and saved locally) ---------- */
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
const SECRET = crypto.randomBytes(32);

/* ---------- tiny JSON store ---------- */
let db = { stock: GS.PRODUCT.initialStock, rates: {}, orders: [], seq: 0 };
if (fs.existsSync(DB_FILE)) {
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
  catch (e) { console.error('Could not read store.json, starting empty:', e.message); }
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
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
function publicConfig() {
  return { stock: db.stock, rates: db.rates };
}
function holdsStock(status) { return status !== 'cancelled' && status !== 'returned'; }

function createOrder(b, ip) {
  const errors = {};
  const name = clean(b.name, 80);
  const phoneDigits = clean(b.phone, 25).replace(/\D/g, '');
  const country = GS.country(clean(b.country, 2));
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
  if (Object.keys(errors).length) return { status: 400, body: { error: 'validation', fields: errors } };

  // Cash on delivery is collected in the destination country's currency
  const currency = country.currency;
  const q = GS.quote({ qty: b.qty, cross: Array.isArray(b.cross) ? b.cross : [], currency: currency, rates: db.rates });
  if (q.qty > db.stock) return { status: 409, body: { error: 'stock', stock: db.stock } };

  db.seq += 1;
  db.stock -= q.qty;
  const phone = '+' + (phoneDigits.startsWith(country.dial) && phoneDigits.length > country.dial.length + 6
    ? phoneDigits : country.dial + phoneDigits.replace(/^0+/, ''));
  const order = {
    id: 'GS-' + String(1000 + db.seq),
    createdAt: new Date().toISOString(),
    status: 'new',
    stockHeld: true,
    customer: { name: name, phone: phone, email: email },
    shipping: { country: country.code, region: country.region, city: city, address: address },
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
  }, stock: db.stock } };
}

function updateOrder(id, b) {
  const o = db.orders.find(function (x) { return x.id === id; });
  if (!o) return { status: 404, body: { error: 'not found' } };
  if (b.status !== undefined) {
    if (!GS.STATUSES.includes(b.status)) return { status: 400, body: { error: 'bad status' } };
    if (b.status !== o.status) {
      const wantHeld = holdsStock(b.status);
      if (o.stockHeld && !wantHeld) { db.stock += o.qty; o.stockHeld = false; }
      else if (!o.stockHeld && wantHeld) { db.stock = Math.max(0, db.stock - o.qty); o.stockHeld = true; }
      o.status = b.status;
      o.history.push({ status: b.status, at: new Date().toISOString() });
    }
  }
  if (b.adminNote !== undefined) o.adminNote = clean(b.adminNote, 500);
  save();
  return { status: 200, body: { order: o, stock: db.stock } };
}

/* ---------- routing ---------- */
async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress || '';
  const route = req.method + ' ' + url.pathname;
  try {
    if (route === 'GET /api/config') return json(res, 200, publicConfig());

    if (route === 'POST /api/orders') {
      if (limited('order:' + ip, 10, 3600 * 1000)) return json(res, 429, { error: 'rate' });
      const b = await readBody(req);
      if (b.website) return json(res, 201, { order: { id: 'GS-0000' }, stock: db.stock }); // honeypot
      const r = createOrder(b, ip);
      return json(res, r.status, r.body);
    }

    if (route === 'POST /api/admin/login') {
      if (limited('login:' + ip, 8, 15 * 60 * 1000)) return json(res, 429, { error: 'rate' });
      const b = await readBody(req);
      if (!safeEqual(b.password || '', ADMIN_PASSWORD)) return json(res, 401, { error: 'invalid' });
      return json(res, 200, { token: makeToken() });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'unauthorized' });

      if (route === 'GET /api/admin/data') return json(res, 200, { orders: db.orders, stock: db.stock, rates: db.rates });

      if (route === 'PUT /api/admin/settings') {
        const b = await readBody(req);
        if (b.stock !== undefined) {
          const s = Math.floor(Number(b.stock));
          if (!(s >= 0 && s <= 100000)) return json(res, 400, { error: 'bad stock' });
          db.stock = s;
        }
        if (b.rates && typeof b.rates === 'object') {
          Object.keys(b.rates).forEach(function (cur) {
            const v = Number(b.rates[cur]);
            if (GS.CURRENCIES[cur] && !GS.CURRENCIES[cur].fixed && v > 0 && isFinite(v)) {
              if (v === GS.CURRENCIES[cur].rate) delete db.rates[cur]; else db.rates[cur] = v;
            }
          });
        }
        save();
        return json(res, 200, { stock: db.stock, rates: db.rates });
      }

      const m = url.pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9-]+)$/);
      if (m && req.method === 'PATCH') {
        const r = updateOrder(m[1], await readBody(req));
        return json(res, r.status, r.body);
      }
      if (m && req.method === 'DELETE') {
        const i = db.orders.findIndex(function (x) { return x.id === m[1]; });
        if (i < 0) return json(res, 404, { error: 'not found' });
        const o = db.orders[i];
        if (o.stockHeld) db.stock += o.qty;
        db.orders.splice(i, 1);
        save();
        return json(res, 200, { ok: true, stock: db.stock });
      }
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, e.message === 'too large' ? 413 : 400, { error: e.message });
  }
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
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
  if (generated) console.log('Admin password (generated, saved in data/admin-password.txt): ' + ADMIN_PASSWORD);
  else if (!process.env.ADMIN_PASSWORD) console.log('Admin password is in data/admin-password.txt');
});
