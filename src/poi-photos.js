import { haversineMeters } from './domain.js';

const PHOTO_CACHE_KEY = 'czekpoint.poi.photos.v1';
const memoryPhotoCache = new Map();

/**
 * Fallback bitmap/illustration asset (what the app used so far) based on place kind/category.
 */
export function getFallbackBitmapUrl(place) {
  if (!place || typeof place !== 'object') return './assets/forest.svg';
  if (place.illustration && ['forest', 'castle', 'lake'].includes(place.illustration)) {
    return `./assets/${place.illustration}.svg`;
  }
  const kind = String(place.kind || '').toLowerCase();
  const cat = String(place.category || '').toLowerCase();
  if (kind === 'culture' || kind === 'castle' || kind === 'heritage' || cat === 'castles') {
    return './assets/castle.svg';
  }
  if (kind === 'water' || kind === 'spring' || cat === 'water') {
    return './assets/lake.svg';
  }
  return './assets/forest.svg';
}

/**
 * Checks whether a Wikimedia Commons / Wikipedia license string permits commercial use.
 * Allowed: Public Domain (PD, CC0), CC BY, CC BY-SA.
 * Rejected: Non-Commercial (NC), NoDerivs (ND), Fair Use, unverified/unknown.
 */
export function isCommerciallyUsableLicense(licenseShortName = '', usageTerms = '') {
  const combined = `${licenseShortName || ''} ${usageTerms || ''}`.trim().toLowerCase();
  if (!combined) return false;

  // Reject any Non-Commercial, NoDerivs, or restricted terms immediately
  if (
    /\bnc\b|non-?commercial|nekomer|noderiv|\bnd\b|fair\s*use|all\s*rights\s*reserved|copyrighted\s*free\s*use\s*provided/i.test(
      combined
    )
  ) {
    // Note: "copyrighted free use" without restrictions on Commons is commercial-safe, but we stay strict with CC/PD
    if (!/cc0|public\s*domain|\bcc[\s-]+by\b/i.test(combined)) {
      return false;
    }
    if (/\bnc\b|non-?commercial|\bnd\b|noderiv/i.test(combined)) {
      return false;
    }
  }

  // Accept Public Domain / CC0 / PDM
  if (/public\s*domain|\bpd\b|voln[eé]\s*d[ií]lo|\bcc0\b/i.test(combined)) {
    return true;
  }

  // Accept CC BY and CC BY-SA (versions 1.0, 2.0, 2.5, 3.0, 4.0)
  if (/\bcc[\s-]+by(?:-sa)?\b/i.test(combined) || /creative\s*commons\s*attribution/i.test(combined)) {
    return true;
  }

  return false;
}

function stripHtmlTags(raw = '') {
  return String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadPersistedPhotoCache(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || memoryPhotoCache.size > 0) return;
  try {
    const raw = storage.getItem(PHOTO_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object') memoryPhotoCache.set(k, v);
      }
    }
  } catch {}
}

function savePersistedPhotoCache(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return;
  try {
    const entries = [...memoryPhotoCache.entries()].slice(-180);
    const obj = Object.fromEntries(entries);
    storage.setItem(PHOTO_CACHE_KEY, JSON.stringify(obj));
  } catch {}
}

/**
 * Verifies a Wikimedia File title via Commons / Czech Wikipedia imageinfo API
 * and returns commercial-safe photo URL + license metadata, or null if not commercial-safe.
 */
