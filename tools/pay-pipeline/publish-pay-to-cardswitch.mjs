/**
 * Copy cf-static-sync/data/pay → CardSwitch checkout data/pay (CI / local).
 *
 *   PAY_DATA_DIR=./data/pay CARDSWITCH_PAY_DIR=./cardswitch/data/pay \
 *     node tools/pay-pipeline/publish-pay-to-cardswitch.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.join(__dirname, '..', '..');

const FILES = [
  'platforms.json',
  'search_aliases.json',
  'activities.json',
  'ipass-activities.json',
  'jko-activities.json',
  'easy-activities.json',
  'icash-activities.json',
  'plus-activities.json',
  'linepay-activities.json',
  '.gitignore',
];

const src = path.resolve(process.env.PAY_DATA_DIR || path.join(SYNC_ROOT, 'data', 'pay'));
const dest = path.resolve(
  process.env.CARDSWITCH_PAY_DIR || path.join(SYNC_ROOT, 'cardswitch', 'data', 'pay')
);

if (!fs.existsSync(src)) {
  console.error('Missing source pay dir:', src);
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
let n = 0;
for (const file of FILES) {
  const from = path.join(src, file);
  if (!fs.existsSync(from)) {
    console.warn('skip missing', file);
    continue;
  }
  fs.copyFileSync(from, path.join(dest, file));
  console.log('publish', file);
  n++;
}
console.log(`Published ${n} files\n  from: ${src}\n  to:   ${dest}`);
