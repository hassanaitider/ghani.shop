'use strict';
// "Build" step: this project has no bundler or TypeScript, so verify every script parses and the shared model works.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = ['server.js'].concat(
  fs.readdirSync(path.join(root, 'public')).filter(function (f) { return f.endsWith('.js'); }).map(function (f) { return path.join('public', f); })
);
let failed = false;
files.forEach(function (f) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
  if (r.status !== 0) { failed = true; console.error('FAIL ' + f + '\n' + r.stderr); } else console.log('ok   ' + f);
});

const GS = require(path.join(root, 'public', 'shared.js'));
const q = GS.quote({ qty: 2, currency: 'MAD', rates: {}, product: GS.defaultProduct('MAD', {}) });
if (!(q.total > 0) || q.currency !== 'MAD') { failed = true; console.error('FAIL shared.js quote'); } else console.log('ok   quote(MAD) = ' + q.total);
// [code, currency, dial] for every target country
const TARGETS = [
  ['MA', 'MAD', '212'], ['CI', 'XOF', '225'], ['GA', 'XAF', '241'], ['ML', 'XOF', '223'], ['BF', 'XOF', '226'], ['SN', 'XOF', '221'],
  ['KE', 'KES', '254'], ['TZ', 'TZS', '255'], ['ZM', 'ZMW', '260'], ['GH', 'GHS', '233'], ['UG', 'UGX', '256'], ['SS', 'SSP', '211'],
  ['SK', 'EUR', '421'], ['SI', 'EUR', '386'], ['ES', 'EUR', '34'], ['AT', 'EUR', '43'], ['BG', 'BGN', '359'], ['HR', 'EUR', '385'],
  ['CZ', 'CZK', '420'], ['FR', 'EUR', '33'], ['DE', 'EUR', '49'], ['GR', 'EUR', '30'], ['HU', 'HUF', '36'], ['IT', 'EUR', '39'],
  ['MK', 'MKD', '389'], ['PL', 'PLN', '48'], ['PT', 'EUR', '351'], ['RO', 'RON', '40']
];
TARGETS.forEach(function (t) {
  const c = GS.country(t[0]);
  if (!c || c.currency !== t[1] || c.dial !== t[2] || !GS.CURRENCIES[t[1]]) { failed = true; console.error('FAIL country ' + t[0]); }
});
console.log('ok   ' + TARGETS.length + ' target countries (currency + dial code)');
process.exit(failed ? 1 : 0);
