/**
 * Czekpoint v1.2 — Fotky a vektorové ilustrace míst v okolí (Bod 4)
 *
 * Pro každé místo zajistí reálnou fotografii (z OSM tagů nebo Wikipedia GeoSearch / PageImages API)
 * uloženou v localStorage cache, nebo vygeneruje barevnou vektorovou ilustraci (SVG Data URL)
 * podle kategorie místa (hrad/zámek, kaplička, lesní studánka, skalní vyhlídka, rozcestník, důl/památka)
 * přímo s názvem místa.
 */

export const PLACE_PHOTOS_CACHE_KEY = 'czekpoint.place_photos.v1.2';

const memoryCache = new Map();
const inFlightRequests = new Map();

function escapeXml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Určí podrobný archetyp místa pro vektorovou ilustraci podle názvu, kategorie a OSM tagů.
 * Archetypy: 'castle' (hrad/zámek), 'chapel' (kaplička/kostel), 'spring' (lesní studánka/rybník),
 * 'viewpoint' (skalní vyhlídka/vrchol), 'guidepost' (rozcestník/stezka), 'mine' (důl/památka/muzeum).
 */
export function detectPlaceIllustrationArchetype(place) {
  if (!place || typeof place !== 'object') return 'viewpoint';
  const title = String(place.title || '').toLowerCase();
  const kind = String(place.kind || '').toLowerCase();
  const cat = String(place.category || '').toLowerCase();
  const tags = place.tags || {};

  if (
    /kapl|kostel|kříž|boží muka|svat[áýé]|klášter|poutní|zvonic/.test(title) ||
    tags.amenity === 'place_of_worship' ||
    /^(wayside_chapel|wayside_cross)$/.test(tags.historic || '')
  ) {
    return 'chapel';
  }
  if (
    /důl\b|štol|hornick|lom\b|muzeum|skanzen|památník|mohyl|mlýn|kovárn|tvrz/.test(title) ||
    tags.tourism === 'museum' ||
    /^(memorial|monument|mine)$/.test(tags.historic || '')
  ) {
    return 'mine';
  }
  if (
    /hrad\b|hrádek|zámek|zámeček|zřícenin|bašt/.test(title) ||
    /^(castle|ruins|manor)$/.test(tags.historic || '') ||
    kind === 'culture' ||
    cat === 'castles'
  ) {
    return 'castle';
  }
  if (
    /studánk|pramen|rybník|jezero|nádrž|přehrad|tůň|vodopád|potok|říčk|jez\b|voda/.test(title) ||
    kind === 'water' ||
    cat === 'water' ||
    /^(spring|water)$/.test(tags.natural || '')
  ) {
    return 'spring';
  }
  if (
    /rozcest|stezk|alej|cesta|okruh|start trasy|náměstí|nádraží/.test(title) ||
    place.pointKind === 'route-start' ||
    tags.information === 'guidepost'
  ) {
    return 'guidepost';
  }
  if (
    /vyhlídk|rozhledn|skál|skalní|vrch|vrchol|hora|kopec|třemšín|hřeben|kazateln/.test(title) ||
    kind === 'view' ||
    cat === 'views' ||
    tags.tourism === 'viewpoint'
  ) {
    return 'viewpoint';
  }
  return 'viewpoint';
}

/**
 * Vygeneruje barevnou vektorovou ilustraci (SVG Data URL) podle kategorie místa s názvem místa.
 */
