import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../wrangler/wrangler.toml');

function requireEnv(name) {
  const v = String(process.env[name] || '').trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

const metaName = requireEnv('D1_META_NAME');
const metaId = requireEnv('D1_META_ID');
const stores0Name = requireEnv('D1_STORES_0_NAME');
const stores0Id = requireEnv('D1_STORES_0_ID');

const lines = [
  'name = "edge-static-sync-cli"',
  'compatibility_date = "2024-09-23"',
  '',
  '[[d1_databases]]',
  'binding = "META"',
  `database_name = "${metaName}"`,
  `database_id = "${metaId}"`,
  '',
  '[[d1_databases]]',
  'binding = "STORES_0"',
  `database_name = "${stores0Name}"`,
  `database_id = "${stores0Id}"`,
  ''
];

for (let i = 1; i <= 9; i += 1) {
  const name = String(process.env[`D1_STORES_${i}_NAME`] || '').trim();
  const id = String(process.env[`D1_STORES_${i}_ID`] || '').trim();
  if (!name && !id) continue;
  if (!name || !id) {
    console.error(`D1_STORES_${i}_NAME and D1_STORES_${i}_ID must both be set`);
    process.exit(1);
  }
  lines.push('[[d1_databases]]', `binding = "STORES_${i}"`, `database_name = "${name}"`, `database_id = "${id}"`, '');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`Wrote ${outPath}`);
