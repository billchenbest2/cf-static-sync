/** Merge CVS store lists; dedupe by storeId. */

export function mergeCvsStores(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const store of list || []) {
      if (!store || !store.storeId) continue;
      const prev = byId.get(store.storeId);
      if (!prev) {
        byId.set(store.storeId, { ...store });
        continue;
      }
      const services = [...new Set([...(prev.services || []), ...(store.services || [])])].sort();
      byId.set(store.storeId, {
        ...prev,
        ...store,
        services,
        phone: store.phone || prev.phone,
        hours: store.hours || prev.hours
      });
    }
  }
  return [...byId.values()].sort((a, b) => String(a.storeId).localeCompare(String(b.storeId)));
}

export function countByBrand(stores) {
  const counts = {};
  for (const s of stores) {
    const id = s.brandId || 'other';
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}
