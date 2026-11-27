#!/usr/bin/env node
/*
 * Builds the localized versions of the "Pack de 2 sacs" infographics with Gemini image editing.
 * The French originals live in public/media/sacs-pvc/{pack-de-2,organisation,capacite}.webp and carry their text inside the picture,
 * so each market needs its own images:
 *   en/pack-de-2, en/organisation          -> English (shared by all English-speaking countries)
 *   en/capacite-<CC>                       -> English + the local price (TZ KE ZM UG SS GH)
 *   fr/capacite-<CC>                       -> French + the local price (GN CD; the CFA price is baked in the original)
 *
 * Usage (PowerShell):   $env:GEMINI_API_KEY = "..."; node scripts/translate-sacs-images.js
 * Options:              --only=en | --only=fr      --force (regenerate files that already exist)
 * Then restart the server: it picks the new images up on startup. Always check the generated images by eye (prices especially).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Set GEMINI_API_KEY first.'); process.exit(1); }
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const DIR = path.join(__dirname, '..', 'public', 'media', 'sacs-pvc');
const only = (process.argv.find(function (a) { return a.startsWith('--only='); }) || '').split('=')[1];
const force = process.argv.includes('--force');

const EN_PRICES = { TZ: '81,999 TSh', KE: '3,999 KSh', ZM: '699 ZMW', UG: '13,499 USh', SS: '3,999 SSP', GH: '359 GHS' };
const FR_PRICES = { GN: '330 000 GNF', CD: '88 500 FC' };

const STYLE = 'Keep the exact same layout, fonts, colors, photos, icons and style; change only the wording of the text. Numbers, symbols and measurements (38cm, 24cm, 32cm) stay as they are. Return the edited image.';
function enPrompt(price) {
  return 'Edit this product infographic: translate every piece of French text in it into natural, persuasive English (marketing tone, same meaning). ' +
    (price ? 'The big gold price badge currently reads "19999 CFA": replace it with exactly "' + price + '" (same size, same style). ' : '') + STYLE;
}
function frPrompt(price) {
  return 'Edit this product infographic: the big gold price badge currently reads "19999 CFA". Replace it with exactly "' + price + '" (same size, same style). ' +
    'Do not change anything else: all the French text, photos and layout stay identical. Return the edited image.';
}

function sniff(b) {
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (b[0] === 0x89 && b.slice(1, 4).toString('latin1') === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
  throw new Error('unknown image format');
}
function exists(rel) { return ['webp', 'png', 'jpg'].some(function (e) { return fs.existsSync(path.join(DIR, rel + '.' + e)); }); }

async function edit(srcFile, prompt) {
  const buf = fs.readFileSync(srcFile);
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: sniff(buf).mime, data: buf.toString('base64') } }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    }),
    signal: AbortSignal.timeout(180000)
  });
  if (!r.ok) throw new Error('gemini ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const img = parts.find(function (p) { return (p.inlineData || p.inline_data || {}).data; });
  if (!img) throw new Error('no image returned');
  return Buffer.from((img.inlineData || img.inline_data).data, 'base64');
}

async function make(rel, srcName, prompt) {
  if (!force && exists(rel)) { console.log('skip   ' + rel + ' (exists)'); return; }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const out = await edit(path.join(DIR, srcName + '.webp'), prompt);
      const fmt = sniff(out), file = path.join(DIR, rel + '.' + fmt.ext);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, out);
      console.log('ok     ' + rel + '.' + fmt.ext);
      return;
    } catch (e) { console.log('retry  ' + rel + ': ' + e.message); }
  }
  console.log('FAILED ' + rel);
}

(async function () {
  if (only !== 'fr') {
    await make('en/pack-de-2', 'pack-de-2', enPrompt(''));
    await make('en/organisation', 'organisation', enPrompt(''));
    for (const cc of Object.keys(EN_PRICES)) await make('en/capacite-' + cc, 'capacite', enPrompt(EN_PRICES[cc]));
  }
  if (only !== 'en') {
    for (const cc of Object.keys(FR_PRICES)) await make('fr/capacite-' + cc, 'capacite', frPrompt(FR_PRICES[cc]));
  }
  console.log('Done. Restart the server, then check the pages and the prices inside the images.');
})();
