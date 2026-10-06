/**
 * Copy icash-uniopen-quota.json into CardSwitch and bump cardswitch-versions.json.
 *
 *   CARDSWITCH_DIR=./cardswitch node tools/icash-uniopen-quota/publish-to-cardswitch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.join(__dirname, '..', '..');

const srcFile = path.resolve(
  process.env.ICASH_QUOTA_OUT
    || path.join(SYNC_ROOT, 'data', 'cardswitch', 'icash-uniopen-quota.json'),
);
const destRoot = path.resolve(
  process.env.CARDSWITCH_DIR || path.join(SYNC_ROOT, 'cardswitch'),
);
const destFile = path.join(destRoot, 'data', 'icash-uniopen-quota.json');
const versionsPath = path.join(destRoot, 'data', 'cardswitch-versions.json');
const VERSION_KEY = 'data/icash-uniopen-quota.json';

if (!fs.existsSync(srcFile)) {
  console.error('Missing quota status file:', srcFile);
  process.exit(1);
}
if (!fs.existsSync(destRoot)) {
  console.error('Missing CardSwitch dir:', destRoot);
  process.exit(1);
}

fs.mkdirSync(path.dirname(destFile), { recursive: true });
fs.copyFileSync(srcFile, destFile);
console.log('publish', VERSION_KEY);

const nowIso = new Date().toISOString();
let versions = { updatedAt: nowIso, files: {} };
if (fs.existsSync(versionsPath)) {
  try {
    versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
  } catch (_) { /* ignore */ }
}
if (!versions.files || typeof versions.files !== 'object') versions.files = {};
versions.files[VERSION_KEY] = nowIso;
versions.updatedAt = nowIso;
fs.mkdirSync(path.dirname(versionsPath), { recursive: true });
fs.writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`, 'utf8');
console.log('publish data/cardswitch-versions.json');
