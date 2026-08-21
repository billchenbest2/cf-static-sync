/**
 * Reuse previously fetched ended activities to skip redundant network requests.
 */
import fs from 'fs';

export function loadEndedCache(outPath) {
  const map = new Map();
  try {
    const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    for (const act of payload.activities || []) {
      if (act?.id && act?.period?.status === 'ended') {
        map.set(act.id, act);
      }
    }
  } catch {
    /* first run or missing file */
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

export function mergeWithEndedCache(freshActivities, endedCache) {
  const freshIds = new Set(freshActivities.map((a) => a.id));
  const merged = freshActivities.map(({ _fromCache, ...act }) => act);
  let keptEndedNotInList = 0;

  for (const [id, act] of endedCache) {
    if (!freshIds.has(id)) {
      merged.push(act);
      keptEndedNotInList++;
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
      total: merged.length,
    },
  };
}

export function finalizeAndSave(outPath, { meta, activities, endedCache, skippedFetch = 0 }) {
  const { activities: merged, stats } = mergeWithEndedCache(activities, endedCache);
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
  if (!stats?.cachedEndedTotal) return;
  console.log(`  ended cache loaded: ${stats.cachedEndedTotal}`);
  if (stats.skippedFetch) console.log(`  skipped re-fetch (cached ended): ${stats.skippedFetch}`);
  if (stats.freshlyFetched != null) console.log(`  freshly crawled: ${stats.freshlyFetched}`);
  if (stats.keptEndedNotInList) {
    console.log(`  kept ended (no longer on site): ${stats.keptEndedNotInList}`);
  }
}
