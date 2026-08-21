/**
 * Seed or refresh cf-static-sync/data/pay from a CardSwitch pay folder.
 *
 *   node tools/pay-pipeline/seed-pay-cache.mjs
 *   node tools/pay-pipeline/seed-pay-cache.mjs --from "C:/path/to/CardSwitch-main/data/pay"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.join(__dirname, '..', '..');
const DEST = path.join(SYNC_ROOT, 'data', 'pay');
const WORKSPACE = path.join(SYNC_ROOT, '..', '..');

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const fromArg = fromIdx >= 0 ? args[fromIdx + 1] : null;

const candidates = [
  fromArg,
  process.env.PAY_SEED_FROM,
  path.join(WORKSPACE, 'CardSwitch-main', 'data', 'pay'),
  path.join(SYNC_ROOT, 'cardswitch', 'data', 'pay'),
].filter(Boolean);

const src = candidates.find((p) => fs.existsSync(p));
if (!src) {
  console.error('No seed source found. Pass --from <CardSwitch data/pay>');
  process.exit(1);
}

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

fs.mkdirSync(DEST, { recursive: true });
let n = 0;
for (const file of FILES) {
  const from = path.join(src, file);
  if (!fs.existsSync(from)) {
    if (file === '.gitignore') {
      fs.writeFileSync(path.join(DEST, file), 'ocr-cache/\nai-quota.json\n*.log\n', 'utf8');
      n++;
      continue;
    }
    console.warn('skip missing', file);
    continue;
  }
  fs.copyFileSync(from, path.join(DEST, file));
  console.log('OK', file);
  n++;
}
console.log(`Seeded ${n} files\n  from: ${src}\n  to:   ${DEST}`);
