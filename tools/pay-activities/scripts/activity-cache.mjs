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

/**
 * Reuse a previously crawled activity when list metadata is unchanged
 * (same title/dates/url/updateDate) and we already have detail text.
 */
export function useCachedIfUnchanged(prevIndex, id, listMeta, listPeriod = null) {
  const prev = prevIndex.get(id);
  if (!prev) return { skip: false, cached: null };

  if (listPeriod?.status === 'ended') {
    return useCachedIfEnded(new Map([[id, prev]]), id, listPeriod);
  }

  const prevList = prev.raw?.list || {};
  const meta = listMeta || {};
  const sameTitle =
    String(prev.title || '') === String(meta.title || meta.name || prev.title || '') ||
    String(prevList.name || '') === String(meta.name || '');
  const sameStart = String(prevList.startDate || '') === String(meta.startDate || '');
  const sameEnd = String(prevList.endDate || '') === String(meta.endDate || '');
  const sameUrl = String(prevList.externalUrl || '') === String(meta.externalUrl || '');
  const prevUpdate = prevList.updateDate || '';
  const nextUpdate = meta.updateDate || '';
  const sameUpdate = !nextUpdate || !prevUpdate || prevUpdate === nextUpdate;
  const hasBody = String(prev.raw?.text || '').trim().length > 20;

  if (sameTitle && sameStart && sameEnd && sameUrl && sameUpdate && hasBody) {
    const cached = {
      ...prev,
      period: listPeriod || prev.period,
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
  const text = String(act?.raw?.text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
  const url = String(act?.url || '');
  return `${title}\n${start}\n${end}\n${url}\n${text}`;
}

/**
 * Keep AI / manual fields when the crawled content has not changed.
 * If content changed, drop aiVerifiedAt so the next AI pass re-runs.
 */
export function preserveAiFields(fresh, prev) {
  if (!fresh) return fresh;
  if (!prev) return fresh;

  const out = { ...fresh };
  if (prev.manualFixedAt) {
    out.manualFixedAt = prev.manualFixedAt;
    if (Array.isArray(prev.rewards) && prev.rewards.length) out.rewards = prev.rewards;
  }

  if (contentFingerprint(fresh) === contentFingerprint(prev) && prev.aiVerifiedAt) {
    for (const key of AI_FIELDS) {
      if (prev[key] != null) out[key] = prev[key];
    }
    if (Array.isArray(prev.rewards) && prev.rewards.length) out.rewards = prev.rewards;
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
