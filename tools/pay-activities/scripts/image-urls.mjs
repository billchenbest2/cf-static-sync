/**
 * Resolve OCR candidate image URLs from activity raw JSON and slug.
 */
const S3 = 'https://prod-s3.pxpayplus.com';

const KV_FILENAME_CANDIDATES = [
  'KV.png',
  'kv.png',
  '00-kv.png',
  '00-KV.png',
  '01-kv.png',
  '01-KV.png',
  '02-kv.png',
  'banner.png',
  'KV.webp',
  'kv.webp',
  '00-kv.webp',
];

const LOTTIE_JSON_CANDIDATES = ['kv.json', 'KV.json', 'animation.json', 'banner.json'];

const PRIORITY_NAMES = [
  /\/kv\.json$/i,
  /\/00-kv\.png$/i,
  /\/KV\.png$/i,
  /\/kv\.png$/i,
  /\/00-kv\.webp$/i,
  /\/kv\.webp$/i,
  /\/KV\.webp$/i,
  /\/banner\.png$/i,
  /banner/i,
  /\/01-kv\.png$/i,
  /Og_img/i,
  /KV/i,
  /title/i,
  /kv/i,
  /1-1\.png/i,
  /promotion/i,
];

export function resolveImagePath(value, slug) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  if (!/\.(png|jpg|jpeg|webp)$/i.test(v)) return null;
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('MKT_Event/')) return `${S3}/${v}`;
  if (v.startsWith('/')) return `${S3}${v}`;
  return `${S3}/MKT_Event/Event_Img/${slug}/${v.replace(/^\//, '')}`;
}

function addStructuredImageFields(urls, raw, slug) {
  if (!raw || typeof raw !== 'object') return;
  const picks = [
    raw.kv?.imageUrl,
    raw.kv?.image,
    raw.kv?.static,
    raw.banner?.picture,
    raw.banner?.image,
    raw.banner_section?.picture,
    raw.keyVisual?.picture,
    raw.keyVisual?.imageUrl,
  ];
  for (const p of picks) {
    const u = resolveImagePath(p, slug);
    if (u) urls.add(u);
  }
}

function addKnownKvCandidates(urls, slug) {
  for (const name of KV_FILENAME_CANDIDATES) {
    urls.add(`${S3}/MKT_Event/Event_Img/${slug}/${name}`);
  }
}

function addLottieJsonCandidates(urls, slug, raw) {
  for (const name of LOTTIE_JSON_CANDIDATES) {
    urls.add(`${S3}/MKT_Event/Event_Img/${slug}/${name}`);
  }
  const anim = raw?.kv?.animation;
  if (typeof anim === 'string' && anim.trim()) {
    const name = anim.endsWith('.json') ? anim : `${anim.replace(/\/$/, '')}.json`;
    urls.add(`${S3}/MKT_Event/Event_Img/${slug}/${name.replace(/^\//, '')}`);
  }
}

export function collectLottieJsonUrls(slug, raw) {
  const urls = new Set();
  addLottieJsonCandidates(urls, slug, raw);
  return [...urls];
}

export function extractBase64DataUrls(text) {
  if (!text) return [];
  const re = /data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+/g;
  return [...new Set(String(text).match(re) || [])];
}

export function decodeDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
}

