import { haversineMeters } from './domain.js';
import { COMPANION_MODES, EXPLORATION_MODES } from './walk-store.js';

export const START_PRESETS = Object.freeze([
  { id: 'namesti', label: 'Náměstí Rožmitál', lat: 49.6033, lng: 13.8633 },
  { id: 'nadrazi', label: 'Nádraží Rožmitál pod Třemšínem', lat: 49.5968, lng: 13.8682 },
  { id: 'stary-rozmital', label: 'Starý Rožmitál', lat: 49.6082, lng: 13.8507 },
]);

export const PLANNER_RADII = Object.freeze([1, 3, 5, 10]);

export const PLANNER_CATEGORIES = Object.freeze([
  {
    id: 'castles',
    label: 'Hrady, zámky a zříceniny',
    icon: '🏰',
    overpassKey: 'historic',
    overpassRegex: 'castle|ruins|manor',
  },
  {
    id: 'views',
    label: 'Vyhlídky, skály a vrcholy',
    icon: '⛰️',
    overpassKey: 'tourism_natural',
    overpassRegex: 'viewpoint|peak|cliff|rock',
  },
  {
    id: 'museums',
    label: 'Muzea a památníky',
    icon: '🏛️',
    overpassKey: 'tourism_historic',
    overpassRegex: 'museum|attraction|artwork|memorial|monument',
  },
  {
    id: 'sacral',
    label: 'Kapličky, křížky a kostely',
    icon: '⛪',
    overpassKey: 'amenity_historic',
    overpassRegex: 'place_of_worship|wayside_chapel|wayside_cross',
  },
  {
    id: 'water',
    label: 'Studánky, rybníky a jezy',
    icon: '💧',
    overpassKey: 'natural_waterway',
    overpassRegex: 'spring|water|waterfall|weir',
  },
  {
    id: 'nature',
    label: 'Památné stromy, altány a odpočívadla',
    icon: '🌲',
    overpassKey: 'tourism_amenity_natural',
    overpassRegex: 'picnic_site|shelter|tree',
  },
  {
    id: 'family',
    label: 'Parky a dětská hřiště',
    icon: '🐾',
    overpassKey: 'leisure',
    overpassRegex: 'park|playground|dog_park',
  },
]);

export const COMPANION_STYLES = Object.freeze([
  { id: 'solo', label: 'Sólo poutník', icon: '🥾', speedKmH: 4.0 },
  { id: 'dog', label: 'Se psem', icon: '🐕', speedKmH: 4.0 },
  { id: 'stroller', label: 'S kočárkem', icon: '👶', speedKmH: 3.2 },
  { id: 'family', label: 'Skupina / Rodina', icon: '👨‍👩‍👧', speedKmH: 3.2 },
]);

/**
 * Optimizes route order for up to 10 points using Nearest Neighbor algorithm from origin.
 */
export function optimizeRouteOrder(origin, places) {
  if (!Array.isArray(places) || places.length <= 1) {
    return Array.isArray(places) ? [...places] : [];
  }
  const remaining = places.slice(0, 10).map((p, idx) => ({ ...p, _idx: idx }));
  const ordered = [];
  let currentPos = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
    ? origin
    : { lat: remaining[0].lat, lng: remaining[0].lng };

  while (remaining.length > 0) {
    let nearestIndex = 0;
    let minDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const d = haversineMeters(currentPos, p);
      const dist = d != null ? d : Infinity;
      if (dist < minDistance) {
        minDistance = dist;
        nearestIndex = i;
      }
    }
    const [chosen] = remaining.splice(nearestIndex, 1);
    delete chosen._idx;
    ordered.push(chosen);
    currentPos = { lat: chosen.lat, lng: chosen.lng };
  }

  return ordered;
}

/**
 * Route X-ray: Calculates air distance, estimated walking distance, walking time,
 * surface summary, and warnings (e.g. for stroller).
 */
