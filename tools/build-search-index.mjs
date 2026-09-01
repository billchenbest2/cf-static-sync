/**
 * Build encrypted search index from existing Pages map chunks (no D1).
 *
 *   node build-search-index.mjs
 *   node build-search-index.mjs --pull --deploy
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSearchIndexFromDeployDir } from './lib/search-index-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../site/dist');
const PAGES_BASE = process.env.PAGES_BASE || 'https://paymentmaptw-data.pages.dev';
const PAGES_PROJECT = process.env.PAGES_PROJECT_NAME || 'paymentmaptw-data';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function deployPages() {
  const workerDir = process.env.WRANGLER_CWD || path.resolve(__dirname, '../wrangler');
  const cmd = `npx wrangler pages deploy "${OUT_DIR}" --project-name=${PAGES_PROJECT} --branch=main --commit-dirty=true`;
  const res = spawnSync(cmd, {
    cwd: workerDir,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    env: process.env
  });
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'pages deploy failed');
  process.stdout.write(res.stdout || '');
}

async function main() {
  const { entries, searchManifest } = await buildSearchIndexFromDeployDir(OUT_DIR, {
    pullFrom: hasFlag('--pull') ? PAGES_BASE : null
  });
  console.log(
    `Search index: ${entries.length} entries, ${searchManifest.shardCount} encrypted shards → ${OUT_DIR}`
  );

  if (hasFlag('--deploy')) {
    console.log(`Deploying to ${PAGES_PROJECT}...`);
    deployPages();
    console.log('Deploy complete.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
