import { haversineMeters } from './domain.js';
import { routes as defaultCatalog } from './data.js';

const cache = new Map();
let nextRequest = 0;

export function resolveCanonicalPlaceId(place, catalog = defaultCatalog) {
  if (!place) return null;
  const rawId = typeof place === 'string' ? place : place.id;
  const match = (catalog || []).find(r => r.id === rawId || `catalog:${r.id}` === rawId);
  if (match) return match.id;

  // Spatial matching: if place is within 50m of a collectible catalog place, resolve to canonical ID
  if (typeof place === 'object' && place.lat != null && place.lng != null) {
    for (const r of (catalog || [])) {
      if (r.location && (r.pointKind === 'place' || r.pointKind == null) && r.collectible === true) {
        if (haversineMeters(place, r.location) <= 50) {
          return r.id;
        }
      }
    }
  }
  return rawId;
}

export function nearbyQuery(position) {
  if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng) || Math.abs(position.lat) > 85 || Math.abs(position.lng) > 180) {
    throw new Error('Neplatná poloha pro hledání.');
  }
  // Round before transmitting. No exact phone position or track is sent.
  const lat = Math.round(position.lat * 100) / 100, lng = Math.round(position.lng * 100) / 100;
  return {
    key: `${lat},${lng}`,
    query: `[out:json][timeout:15];(nwr(around:1800,${lat},${lng})[tourism~"^(viewpoint|museum|attraction|artwork|picnic_site)$"];nwr(around:1800,${lat},${lng})[historic~"^(castle|memorial|monument|ruins)$"];);out center 70;`,
  };
}

export function normalizePlaces(data, position, catalog = defaultCatalog) {
  if (!Array.isArray(data?.elements)) throw new Error('Mapová služba vrátila neplatná data.');
  return data.elements
    .filter(p => ['node', 'way', 'relation'].includes(p.type) && Number.isSafeInteger(p.id) && !['private', 'no'].includes(p.tags?.access))
    .map(p => {
      const lat = p.lat ?? p.center?.lat;
      const lng = p.lon ?? p.center?.lon;
      const osmId = `osm:${p.type}:${p.id}`;
      const canonicalId = resolveCanonicalPlaceId({ id: osmId, lat, lng }, catalog);
      const title = String(
        p.tags?.name ||
        ({
          viewpoint: 'Vyhlídka',
          museum: 'Muzeum',
          attraction: 'Zajímavost',
          artwork: 'Umělecké dílo',
          picnic_site: 'Místo k odpočinku',
          castle: 'Hrad či zámek',
          memorial: 'Památník',
          monument: 'Pomník',
          ruins: 'Zřícenina',
        }[p.tags?.tourism || p.tags?.historic]) ||
        'Místo z OSM'
      ).slice(0, 140);

      return {
        id: canonicalId,
        rawOsmId: osmId,
        lat,
        lng,
        title,
        url: `https://www.openstreetmap.org/${p.type}/${p.id}`,
        pointKind: 'place',
        collectible: true,
      };
    })
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (haversineMeters(position, p) ?? Infinity) <= 2500)
    .sort((a, b) => haversineMeters(position, a) - haversineMeters(position, b))
    .slice(0, 30);
}

export async function fetchNearby(position, endpoint, signal, catalog = defaultCatalog) {
  const { key, query } = nearbyQuery(position);
  if (cache.has(key) && cache.get(key).expires > Date.now()) return cache.get(key).places;
  if (Date.now() < nextRequest) throw new Error('Další hledání bude možné za minutu. Mezitím můžeš dál odkrývat mapu.');
  nextRequest = Date.now() + 60000;
  const timer = new AbortController(), id = setTimeout(() => timer.abort(), 20000);
  const cancel = () => timer.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), signal: timer.signal });
    if (!response.ok) throw new Error('Služba míst je nyní nedostupná. Zkus to později; chůze a body fungují dál.');
    const places = normalizePlaces(await response.json(), position, catalog);
    cache.set(key, { places, expires: Date.now() + 15 * 60000 });
    return places;
  } finally {
    clearTimeout(id);
    signal?.removeEventListener('abort', cancel);
  }
}
