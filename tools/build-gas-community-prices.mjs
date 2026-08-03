#!/usr/bin/env node
/**
 * Export gas_price_reports from D1 meta DB and publish gas/community-prices.json
 * alongside payment map chunks (paymentmaptw-data Pages).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetaDbName, runWranglerD1Query } from './lib/d1-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../site/dist');
const OUT = path.join(OUTPUT_DIR, 'gas/community-prices.json');
const STALE_MS = 72 * 60 * 60 * 1000;
const MAX_REPORTS_PER_STATION = 10;

const SQL =
  "SELECT reportId, stationId, reportedAt, reporterHash, price92, price95, price98, priceDiesel, promotions, note, status FROM gas_price_reports WHERE status = 'active' ORDER BY reportedAt DESC";

function safeParse(s, def) {
  try {
    return JSON.parse(s || 'null') ?? def;
  } catch {
    return def;
  }
}

function pricesFromRow(row) {
  const prices = {};
  for (const product of ['92', '95', '98', 'diesel']) {
    const map = {
      '92': row.price92,
      '95': row.price95,
      '98': row.price98,
      diesel: row.priceDiesel
    };
    if (map[product] != null && Number.isFinite(Number(map[product]))) {
      prices[product] = Number(map[product]);
    }
  }
  return prices;
}

function normalizeReport(row) {
  const promotions = Array.isArray(row.promotions)
    ? row.promotions
    : safeParse(row.promotions, []);
  const reportedAt = String(row.reportedAt || '');
  const ts = Date.parse(reportedAt);
  return {
    reportId: String(row.reportId || ''),
    reportedAt,
    prices: pricesFromRow(row),
    promotions,
    note: String(row.note || ''),
    stale: Number.isFinite(ts) ? Date.now() - ts > STALE_MS : true
  };
}

function aggregate(rows) {
  const grouped = {};
  const sorted = [...rows]
    .filter((r) => String(r.status || 'active') === 'active')
    .sort((a, b) => String(b.reportedAt || '').localeCompare(String(a.reportedAt || '')));

  for (const row of sorted) {
    const id = String(row.stationId || '').trim();
    if (!id) continue;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push(normalizeReport(row));
  }

  const byStation = {};
  for (const [id, reports] of Object.entries(grouped)) {
    const trimmed = reports.slice(0, MAX_REPORTS_PER_STATION);
    const latest = trimmed[0];
    byStation[id] = {
      ...latest,
      reports: trimmed
    };
  }
  return byStation;
}

function main() {
  let rows = [];
  try {
    rows = runWranglerD1Query(getMetaDbName(), SQL, true);
    if (!Array.isArray(rows)) rows = [];
  } catch (e) {
    console.warn('D1 gas_price_reports export failed (table may be empty):', e.message);
    rows = [];
  }

  const out = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    byStation: aggregate(rows)
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
  console.log('Wrote', OUT, 'stations with prices:', Object.keys(out.byStation).length);
}

main();