export function generateCategoryPlaceSvgDataUrl(place) {
  const archetype = detectPlaceIllustrationArchetype(place);
  const rawTitle = String(place?.title || 'Zajímavé místo').trim();
  const shortTitle = rawTitle.length > 26 ? rawTitle.slice(0, 24).trim() + '…' : rawTitle;
  const safeTitle = escapeXml(shortTitle);

  const themes = {
    castle: {
      skyTop: '#2c3e55',
      skyBot: '#e3b878',
      hillBack: '#5b6d5b',
      hillFront: '#2e4736',
      badge: 'HRAD A ZÁMEK',
      artwork: `
        <circle cx="205" cy="48" r="22" fill="#f9d98c" opacity="0.9"/>
        <path d="M0 135 L65 95 L130 120 L200 88 L264 130 L264 216 L0 216 Z" fill="#5b6d5b"/>
        <path d="M0 155 Q110 122 264 150 L264 216 L0 216 Z" fill="#2e4736"/>
        <g fill="#f3ead8" stroke="#233329" stroke-width="2">
          <rect x="86" y="72" width="32" height="66" rx="2"/>
          <rect x="82" y="64" width="10" height="10"/>
          <rect x="97" y="64" width="10" height="10"/>
          <rect x="112" y="64" width="10" height="10"/>
          <rect x="118" y="92" width="44" height="46"/>
          <rect x="158" y="66" width="28" height="72" rx="2"/>
          <polygon points="154,66 172,42 190,66" fill="#a84232"/>
          <rect x="132" y="114" width="14" height="24" rx="7" fill="#2c3e55"/>
        </g>
      `,
    },
    chapel: {
      skyTop: '#35524a',
      skyBot: '#dfcfa6',
      hillBack: '#68876d',
      hillFront: '#38583e',
      badge: 'KAPLIČKA',
      artwork: `
        <circle cx="62" cy="48" r="20" fill="#fce5a2" opacity="0.88"/>
        <path d="M0 142 Q90 105 180 132 T264 135 L264 216 L0 216 Z" fill="#68876d"/>
        <path d="M0 158 Q132 132 264 158 L264 216 L0 216 Z" fill="#38583e"/>
        <g stroke="#243829" stroke-width="2">
          <rect x="108" y="88" width="48" height="54" rx="3" fill="#f7f1e1"/>
          <polygon points="102,90 132,62 162,90" fill="#b5533c"/>
          <rect x="125" y="46" width="14" height="20" fill="#f7f1e1"/>
          <polygon points="122,46 132,33 142,46" fill="#b5533c"/>
          <line x1="132" y1="20" x2="132" y2="34" stroke="#f9d98c" stroke-width="3"/>
          <line x1="126" y1="25" x2="138" y2="25" stroke="#f9d98c" stroke-width="3"/>
          <rect x="124" y="114" width="16" height="28" rx="8" fill="#463325"/>
        </g>
      `,
    },
    spring: {
      skyTop: '#1e4e5f',
      skyBot: '#bfe3dc',
      hillBack: '#4b7f72',
      hillFront: '#255246',
      badge: 'STUDÁNKA A VODA',
      artwork: `
        <path d="M0 128 Q85 95 165 124 T264 118 L264 216 L0 216 Z" fill="#4b7f72"/>
        <path d="M0 148 Q130 128 264 148 L264 216 L0 216 Z" fill="#255246"/>
        <ellipse cx="132" cy="154" rx="88" ry="24" fill="#3b949e" stroke="#b9ece8" stroke-width="2"/>
        <path d="M82 150 Q108 144 134 150 T186 150" fill="none" stroke="#e4fbf8" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M96 160 Q122 154 148 160 T178 160" fill="none" stroke="#e4fbf8" stroke-width="2" stroke-linecap="round"/>
        <polygon points="112,92 132,68 152,92" fill="#8b5a2b" stroke="#233830" stroke-width="2"/>
        <rect x="118" y="92" width="28" height="24" fill="#d9c6a5" stroke="#233830" stroke-width="2"/>
        <path d="M132 106 Q132 132 126 144" fill="none" stroke="#9be8f0" stroke-width="4" stroke-linecap="round"/>
      `,
    },
    viewpoint: {
      skyTop: '#24473b',
      skyBot: '#d9e5be',
      hillBack: '#6b8e6e',
      hillFront: '#31543c',
      badge: 'SKALNÍ VYHLÍDKA',
      artwork: `
        <circle cx="198" cy="50" r="24" fill="#f7d379" opacity="0.92"/>
        <path d="M0 140 L55 88 L112 126 L168 74 L225 118 L264 96 L264 216 L0 216 Z" fill="#6b8e6e"/>
        <polygon points="72,156 118,76 156,92 184,156" fill="#8c877a" stroke="#2a3a2e" stroke-width="2"/>
        <polygon points="118,76 138,96 105,124" fill="#aba598"/>
        <path d="M0 154 Q130 134 264 156 L264 216 L0 216 Z" fill="#31543c"/>
        <polygon points="42,88 24,142 60,142" fill="#1d3826"/>
        <polygon points="222,94 206,146 238,146" fill="#1d3826"/>
      `,
    },
    guidepost: {
      skyTop: '#2e4a36',
      skyBot: '#dce4c8',
      hillBack: '#6b875e',
      hillFront: '#3b5936',
      badge: 'ROZCESTNÍK',
      artwork: `
        <path d="M0 138 Q95 106 185 130 T264 126 L264 216 L0 216 Z" fill="#6b875e"/>
        <path d="M0 154 Q130 136 264 154 L264 216 L0 216 Z" fill="#3b5936"/>
        <rect x="127" y="54" width="10" height="104" rx="3" fill="#7c5230" stroke="#23170b" stroke-width="2"/>
        <polygon points="135,66 202,66 214,76 202,86 135,86" fill="#f5d142" stroke="#23170b" stroke-width="2"/>
        <rect x="144" y="72" width="44" height="8" fill="#c92a2a"/>
        <polygon points="129,92 64,92 52,102 64,112 129,112" fill="#f7f4ea" stroke="#23170b" stroke-width="2"/>
        <rect x="74" y="98" width="44" height="8" fill="#1e62b5"/>
      `,
    },
    mine: {
      skyTop: '#2f3842',
      skyBot: '#d5c7ad',
      hillBack: '#686b5e',
      hillFront: '#394236',
      badge: 'DŮL A PAMÁTKA',
      artwork: `
        <circle cx="70" cy="48" r="18" fill="#f2cf7e" opacity="0.85"/>
        <path d="M0 136 L75 94 L152 128 L215 88 L264 124 L264 216 L0 216 Z" fill="#686b5e"/>
        <path d="M0 152 Q132 128 264 152 L264 216 L0 216 Z" fill="#394236"/>
        <path d="M88 152 L98 92 L166 92 L176 152 Z" fill="#7c7365" stroke="#222620" stroke-width="2.5"/>
        <path d="M110 152 L110 112 A22 22 0 0 1 154 112 L154 152 Z" fill="#181c18" stroke="#d5c7ad" stroke-width="2"/>
        <line x1="120" y1="64" x2="144" y2="88" stroke="#f2cf7e" stroke-width="3" stroke-linecap="round"/>
        <line x1="144" y1="64" x2="120" y2="88" stroke="#f2cf7e" stroke-width="3" stroke-linecap="round"/>
      `,
    },
  };

  const t = themes[archetype] || themes.viewpoint;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 264 216" width="264" height="216">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.skyTop}"/>
        <stop offset="75%" stop-color="${t.skyBot}"/>
      </linearGradient>
    </defs>
    <rect width="264" height="216" rx="16" fill="url(#sky)"/>
    ${t.artwork}
    <rect x="0" y="156" width="264" height="60" fill="rgba(18, 33, 25, 0.86)"/>
    <text x="132" y="175" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="800" fill="#d8e99e" letter-spacing="1.2">${escapeXml(t.badge)}</text>
    <text x="132" y="198" text-anchor="middle" font-family="Georgia, serif" font-size="14" font-weight="700" fill="#ffffff">${safeTitle}</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function loadCacheFromStorage(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || memoryCache.size > 0) return;
  try {
    const raw = storage.getItem(PLACE_PHOTOS_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object') memoryCache.set(k, v);
      }
    }
  } catch {}
}

