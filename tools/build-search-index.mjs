/**
 * Build encrypted search index from existing Pages map chunks (no D1).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchIndexFromDeployDir } from './lib/search-index-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../site/dist');
const PAGES_BASE = process.env.PAGES_BASE || 'https://paymentmaptw-data.pages.dev';

async function main() {
  const pullFrom = process.argv.includes('--pull') ? PAGES_BASE : null;
  const { entries, searchManifest } = await buildSearchIndexFromDeployDir(OUT_DIR, { pullFrom });
  console.log(`Search index: ${entries.length} entries, ${searchManifest.shardCount} shards`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
