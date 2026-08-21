/**
 * @deprecated Data is written directly to data/pay via PAY_DATA_DIR.
 * Kept only for optional local sync from sibling pxplus-activities.
 *
 *   node automation/pay-pipeline/sync-data.mjs --from-pxplus
 *   node automation/pay-pipeline/sync-data.mjs --to-pxplus
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CS_ROOT = path.join(__dirname, '..', '..');
const PAY_DIR = path.join(CS_ROOT, 'data', 'pay');

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
];

function resolvePxplusData() {
  const envPath = process.env.PXPLUS_ACTIVITIES_PATH;
  const candidates = [
    envPath ? path.join(envPath, 'data') : null,
    path.join(CS_ROOT, '..', 'pxplus-activities', 'data'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function copyFiles(srcDir, destDir, files, label) {
  fs.mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const file of files) {
    const from = path.join(srcDir, file);
    const to = path.join(destDir, file);
    if (!fs.existsSync(from)) {
      console.warn(`  skip missing: ${file}`);
      continue;
    }
    fs.copyFileSync(from, to);
    console.log(`  OK ${file}`);
    n++;
  }
  console.log(`Synced ${n} files ${label}`);
}

const toPxplus = process.argv.includes('--to-pxplus');
const pxData = resolvePxplusData();
if (!pxData) {
  console.error('No sibling pxplus-activities/data found (optional tool only).');
  console.error('Normal pipeline writes directly to data/pay — use: npm run pay:pipeline');
  process.exit(1);
}

if (toPxplus) copyFiles(PAY_DIR, pxData, FILES, 'CardSwitch → pxplus');
else copyFiles(pxData, PAY_DIR, FILES, 'pxplus → CardSwitch/data/pay');
