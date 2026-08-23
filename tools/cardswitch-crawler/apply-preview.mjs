#!/usr/bin/env node
/**
 * Copy crawler preview output into production paths after manual review.
 *
 * Usage:
 *   node automation/github-crawler/apply-preview.mjs --dir automation/github-crawler/preview/latest
 *   node automation/github-crawler/apply-preview.mjs --dir ./downloaded-artifact --dry-run
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableJsonStringify } from './parsers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const OUTPUT_FILES = [
  'cards/builtin/cathay/data.json',
  'cards/builtin/taishin/data.json',
  'cards/builtin/esun/data.json',
  'cards/builtin/ctbcLinepay/data.json',
  'cards/builtin/hsbc/data.json',
  'cards/builtin/hsbcTravel/data.json',
  'cards/builtin/ctbcCal/data.json',
  'cards/builtin/ubot/data.json',
  'miles_data/taishin_miles_data.json',
  'miles_data/esun_miles_data.json',
  'miles_data/cathay_miles_data.json',
  'miles_data/openpoint_miles_data.json',
  'miles_data/dbs_miles_data.json',
  'miles_data/hsbc_miles_data.json',
];

function parseArgs() {
  const args = process.argv.slice(2);
  let dir = process.env.CRAWLER_OUTPUT_DIR || '';
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--dir=')) dir = arg.slice('--dir='.length);
    else if (!arg.startsWith('-')) dir = arg;
  }
  if (!dir) {
    throw new Error('Missing preview directory. Use --dir=path/to/preview');
  }
  return { dir: path.resolve(dir), dryRun };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const { dir, dryRun } = parseArgs();
  const summaryPath = path.join(dir, 'crawler-summary.json');
  let summary = null;
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
    console.log(`Preview summary: ${summaryPath}`);
    console.log(`  finishedAt: ${summary.finishedAt}`);
    console.log(`  updated: ${(summary.updated || []).length}`);
  } catch {
    console.log(`(no crawler-summary.json in ${dir})`);
  }

  const planned = [];
  const unchanged = [];
  const missing = [];

  for (const rel of OUTPUT_FILES) {
    const src = path.join(dir, rel);
    const dest = path.join(ROOT, rel);
    const next = await readJsonIfExists(src);
    if (!next) {
      missing.push(rel);
      continue;
    }
    const prev = await readJsonIfExists(dest);
    if (prev && stableJsonStringify(prev) === stableJsonStringify(next)) {
      unchanged.push(rel);
      continue;
    }
    planned.push(rel);
    if (!dryRun) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    }
  }

  console.log('\n=== Apply preview ===');
  console.log(`Source: ${dir}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Apply (${planned.length}):`);
  for (const f of planned) console.log(`  - ${f}`);
  console.log(`Unchanged (${unchanged.length}):`);
  for (const f of unchanged) console.log(`  - ${f}`);
  if (missing.length) {
    console.log(`Missing in preview (${missing.length}):`);
    for (const f of missing) console.log(`  - ${f}`);
  }

  if (dryRun && planned.length) {
    console.log('\nRe-run without --dry-run to write files.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