export function analyzePlannedRoute(origin, orderedPlaces, companionMode = 'solo') {
  const places = Array.isArray(orderedPlaces) ? orderedPlaces : [];
  let airDistanceM = 0;

  if (places.length > 0) {
    if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
      const firstDist = haversineMeters(origin, places[0]);
      if (firstDist != null) airDistanceM += firstDist;
    }
    for (let i = 0; i < places.length - 1; i++) {
      const segDist = haversineMeters(places[i], places[i + 1]);
      if (segDist != null) airDistanceM += segDist;
    }
  }

  airDistanceM = Math.round(airDistanceM);
  const estimatedWalkDistanceM = Math.round(airDistanceM * 1.3);

  // Speed: 4.0 km/h for solo & dog (~66.7 m/min); 3.2 km/h for stroller & family (~53.3 m/min)
  const isSlower = companionMode === 'stroller' || companionMode === 'family';
  const speedMpm = isSlower ? (3200 / 60) : (4000 / 60);
  const estimatedMinutes = estimatedWalkDistanceM > 0 ? Math.round(estimatedWalkDistanceM / speedMpm) : 0;

  // Surface summary from catalog access.surface or OSM surface tags
  const surfaces = [];
  for (const p of places) {
    if (p.access?.surface) surfaces.push(p.access.surface);
    else if (p.surface) surfaces.push(p.surface);
  }
  let surfaceText = 'Směs lesních a zpevněných cest';
  if (surfaces.length > 0) {
    const hasForest = surfaces.some(s => /lesn|kamen|pěšin|nezpev/i.test(s));
    const hasPaved = surfaces.some(s => /asfalt|dlažb|chodn|zpevněn/i.test(s));
    if (hasForest && hasPaved) surfaceText = 'Lesní pěšiny i zpevněné úseky';
    else if (hasForest) surfaceText = 'Převážně přírodní a lesní cesty';
    else if (hasPaved) surfaceText = 'Převážně zpevněný povrch a chodníky';
  }
  const surfaceSummary = `${surfaceText} (Odhad z mapových dat)`;

  // Warnings for companionMode
  const warnings = [];
  if (companionMode === 'stroller') {
    for (const p of places) {
      const title = p.title || 'Vybrané místo';
      if (p.access?.stroller === 'no') {
        warnings.push(`${title}: nevhodné pro kočárek (strmý terén či kamenitá cesta)`);
      } else if (p.tags && /peak|cliff|rock/.test(p.tags?.natural || '')) {
        warnings.push(`${title}: skalnatý vrchol – obtížný terén pro kočárek`);
      } else if (/skála|vrchol|vyhlídka na drtiči/i.test(title)) {
        warnings.push(`${title}: skalnatý nebo vyvýšený terén, kočárek může mít potíže`);
      }
    }
  } else if (companionMode === 'dog') {
    for (const p of places) {
      const title = p.title || 'Vybrané místo';
      if (p.access?.dog === 'no') {
        warnings.push(`${title}: vstup se psem je zakázán`);
      } else if (p.kind === 'culture' && /muzeum|zámek|kostel/i.test(title)) {
        warnings.push(`${title}: vstup do interiérů se psem může být omezen`);
      }
    }
  }

  return {
    airDistanceM,
    estimatedWalkDistanceM,
    estimatedMinutes,
    surfaceSummary,
    warnings,
  };
}

/**
 * Fetches elevation profile from open-meteo API with 4s timeout.
 * Coordinates are rounded to 3 decimal places.
 * Fails safely returning { elevationGainM: null } when offline or on error.
 */
