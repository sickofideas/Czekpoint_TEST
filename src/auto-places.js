import { haversineMeters } from './domain.js';
import { routes as defaultCatalog } from './data.js';

export const GRID_CACHE_KEY_PREFIX = 'czekpoint.grid.v1:';
export const GRID_LRU_KEY = 'czekpoint.grid.lru';
export const MAX_CACHED_TILES = 15;
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let lastOverpassRequestTime = 0;

/**
 * Converts any coordinate in CZ or Europe to a geographic 0.1° × 0.1° tile key (~10 × 10 km).
 * E.g. { lat: 49.6033, lng: 13.8633 } -> "grid:49.6:13.8"
 */
export function gridKeyForPosition(pos) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) {
    return 'grid:0.0:0.0';
  }
  const glat = (Math.floor(pos.lat * 10) / 10).toFixed(1);
  const glng = (Math.floor(pos.lng * 10) / 10).toFixed(1);
  return `grid:${glat}:${glng}`;
}

/**
 * Scores and ranks places based on tourist appeal:
 * Tier 1 (100+): Castles, chateaux, ruins, watchtowers, peaks, viewpoints
 * Tier 2 (70+): Museums, waterfalls, springs, natural monuments
 * Tier 3 (40+): Chapels, wayside crosses, gazebos, parks, picnic sites
 */
export function scoreAndRankPlace(place) {
  if (!place) return 0;
  let score = 0;
  const cat = place.category || '';
  const title = (place.title || '').toLowerCase();
  const tags = place.tags || {};
  const historic = tags.historic || '';
  const tourism = tags.tourism || '';
  const natural = tags.natural || '';
  const waterway = tags.waterway || '';
  const amenity = tags.amenity || '';
  const leisure = tags.leisure || '';

  // Tier 1: Castles, ruins, watchtowers, peaks, viewpoints
  if (
    cat === 'castles' ||
    cat === 'views' ||
    /^(castle|ruins|manor)$/.test(historic) ||
    tourism === 'viewpoint' ||
    /^(peak|cliff|rock)$/.test(natural) ||
    /hrad|zámek|zřícenin|rozhledn|vyhlídk|vrch|vrchol|skála/.test(title)
  ) {
    score += 100;
    if (tourism === 'viewpoint' || /rozhledn/.test(title)) score += 20;
    if (cat === 'castles' || /hrad|zámek/.test(title)) score += 15;
  }
  // Tier 2: Museums, memorials, waterfalls, springs, natural monuments
  else if (
    cat === 'museums' ||
    cat === 'water' ||
    /^(museum|attraction|artwork)$/.test(tourism) ||
    /^(memorial|monument)$/.test(historic) ||
    /^(spring|water)$/.test(natural) ||
    /^(waterfall|weir)$/.test(waterway) ||
    /muzeum|památník|studánk|pramen|vodopád|rybník|jez/.test(title)
  ) {
    score += 70;
    if (cat === 'museums' || /muzeum/.test(title)) score += 10;
    if (/vodopád|studánk/.test(title)) score += 10;
  }
  // Tier 3: Chapels, wayside crosses, gazebos, parks
  else if (
    cat === 'sacral' ||
    cat === 'nature' ||
    cat === 'family' ||
    amenity === 'place_of_worship' ||
    /^(wayside_chapel|wayside_cross)$/.test(historic) ||
    tourism === 'picnic_site' ||
    amenity === 'shelter' ||
    natural === 'tree' ||
    /^(park|playground|dog_park)$/.test(leisure) ||
    /kapl|kříž|kostel|altán|park/.test(title)
  ) {
    score += 40;
  } else {
    score += 20;
  }

  // Bonus for verified catalog place
  if (place.collectible === true && !String(place.id).startsWith('osm:')) {
    score += 30;
  }

  // Bonus for meaningful descriptive name (not generic OSM label)
  if (title && !title.startsWith('místo z osm') && !title.startsWith('zajímavost')) {
    score += 10;
  }

  return score;
}

/**
 * Deduplicates places by canonical ID or spatial proximity within 50 meters.
 */
export function deduplicatePlaces(places) {
  if (!Array.isArray(places)) return [];
  const result = [];
  const seenIds = new Set();

  for (const place of places) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue;
    if (seenIds.has(place.id)) continue;

    // Check spatial duplicate
    const isSpatialDuplicate = result.some(existing => {
      const dist = haversineMeters(existing, place);
      return dist != null && dist <= 50;
    });

    if (!isSpatialDuplicate) {
      seenIds.add(place.id);
      result.push(place);
    }
  }

  return result;
}

/**
 * Reads cached grid tile from localStorage.
 */
export function getCachedGridTile(gridKey, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || !gridKey) return null;
  try {
    const raw = storage.getItem(GRID_CACHE_KEY_PREFIX + gridKey);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (!item || !Array.isArray(item.places) || !item.cachedAt) return null;
    if (Date.now() - item.cachedAt > CACHE_TTL_MS) {
      storage.removeItem(GRID_CACHE_KEY_PREFIX + gridKey);
      return null;
    }
    return item.places;
  } catch {
    return null;
  }
}

/**
 * Saves grid tile into localStorage with LRU eviction (max 15 tiles).
 */
