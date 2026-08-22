/**
 * Activity cache helpers:
 * - Skip re-fetch for ended (and unchanged active) rows
 * - Preserve AI verification fields when content fingerprint is unchanged
 */
import fs from 'fs';

const AI_FIELDS = [
  'aiVerifiedAt',
  'aiEscalatedAt',
  'aiRiskScore',
  'aiRiskReasons',
  'aiModel',
  'aiNeedsReview',
  'manualFixedAt',
];

export function loadActivityIndex(outPath) {
  const map = new Map();
  try {
    const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    for (const act of payload.activities || []) {
      if (act?.id) map.set(act.id, act);
    }
  } catch {
    /* first run */
  }
  return map;
}

export function loadEndedCache(outPath) {
  const map = new Map();
  for (const [id, act] of loadActivityIndex(outPath)) {
    if (act?.period?.status === 'ended') map.set(id, act);
  }
  return map;
}

/**
 * @returns {{ skip: boolean, cached: object|null }}
 */
export function useCachedIfEnded(cache, id, listPeriod = null) {
  const cached = cache.get(id);
  if (!cached) return { skip: false, cached: null };
  if (listPeriod?.status && listPeriod.status !== 'ended') {
    return { skip: false, cached: null };
  }
  return { skip: true, cached };
}

