/**
 * Czekpoint — Odkrývání přírodních objektů podle jejich skutečného tvaru (Bod 32)
 * a výpočet vzdálenosti k břehu / hranici polygonu (nikoli ke středu vodní plochy).
 *
 * Zásada: Odhalené krajinné objekty (`revealedFeatures`) jsou oddělené od skutečně prošlého území
 * (`cells`, `walkSegments`, `meters`). Odhalení rybníka nepotvrzuje zastávky na opačném břehu
 * a nepřičítá nachozené metry ani průzkumné body.
 */

import { haversineMeters } from './domain.js';
import { MAX_GPS_ACCURACY_M } from './walk-engine.js';

export const SHORE_APPROACH_RADIUS_M = 45; // Vzdálenost k břehu/okraji pro odhalení přírodního objektu (45 m)
export const MAX_FULL_REVEAL_POND_AREA_M2 = 250000; // Max rozloha malého rybníka pro celé odhalení (25 ha)
export const MAX_FULL_REVEAL_FAR_POINT_M = 650; // Max vzdálenost nejvzdálenějšího bodu malého rybníka (650 m)
export const FOREST_LOCAL_REVEAL_RADIUS_M = 135; // Rozšířený lokální poloměr odkrytí uvnitř lesa (135 m)
export const LARGE_WATER_LOCAL_RADIUS_M = 130; // Lokální poloměr odkrytí u velké vodní plochy (130 m)

/**
 * Vestavěné polygony skutečných přírodních objektů v Rožmitále pod Třemšínem a okolí (OSM souřadnice).
 * Každý objekt má `polygon` jako pole `[lat, lng]` bodů opisujících jeho břeh / hranici.
 */
export const BUILTIN_NATURAL_FEATURES = Object.freeze([
  {
    id: 'water:podzamecky-rybnik',
    title: 'Podzámecký rybník',
    kind: 'water',
    accessPoint: { lat: 49.60373, lng: 13.85891 }, // Břeh u lávky / hráze (východní břeh)
    polygon: [
      [49.60295, 13.86120],
      [49.60373, 13.85891],
      [49.60485, 13.85760],
      [49.60610, 13.85480],
      [49.60655, 13.85350],
      [49.60540, 13.85280],
      [49.60410, 13.85490],
      [49.60310, 13.85780],
      [49.60255, 13.86010],
    ],
  },
  {
    id: 'water:rybnik-jez',
    title: 'Lesní rybník Jez',
    kind: 'water',
    accessPoint: { lat: 49.59610, lng: 13.84250 }, // Přístupová cesta u hráze rybníka Jez
    polygon: [
      [49.59610, 13.84250],
      [49.59642, 13.84295],
      [49.59668, 13.84240],
      [49.59655, 13.84175],
      [49.59618, 13.84160],
      [49.59592, 13.84205],
    ],
  },
  {
    id: 'water:rybnik-kuchynka',
    title: 'Rybník Kuchyňka',
    kind: 'water',
    accessPoint: { lat: 49.60740, lng: 13.85020 },
    polygon: [
      [49.60740, 13.85020],
      [49.60810, 13.84980],
      [49.60855, 13.84840],
      [49.60815, 13.84730],
      [49.60735, 13.84810],
      [49.60705, 13.84940],
    ],
  },
  {
    id: 'water:rusalcino-jezirko',
    title: 'Rusalčino jezírko',
    kind: 'water',
    accessPoint: { lat: 49.63600, lng: 13.93462 },
    polygon: [
      [49.63600, 13.93462],
      [49.63628, 13.93495],
      [49.63642, 13.93450],
      [49.63620, 13.93412],
      [49.63592, 13.93430],
    ],
  },
  {
    id: 'water:rybnik-vsevily',
    title: 'Rybník Vševily',
    kind: 'water',
    accessPoint: { lat: 49.56940, lng: 13.90300 },
    polygon: [
      [49.56940, 13.90300],
      [49.57020, 13.90410],
      [49.57095, 13.90320],
      [49.57050, 13.90160],
      [49.56960, 13.90180],
    ],
  },
  {
    id: 'water:hluboky-rybnik',
    title: 'Hluboký rybník u Hoděmyšle',
    kind: 'water',
    accessPoint: { lat: 49.62000, lng: 13.89000 },
    polygon: [
      [49.62000, 13.89000],
      [49.62140, 13.89190],
      [49.62270, 13.89040],
      [49.62210, 13.88790],
      [49.62060, 13.88810],
    ],
  },
  {
    id: 'forest:sterbina-voltus',
    title: 'Les Štěrbina a Voltuš',
    kind: 'forest',
    polygon: [
      [49.59750, 13.84950],
      [49.59680, 13.84100],
      [49.59200, 13.83500],
      [49.58550, 13.83550],
      [49.58580, 13.84650],
      [49.59150, 13.85150],
    ],
  },
  {
    id: 'forest:alej-johanky-park',
    title: 'Alej královny Johanky a lužní remízek',
    kind: 'forest',
    polygon: [
      [49.60350, 13.85920],
      [49.60660, 13.85260],
      [49.60710, 13.85340],
      [49.60410, 13.86010],
    ],
  },
]);

