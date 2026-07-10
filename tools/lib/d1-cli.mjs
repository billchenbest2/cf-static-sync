import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WRANGLER_CWD = process.env.WRANGLER_CWD || path.resolve(__dirname, '../wrangler');

export function getMetaDbName() {
  return process.env.D1_META_DB || 'app-meta';
}

export function getStoresDbName(shardId) {
  const prefix = process.env.D1_STORES_PREFIX || 'app-stores';
  return `${prefix}-${shardId}`;
}

function runWrangler(args) {
  const remoteFlag = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : '';
  const fileIdx = args.indexOf('--file');
  let cmd;
  if (fileIdx >= 0) {
    const filePath = args[fileIdx + 1];
    const head = args.slice(0, fileIdx);
    cmd = `npx wrangler ${head.join(' ')} --file "${filePath}" ${remoteFlag}`.trim();
  } else {
    cmd = `npx wrangler ${args.join(' ')}`;
  }

  const res = spawnSync(cmd, {
    cwd: WRANGLER_CWD,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    env: process.env
  });
  if (res.status !== 0) {
    throw new Error(`wrangler failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

export function runWranglerD1Execute(dbName, sql, remote = true) {
  const tmp = path.join(os.tmpdir(), `d1-exec-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(tmp, sql, 'utf8');
  try {
    runWranglerD1ExecuteFile(dbName, tmp, remote);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function runWranglerD1ExecuteFile(dbName, filePath, remote = true) {
  const args = ['d1', 'execute', dbName, '--file', filePath];
  if (remote) args.push('--remote');
  else args.push('--local');
  runWrangler(args);
}

function parseWranglerD1Results(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first && Array.isArray(first.results)) return first.results;
  } catch {
    /* ignore */
  }
  return null;
}

export function runWranglerD1Query(dbName, sql, remote = true) {
  const args = ['d1', 'execute', dbName, '--json', '--command', sql];
  if (remote) args.push('--remote');
  else args.push('--local');
  const cmd = `npx wrangler ${args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')}`;
  const res = spawnSync(cmd, {
    cwd: WRANGLER_CWD,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    env: process.env
  });
  const rows = parseWranglerD1Results(res.stdout) ?? parseWranglerD1Results(res.stderr);
  if (rows) return rows;
  if (res.status !== 0) {
    throw new Error(`wrangler query failed: ${res.stderr || res.stdout}`);
  }
  return [];
}

export function hashString(s) {
  return createHash('md5').update(String(s), 'utf8').digest('hex');
}
