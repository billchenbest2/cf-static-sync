/**
 * OCR dates from activity banner/KV images.
 * Usage: node scripts/ocr-dates.mjs [--slug=theme_2025] [--limit=5]
 *
 * Requires: npm install  (installs tesseract.js)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';
import { extractDatesFromText, extractDatesFromRaw } from './date-extract.mjs';
import {
  collectOcrImageUrls,
  fetchS3Json,
  downloadImage,
  fetchJsonUrl,
  extractBase64DataUrls,
  decodeDataUrl,
  prepareImageVariantsForOcr,
} from './image-urls.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(process.env.PAY_DATA_DIR || path.join(ROOT, 'data'), 'activities.json');
const CACHE_DIR = path.join(process.env.PAY_DATA_DIR || path.join(ROOT, 'data'), 'ocr-cache');
const MARKETING_BASE = 'https://marketing.pxpayplus.com/pxplus_marketing_page';

const args = process.argv.slice(2);
const slugFilters = args.filter((a) => a.startsWith('--slug=')).map((a) => a.split('=')[1]);
const limitPerActivity = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || 8);
const force = args.includes('--force');
const countOnly = args.includes('--count-only');

function selectOcrTargets(activities) {
  let targets = activities.filter((a) => a.source === 'fixed_route');
  if (slugFilters.length) {
    targets = targets.filter((a) => slugFilters.includes(a.slug));
  } else {
    targets = targets.filter(
      (a) => a.period?.status === 'unknown' || a.period?.needsOcr || !a.period?.end
    );
  }
  if (!force) {
    targets = targets.filter((a) => {
      if (a.period?.periodSource === 'api') return false;
      if (a.period?.periodSource === 'ocr' && a.period?.start && a.period?.end) return false;
      return true;
    });
  }
  return targets;
}

function parsePeriodStatus(start, end) {
  const s = start ? new Date(start.replace(/\//g, '-')) : null;
  const e = end ? new Date(end.replace(/\//g, '-')) : null;
  const now = new Date();
  let status = 'unknown';
  if (s && e && !Number.isNaN(s) && !Number.isNaN(e)) {
    if (now < s) status = 'upcoming';
    else if (now > e) status = 'ended';
    else status = 'active';
  }
  return { start: start || '', end: end || '', status };
}

async function ocrImage(worker, buffer) {
  try {
    const { data } = await worker.recognize(buffer);
    return (data.text || '').replace(/\s+/g, ' ').trim();
  } catch (e) {
    return '';
  }
}

async function expandOcrCandidates(slug, raw, imageUrls, referer) {
  const items = [];

  for (const url of imageUrls) {
    if (/\.json(\?|$)/i.test(url)) {
      const jsonText = await fetchJsonUrl(url, referer);
      if (!jsonText) {
        items.push({ url, error: 'json fetch failed' });
        continue;
      }
      const assets = extractBase64DataUrls(jsonText)
        .map((dataUrl, index) => ({ dataUrl, index, size: decodeDataUrl(dataUrl)?.length || 0 }))
        .sort((a, b) => b.size - a.size);
      for (const asset of assets) {
        items.push({ url: `${url}#asset-${asset.index}`, dataUrl: asset.dataUrl, fromJson: url });
      }
      continue;
    }
    if (url.startsWith('data:image')) {
      items.push({ url: `inline-${items.length}`, dataUrl: url });
      continue;
    }
    items.push({ url });
  }

  for (const dataUrl of extractBase64DataUrls(JSON.stringify(raw || {})).slice(0, 2)) {
    items.push({ url: `raw-embedded-${items.length}`, dataUrl });
  }

  items.sort((a, b) => {
    const score = (x) => {
      if (x.fromJson || /kv\.json/i.test(x.url || '')) return 2;
      if (x.dataUrl) return 1;
      return 0;
    };
    return score(b) - score(a);
  });
  return items;
}

function scoreOcrHit(inferred, label) {
  if (!inferred?.start) return -1;
  let score = 0;
  if (inferred.start && inferred.end) {
    score = 100;
    if (inferred.confidence === 'high') score += 30;
    else if (inferred.confidence === 'medium') score += 15;
    else if (inferred.confidence === 'low') score += 5;
  } else {
    score = 10;
  }
  if (label === 'full' || String(label).startsWith('full-rot')) score += 3;
  return score;
}

function pickBestOcrHit(hits, slug) {
  let best = null;
  let bestScore = -1;
  for (const hit of hits) {
    const inferred = extractDatesFromText(hit.text, { slug });
    const score = scoreOcrHit(inferred, hit.label);
    if (score > bestScore) {
      bestScore = score;
      best = { ...hit, inferred };
    }
  }
  return best;
}

function variantPass(label) {
  if (label === 'full' || String(label).startsWith('full-rot')) return 0;
  if (String(label).includes('-rot')) return 2;
  return 1;
}

async function ocrCandidate(worker, slug, item, referer) {
  const cacheKey = item.dataUrl || item.url;
  const cacheName = `${slug}-v3-${Buffer.from(cacheKey).toString('base64url').slice(0, 48)}.txt`;
  const cachePath = path.join(CACHE_DIR, cacheName);

  let text = '';
  if (!force && fs.existsSync(cachePath)) {
    text = fs.readFileSync(cachePath, 'utf8');
    return { ...item, ok: true, text, cached: true };
  }

  const buf = item.dataUrl ? decodeDataUrl(item.dataUrl) : await downloadImage(item.url, referer);
  if (!buf) {
    return { ...item, ok: false, error: item.error || 'download failed' };
  }

  const variants = await prepareImageVariantsForOcr(buf, item.dataUrl || item.url);
  if (!variants.length) {
    return { ...item, ok: false, error: 'unsupported image format' };
  }

  variants.sort((a, b) => variantPass(a.label) - variantPass(b.label));

  const hits = [];
  for (const variant of variants) {
    if (variantPass(variant.label) === 2) {
      const bestSoFar = pickBestOcrHit(hits, slug);
      if (bestSoFar?.inferred?.start && bestSoFar?.inferred?.end) break;
    }
    const part = await ocrImage(worker, variant.buffer);
    if (!part) continue;
    hits.push({ label: variant.label, text: part });
  }

  const best = pickBestOcrHit(hits, slug);
  text = best?.text || hits.map((h) => h.text).filter(Boolean)[0] || '';
  fs.writeFileSync(cachePath, text, 'utf8');
  return { ...item, ok: true, text, ocrVariant: best?.label || '' };
}

async function processActivity(worker, act) {
  const slug = act.slug;
  if (!slug) return { act, skipped: true, reason: 'not fixed route' };

  if (!force && act.period?.periodSource === 'api') {
    return { act, skipped: true, reason: 'has api dates' };
  }
  if (!force && act.period?.periodSource === 'ocr' && act.period?.start && act.period?.end) {
    return { act, skipped: true, reason: 'already ocr' };
  }

  let raw = act.raw;
  if (!raw) raw = await fetchS3Json(slug);

  const fromRaw = extractDatesFromRaw(raw, slug);
  if (fromRaw?.start && fromRaw?.end) {
    return {
      act,
      slug,
      success: true,
      source: 'raw-json',
      imageUrls: collectOcrImageUrls(slug, raw).slice(0, limitPerActivity),
      ocrAttempts: [{ ok: true, source: 'raw-json', inferred: fromRaw }],
      period: {
        ...parsePeriodStatus(fromRaw.start, fromRaw.end),
        periodSource: 'text',
        periodConfidence: fromRaw.confidence || 'medium',
        needsOcr: false,
        ocrImageUrls: collectOcrImageUrls(slug, raw).slice(0, limitPerActivity),
        ocrFrom: 'raw-json',
        ocrTextPreview: `${fromRaw.start} ~ ${fromRaw.end}`,
      },
    };
  }

  const imageUrls = collectOcrImageUrls(slug, raw).slice(0, limitPerActivity);
  const referer = `${MARKETING_BASE}/${slug}`;
  const candidates = await expandOcrCandidates(slug, raw, imageUrls, referer);
  const ocrAttempts = [];

  for (const item of candidates) {
    if (item.error && !item.dataUrl) {
      ocrAttempts.push({ url: item.url, ok: false, error: item.error });
      continue;
    }

    let attempt;
    try {
      attempt = await ocrCandidate(worker, slug, item, referer);
    } catch (e) {
      ocrAttempts.push({ url: item.url, ok: false, error: String(e.message) });
      continue;
    }

    if (!attempt.ok) {
      ocrAttempts.push({ url: item.url, ok: false, error: attempt.error });
      continue;
    }

    const text = attempt.text || '';
    const inferred = extractDatesFromText(text, { slug });
    ocrAttempts.push({
      url: item.url,
      ok: true,
      textPreview: text.slice(0, 120),
      text,
      inferred,
      fromJson: item.fromJson || null,
      ocrVariant: attempt.ocrVariant || '',
    });

    if (inferred?.start && inferred?.end) {
      return {
        act,
        slug,
        success: true,
        imageUrls,
        ocrAttempts,
        period: {
          ...parsePeriodStatus(inferred.start, inferred.end),
          periodSource: 'ocr',
          periodConfidence: inferred.confidence || 'medium',
          needsOcr: false,
          ocrImageUrls: imageUrls,
          ocrFrom: item.fromJson || item.url,
          ocrVariant: attempt.ocrVariant || '',
          ocrTextPreview: text.slice(0, 200),
        },
      };
    }
  }

  const bestPartial = pickBestOcrHit(
    ocrAttempts.filter((a) => a.ok && a.text).map((a) => ({ label: a.ocrVariant || a.url, text: a.text })),
    slug
  );
  const partial = bestPartial?.inferred || null;

  return {
    act,
    slug,
    success: false,
    imageUrls,
    ocrAttempts,
    period: partial?.start
      ? {
          ...parsePeriodStatus(partial.start, partial.end || ''),
          periodSource: 'ocr',
          periodConfidence: 'partial',
          needsOcr: !partial.end,
          ocrImageUrls: imageUrls,
          ocrTextPreview: (bestPartial.text || '').slice(0, 300),
        }
      : null,
  };
}

async function main() {
  if (countOnly) {
    if (!fs.existsSync(DATA_PATH)) {
      console.log(0);
      return;
    }
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    console.log(selectOcrTargets(data.activities).length);
    return;
  }

  console.log('PXPlus OCR date extraction\n');
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const targets = selectOcrTargets(data.activities);

  console.log(`Targets: ${targets.length} activities, ${limitPerActivity} images each\n`);
  console.log('Loading Tesseract (chi_tra + eng)...');

  const worker = await createWorker('chi_tra+eng');
  const results = [];

  for (const act of targets) {
    process.stdout.write(`  ${act.slug} ... `);
    try {
      const r = await processActivity(worker, act);
      results.push(r);

      if (r.skipped) {
        console.log(`skip (${r.reason})`);
        continue;
      }
      if (r.source === 'raw-json') {
        console.log(`OK (JSON) ${r.period.start} ~ ${r.period.end}`);
      } else if (r.success) {
        console.log(`OK ${r.period.start} ~ ${r.period.end}`);
      } else if (r.period?.start) {
        console.log(`partial ${r.period.start}${r.period.end ? ' ~ ' + r.period.end : ''}`);
      } else {
        console.log(`no dates (${r.ocrAttempts?.length || 0} images tried)`);
      }
    } catch (e) {
      console.log(`error: ${e.message}`);
      results.push({ act, slug: act.slug, error: String(e.message) });
    }
  }

  await worker.terminate();

  // Merge back into activities.json
  let updated = 0;
  for (const r of results) {
    if (r.skipped) continue;
    if (r.period?.periodSource !== 'ocr' && r.period?.periodSource !== 'text') continue;
    const idx = data.activities.findIndex((a) => a.id === r.act.id);
    if (idx < 0) continue;
    if (!r.period) continue;
    if (r.period.start || r.success) {
      data.activities[idx].period = { ...data.activities[idx].period, ...r.period };
      data.activities[idx].ocrMeta = {
        processedAt: new Date().toISOString(),
        attempts: r.ocrAttempts,
      };
      updated++;
    }
  }

  data.meta.lastOcrAt = new Date().toISOString();
  data.meta.ocrUpdated = updated;

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');

  const reportPath = path.join(process.env.PAY_DATA_DIR || path.join(ROOT, 'data'), 'ocr-results.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ processedAt: new Date().toISOString(), results }, null, 2),
    'utf8'
  );

  console.log(`\nUpdated ${updated} activities in activities.json`);
  console.log(`Report -> ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