function normDateToken(s) {
  const m = String(s || '')
    .replace(/[/.]/g, '-')
    .replace(/T.*$/, '')
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** Strip leading official quota-full brackets from list titles (iPASS / similar). */
export function stripQuotaTitleNoise(title) {
  let s = String(title || '').trim();
  // [ ...額滿 ], 【...額滿】, （...額滿）
  const re =
    /^[\[\u3010(\uFF08][^\n\]\u3011)\uFF09]{0,100}?\u984d\u6eff[^\n\]\u3011)\uFF09]{0,60}[\]\u3011)\uFF09]\s*/;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(re, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

export function titlesMatchForCache(a, b) {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return true;
  if (x === y) return true;
  return stripQuotaTitleNoise(x) === stripQuotaTitleNoise(y);
}

/**
 * Keep cached detail body, but refresh list-facing fields (title / period / quota).
 */
export function mergeListFacingFields(prev, { title, listMeta, listPeriod, quotaFull } = {}) {
  const out = {
    ...prev,
    period: listPeriod || prev.period,
    _fromCache: true,
    _cacheReason: 'unchanged',
  };
  if (title) out.title = title;
  if (quotaFull !== undefined) out.quotaFull = quotaFull;
  if (listMeta) {
    out.raw = {
      ...(prev.raw || {}),
      list: listMeta,
    };
  }
  return out;
}

function hasDetailBody(prev) {
  if (String(prev?.raw?.text || '').trim().length > 20) return true;
  if (String(prev?.searchText || '').trim().length > 40) return true;
  if (prev?.raw && typeof prev.raw === 'object') {
    try {
      const n = JSON.stringify(prev.raw).length;
      return n > 80;
    } catch {
      return false;
    }
  }
  return false;
}

/** Recompute active/upcoming/ended from stored period dates. */
export function refreshPeriodStatus(period) {
  if (!period) return null;
  const start = period.start || null;
  const end = period.end || null;
  if (!start && !end) {
    return { ...period, status: period.status || 'unknown' };
  }
  const now = new Date();
  let status = period.status || 'unknown';
  try {
    if (start && end) {
      const s = new Date(String(start).replace(/\//g, '-'));
      const eRaw = String(end).replace(/\//g, '-');
      const e = new Date(eRaw.includes('T') ? eRaw : `${eRaw}T23:59:59`);
      if (!Number.isNaN(+s) && now < s) status = 'upcoming';
      else if (!Number.isNaN(+e) && now > e) status = 'ended';
      else if (!Number.isNaN(+s) && !Number.isNaN(+e)) status = 'active';
    } else if (end) {
      const eRaw = String(end).replace(/\//g, '-');
      const e = new Date(eRaw.includes('T') ? eRaw : `${eRaw}T23:59:59`);
      if (!Number.isNaN(+e)) status = now > e ? 'ended' : 'active';
    }
  } catch {
    /* keep prior status */
  }
  return { ...period, start, end, status };
}

/**
 * Reuse a previously crawled activity when list metadata is unchanged
 * (same title/dates/url/updateDate) and we already have detail text.
 *
 * listMeta.softReuse: when the platform has no list fingerprint (e.g. PX
 * advertise id probe), skip re-fetch if prior body exists and period is
 * still active/upcoming (or just marked ended by calendar).
 */
export function useCachedIfUnchanged(prevIndex, id, listMeta, listPeriod = null) {
  const prev = prevIndex.get(id);
  if (!prev) return { skip: false, cached: null };

  if (listPeriod?.status === 'ended') {
    return {
      skip: true,
      cached: {
        ...prev,
        period: listPeriod,
        _fromCache: true,
        _cacheReason: 'ended-list',
      },
    };
  }

  if (!hasDetailBody(prev)) return { skip: false, cached: null };

  const prevList = prev.raw?.list || {};
  const meta = listMeta || {};
  const nextTitle = String(meta.title || meta.name || '');
  const prevTitle = String(prev.title || prevList.name || '');
  const sameTitle =
    !nextTitle ||
    titlesMatchForCache(prevTitle, nextTitle) ||
    titlesMatchForCache(prevList.name || '', meta.name || '');

  const nextStart = String(meta.startDate || '');
  const nextEnd = String(meta.endDate || '');
  const prevStart = String(prevList.startDate || prev.period?.start || '');
  const prevEnd = String(prevList.endDate || prev.period?.end || '');
  const sameStart =
    !nextStart || !prevStart || normDateToken(prevStart) === normDateToken(nextStart);
  const sameEnd = !nextEnd || !prevEnd || normDateToken(prevEnd) === normDateToken(nextEnd);

  const nextUrl = String(meta.externalUrl || '').replace(/\/$/, '');
  const prevUrl = String(prevList.externalUrl || prev.url || '').replace(/\/$/, '');
  const sameUrl = !nextUrl || !prevUrl || prevUrl === nextUrl;

  const prevUpdate = prevList.updateDate || '';
  const nextUpdate = meta.updateDate || '';
  const sameUpdate = !nextUpdate || !prevUpdate || prevUpdate === nextUpdate;

  const metaSignals = [nextTitle, nextStart, nextEnd, nextUrl, nextUpdate].filter(Boolean).length;

  if (metaSignals === 0) {
    if (!meta.softReuse) return { skip: false, cached: null };
    const refreshed = listPeriod || refreshPeriodStatus(prev.period);
    if (!refreshed) return { skip: false, cached: null };
    if (
      refreshed.status === 'active' ||
      refreshed.status === 'upcoming' ||
      refreshed.status === 'ended'
    ) {
      return {
        skip: true,
        cached: {
          ...prev,
          period: refreshed,
          _fromCache: true,
          _cacheReason: refreshed.status === 'ended' ? 'ended-soft' : 'unchanged-soft',
        },
      };
    }
    return { skip: false, cached: null };
  }

  if (sameTitle && sameStart && sameEnd && sameUrl && sameUpdate) {
    const cached = {
      ...prev,
      period: listPeriod || refreshPeriodStatus(prev.period) || prev.period,
      _fromCache: true,
      _cacheReason: 'unchanged',
    };
    return { skip: true, cached };
  }
  return { skip: false, cached: null };
}

export function contentFingerprint(act) {
  const title = String(act?.title || '');
  const start = act?.period?.start || '';
  const end = act?.period?.end || '';
  const text = bodyFingerprint(act);
  const url = String(act?.url || '');
  return `${title}\n${start}\n${end}\n${url}\n${text}`;
}

/** Body-only fingerprint (ignore title/date drift from list cards). */
export function bodyFingerprint(act) {
  return String(act?.raw?.text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

/**
 * Keep AI / manual fields when the crawled content has not changed.
 * If content changed, drop aiVerifiedAt so the next AI pass re-runs.
 *
 * Important: AI may intentionally set rewards=[] (no %). Restore that too —
 * do not keep heuristic extracts over a verified empty list.
 */
export function preserveAiFields(fresh, prev) {
  if (!fresh) return fresh;
  if (!prev) return fresh;

  const out = { ...fresh };
  if (prev.manualFixedAt) {
    out.manualFixedAt = prev.manualFixedAt;
    if (Array.isArray(prev.rewards)) out.rewards = prev.rewards;
  }

  if (!prev.aiVerifiedAt) return out;

  const sameFull = contentFingerprint(fresh) === contentFingerprint(prev);
  const prevBody = bodyFingerprint(prev);
  const sameBody = prevBody.length > 20 && prevBody === bodyFingerprint(fresh);

  if (sameFull || sameBody) {
    for (const key of AI_FIELDS) {
      if (prev[key] != null) out[key] = prev[key];
    }
    if (Array.isArray(prev.rewards)) out.rewards = prev.rewards;
  }

  return out;
}

export function mergeWithEndedCache(freshActivities, endedCache, prevIndex = null) {
  const freshIds = new Set(freshActivities.map((a) => a.id));
  const merged = freshActivities.map(({ _fromCache, _cacheReason, ...act }) => act);
  let keptEndedNotInList = 0;
  let keptProtectedActive = 0;

  for (const [id, act] of endedCache) {
    if (!freshIds.has(id)) {
      merged.push(act);
      keptEndedNotInList++;
    }
  }

  // Keep active/upcoming PROTECTED / landpress-discovered rows that are not in the public list
  if (prevIndex) {
    for (const [id, act] of prevIndex) {
      if (freshIds.has(id)) continue;
      if (act?.period?.status === 'ended') continue;
      const sources = act?.raw?.list?.discoverSources || [];
      const vis = act?.raw?.list?.visibility;
      const keep =
        vis === 'PROTECTED' ||
        sources.includes('landpress') ||
        sources.includes('landpress-followed');
      if (!keep) continue;
      if (act.period?.status === 'active' || act.period?.status === 'upcoming') {
        merged.push(act);
        keptProtectedActive++;
      }
    }
  }

  const skippedFetch = freshActivities.filter((a) => a._fromCache).length;
  const freshlyFetched = freshActivities.length - skippedFetch;

  return {
    activities: merged,
    stats: {
      cachedEndedTotal: endedCache.size,
      skippedFetch,
      freshlyFetched,
      keptEndedNotInList,
      keptProtectedActive,
      total: merged.length,
    },
  };
}

export function finalizeAndSave(outPath, { meta, activities, endedCache, skippedFetch = 0 }) {
  const prevIndex = loadActivityIndex(outPath);
  const preserved = activities.map((row) => {
    const fromCache = row._fromCache;
    const { _fromCache, _cacheReason, ...act } = row;
    if (fromCache) return { ...act, _fromCache: true };
    return preserveAiFields(act, prevIndex.get(act.id));
  });

  const { activities: merged, stats } = mergeWithEndedCache(preserved, endedCache, prevIndex);
  const cache = {
    ...stats,
    skippedFetch: skippedFetch || stats.skippedFetch,
  };
  const payload = {
    meta: {
      ...meta,
      fetchedAt: new Date().toISOString(),
      count: merged.length,
      cache,
    },
    activities: merged,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  return { payload, stats: cache };
}

export function logCacheSummary(stats) {
  if (!stats) return;
  if (stats.cachedEndedTotal) console.log(`  ended cache loaded: ${stats.cachedEndedTotal}`);
  if (stats.skippedFetch) console.log(`  skipped re-fetch (cached): ${stats.skippedFetch}`);
  if (stats.freshlyFetched != null) console.log(`  freshly crawled: ${stats.freshlyFetched}`);
  if (stats.keptEndedNotInList) {
    console.log(`  kept ended (no longer on site): ${stats.keptEndedNotInList}`);
  }
  if (stats.keptProtectedActive) {
    console.log(`  kept protected/landpress active: ${stats.keptProtectedActive}`);
  }
}