function saveCacheToStorage(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return;
  try {
    const entries = [...memoryCache.entries()].slice(-200);
    storage.setItem(PLACE_PHOTOS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

export function getPlaceCacheKey(place) {
  if (!place) return 'unknown';
  if (place.id) return String(place.id);
  const lat = Number(place.lat ?? place.location?.lat ?? 0).toFixed(4);
  const lng = Number(place.lng ?? place.location?.lng ?? 0).toFixed(4);
  return `coord:${lat},${lng}`;
}

export function formatPhotoSourceLabel(sourceOrObj) {
  const source = typeof sourceOrObj === 'object' && sourceOrObj !== null
    ? (sourceOrObj.source || (sourceOrObj.isRealPhoto ? 'wikipedia-tag' : 'svg-illustration'))
    : sourceOrObj;
  const customLicense = typeof sourceOrObj === 'object' && sourceOrObj !== null ? sourceOrObj.license : null;

  if (source === 'wikimedia-commons') {
    return {
      sourceLabel: 'Wikimedia Commons',
      licenseLabel: customLicense || 'CC BY-SA / volné dílo (neověřená shoda objektu)',
    };
  }
  if (source === 'wikipedia-tag' || source === 'wikipedia-geosearch' || source === 'wikipedia') {
    return {
      sourceLabel: 'Wikipedie / Wikimedia Commons',
      licenseLabel: customLicense || 'CC BY-SA / volné dílo (automaticky přiřazeno dle polohy/článku)',
    };
  }
  if (source === 'osm' || source === 'osm-image') {
    return {
      sourceLabel: 'OpenStreetMap (tag image)',
      licenseLabel: customLicense || '© přispěvatelé OpenStreetMap (ODbL)',
    };
  }
  return {
    sourceLabel: 'Vektorová ilustrace kategorie',
    licenseLabel: 'Vlastní ilustrace Czekpoint',
  };
}

export function isExternalPhotosEnabled(storage = typeof localStorage !== 'undefined' ? localStorage : null, explicitFlag = undefined) {
  if (typeof explicitFlag === 'boolean') return explicitFlag;
  if (!storage || typeof storage.getItem !== 'function') return true;
  try {
    const raw = storage.getItem('czekpoint.state.v2');
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    if (parsed?.appSettings && typeof parsed.appSettings.showExternalPhotos === 'boolean') {
      return parsed.appSettings.showExternalPhotos;
    }
  } catch {}
  return true;
}

/**
 * Synchronně vrátí fotku místa z cache nebo okamžitou barevnou SVG ilustraci s názvem místa.
 * Respektuje přepínač `showExternalPhotos` (DÁVKA 2 Bod 2.2).
 */
export function getPlacePhotoSync(place, storage = typeof localStorage !== 'undefined' ? localStorage : null, options = {}) {
  const fallbackSvgUrl = generateCategoryPlaceSvgDataUrl(place);
  const archetype = detectPlaceIllustrationArchetype(place);
  const fallbackMeta = formatPhotoSourceLabel('svg-illustration');
  if (!place || typeof place !== 'object') {
    return {
      photoUrl: fallbackSvgUrl,
      isRealPhoto: false,
      source: 'svg-illustration',
      sourceLabel: fallbackMeta.sourceLabel,
      licenseLabel: fallbackMeta.licenseLabel,
      fallbackSvgUrl,
      archetype: 'viewpoint',
    };
  }

  const externalAllowed = isExternalPhotosEnabled(storage, options?.showExternalPhotos);
  if (!externalAllowed) {
    return {
      photoUrl: fallbackSvgUrl,
      isRealPhoto: false,
      source: 'svg-illustration',
      sourceLabel: fallbackMeta.sourceLabel,
      licenseLabel: fallbackMeta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
  }

  loadCacheFromStorage(storage);
  const key = getPlaceCacheKey(place);
  const cached = memoryCache.get(key);
  if (cached && cached.photoUrl && cached.isRealPhoto) {
    const meta = formatPhotoSourceLabel(cached.source || 'wikipedia-geosearch');
    return {
      ...cached,
      sourceLabel: cached.sourceLabel || meta.sourceLabel,
      licenseLabel: cached.licenseLabel || meta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
  }

  // Zkontrolujeme přímý OSM tag image, pokud je platnou HTTPS URL
  const directImg = place.tags?.image || place.imageUrl || place.photoUrl;
  if (typeof directImg === 'string' && /^https:\/\//i.test(directImg) && !/\.svg$/i.test(directImg)) {
    const meta = formatPhotoSourceLabel('osm-image');
    const entry = {
      photoUrl: directImg,
      isRealPhoto: true,
      source: 'osm-image',
      sourceLabel: meta.sourceLabel,
      licenseLabel: meta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
    memoryCache.set(key, entry);
    return entry;
  }

  return {
    photoUrl: fallbackSvgUrl,
    isRealPhoto: false,
    source: 'svg-illustration',
    sourceLabel: fallbackMeta.sourceLabel,
    licenseLabel: fallbackMeta.licenseLabel,
    fallbackSvgUrl,
    archetype,
  };
}

/**
 * Asynchronně zjistí reálnou fotku místa z OSM tagů (`image`, `wikimedia_commons`, `wikipedia`)
 * nebo z Wikipedia GeoSearch / PageImages API (okruh 400 m) a výsledek uloží do localStorage cache.
 * Pokud reálná fotka na Wikipedii není nebo uživatel vypnul externí fotky, vrátí barevnou vektorovou ilustraci (SVG Data URL).
 */
export async function resolvePlacePhoto(place, options = {}) {
  const fallbackSvgUrl = generateCategoryPlaceSvgDataUrl(place);
  const archetype = detectPlaceIllustrationArchetype(place);
  const fallbackMeta = formatPhotoSourceLabel('svg-illustration');
  if (!place || typeof place !== 'object') {
    return {
      photoUrl: fallbackSvgUrl,
      isRealPhoto: false,
      source: 'svg-illustration',
      sourceLabel: fallbackMeta.sourceLabel,
      licenseLabel: fallbackMeta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
  }

  const storage = options.storage !== undefined
    ? options.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null);
  const fetchImpl = options.fetchImpl !== undefined
    ? options.fetchImpl
    : (typeof fetch !== 'undefined' ? fetch : null);

  if (!isExternalPhotosEnabled(storage, options.showExternalPhotos)) {
    return {
      photoUrl: fallbackSvgUrl,
      isRealPhoto: false,
      source: 'svg-illustration',
      sourceLabel: fallbackMeta.sourceLabel,
      licenseLabel: fallbackMeta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
  }

  loadCacheFromStorage(storage);
  const key = getPlaceCacheKey(place);

  if (memoryCache.has(key)) {
    const cached = memoryCache.get(key);
    const meta = formatPhotoSourceLabel(cached.isRealPhoto ? (cached.source || 'wikipedia-geosearch') : 'svg-illustration');
    return {
      ...cached,
      photoUrl: cached.isRealPhoto && cached.photoUrl ? cached.photoUrl : fallbackSvgUrl,
      sourceLabel: cached.sourceLabel || meta.sourceLabel,
      licenseLabel: cached.licenseLabel || meta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
  }

  // 1. Přímý OSM tag `image`
  const directImage = place.tags?.image || place.imageUrl;
  if (typeof directImage === 'string' && /^https:\/\//i.test(directImage)) {
    const meta = formatPhotoSourceLabel('osm');
    const result = {
      photoUrl: directImage,
      isRealPhoto: true,
      source: 'osm',
      sourceLabel: meta.sourceLabel,
      licenseLabel: meta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
    memoryCache.set(key, result);
    saveCacheToStorage(storage);
    return result;
  }

  if (!fetchImpl) {
    return {
      photoUrl: fallbackSvgUrl,
      isRealPhoto: false,
      source: 'svg-illustration',
      sourceLabel: fallbackMeta.sourceLabel,
      licenseLabel: fallbackMeta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
  }

  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key);
  }

  const promise = (async () => {
    try {
      // 2. OSM tag `wikipedia` (např. "cs:Zámek Rožmitál pod Třemšínem")
      const wikiTag = place.tags?.wikipedia;
      if (typeof wikiTag === 'string' && wikiTag.length > 2) {
        const titlePart = wikiTag.includes(':') ? wikiTag.split(':').slice(1).join(':') : wikiTag;
        const wikiTitleUrl =
          `https://cs.wikipedia.org/w/api.php?action=query` +
          `&titles=${encodeURIComponent(titlePart)}` +
          `&prop=pageimages&pithumbsize=400&format=json&origin=*`;
        const res = await fetchImpl(wikiTitleUrl, { signal: options.signal });
        if (res && res.ok) {
          const data = await res.json();
          const pages = Object.values(data?.query?.pages || {});
          const thumb = pages.find(p => p?.thumbnail?.source)?.thumbnail?.source;
          if (thumb && !/\.svg$/i.test(thumb)) {
            const meta = formatPhotoSourceLabel('wikipedia-tag');
            const found = {
              photoUrl: thumb,
              isRealPhoto: true,
              source: 'wikipedia-tag',
              sourceLabel: meta.sourceLabel,
              licenseLabel: meta.licenseLabel,
              fallbackSvgUrl,
              archetype,
            };
            memoryCache.set(key, found);
            saveCacheToStorage(storage);
            return found;
          }
        }
      }

      // 3. OSM tag `wikimedia_commons` (např. "File:..." nebo "Category:...")
      const commonsTag = place.tags?.wikimedia_commons;
      if (typeof commonsTag === 'string' && /^(File:|Soubor:)/i.test(commonsTag)) {
        const commonsUrl =
          `https://commons.wikimedia.org/w/api.php?action=query` +
          `&titles=${encodeURIComponent(commonsTag)}` +
          `&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`;
        const res = await fetchImpl(commonsUrl, { signal: options.signal });
        if (res && res.ok) {
          const data = await res.json();
          const pages = Object.values(data?.query?.pages || {});
          const thumb = pages[0]?.imageinfo?.[0]?.thumburl || pages[0]?.imageinfo?.[0]?.url;
          if (thumb && !/\.svg$/i.test(thumb)) {
            const meta = formatPhotoSourceLabel('wikimedia-commons');
            const found = {
              photoUrl: thumb,
              isRealPhoto: true,
              source: 'wikimedia-commons',
              sourceLabel: meta.sourceLabel,
              licenseLabel: meta.licenseLabel,
              fallbackSvgUrl,
              archetype,
            };
            memoryCache.set(key, found);
            saveCacheToStorage(storage);
            return found;
          }
        }
      }

      // 4. Wikipedia GeoSearch / PageImages API (400 m kolem souřadnic místa)
      const lat = Number(place.lat ?? place.location?.lat);
      const lng = Number(place.lng ?? place.location?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const geoUrl =
          `https://cs.wikipedia.org/w/api.php?action=query` +
          `&generator=geosearch&ggscoord=${lat}|${lng}&ggsradius=400` +
          `&prop=pageimages&pithumbsize=400&format=json&origin=*`;
        const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const tid = timer ? setTimeout(() => timer.abort(), 3200) : null;
        try {
          const res = await fetchImpl(geoUrl, { signal: timer ? timer.signal : options.signal });
          if (res && res.ok) {
            const data = await res.json();
            const pages = Object.values(data?.query?.pages || {});
            const withThumb = pages.filter(p => p?.thumbnail?.source && !/\.svg$/i.test(p.thumbnail.source));
            if (withThumb.length > 0) {
              const normPlace = String(place.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
              withThumb.sort((a, b) => {
                const aNorm = String(a.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const bNorm = String(b.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const aMatch = normPlace.includes(aNorm) || aNorm.includes(normPlace) ? 1 : 0;
                const bMatch = normPlace.includes(bNorm) || bNorm.includes(normPlace) ? 1 : 0;
                return bMatch - aMatch;
              });
              const chosen = withThumb[0];
              const meta = formatPhotoSourceLabel('wikipedia-geosearch');
              const found = {
                photoUrl: chosen.thumbnail.source,
                isRealPhoto: true,
                source: 'wikipedia-geosearch',
                sourceLabel: meta.sourceLabel,
                licenseLabel: meta.licenseLabel,
                articleTitle: chosen.title || '',
                fallbackSvgUrl,
                archetype,
              };
              memoryCache.set(key, found);
              saveCacheToStorage(storage);
              return found;
            }
          }
        } finally {
          if (tid) clearTimeout(tid);
        }
      }
    } catch {}

    const fallbackEntry = {
      photoUrl: fallbackSvgUrl,
      isRealPhoto: false,
      source: 'svg-illustration',
      sourceLabel: fallbackMeta.sourceLabel,
      licenseLabel: fallbackMeta.licenseLabel,
      fallbackSvgUrl,
      archetype,
    };
    memoryCache.set(key, fallbackEntry);
    saveCacheToStorage(storage);
    return fallbackEntry;
  })();

  inFlightRequests.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlightRequests.delete(key);
  }
}

/**
 * Načte na pozadí fotky pro pole míst a zavolá callback při nalezení reálné fotky.
 */
export async function prefetchPlacePhotos(places = [], options = {}) {
  if (!Array.isArray(places) || places.length === 0) return;
  const storage = options.storage !== undefined ? options.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!isExternalPhotosEnabled(storage, options.showExternalPhotos)) return;
  const subset = places.slice(0, options.maxCount || 16);
  let updated = false;
  await Promise.allSettled(
    subset.map(async p => {
      const key = getPlaceCacheKey(p);
      if (memoryCache.has(key)) return;
      const res = await resolvePlacePhoto(p, options);
      if (res && res.isRealPhoto) {
        updated = true;
        if (typeof options.onPlaceResolved === 'function') {
          options.onPlaceResolved(p, res);
        }
      }
    })
  );
  if (updated && typeof options.onBatchUpdated === 'function') {
    options.onBatchUpdated();
  }
}

