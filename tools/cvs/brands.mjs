/** Brand taxonomy for Taiwan convenience stores (CVS mode). */

export const CVS_BRANDS = [
  { id: '711', label: '7-ELEVEN', short: '7-11', primary: true, color: '#008043' },
  { id: 'family', label: '全家', short: '全家', primary: true, color: '#0078c8' },
  { id: 'hilife', label: '萊爾富', short: '萊爾富', primary: true, color: '#e60012' },
  { id: 'ok', label: 'OK超商', short: 'OK', primary: true, color: '#f58220' },
  { id: 'simple', label: '美廉社', short: '美廉社', primary: true, color: '#c62828' }
];

export const BRAND_BY_ID = Object.fromEntries(CVS_BRANDS.map((b) => [b.id, b]));

export const PHASE1_BRAND_IDS = ['711', 'family'];

export function brandLabel(brandId) {
  const b = BRAND_BY_ID[brandId];
  return (b && b.label) || brandId;
}
