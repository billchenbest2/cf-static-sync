/**
 * Per-model daily quota (RPD) tracker. Premium Flash = 20 RPD each.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUOTA_PATH = path.join(process.env.PAY_DATA_DIR || path.join(__dirname, '..', 'data'), 'ai-quota.json');

const today = () => new Date().toISOString().slice(0, 10);

function load() {
  const empty = { date: today(), used: {} };
  if (!fs.existsSync(QUOTA_PATH)) return empty;
  try {
    const j = JSON.parse(fs.readFileSync(QUOTA_PATH, 'utf8'));
    if (j.date !== today()) return empty;
    j.used = j.used || {};
    return j;
  } catch {
    return empty;
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(QUOTA_PATH), { recursive: true });
  fs.writeFileSync(QUOTA_PATH, JSON.stringify(state, null, 2), 'utf8');
}

export function remainingQuota(modelId, dailyCap) {
  const state = load();
  const used = state.used[modelId] || 0;
  return Math.max(0, dailyCap - used);
}

export function recordQuotaUse(modelId) {
  const state = load();
  state.used[modelId] = (state.used[modelId] || 0) + 1;
  save(state);
  return state.used[modelId];
}

export function quotaSnapshot() {
  return load();
}