export async function fetchJsonUrl(url, referer) {
  const res = await fetch(url, {
    headers: {
      Referer: referer || 'https://marketing.pxpayplus.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.startsWith('{') && !text.includes('data:image')) return null;
  return text;
}

export function collectOcrImageUrls(slug, raw, extras = {}) {
  const urls = new Set();

  addKnownKvCandidates(urls, slug);
  addLottieJsonCandidates(urls, slug, raw);
  addStructuredImageFields(urls, raw, slug);

  if (extras.ogImage) {
    const u =
      resolveImagePath(extras.ogImage, slug) ||
      resolveImagePath(`MKT_Event/Event_Img/Og_img/${slug}.png`, slug);
    if (u) urls.add(u);
  }

  urls.add(`${S3}/MKT_Event/Event_Img/Og_img/${slug}.png`);

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) return obj.forEach(walk);
    for (const v of Object.values(obj)) {
      if (typeof v === 'string') {
        const u = resolveImagePath(v, slug);
        if (u) urls.add(u);
      } else if (typeof v === 'object') walk(v);
    }
  }

  walk(raw);

  if (extras.bannerUrl) {
    const u = resolveImagePath(extras.bannerUrl, slug) || extras.bannerUrl;
    if (u) urls.add(u);
  }

  const text = JSON.stringify(raw || {});
  const re = /https:\/\/prod-s3\.pxpayplus\.com\/[^"\\]+\.(?:png|jpg|jpeg|webp)/gi;
  let m;
  while ((m = re.exec(text))) urls.add(m[0]);

  const list = [...urls];
  list.sort((a, b) => scoreUrl(b, slug) - scoreUrl(a, slug));
  return list;
}

function scoreUrl(url, slug) {
  let score = 0;
  for (let i = 0; i < PRIORITY_NAMES.length; i++) {
    if (PRIORITY_NAMES[i].test(url)) score += (PRIORITY_NAMES.length - i) * 10;
  }
  if (url.includes(slug)) score += 5;
  if (url.includes('Og_img')) score += 3;
  if (/00-kv\.png/i.test(url)) score += 30;
  if (/KV\.png$/i.test(url)) score += 25;
  if (/kv\.json$/i.test(url)) score += 35;
  return score;
}

let sharpModule;
async function getSharp() {
  if (sharpModule === undefined) {
    try {
      sharpModule = (await import('sharp')).default;
    } catch {
      sharpModule = null;
    }
  }
  return sharpModule;
}

export async function prepareImageForOcr(buffer, url) {
  if (!buffer?.length) return null;
  const isWebp = /\.webp(\?|$)/i.test(url || '') || String(url || '').startsWith('data:image/webp');
  const sharp = await getSharp();
  if (!sharp) {
    if (isWebp) return null;
    if (!/\.(png|jpg|jpeg)(\?|$)/i.test(url || '') && !String(url || '').startsWith('data:image/')) return null;
    return buffer;
  }
  try {
    let img = sharp(buffer);
    const meta = await img.metadata();
    const targetW = Math.max(meta.width || 0, 900);
    if ((meta.width || 0) < targetW) {
      img = img.resize({ width: targetW });
    }
    return await img.png().toBuffer();
  } catch {
    if (isWebp) return null;
    return buffer;
  }
}

export async function prepareImageVariantsForOcr(buffer, url) {
  const variants = [];
  const full = await prepareImageForOcr(buffer, url);
  if (full) variants.push({ label: 'full', buffer: full });

  const sharp = await getSharp();
  if (!sharp || !buffer?.length) return variants;

  try {
    const meta = await sharp(buffer).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w < 200 || h < 200) return variants;

    const rotBg = { r: 255, g: 255, b: 240, alpha: 1 };

    const addCrop = async (label, region) => {
      try {
        const crop = await sharp(buffer)
          .extract(region)
          .resize({ width: Math.max(region.width, 700) })
          .png()
          .toBuffer();
        variants.push({ label, buffer: crop });
      } catch {
        // skip one window, keep scanning the rest of the image
      }
    };

    const addRotated = async (label, region, deg) => {
      try {
        let pipeline = sharp(buffer);
        if (region) pipeline = pipeline.extract(region);
        const out = await pipeline
          .rotate(deg, { background: rotBg })
          .resize({ width: Math.max(region?.width || w, 800) })
          .png()
          .toBuffer();
        variants.push({ label, buffer: out });
      } catch {
        // skip one window, keep scanning the rest of the image
      }
    };

    // Whole-image deskew: dates can be slanted anywhere on the KV.
    for (const deg of [-8, 8]) {
      await addRotated(`full-rot${deg}`, null, deg);
    }

    // Tesseract often misses small date text on a full banner, so slide
    // OCR-sized windows across the entire image instead of assuming a corner.
    if (h > 400 && w > 400) {
      const ww = Math.min(w, Math.max(280, Math.floor(w * 0.58)));
      const wh = Math.min(h, Math.max(160, Math.floor(h * 0.32)));
      const cols = ww < w ? 3 : 1;
      const rows = wh < h ? 4 : 1;
      const windows = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const left = cols === 1 ? 0 : Math.round((c * (w - ww)) / (cols - 1));
          const top = rows === 1 ? 0 : Math.round((r * (h - wh)) / (rows - 1));
          windows.push([`win-r${r}c${c}`, { left, top, width: ww, height: wh }]);
        }
      }
      for (const [label, region] of windows) {
        await addCrop(label, region);
      }
      for (const [label, region] of windows) {
        for (const deg of [-8, 8]) {
          await addRotated(`${label}-rot${deg}`, region, deg);
        }
      }
    }
  } catch {
    // ignore crop failures
  }

  return variants;
}

export async function fetchS3Json(slug) {
  const res = await fetch(`${S3}/MKT_Event/${slug}.json`, {
    headers: { Referer: `https://marketing.pxpayplus.com/pxplus_marketing_page/${slug}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.startsWith('{')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function downloadImage(url, referer) {
  if (!url || !url.startsWith('http')) return null;
  const res = await fetch(url, {
    headers: {
      Referer: referer || 'https://marketing.pxpayplus.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('image') && !url.match(/\.(png|jpg|jpeg|webp)/i)) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 500) return null;
  return buf;
}