export async function verifyWikimediaFileCommercial(
  fileTitle,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  signal = null
) {
  if (!fileTitle || !fetchImpl) return null;
  const normalizedTitle = fileTitle.startsWith('File:') || fileTitle.startsWith('Soubor:')
    ? fileTitle
    : `File:${fileTitle}`;

  const url =
    `https://commons.wikimedia.org/w/api.php?action=query` +
    `&titles=${encodeURIComponent(normalizedTitle)}` +
    `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=560` +
    `&format=json&origin=*`;

  const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = timer ? setTimeout(() => timer.abort(), 3200) : null;
  try {
    const res = await fetchImpl(url, { signal: timer ? timer.signal : signal });
    if (!res || !res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages || typeof pages !== 'object') return null;
    const firstPage = Object.values(pages)[0];
    const info = firstPage?.imageinfo?.[0];
    if (!info) return null;

    const thumbUrl = info.thumburl || info.url;
    if (!thumbUrl || /\.svg$/i.test(thumbUrl) || /\.tif$/i.test(thumbUrl)) return null;

    const ext = info.extmetadata || {};
    const licenseShort = stripHtmlTags(ext.LicenseShortName?.value || '');
    const usageTerms = stripHtmlTags(ext.UsageTerms?.value || '');
    const artist = stripHtmlTags(ext.Artist?.value || 'Wikimedia Commons');

    if (!isCommerciallyUsableLicense(licenseShort, usageTerms)) {
      return null;
    }

    return {
      photoUrl: thumbUrl,
      fullUrl: info.descriptionurl || info.url || thumbUrl,
      license: licenseShort || usageTerms || 'CC BY-SA',
      artist: artist.slice(0, 80),
      sourceLabel: 'Wikimedia Commons',
    };
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Resolves a verified, commercially-usable real photo for a POI on the map.
 * - Checks if the place already has a verified photo in cache.
 * - Queries Czech Wikipedia / Wikimedia Commons by pageid, OSM wikipedia/wikimedia_commons tag, or coordinates + title.
 * - Verifies license via `isCommerciallyUsableLicense` (CC0 / Public Domain / CC BY / CC BY-SA).
 * - If no verified photo exists, returns `{ hasVerifiedPhoto: false, photoUrl: null, fallbackUrl }`.
 */
export async function resolveVerifiedPlacePhoto(
  place,
  options = {}
) {
  const fallbackUrl = getFallbackBitmapUrl(place);
  if (!place || typeof place !== 'object') {
    return { hasVerifiedPhoto: false, photoUrl: null, fallbackUrl, license: null, artist: null };
  }

  const fetchImpl = options.fetchImpl !== undefined
    ? options.fetchImpl
    : (typeof fetch !== 'undefined' ? fetch : null);
  const storage = options.storage !== undefined
    ? options.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null);

  loadPersistedPhotoCache(storage);

  const cacheKey = String(place.id || `${place.lat},${place.lng}`);
  if (memoryPhotoCache.has(cacheKey)) {
    const cached = memoryPhotoCache.get(cacheKey);
    return {
      ...cached,
      fallbackUrl,
    };
  }

  // If the place already has a pre-verified commercial photo attached
  if (
    place.verifiedPhoto?.photoUrl &&
    isCommerciallyUsableLicense(place.verifiedPhoto.license, place.verifiedPhoto.license)
  ) {
    const result = {
      hasVerifiedPhoto: true,
      photoUrl: place.verifiedPhoto.photoUrl,
      license: place.verifiedPhoto.license,
      artist: place.verifiedPhoto.artist || 'Wikimedia Commons',
      sourceLabel: place.verifiedPhoto.sourceLabel || 'Wikimedia Commons',
      fallbackUrl,
    };
    memoryPhotoCache.set(cacheKey, result);
    savePersistedPhotoCache(storage);
    return result;
  }

  if (!fetchImpl) {
    return { hasVerifiedPhoto: false, photoUrl: null, fallbackUrl, license: null, artist: null };
  }

  try {
    // 1. Check if OSM tag has direct File on Wikimedia Commons
    const commonsTag = place.tags?.wikimedia_commons;
    if (commonsTag && /^(File:|Soubor:)/i.test(commonsTag)) {
      const verified = await verifyWikimediaFileCommercial(commonsTag, fetchImpl, options.signal);
      if (verified) {
        const result = { hasVerifiedPhoto: true, ...verified, fallbackUrl };
        memoryPhotoCache.set(cacheKey, result);
        savePersistedPhotoCache(storage);
        return result;
      }
    }

    // 2. If place came from Czech Wikipedia GeoSearch and has pageimage file name
    if (place.wikiPageImage) {
      const verified = await verifyWikimediaFileCommercial(place.wikiPageImage, fetchImpl, options.signal);
      if (verified) {
        const result = { hasVerifiedPhoto: true, ...verified, fallbackUrl };
        memoryPhotoCache.set(cacheKey, result);
        savePersistedPhotoCache(storage);
        return result;
      }
    }

    // 3. Query Czech Wikipedia around the place's coordinates or by title for pageimages
    const lat = place.lat ?? place.location?.lat;
    const lng = place.lng ?? place.location?.lng;
    let candidatePageImage = null;

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const geoUrl =
        `https://cs.wikipedia.org/w/api.php?action=query` +
        `&generator=geosearch&ggscoord=${lat}|${lng}&ggsradius=850&ggslimit=8` +
        `&prop=pageimages|coordinates&piprop=name|thumbnail&pithumbsize=560` +
        `&format=json&origin=*`;

      const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = timer ? setTimeout(() => timer.abort(), 3000) : null;
      try {
        const res = await fetchImpl(geoUrl, { signal: timer ? timer.signal : options.signal });
        if (res && res.ok) {
          const data = await res.json();
          const pages = Object.values(data?.query?.pages || {});
          const cleanPlaceTitle = String(place.title || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

          // Sort pages by title similarity + proximity
          const scored = pages
            .filter(pg => pg && pg.pageimage && !/\.svg$/i.test(pg.pageimage))
            .map(pg => {
              const pgTitle = String(pg.title || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
              const coord = pg.coordinates?.[0];
              const dist = coord ? (haversineMeters({ lat, lng }, { lat: coord.lat, lng: coord.lon }) ?? 999) : 500;
              const firstWord = pgTitle.split(/[\s(–-]+/)[0];
              const titleMatch =
                cleanPlaceTitle.includes(pgTitle) ||
                pgTitle.includes(cleanPlaceTitle) ||
                (firstWord.length >= 4 && cleanPlaceTitle.includes(firstWord));
              return {
                pg,
                score: (titleMatch ? 1000 : 0) - dist,
                dist,
                titleMatch,
              };
            })
            .filter(item => item.titleMatch || item.dist <= 220)
            .sort((a, b) => b.score - a.score);

          if (scored.length > 0) {
            candidatePageImage = scored[0].pg.pageimage;
          }
        }
      } catch {} finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    if (candidatePageImage) {
      const verified = await verifyWikimediaFileCommercial(candidatePageImage, fetchImpl, options.signal);
      if (verified) {
        const result = { hasVerifiedPhoto: true, ...verified, fallbackUrl };
        memoryPhotoCache.set(cacheKey, result);
        savePersistedPhotoCache(storage);
        return result;
      }
    }
  } catch {}

  const fallbackResult = {
    hasVerifiedPhoto: false,
    photoUrl: null,
    fallbackUrl,
    license: null,
    artist: null,
  };
  memoryPhotoCache.set(cacheKey, fallbackResult);
  return fallbackResult;
}

/**
 * Synchronously returns cached verified photo info for a place if already resolved,
 * or null if not yet resolved.
 */
export function getCachedPlacePhoto(place) {
  if (!place || typeof place !== 'object') return null;
  loadPersistedPhotoCache();
  const cacheKey = String(place.id || `${place.lat},${place.lng}`);
  const cached = memoryPhotoCache.get(cacheKey);
  if (cached && cached.hasVerifiedPhoto && cached.photoUrl) {
    return cached;
  }
  if (
    place.verifiedPhoto?.photoUrl &&
    isCommerciallyUsableLicense(place.verifiedPhoto.license, place.verifiedPhoto.license)
  ) {
    return {
      hasVerifiedPhoto: true,
      photoUrl: place.verifiedPhoto.photoUrl,
      license: place.verifiedPhoto.license,
      artist: place.verifiedPhoto.artist || 'Wikimedia Commons',
      sourceLabel: place.verifiedPhoto.sourceLabel || 'Wikimedia Commons',
      fallbackUrl: getFallbackBitmapUrl(place),
    };
  }
  return null;
}

const inFlightPrefetches = new Set();

/**
 * Resolves verified commercial-safe photos in the background for a list of places (e.g., planned stops + visible POIs)
 * and calls `onResolved(place, photoInfo)` whenever a new verified photo is confirmed.
 */
export async function prefetchVerifiedPhotosForPlaces(places = [], options = {}) {
  if (!Array.isArray(places) || places.length === 0) return;
  loadPersistedPhotoCache(options.storage);

  const candidates = places
    .filter(p => p && p.id && !memoryPhotoCache.has(String(p.id)) && !inFlightPrefetches.has(String(p.id)))
    .slice(0, options.maxCount || 10);

  if (candidates.length === 0) return;

  let anyNewPhoto = false;
  await Promise.allSettled(
    candidates.map(async p => {
      const key = String(p.id);
      inFlightPrefetches.add(key);
      try {
        const res = await resolveVerifiedPlacePhoto(p, options);
        if (res && res.hasVerifiedPhoto && res.photoUrl) {
          anyNewPhoto = true;
          if (typeof options.onPlaceResolved === 'function') {
            options.onPlaceResolved(p, res);
          }
        }
      } finally {
        inFlightPrefetches.delete(key);
      }
    })
  );

  if (anyNewPhoto && typeof options.onBatchUpdated === 'function') {
    options.onBatchUpdated();
  }
}