export async function fetchElevationProfile(points, fetchImpl = typeof fetch !== 'undefined' ? fetch : null) {
  if (!Array.isArray(points) || points.length < 2 || !fetchImpl) {
    return { elevationGainM: null };
  }

  try {
    const validPoints = points.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validPoints.length < 2) return { elevationGainM: null };

    const lats = validPoints.map(p => Number(p.lat).toFixed(3)).join(',');
    const lngs = validPoints.map(p => Number(p.lng).toFixed(3)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

    let timeoutId;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), 4000);
    }

    try {
      const res = await fetchImpl(url, { signal });
      if (!res.ok) return { elevationGainM: null };
      const data = await res.json();
      if (!Array.isArray(data?.elevation) || data.elevation.length < 2) {
        return { elevationGainM: null };
      }
      let gain = 0;
      for (let i = 1; i < data.elevation.length; i++) {
        const diff = data.elevation[i] - data.elevation[i - 1];
        if (Number.isFinite(diff) && diff > 0) gain += diff;
      }
      return { elevationGainM: Math.round(gain) };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    return { elevationGainM: null };
  }
}

function toBase64Url(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64url');
  }
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64url').toString('utf8');
  }
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

/**
 * Encodes planned route to a shareable string 'CZK1-...'.
 * Strictly contains no user text, personal data, or free-form notes.
 */
export function encodeRouteShareCode(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Neplatný plán pro sdílení.');
  }

  const payload = {
    v: 1,
    o: plan.origin && Number.isFinite(plan.origin.lat) && Number.isFinite(plan.origin.lng)
      ? [Number(plan.origin.lat.toFixed(4)), Number(plan.origin.lng.toFixed(4))]
      : null,
    r: Number(plan.radiusKm) || 3,
    c: Array.isArray(plan.categories) ? plan.categories.filter(c => typeof c === 'string').slice(0, 10) : [],
    p: Array.isArray(plan.selectedPlaceIds) ? plan.selectedPlaceIds.filter(p => typeof p === 'string').slice(0, 10) : [],
    m: COMPANION_MODES.includes(plan.companionMode) ? plan.companionMode : 'solo',
    e: EXPLORATION_MODES.includes(plan.explorationMode) ? plan.explorationMode : 'focus',
  };

  return `CZK1-${toBase64Url(JSON.stringify(payload))}`;
}

/**
 * Decodes and validates a shareable route code.
 * Throws on tampering or schema mismatches.
 */
export function decodeRouteShareCode(code) {
  if (typeof code !== 'string' || !code.startsWith('CZK1-')) {
    throw new Error('Neplatný formát kódu výpravy.');
  }
  const rawB64 = code.slice(5).trim();
  if (!rawB64 || !/^[A-Za-z0-9_-]+$/.test(rawB64)) {
    throw new Error('Kód výpravy obsahuje nepovolené znaky.');
  }

  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(rawB64));
  } catch {
    throw new Error('Kód výpravy se nepodařilo přečíst.');
  }

  if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) {
    throw new Error('Neplatné schéma sdílené trasy.');
  }

  let origin = null;
  if (parsed.o !== null) {
    if (!Array.isArray(parsed.o) || parsed.o.length !== 2 || !Number.isFinite(parsed.o[0]) || !Number.isFinite(parsed.o[1])) {
      throw new Error('Neplatné souřadnice startu.');
    }
    origin = { lat: parsed.o[0], lng: parsed.o[1] };
  }

  if (!Array.isArray(parsed.p) || parsed.p.some(id => typeof id !== 'string' || id.length > 100)) {
    throw new Error('Neplatný seznam míst.');
  }

  if (!COMPANION_MODES.includes(parsed.m)) {
    throw new Error('Neplatný režim parťáka.');
  }

  if (!EXPLORATION_MODES.includes(parsed.e)) {
    throw new Error('Neplatný herní režim.');
  }

  return {
    origin,
    radiusKm: [1, 3, 5, 10].includes(Number(parsed.r)) ? Number(parsed.r) : 3,
    categories: Array.isArray(parsed.c) ? parsed.c.filter(c => typeof c === 'string') : [],
    selectedPlaceIds: parsed.p.slice(0, 10),
    companionMode: parsed.m,
    explorationMode: parsed.e,
  };
}
