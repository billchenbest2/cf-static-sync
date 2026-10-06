/**
 * Fetch icash uniopen +4% activity page and write quota status JSON.
 *
 * Env:
 *   ICASH_QUOTA_SOURCE_URL  override config sourceUrl
 *   ICASH_QUOTA_OUT         output path (default data/cardswitch/icash-uniopen-quota.json)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIcashUniopenQuota } from './parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_OUT = path.join(SYNC_ROOT, 'data', 'cardswitch', 'icash-uniopen-quota.json');

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const sourceUrl = String(
    process.env.ICASH_QUOTA_SOURCE_URL || cfg.sourceUrl || '',
  ).trim();
  if (!sourceUrl) throw new Error('Missing sourceUrl in config.json');
  return {
    sourceUrl,
    activityKey: String(cfg.activityKey || 'uniopen_icash_pay_4pct').trim(),
  };
}

async function fetchHtml(url) {
  const cacheBust = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const res = await fetch(cacheBust, {
    headers: {
      'User-Agent': 'CardSwitch-icash-uniopen-quota/1.0',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function mergePrevious(prev, next) {
  if (!prev || typeof prev !== 'object') return next;
  const fullMonths = { ...(prev.fullMonths || {}), ...(next.fullMonths || {}) };
  return {
    ...next,
    fullMonths,
    current: next.current,
  };
}

const outPath = process.env.ICASH_QUOTA_OUT
  ? path.resolve(process.env.ICASH_QUOTA_OUT)
  : DEFAULT_OUT;

const cfg = loadConfig();
console.log('sourceUrl:', cfg.sourceUrl);

let previous = null;
if (fs.existsSync(outPath)) {
  try {
    previous = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch (_) {
    previous = null;
  }
}

const html = await fetchHtml(cfg.sourceUrl);
const parsed = parseIcashUniopenQuota(html, {
  activityKey: cfg.activityKey,
  sourceUrl: cfg.sourceUrl,
});
const payload = mergePrevious(previous, parsed);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log('wrote', outPath);
console.log('current', payload.current);
console.log('fullMonths', Object.keys(payload.fullMonths || {}).join(',') || '(none)');