export function setCachedGridTile(gridKey, places, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || !gridKey || !Array.isArray(places)) return;
  try {
    const fullKey = GRID_CACHE_KEY_PREFIX + gridKey;
    const payload = JSON.stringify({
      cachedAt: Date.now(),
      places: places.slice(0, 50),
    });
    storage.setItem(fullKey, payload);

    // Update LRU list
    let lru = [];
    try {
      const rawLru = storage.getItem(GRID_LRU_KEY);
      if (rawLru) lru = JSON.parse(rawLru);
    } catch {}
    if (!Array.isArray(lru)) lru = [];

    lru = lru.filter(k => k !== gridKey);
    lru.unshift(gridKey);

    // Evict old tiles
    while (lru.length > MAX_CACHED_TILES) {
      const evicted = lru.pop();
      try { storage.removeItem(GRID_CACHE_KEY_PREFIX + evicted); } catch {}
    }

    storage.setItem(GRID_LRU_KEY, JSON.stringify(lru));
  } catch {}
}

/**
 * Loads places for a 10km area around centerPos:
 * 1. Immediately returns built-in places within 10 km.
 * 2. Checks localStorage cache for grid tile, merges if present.
 * 3. Background fetch via Overpass for missing tile (respecting 60s rate-limit).
 */
export async function loadAutoPlacesForArea(
  centerPos,
  routes = defaultCatalog,
  config = {},
  signal = null,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!centerPos || !Number.isFinite(centerPos.lat) || !Number.isFinite(centerPos.lng)) {
    return [];
  }

  // 1. Built-in places within 10 km
  const builtIn = (routes || [])
    .filter(r => r.location && (r.pointKind === 'place' || r.pointKind == null))
    .map(r => ({
      id: r.id,
      title: r.title,
      lat: r.location.lat,
      lng: r.location.lng,
      category: r.kind === 'culture' ? 'castles' : r.kind === 'view' ? 'views' : r.kind === 'water' ? 'water' : 'nature',
      pointKind: 'place',
      collectible: r.collectible !== false,
      access: r.access || {},
      surface: r.access?.surface || null,
      tags: {},
      url: `#/trasa/${encodeURIComponent(r.id)}`,
    }))
    .filter(p => (haversineMeters(centerPos, p) ?? Infinity) <= 10000);

  const gridKey = gridKeyForPosition(centerPos);

  // 2. Check localStorage cache
  const cached = getCachedGridTile(gridKey, storage);
  if (cached && cached.length > 0) {
    const combined = deduplicatePlaces([...builtIn, ...cached]);
    return combined.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  }

  // If no fetch or offline or rate limited, return built-in
  if (!fetchImpl) {
    return builtIn.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  }

  // Check rate limit: 60s
  const now = Date.now();
  if (now - lastOverpassRequestTime < 60000) {
    return builtIn.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  }

  // 3. Query Overpass API for tile in background
  try {
    lastOverpassRequestTime = now;
    const parts = gridKey.replace('grid:', '').split(':');
    const sLat = parseFloat(parts[0]);
    const wLng = parseFloat(parts[1]);
    const nLat = Number((sLat + 0.1).toFixed(3));
    const eLng = Number((wLng + 0.1).toFixed(3));
    const bbox = `${sLat},${wLng},${nLat},${eLng}`;

    const query = `[out:json][timeout:12];(
      nwr(${bbox})[tourism~"^(viewpoint|museum|attraction)$"];
      nwr(${bbox})[historic~"^(castle|ruins|memorial|monument)$"];
      nwr(${bbox})[natural~"^(peak|spring)$"];
      nwr(${bbox})[amenity="place_of_worship"];
    );out center 40;`;

    const endpoint = config?.overpassEndpoint || 'https://overpass-api.de/api/interpreter';
    const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = timer ? setTimeout(() => timer.abort(), 12000) : null;

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal: timer ? timer.signal : signal,
      });

      if (!response.ok) return builtIn;
      const data = await response.json();
      if (!Array.isArray(data?.elements)) return builtIn;

      const fetchedPlaces = data.elements
        .filter(el => ['node', 'way', 'relation'].includes(el.type) && el.tags && !['private', 'no'].includes(el.tags?.access))
        .map(el => {
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          const title = el.tags?.name || (el.tags?.tourism === 'viewpoint' ? 'Vyhlídka' : el.tags?.historic === 'castle' ? 'Hrad' : 'Zajímavost');
          let category = 'nature';
          if (el.tags?.historic === 'castle' || el.tags?.historic === 'ruins') category = 'castles';
          else if (el.tags?.tourism === 'viewpoint' || el.tags?.natural === 'peak') category = 'views';
          else if (el.tags?.tourism === 'museum') category = 'museums';
          else if (el.tags?.amenity === 'place_of_worship') category = 'sacral';
          else if (el.tags?.natural === 'spring') category = 'water';

          return {
            id: `osm:${el.type}:${el.id}`,
            title,
            lat,
            lng,
            category,
            pointKind: 'place',
            collectible: true,
            access: { stroller: el.tags?.wheelchair === 'yes' ? 'yes' : 'unknown' },
            surface: el.tags?.surface || null,
            tags: el.tags,
            url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
          };
        })
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));

      setCachedGridTile(gridKey, fetchedPlaces, storage);
      const combined = deduplicatePlaces([...builtIn, ...fetchedPlaces]);
      return combined.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    return builtIn.sort((a, b) => scoreAndRankPlace(b) - scoreAndRankPlace(a));
  }
}
