/**
 * Sync crawler sources from local pxplus-activities into this package,
 * and patch data paths to use PAY_DATA_DIR (CardSwitch data/pay).
 *
 * Usage (from cf-static-sync-main):
 *   node tools/pay-activities/vendor-from-pxplus.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEST = __dirname;
const SYNC_ROOT = path.join(__dirname, '..', '..');

function resolvePxplusRoot() {
  const candidates = [
    process.env.PXPLUS_ACTIVITIES_PATH,
    path.join(SYNC_ROOT, '..', '..', 'pxplus-activities'),
    path.join(SYNC_ROOT, '..', 'pxplus-activities'),
    path.join(SYNC_ROOT, 'pxplus-activities'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'scripts'))) return path.resolve(p);
  }
  return null;
}

const SRC = resolvePxplusRoot();
if (!SRC) {
  console.error('Cannot find pxplus-activities. Set PXPLUS_ACTIVITIES_PATH.');
  process.exit(1);
}

const SCRIPT_FILES = [
  'fetch-all.mjs',
  'fetch-activities.mjs',
  'fetch-easy.mjs',
  'fetch-icash.mjs',
  'fetch-ipass.mjs',
  'fetch-jko.mjs',
  'fetch-linepay.mjs',
  'fetch-plus.mjs',
  'activity-cache.mjs',
  'platform-catalog.mjs',
  'brand-aliases.mjs',
  'date-extract.mjs',
  'image-urls.mjs',
  'ocr-dates.mjs',
  'ai-backfill.mjs',
  'ai-escalate.mjs',
  'ai-extract.mjs',
  'ai-client.mjs',
  'ai-risk.mjs',
  'ai-quota.mjs',
  'ai-verify.mjs',
];

const VIEWER_FILES = ['banks.js', 'quota-full.js', 'ipass-addons.js'];

function mustExist(p) {
  if (!fs.existsSync(p)) throw new Error('Missing: ' + p);
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function patchDataDir(code) {
  let s = code;

  // platform-catalog / ai-quota style
  s = s.replace(
    /const CATALOG_PATH = path\.join\(__dirname, '\.\.', 'data', 'platforms\.json'\);/,
    "const CATALOG_PATH = path.join(process.env.PAY_DATA_DIR || path.join(__dirname, '..', 'data'), 'platforms.json');"
  );
  s = s.replace(
    /const QUOTA_PATH = path\.join\(__dirname, '\.\.', 'data', 'ai-quota\.json'\);/,
    "const QUOTA_PATH = path.join(process.env.PAY_DATA_DIR || path.join(__dirname, '..', 'data'), 'ai-quota.json');"
  );

  // fetch / ai-backfill / ai-escalate style
  s = s.replace(
    /const DATA_DIR = path\.join\(ROOT, 'data'\);/g,
    "const DATA_DIR = process.env.PAY_DATA_DIR || path.join(ROOT, 'data');"
  );
  s = s.replace(
    /const DATA_DIR = path\.join\(__dirname, '\.\.', 'data'\);/g,
    "const DATA_DIR = process.env.PAY_DATA_DIR || path.join(__dirname, '..', 'data');"
  );

  // ocr-dates / deep-search
  s = s.replace(
    /const DATA_PATH = path\.join\(ROOT, 'data', 'activities\.json'\);/g,
    "const DATA_PATH = path.join(process.env.PAY_DATA_DIR || path.join(ROOT, 'data'), 'activities.json');"
  );
  s = s.replace(
    /const CACHE_DIR = path\.join\(ROOT, 'data', 'ocr-cache'\);/g,
    "const CACHE_DIR = path.join(process.env.PAY_DATA_DIR || path.join(ROOT, 'data'), 'ocr-cache');"
  );
  s = s.replace(
    /const reportPath = path\.join\(ROOT, 'data', 'ocr-results\.json'\);/g,
    "const reportPath = path.join(process.env.PAY_DATA_DIR || path.join(ROOT, 'data'), 'ocr-results.json');"
  );
  s = s.replace(
    /const outPath = path\.join\(ROOT, 'data', 'deep-date-search\.json'\);/g,
    "const outPath = path.join(process.env.PAY_DATA_DIR || path.join(ROOT, 'data'), 'deep-date-search.json');"
  );

  return s;
}

mustExist(SRC);
mustExist(path.join(SRC, 'scripts'));

for (const f of SCRIPT_FILES) {
  const from = path.join(SRC, 'scripts', f);
  if (!fs.existsSync(from)) {
    console.warn('skip missing script', f);
    continue;
  }
  const raw = fs.readFileSync(from, 'utf8');
  const to = path.join(DEST, 'scripts', f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, patchDataDir(raw), 'utf8');
  console.log('script', f);
}

for (const f of VIEWER_FILES) {
  const from = path.join(SRC, 'viewer', f);
  mustExist(from);
  copyFile(from, path.join(DEST, 'viewer', f));
  console.log('viewer', f);
}

const pkg = {
  name: 'cardswitch-pay-activities',
  private: true,
  type: 'module',
  description: 'Vendored pay crawlers/AI; data lives in CardSwitch-main/data/pay via PAY_DATA_DIR',
  scripts: {
    'fetch:all': 'node scripts/fetch-all.mjs',
    'fetch:linepay': 'node scripts/fetch-linepay.mjs',
    ocr: 'node scripts/ocr-dates.mjs',
    'ai:backfill': 'node scripts/ai-backfill.mjs',
    'ai:escalate': 'node scripts/ai-escalate.mjs',
    'vendor:update': 'node vendor-from-pxplus.mjs',
  },
  dependencies: {
    cheerio: '^1.2.0',
    dotenv: '^17.4.2',
    sharp: '^0.34.3',
    'tesseract.js': '^6.0.1',
  },
};
fs.writeFileSync(path.join(DEST, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');

const gitignore = ['node_modules/', '.env', 'data/', '*.log'];
fs.writeFileSync(path.join(DEST, '.gitignore'), gitignore.join('\n') + '\n', 'utf8');

console.log('\nVendored into', DEST);
console.log('Set PAY_DATA_DIR to CardSwitch-main/data/pay when running.');
