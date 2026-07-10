function safeJsonParse(s, def) {
  try {
    return JSON.parse(s || '[]');
  } catch {
    return def;
  }
}

export function shouldExportStore(store) {
  const status = String((store && store.status) || '')
    .toLowerCase()
    .trim();
  return status !== 'removed' && status !== 'deleted';
}

export function storeToExportShape(row) {
  const cash = row.cashAccepted;
  return {
    placeKey: row.placeKey,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    googleMapsUrl: row.googleMapsUrl,
    categoryIds: safeJsonParse(row.categoryIds, []),
    payments: safeJsonParse(row.payments, []),
    iconId: row.iconId,
    notes: row.notes,
    cashAccepted: cash === 1 ? true : cash === 0 ? false : null,
    cardNetworks: safeJsonParse(row.cardNetworks, []),
    status: row.status,
    reportSource: row.reportSource,
    reportedAt: row.reportedAt,
    verified: false
  };
}
