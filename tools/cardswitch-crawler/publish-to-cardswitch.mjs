/**
 * Publish crawled CardSwitch card/miles JSON into a CardSwitch checkout.
 *
 *   CARDSWITCH_CRAWL_DIR=./data/cardswitch CARDSWITCH_DIR=./cardswitch \
 *     node tools/cardswitch-crawler/publish-to-cardswitch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.join(__dirname, '..', '..');

const srcRoot = path.resolve(
  process.env.CARDSWITCH_CRAWL_DIR || path.join(SYNC_ROOT, 'data', 'cardswitch'),
);
const destRoot = path.resolve(
  process.env.CARDSWITCH_DIR || path.join(SYNC_ROOT, 'cardswitch'),
);

function copyFile(rel) {
  const from = path.join(srcRoot, rel);
  const to = path.join(destRoot, rel);
  if (!fs.existsSync(from)) {
    console.warn('skip missing', rel);
    return false;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log('publish', rel);
  return true;
}

function listMilesJson() {
  const abs = path.join(srcRoot, 'miles_data');
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join('miles_data', name).replace(/\\/g, '/'));
}

function listBuiltinDataJson() {
  const base = path.join(srcRoot, 'cards', 'builtin');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = path.join('cards', 'builtin', entry.name, 'data.json').replace(/\\/g, '/');
    if (fs.existsSync(path.join(srcRoot, rel))) out.push(rel);
  }
  return out;
}

if (!fs.existsSync(srcRoot)) {
  console.error('Missing crawl output dir:', srcRoot);
  process.exit(1);
}
if (!fs.existsSync(destRoot)) {
  console.error('Missing CardSwitch dir:', destRoot);
  process.exit(1);
}

const files = [...listBuiltinDataJson(), ...listMilesJson()];
let n = 0;
for (const rel of files) {
  if (copyFile(rel)) n += 1;
}

const versionsFrom = path.join(srcRoot, 'data-versions.json');
if (fs.existsSync(versionsFrom)) {
  const destVersions = path.join(destRoot, 'data', 'cardswitch-versions.json');
  fs.mkdirSync(path.dirname(destVersions), { recursive: true });
  fs.copyFileSync(versionsFrom, destVersions);
  console.log('publish data/cardswitch-versions.json');
  n += 1;
}
console.log(`Published ${n} files\n  from: ${srcRoot}\n  to:   ${destRoot}`);
if (n === 0) process.exit(1);