/**
 * Normalizuje vrchol polygonu na `{ lat, lng }`.
 */
export function normalizeVertex(v) {
  if (!v) return null;
  if (Array.isArray(v) && v.length >= 2) {
    const lat = Number(v[0]);
    const lng = Number(v[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  if (typeof v === 'object') {
    const lat = Number(v.lat);
    const lng = Number(v.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  return null;
}

/**
 * Vypočítá přibližnou rozlohu polygonu v m² (pomocí rovinné projekce v metrech).
 */
export function computePolygonAreaM2(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;
  const pts = polygon.map(normalizeVertex).filter(Boolean);
  if (pts.length < 3) return 0;

  const refLat = pts[0].lat;
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;

  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const x1 = (p1.lng - pts[0].lng) * mPerDegLng;
    const y1 = (p1.lat - pts[0].lat) * mPerDegLat;
    const x2 = (p2.lng - pts[0].lng) * mPerDegLng;
    const y2 = (p2.lat - pts[0].lat) * mPerDegLat;
    area2 += x1 * y2 - x2 * y1;
  }
  return Math.abs(area2) / 2;
}

/**
 * Zjistí, zda bod `point` leží uvnitř polygonu (algoritmus ray-casting).
 */
export function isPointInPolygon(point, polygon) {
  const pt = normalizeVertex(point);
  if (!pt || !Array.isArray(polygon) || polygon.length < 3) return false;
  const vs = polygon.map(normalizeVertex).filter(Boolean);
  if (vs.length < 3) return false;

  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].lng, yi = vs[i].lat;
    const xj = vs[j].lng, yj = vs[j].lat;
    const intersect =
      yi > pt.lat !== yj > pt.lat &&
      pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Najde nejbližší bod na úsečce A–B k bodu P a vrátí `{ lat, lng, distanceM }`.
 */
export function nearestPointOnSegment(point, segA, segB) {
  const p = normalizeVertex(point);
  const a = normalizeVertex(segA);
  const b = normalizeVertex(segB);
  if (!p || !a || !b) return { lat: 0, lng: 0, distanceM: Infinity };

  const cosLat = Math.cos((p.lat * Math.PI) / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;

  const ax = (a.lng - p.lng) * mPerDegLng;
  const ay = (a.lat - p.lat) * mPerDegLat;
  const bx = (b.lng - p.lng) * mPerDegLng;
  const by = (b.lat - p.lat) * mPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 1e-6) {
    t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  }

  const nearLat = a.lat + (b.lat - a.lat) * t;
  const nearLng = a.lng + (b.lng - a.lng) * t;
  const distM = haversineMeters(p, { lat: nearLat, lng: nearLng }) ?? Infinity;

  return {
    lat: nearLat,
    lng: nearLng,
    distanceM: distM,
  };
}

/**
 * Najde nejbližší bod na hranici (břehu / okraji) polygonu k bodu `point`.
 * Používá se pro:
 * 1) Vyhodnocení přiblížení k břehu rybníka nebo okraji lesa (Bod 32 — nikoli vzdálenost ke středu!).
 * 2) Přesměrování cílového bodu chůze z prostředku rybníka na nejbližší bod na břehu (Bod 26).
 */
export function nearestPointOnPolygonBoundary(point, polygon) {
  const p = normalizeVertex(point);
  if (!p || !Array.isArray(polygon) || polygon.length < 2) {
    return { lat: p?.lat || 0, lng: p?.lng || 0, distanceM: Infinity, maxVertexDistanceM: Infinity };
  }
  const vs = polygon.map(normalizeVertex).filter(Boolean);
  if (vs.length < 2) {
    return { lat: p.lat, lng: p.lng, distanceM: Infinity, maxVertexDistanceM: Infinity };
  }

  let best = { lat: vs[0].lat, lng: vs[0].lng, distanceM: Infinity };
  let maxVertexDistM = 0;

  for (let i = 0; i < vs.length; i++) {
    const v1 = vs[i];
    const v2 = vs[(i + 1) % vs.length];
    const vDist = haversineMeters(p, v1) ?? 0;
    if (vDist > maxVertexDistM) maxVertexDistM = vDist;

    const cand = nearestPointOnSegment(p, v1, v2);
    if (cand.distanceM < best.distanceM) {
      best = cand;
    }
  }

  return {
    lat: best.lat,
    lng: best.lng,
    distanceM: best.distanceM,
    maxVertexDistanceM: maxVertexDistM,
    inside: isPointInPolygon(p, vs),
  };
}

/**
 * Pokud bod zájmu leží uvnitř vodní plochy (uprostřed rybníka), vrátí přístupný bod na břehu
 * (`place.accessPoint` nebo nejbližší bod na břehu polygonu), aby trasa ani simulátor
 * nikdy nevedly doprostřed vody (Bod 26).
 */
export function resolveAccessibleStopLocation(place, waterFeatures = BUILTIN_NATURAL_FEATURES) {
  if (!place) return null;
  if (place.accessPoint && Number.isFinite(place.accessPoint.lat) && Number.isFinite(place.accessPoint.lng)) {
    return { lat: place.accessPoint.lat, lng: place.accessPoint.lng, isShoreAccess: true };
  }
  const rawLoc = place.location || place;
  if (!rawLoc || !Number.isFinite(rawLoc.lat) || !Number.isFinite(rawLoc.lng)) return null;

  const features = Array.isArray(waterFeatures) ? waterFeatures : BUILTIN_NATURAL_FEATURES;
  for (const wf of features) {
    if (wf.kind !== 'water' || !Array.isArray(wf.polygon) || wf.polygon.length < 3) continue;
    if (isPointInPolygon(rawLoc, wf.polygon)) {
      if (wf.accessPoint && Number.isFinite(wf.accessPoint.lat) && Number.isFinite(wf.accessPoint.lng)) {
        return { lat: wf.accessPoint.lat, lng: wf.accessPoint.lng, isShoreAccess: true, waterFeatureId: wf.id };
      }
      const shore = nearestPointOnPolygonBoundary(rawLoc, wf.polygon);
      return { lat: shore.lat, lng: shore.lng, isShoreAccess: true, waterFeatureId: wf.id };
    }
  }

  return { lat: rawLoc.lat, lng: rawLoc.lng, isShoreAccess: false };
}

/**
 * Vyhodnotí odkrývání přírodních objektů podle jejich tvaru při přijaté GPS poloze (Bod 32):
 * - Malý rybník (rozloha <= 25 ha a nejvzdálenější bod <= 650 m): po přiblížení k břehu (<= 35 m)
 *   se trvale odhalí celý jeho polygon (`revealMode: 'full_polygon'`).
 * - Velká vodní plocha: po přiblížení k břehu se odhalí pouze blízká část u hráče (`revealMode: 'local_water'`),
 *   nikoli protější břeh kilometry daleko.
 * - Les: po vstupu nebo přiblížení k okraji (<= 25 m) se rozšíří lokální odkrytí uvnitř lesa
 *   (`revealMode: 'local_forest'`), nikoli celý les.
 * - Chybějící hranice objektu: nic si nevymýšlí, ponechá běžné odkrytí kolem cesty.
 *
 * Vrací aktualizovaný seznam `revealedFeatures` (pro uložení) a aktivní lokální průniky (`activeLocalReveals`).
 */
export function evaluateNaturalFeatureReveals(
  fix,
  existingRevealedIds = [],
  features = BUILTIN_NATURAL_FEATURES
) {
  const revealedSet = new Set(Array.isArray(existingRevealedIds) ? existingRevealedIds : []);
  const newlyRevealed = [];
  const activeLocalReveals = [];

  if (
    !fix ||
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    (Number.isFinite(fix.accuracy) && fix.accuracy > MAX_GPS_ACCURACY_M)
  ) {
    return {
      revealedFeatureIds: [...revealedSet],
      newlyRevealedFeatures: [],
      activeLocalReveals: [],
    };
  }

  const featureList = Array.isArray(features) ? features : BUILTIN_NATURAL_FEATURES;

  for (const feat of featureList) {
    // Chybějící hranice objektu: nevymýšlet tvary, ponechat běžné odkrytí kolem cesty
    if (!feat || !feat.id || !Array.isArray(feat.polygon) || feat.polygon.length < 3) {
      continue;
    }

    const boundary = nearestPointOnPolygonBoundary(fix, feat.polygon);
    const distToEdgeM = boundary.inside ? 0 : boundary.distanceM;
    const areaM2 = feat.areaM2 != null ? feat.areaM2 : computePolygonAreaM2(feat.polygon);

    if (feat.kind === 'water' || feat.kind === 'pond' || feat.kind === 'large_water') {
      if (distToEdgeM <= SHORE_APPROACH_RADIUS_M) {
        const isSmallPond =
          feat.kind !== 'large_water' &&
          areaM2 > 0 &&
          areaM2 <= MAX_FULL_REVEAL_POND_AREA_M2 &&
          boundary.maxVertexDistanceM <= MAX_FULL_REVEAL_FAR_POINT_M;

        if (isSmallPond) {
          if (!revealedSet.has(feat.id)) {
            revealedSet.add(feat.id);
            newlyRevealed.push({
              id: feat.id,
              title: feat.title,
              kind: 'small_pond',
              revealMode: 'full_polygon',
              areaM2: Math.round(areaM2),
            });
          }
        } else {
          // Velká vodní plocha: odkrýt jen blízký břeh a vodní okolí hráče
          activeLocalReveals.push({
            id: feat.id,
            title: feat.title,
            kind: 'large_water',
            revealMode: 'local_water',
            center: { lat: fix.lat, lng: fix.lng },
            radiusM: LARGE_WATER_LOCAL_RADIUS_M,
            polygon: feat.polygon,
          });
        }
      }
    } else if (feat.kind === 'forest') {
      // Les: po vstupu nebo přiblížení k okraji (<= 25 m) rozšířit viditelnou část v okolí hráče, ne celý les
      if (boundary.inside || distToEdgeM <= 25) {
        activeLocalReveals.push({
          id: feat.id,
          title: feat.title,
          kind: 'forest',
          revealMode: 'local_forest',
          center: { lat: fix.lat, lng: fix.lng },
          radiusM: FOREST_LOCAL_REVEAL_RADIUS_M,
          polygon: feat.polygon,
        });
      }
    }
  }

  return {
    revealedFeatureIds: [...revealedSet],
    newlyRevealedFeatures: newlyRevealed,
    activeLocalReveals,
  };
}
