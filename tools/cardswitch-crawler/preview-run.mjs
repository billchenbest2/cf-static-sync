#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'preview', 'latest');
process.env.CRAWLER_OUTPUT_DIR = outDir;
process.env.CRAWLER_SUMMARY_PATH = path.join(outDir, 'crawler-summary.json');

await import('./run.mjs');
