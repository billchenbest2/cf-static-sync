/**
 * Merge a payment-platform entry into data/platforms.json.
 * Viewer loads this catalog instead of hardcoding wallets / colors / labels.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(process.env.PAY_DATA_DIR || path.join(__dirname, '..', 'data'), 'platforms.json');

export const PLATFORM_PRESETS = {
  pxplus: {
    id: 'pxplus',
    file: 'activities.json',
    label: '全支付',
    pointUnit: '全點',
    payLabel: '全支付／指定電子支付',
    twqrNeed: '需掃描全支付 TWQR 立牌',
    required: true,
    officialHosts: ['marketing.pxpayplus.com', 'pxpayplus.com'],
    sources: ['activity_content_page', 'fixed_route'],
    colors: {
      dark: { fg: '#38bdf8', bg: '#0c4a6e44', border: '#0369a1' },
      light: { fg: '#1b5f75', bg: '#d5e6ec', border: '#86aebc' },
    },
  },
  ipass: {
    id: 'ipass',
    file: 'ipass-activities.json',
    label: 'iPASS MONEY',
    pointUnit: '一卡通綠點',
    payLabel: 'iPASS MONEY',
    twqrNeed: '需掃描 TWQR 立牌',
    required: false,
    officialHosts: ['i-pass.com.tw'],
    sources: ['ipass_money'],
    idPrefix: 'ipass-',
    enrich: 'ipass',
    colors: {
      dark: { fg: '#34d399', bg: '#06402633', border: '#059669' },
      light: { fg: '#1f6b45', bg: '#d8eadf', border: '#8fbfa4' },
    },
  },
  jko: {
    id: 'jko',
    file: 'jko-activities.json',
    label: '街口支付',
    pointUnit: '街口幣',
    payLabel: '街口支付',
    twqrNeed: '需掃描 TWQR 立牌',
    required: false,
    officialHosts: ['mkt.jkopay.com'],
    sources: ['jkopay', 'jkopay_partner'],
    sourceOfficial: 'jkopay',
    sourcePartner: 'jkopay_partner',
    idPrefix: 'jko-',
    colors: {
      dark: { fg: '#fb923c', bg: '#7c2d1233', border: '#ea580c' },
      light: { fg: '#c2410c', bg: '#fde8d8', border: '#e8b48a' },
    },
  },
  easy: {
    id: 'easy',
    file: 'easy-activities.json',
    label: '悠遊付',
    pointUnit: '悠遊付回饋金',
    payLabel: '悠遊付',
    twqrNeed: '需掃描 TWQR 立牌',
    required: false,
    officialHosts: ['easywallet.easycard.com.tw', 'easycard.com.tw'],
    sources: ['easywallet'],
    idPrefix: 'easy-',
    colors: {
      dark: { fg: '#22d3ee', bg: '#164e6333', border: '#0891b2' },
      light: { fg: '#0e7490', bg: '#d5eef3', border: '#8fbfc9' },
    },
  },
  icash: {
    id: 'icash',
    file: 'icash-activities.json',
    label: 'icash Pay',
    pointUnit: 'OPENPOINT',
    payLabel: 'icash Pay',
    twqrNeed: '需掃描 TWQR 立牌',
    required: false,
    officialHosts: ['icashpay.com.tw', 'www.icashpay.com.tw'],
    sources: ['icashpay'],
    idPrefix: 'icash-',
    colors: {
      dark: { fg: '#a78bfa', bg: '#4c1d9533', border: '#7c3aed' },
      light: { fg: '#6d28d9', bg: '#ede9fe', border: '#c4b5fd' },
    },
  },
  plus: {
    id: 'plus',
    file: 'plus-activities.json',
    label: '全盈+PAY',
    pointUnit: '全盈儲值金',
    payLabel: '全盈+PAY',
    twqrNeed: '需掃描 TWQR 立牌',
    required: false,
    officialHosts: ['event2023.pluspay.com.tw', 'pluspay.com.tw', 'www.pluspay.com.tw'],
    sources: ['pluspay'],
    idPrefix: 'plus-',
    colors: {
      dark: { fg: '#f472b6', bg: '#83184333', border: '#db2777' },
      light: { fg: '#be185d', bg: '#fce7f3', border: '#f9a8d4' },
    },
  },
  linepay: {
    id: 'linepay',
    file: 'linepay-activities.json',
    label: 'LINE Pay',
    pointUnit: 'LINE POINTS',
    payLabel: 'LINE Pay',
    twqrNeed: '需掃描 TWQR 立牌',
    required: false,
    officialHosts: ['web-tw-pay.line.me', 'line.me'],
    sources: ['linepay'],
    idPrefix: 'linepay-',
    colors: {
      dark: { fg: '#86efac', bg: '#14532d33', border: '#22c55e' },
      light: { fg: '#15803d', bg: '#dcfce7', border: '#86efac' },
    },
  },
};

function readCatalog() {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.platforms)) return data;
  } catch {
    /* missing or invalid */
  }
  return { platforms: [] };
}

export function upsertPlatform(idOrSpec) {
  const spec =
    typeof idOrSpec === 'string'
      ? PLATFORM_PRESETS[idOrSpec]
      : { ...(PLATFORM_PRESETS[idOrSpec?.id] || {}), ...idOrSpec };
  if (!spec?.id || !spec.file) {
    throw new Error('upsertPlatform requires id and file');
  }

  const catalog = readCatalog();
  const idx = catalog.platforms.findIndex((p) => p.id === spec.id);
  const row = { ...spec };
  if (idx >= 0) catalog.platforms[idx] = { ...catalog.platforms[idx], ...row };
  else catalog.platforms.push(row);

  const order = Object.keys(PLATFORM_PRESETS);
  catalog.platforms.sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  catalog.updatedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  return catalog;
}

export function ensureDefaultCatalog() {
  for (const id of Object.keys(PLATFORM_PRESETS)) upsertPlatform(id);
}
