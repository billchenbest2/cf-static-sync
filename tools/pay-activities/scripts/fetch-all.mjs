/**
 * Run every activity crawler, then refresh data/platforms.json.
 * Usage: npm run fetch:all
 *
 * Any new scripts/fetch-*.mjs (except this file) is picked up automatically.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { ensureDefaultCatalog } from './platform-catalog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function crawlerJobs() {
  const files = fs.readdirSync(__dirname)
    .filter((f) => /^fetch-.*\.mjs$/.test(f) && f !== 'fetch-all.mjs')
    .sort((a, b) => a.localeCompare(b));
  return files.map((f) => [f.replace(/\.mjs$/, ''), path.join(__dirname, f)]);
}

function run(label, file) {
  return new Promise((resolve, reject) => {
    console.log(`\n======== ${label} ========`);
    const child = spawn(process.execPath, [file], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited ${code}`));
    });
  });
}

async function main() {
  ensureDefaultCatalog();
  const jobs = crawlerJobs();
  if (!jobs.length) {
    console.error('No fetch-*.mjs crawlers found');
    process.exit(1);
  }
  for (const [label, file] of jobs) {
    await run(label, file);
  }
  ensureDefaultCatalog();
  console.log('\nAll crawlers finished. Viewer catalog: data/platforms.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
