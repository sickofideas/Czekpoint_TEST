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

function detectCategory(tags = {}) {
  if (tags.historic && /^(castle|ruins|manor)$/.test(tags.historic)) return 'castles';
  if (tags.tourism === 'viewpoint' || (tags.natural && /^(peak|cliff|rock)$/.test(tags.natural))) return 'views';
  if (/^(museum|attraction|artwork)$/.test(tags.tourism) || /^(memorial|monument)$/.test(tags.historic)) return 'museums';
  if (tags.amenity === 'place_of_worship' || /^(wayside_chapel|wayside_cross)$/.test(tags.historic)) return 'sacral';
  if (/^(spring|water)$/.test(tags.natural) || /^(waterfall|weir)$/.test(tags.waterway)) return 'water';
  if (tags.tourism === 'picnic_site' || tags.amenity === 'shelter' || tags.natural === 'tree') return 'nature';
  if (/^(park|playground|dog_park)$/.test(tags.leisure)) return 'family';
  return 'nature';
}

export function nearbyQuery(position, options = {}) {
  if (!Number.isFinite(position?.lat) || !Number.isFinite(position?.lng) || Math.abs(position.lat) > 85 || Math.abs(position.lng) > 180) {
    throw new Error('Neplatná poloha pro hledání.');
  }
  // Round before transmitting. No exact phone position or track is sent.
  const lat = Math.round(position.lat * 100) / 100, lng = Math.round(position.lng * 100) / 100;
  const radius = Number(options.radiusM) > 0 ? Math.min(10000, Math.max(500, Math.round(options.radiusM))) : 1800;

  const categories = Array.isArray(options.categories) && options.categories.length > 0 ? options.categories : null;

  if (!categories) {
    return {
      key: `${lat},${lng}:${radius}`,
      query: `[out:json][timeout:15];(nwr(around:${radius},${lat},${lng})[tourism~"^(viewpoint|museum|attraction|artwork|picnic_site)$"];nwr(around:${radius},${lat},${lng})[historic~"^(castle|memorial|monument|ruins)$"];);out center 70;`,
    };
  }

  const statements = [];
  for (const cat of categories) {
    if (cat === 'castles') statements.push(`nwr(around:${radius},${lat},${lng})[historic~"^(castle|ruins|manor)$"];`);
    else if (cat === 'views') {
      statements.push(`nwr(around:${radius},${lat},${lng})[tourism="viewpoint"];`);
      statements.push(`nwr(around:${radius},${lat},${lng})[natural~"^(peak|cliff|rock)$"];`);
    } else if (cat === 'museums') {
      statements.push(`nwr(around:${radius},${lat},${lng})[tourism~"^(museum|attraction|artwork)$"];`);
      statements.push(`nwr(around:${radius},${lat},${lng})[historic~"^(memorial|monument)$"];`);
    } else if (cat === 'sacral') {
      statements.push(`nwr(around:${radius},${lat},${lng})[amenity="place_of_worship"];`);
      statements.push(`nwr(around:${radius},${lat},${lng})[historic~"^(wayside_chapel|wayside_cross)$"];`);
    } else if (cat === 'water') {
      statements.push(`nwr(around:${radius},${lat},${lng})[natural~"^(spring|water)$"];`);
      statements.push(`nwr(around:${radius},${lat},${lng})[waterway~"^(waterfall|weir)$"];`);
    } else if (cat === 'nature') {
      statements.push(`nwr(around:${radius},${lat},${lng})[tourism="picnic_site"];`);
      statements.push(`nwr(around:${radius},${lat},${lng})[amenity="shelter"];`);
      statements.push(`nwr(around:${radius},${lat},${lng})[natural="tree"];`);
    } else if (cat === 'family') {
      statements.push(`nwr(around:${radius},${lat},${lng})[leisure~"^(park|playground|dog_park)$"];`);
    }
  }

  if (statements.length === 0) {
    statements.push(`nwr(around:${radius},${lat},${lng})[tourism~"^(viewpoint|museum|attraction|artwork|picnic_site)$"];`);
    statements.push(`nwr(around:${radius},${lat},${lng})[historic~"^(castle|memorial|monument|ruins)$"];`);
  }

  const catKey = [...categories].sort().join(',');
  return {
    key: `${lat},${lng}:${radius}:${catKey}`,
    query: `[out:json][timeout:15];(${statements.join('')});out center 70;`,
  };
}

export function normalizePlaces(data, position, catalog = defaultCatalog, maxDistance = 2500) {
  if (!Array.isArray(data?.elements)) throw new Error('Mapová služba vrátila neplatná data.');
  const limitDist = Number(maxDistance) > 0 ? Number(maxDistance) : 2500;
  return data.elements
    .filter(p => ['node', 'way', 'relation'].includes(p.type) && Number.isSafeInteger(p.id) && !['private', 'no'].includes(p.tags?.access))
    .map(p => {
      const lat = p.lat ?? p.center?.lat;
      const lng = p.lon ?? p.center?.lon;
      const osmId = `osm:${p.type}:${p.id}`;
      const canonicalId = resolveCanonicalPlaceId({ id: osmId, lat, lng }, catalog);
      const category = detectCategory(p.tags);
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
        category,
        surface: p.tags?.surface || p.tags?.highway || null,
        tags: p.tags || {},
        url: `https://www.openstreetmap.org/${p.type}/${p.id}`,
        pointKind: 'place',
        collectible: true,
      };
    })
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (haversineMeters(position, p) ?? Infinity) <= limitDist)
    .sort((a, b) => haversineMeters(position, a) - haversineMeters(position, b))
    .slice(0, 30);
}

export async function fetchNearby(position, endpoint, signal, catalog = defaultCatalog, options = {}) {
  const { key, query } = nearbyQuery(position, options);
  if (cache.has(key) && cache.get(key).expires > Date.now()) return cache.get(key).places;
  if (Date.now() < nextRequest) throw new Error('Další hledání bude možné za minutu. Mezitím můžeš dál odkrývat mapu.');
  nextRequest = Date.now() + 60000;
  const timer = new AbortController(), id = setTimeout(() => timer.abort(), 20000);
  const cancel = () => timer.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), signal: timer.signal });
    if (!response.ok) throw new Error('Služba míst je nyní nedostupná. Zkus to později; chůze a body fungují dál.');
    const maxDist = options.radiusM ? Math.max(2500, options.radiusM + 200) : 2500;
    const places = normalizePlaces(await response.json(), position, catalog, maxDist);
    cache.set(key, { places, expires: Date.now() + 15 * 60000 });
    return places;
  } finally {
    clearTimeout(id);
    signal?.removeEventListener('abort', cancel);
  }
}
