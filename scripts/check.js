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
['MA', 'CI', 'GA', 'ML', 'BF', 'SN'].forEach(function (c) {
  if (!GS.country(c)) { failed = true; console.error('FAIL missing country ' + c); }
});
process.exit(failed ? 1 : 0);
