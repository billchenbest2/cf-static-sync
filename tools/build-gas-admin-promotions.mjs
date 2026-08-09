#!/usr/bin/env node
/**
 * Export gas_admin_promotions from D1 meta DB → gas/admin-promotions.json (paymentmaptw-data Pages).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetaDbName, runWranglerD1Query } from './lib/d1-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.resolve(__dirname, '../site/dist');
const OUT = path.join(OUTPUT_DIR, 'gas/admin-promotions.json');

const SQL =
  "SELECT promoId, label, brandId, stationId, franchiseType, services, product, amount, discountType, unit, validity, conditions, note, status FROM gas_admin_promotions WHERE status = 'active' ORDER BY updatedAt DESC";

const PRODUCT_IDS = new Set(['92', '95', '98', 'diesel']);

function safeParse(s, def) {
  try {
    return JSON.parse(s || 'null') ?? def;
  } catch {
    return def;
  }
}

function normalizeProducts(raw) {
  const d = typeof raw === 'string' ? { product: raw } : raw || {};
  if (Array.isArray(d.products) && d.products.length) {
    const out = [];
    for (const item of d.products) {
      const k = String(item || '').trim();
      if (k === 'all') return ['all'];
      if (PRODUCT_IDS.has(k) && !out.includes(k)) out.push(k);
    }
    if (!out.length || out.length >= 4) return ['all'];
    return out;
  }
  const rawProduct = String(d.product || 'all').trim();
  if (!rawProduct || rawProduct === 'all') return ['all'];
  if (rawProduct.charAt(0) === '[') {
    try {
      const arr = JSON.parse(rawProduct);
      if (Array.isArray(arr)) return normalizeProducts({ products: arr });
    } catch {
      /* ignore */
    }
  }
  if (rawProduct.includes(',')) return normalizeProducts({ products: rawProduct.split(',') });
  return PRODUCT_IDS.has(rawProduct) ? [rawProduct] : ['all'];
}

function rowToPromo(row) {
  const products = normalizeProducts({ product: row.product });
  const conditions = safeParse(row.conditions, null);
  const minLiters =
    conditions && conditions.minLiters != null && Number.isFinite(Number(conditions.minLiters))
      ? Number(conditions.minLiters)
      : null;
  const cond = conditions && typeof conditions === 'object' ? conditions : {};
  return {
    promoId: String(row.promoId || ''),
    label: String(row.label || ''),
    brandId: String(row.brandId || ''),
    stationId: String(row.stationId || ''),
    franchiseType: String(row.franchiseType || ''),
    services: safeParse(row.services, []),
    products,
    product: products.includes('all') ? 'all' : products[0],
    amount: Number(row.amount),
    minLiters,
    discountType: String(row.discountType || 'per_liter'),
    unit: String(row.unit || 'twd_per_liter'),
    validity: safeParse(row.validity, { type: 'permanent' }),
    conditions,
    note: String(row.note || ''),
    status: String(row.status || 'active'),
    kind: 'admin_promotion',
    membershipRequired: cond.membershipRequired || '',
    stackable: cond.stackable || '',
    source: cond.source || '',
    sourceCustom: cond.sourceCustom || '',
    paymentMethods: Array.isArray(cond.paymentMethods) ? cond.paymentMethods : [],
    timeOfDay: cond.timeOfDay || 'all_day',
    timeOfDayFrom: cond.timeOfDayFrom || '',
    timeOfDayTo: cond.timeOfDayTo || '',
    dayScope: cond.dayScope || '',
    exclusiveGroup: cond.exclusiveGroup || '',
    priority: cond.priority != null && Number.isFinite(Number(cond.priority)) ? Number(cond.priority) : 0
  };
}

function isExportablePromo(p) {
  const dt = p.discountType || 'per_liter';
  if (dt === 'gift' || dt === 'other') return true;
  if (dt === 'fill_discount') return Number(p.amount) > 0 && Number(p.minLiters) > 0;
  if (dt === 'percent') return Number(p.amount) > 0 && Number(p.amount) <= 100;
  return Number.isFinite(Number(p.amount)) && Number(p.amount) > 0;
}

function main() {
  let rows = [];
  try {
    rows = runWranglerD1Query(getMetaDbName(), SQL, true);
    if (!Array.isArray(rows)) rows = [];
  } catch (e) {
    console.warn('D1 gas_admin_promotions export failed:', e.message);
    rows = [];
  }

  const promotions = rows.map(rowToPromo).filter(isExportablePromo);
  if (!promotions.length && rows.length) {
    console.warn('gas_admin_promotions: rows found but none passed export filter:', rows.length);
  }
  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    promotions
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
  console.log('Wrote', OUT, 'promotions:', promotions.length);
}

main();
