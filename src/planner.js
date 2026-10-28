import { haversineMeters } from './domain.js';
import { COMPANION_MODES, EXPLORATION_MODES } from './walk-store.js';
import {
  BUILTIN_NATURAL_FEATURES,
  resolveAccessibleStopLocation,
  isPointInPolygon,
  nearestPointOnPolygonBoundary,
  normalizeVertex,
} from './natural-features.js';
import { PILOT_HIKING_TRAILS } from './hiking-trails.js';

export const START_PRESETS = Object.freeze([
  { id: 'namesti', label: 'Náměstí Rožmitál', lat: 49.6033, lng: 13.8633 },
  { id: 'nadrazi', label: 'Nádraží Rožmitál pod Třemšínem', lat: 49.5968, lng: 13.8682 },
  { id: 'stary-rozmital', label: 'Starý Rožmitál', lat: 49.6082, lng: 13.8507 },
]);

export const PLANNER_RADII = Object.freeze([2, 5, 10]);

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
  {
    id: 'benches',
    label: 'Odpočívadla a lavičky',
    icon: '🪑',
    overpassKey: 'amenity_tourism',
    overpassRegex: 'bench|picnic_site|shelter',
  },
]);

export const TERRAIN_DIFFICULTIES = Object.freeze([
  {
    id: 'easy',
    label: '🟢 Lehká (rovinky, zpevněné cesty, bez prudkých stoupání)',
    shortLabel: '🟢 Lehká',
    icon: '🟢',
  },
  {
    id: 'medium',
    label: '🟡 Běžná turistická (lesní cesty a mírné kopce)',
    shortLabel: '🟡 Běžná',
    icon: '🟡',
  },
  {
    id: 'hard',
    label: '🔴 Náročná (vrcholy, vyhlídky a stoupání)',
    shortLabel: '🔴 Náročná',
    icon: '🔴',
  },
]);

export const CZECH_PLACE_PRESETS = Object.freeze([
  { id: 'namesti', label: 'Rožmitál pod Třemšínem (Náměstí)', lat: 49.6033, lng: 13.8633 },
  { id: 'pribram', label: 'Příbram (Svatá Hora / město)', lat: 49.6889, lng: 14.0092 },
  { id: 'padrt', label: 'Brdy – Padrťské rybníky', lat: 49.6512, lng: 13.7605 },
  { id: 'breznice', label: 'Březnice (zámek a park)', lat: 49.5576, lng: 13.9516 },
  { id: 'stary-rozmital', label: 'Starý Rožmitál (Alej Johanky)', lat: 49.6082, lng: 13.8507 },
  { id: 'tremsin-hut', label: 'Hutě pod Třemšínem (Brdy)', lat: 49.5698, lng: 13.8022 },
  { id: 'nadrazi', label: 'Nádraží Rožmitál pod Třemšínem', lat: 49.5968, lng: 13.8682 },
  { id: 'pisek', label: 'Písek (Kamenný most)', lat: 49.3088, lng: 14.1475 },
  { id: 'beroun', label: 'Beroun (Husovo náměstí)', lat: 49.9638, lng: 14.0720 },
  { id: 'kasperske-hory', label: 'Kašperské Hory (Šumava)', lat: 49.1440, lng: 13.5565 },
  { id: 'blatna', label: 'Blatná (vodní zámek)', lat: 49.4230, lng: 13.8794 },
]);

export const COMPANION_STYLES = Object.freeze([
  { id: 'solo', label: 'Sólo poutník', icon: '🥾', speedKmH: 4.0 },
  { id: 'dog', label: 'Se psem', icon: '🐕', speedKmH: 4.0 },
  { id: 'stroller', label: 'S kočárkem', icon: '👶', speedKmH: 3.2 },
  { id: 'family', label: 'Skupina / Rodina', icon: '👨‍👩‍👧', speedKmH: 3.2 },
]);

export function isPeakOrSteepPlace(p) {
  if (!p || typeof p !== 'object') return false;
  const nat = String(p.tags?.natural || '').toLowerCase();
  const tour = String(p.tags?.tourism || '').toLowerCase();
  const title = String(p.title || '').toLowerCase();
  if (nat === 'peak' || nat === 'cliff' || nat === 'rock') return true;
  if (p.access?.difficulty === 'hard' || Number(p.elevationGainM) > 120) return true;
  if (/vrchol|třemšín|skála|skály|drtič|hřeben|rozhledna/.test(title)) return true;
  if (p.kind === 'view' && (tour === 'viewpoint' || /vyhlídka/.test(title)) && p.access?.stroller === 'no') return true;
  return false;
}

/**
 * Vestavěné vodní toky (Vlčava / Lomnice v Rožmitále) a mosty/lávky pro realistický výpočet pěších tras (Body 26 & 27).
 */
export const BUILTIN_RIVER_OBSTACLES = Object.freeze([
  {
    id: 'river:vlcava-rozmital',
    name: 'Říčka Vlčava (Skalice)',
    // Linie vodního toku oddělující břehy mezi Starým Rožmitálem a městem
    polyline: [
      [49.60950, 13.84850],
      [49.60755, 13.85185],
      [49.60630, 13.85380],
      [49.60373, 13.85891],
      [49.60265, 13.86175],
      [49.60150, 13.86650],
    ],
    bridges: [
      { id: 'bridge:stary-rozmital', title: 'Most ve Starém Rožmitále', lat: 49.60755, lng: 13.85185 },
      { id: 'bridge:lavka-podzamecky', title: 'Lávka u Podzámeckého rybníka', lat: 49.60373, lng: 13.85891 },
      { id: 'bridge:most-u-zamku', title: 'Most u zámku Rožmitál', lat: 49.60265, lng: 13.86175 },
    ],
  },
]);

/**
 * Zjistí, zda se dvě úsečky AB a CD protínají (včetně orientace).
 */
export function segmentsIntersect(a, b, c, d) {
  const p1 = normalizeVertex(a), p2 = normalizeVertex(b);
  const p3 = normalizeVertex(c), p4 = normalizeVertex(d);
  if (!p1 || !p2 || !p3 || !p4) return false;

  const ccw = (A, B, C) => (C.lat - A.lat) * (B.lng - A.lng) - (B.lat - A.lat) * (C.lng - A.lng);
  const d1 = ccw(p3, p4, p1);
  const d2 = ccw(p3, p4, p2);
  const d3 = ccw(p1, p2, p3);
  const d4 = ccw(p1, p2, p4);

  if (((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) &&
      ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))) {
    return true;
  }
  return false;
}

/**
 * Zjistí, zda úsečka A–B protíná lomenou čáru řeky mimo bezprostřední blízkost mostu (< 18 m).
 */
export function crossesRiverBarrier(from, to, river) {
  if (!river || !Array.isArray(river.polyline) || river.polyline.length < 2) return false;
  const bridges = Array.isArray(river.bridges) ? river.bridges : [];

  // Pokud je počátek nebo konec přímo na mostě (< 18 m), nejde o nelegální přechod řeky
  for (const br of bridges) {
    if ((haversineMeters(from, br) ?? Infinity) < 18 || (haversineMeters(to, br) ?? Infinity) < 18) {
      return false;
    }
  }

  for (let i = 0; i < river.polyline.length - 1; i++) {
    const r1 = river.polyline[i];
    const r2 = river.polyline[i + 1];
    if (segmentsIntersect(from, to, r1, r2)) {
      return true;
    }
  }
  return false;
}

/**
 * Zjistí, zda úsečka A–B prochází vnitřkem vodní plochy (rybníka).
 */
export function segmentCrossesPond(from, to, pondPolygon) {
  if (!Array.isArray(pondPolygon) || pondPolygon.length < 3) return false;
  const vs = pondPolygon.map(normalizeVertex).filter(Boolean);
  if (vs.length < 3) return false;

  // Vzorkujeme body uvnitř úsečky (mimo krajní body na břehu)
  for (let s = 1; s <= 7; s++) {
    const t = s / 8;
    const mid = {
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    };
    const boundary = nearestPointOnPolygonBoundary(mid, vs);
    if (boundary.inside && boundary.distanceM > 1.5) {
      return true;
    }
  }

  // Nebo protnutí hrany polygonu
  let edgeIntersections = 0;
  for (let i = 0; i < vs.length; i++) {
    const v1 = vs[i];
    const v2 = vs[(i + 1) % vs.length];
    if (segmentsIntersect(from, to, v1, v2)) {
      edgeIntersections++;
    }
  }
  return edgeIntersections >= 2;
}

/**
 * Vypočítá břehovou cestu kolem rybníka mezi dvěma body (vybere kratší ze dvou směrů po obvodu břehu).
 */
export function computeShorePathAroundPond(from, to, pondPolygon) {
  const vs = (pondPolygon || []).map(normalizeVertex).filter(Boolean);
  if (vs.length < 3) return [from, to];

  let startIdx = 0;
  let endIdx = 0;
  let minStartD = Infinity;
  let minEndD = Infinity;

  for (let i = 0; i < vs.length; i++) {
    const ds = haversineMeters(from, vs[i]) ?? Infinity;
    const de = haversineMeters(to, vs[i]) ?? Infinity;
    if (ds < minStartD) { minStartD = ds; startIdx = i; }
    if (de < minEndD) { minEndD = de; endIdx = i; }
  }

  const n = vs.length;
  const pathCW = [from];
  let idx = startIdx;
  for (let step = 0; step <= n; step++) {
    pathCW.push(vs[idx]);
    if (idx === endIdx) break;
    idx = (idx + 1) % n;
  }
  pathCW.push(to);

  const pathCCW = [from];
  idx = startIdx;
  for (let step = 0; step <= n; step++) {
    pathCCW.push(vs[idx]);
    if (idx === endIdx) break;
    idx = (idx - 1 + n) % n;
  }
  pathCCW.push(to);

  const pathLength = pts => {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      total += haversineMeters(pts[i], pts[i + 1]) ?? 0;
    }
    return total;
  };

  return pathLength(pathCW) <= pathLength(pathCCW) ? pathCW : pathCCW;
}

/**
 * Vypočítá realistickou pěší cestu mezi dvěma body se zohledněním:
 * 1) Přístupného bodu u břehu rybníka (nikdy doprostřed vodní plochy — Bod 26).
 * 2) Obcházení rybníků po břehové cestě.
 * 3) Překračování řek a potoků přes nejvýhodnější most nebo lávku (Bod 26 & 27).
 * 4) Mírným zákrutem lesní/polní pěšiny, aby geometrie vedla po cestách.
 */
export function computeLocalWalkingLeg(fromPoint, toPoint, options = {}) {
  const ponds = options.ponds || BUILTIN_NATURAL_FEATURES.filter(f => f.kind === 'water');
  const rivers = options.rivers || BUILTIN_RIVER_OBSTACLES;

  const pFrom = resolveAccessibleStopLocation(fromPoint, ponds) || { lat: fromPoint.lat, lng: fromPoint.lng };
  const pTo = resolveAccessibleStopLocation(toPoint, ponds) || { lat: toPoint.lat, lng: toPoint.lng };

  let waypoints = [pFrom, pTo];

  // 1. Kontrola překročení řeky -> vedeme cestu přes nejbližší most
  for (const river of rivers) {
    const nextWaypoints = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      nextWaypoints.push(a);
      if (crossesRiverBarrier(a, b, river) && Array.isArray(river.bridges) && river.bridges.length > 0) {
        let bestBridge = river.bridges[0];
        let bestDist = Infinity;
        for (const br of river.bridges) {
          const d = (haversineMeters(a, br) ?? Infinity) + (haversineMeters(br, b) ?? Infinity);
          if (d < bestDist) {
            bestDist = d;
            bestBridge = br;
          }
        }
        nextWaypoints.push({ lat: bestBridge.lat, lng: bestBridge.lng, isBridge: true, bridgeId: bestBridge.id });
      }
    }
    nextWaypoints.push(waypoints[waypoints.length - 1]);
    waypoints = nextWaypoints;
  }

  // 2. Kontrola průchodu rybníkem -> vedeme cestu po břehové cestě kolem rybníka
  for (const pond of ponds) {
    if (!Array.isArray(pond.polygon) || pond.polygon.length < 3) continue;
    const nextWaypoints = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      if (segmentCrossesPond(a, b, pond.polygon)) {
        const shorePts = computeShorePathAroundPond(a, b, pond.polygon);
        for (let k = 0; k < shorePts.length - 1; k++) {
          nextWaypoints.push(shorePts[k]);
        }
      } else {
        nextWaypoints.push(a);
      }
    }
    nextWaypoints.push(waypoints[waypoints.length - 1]);
    waypoints = nextWaypoints;
  }

  // 2.5. Priorita turistických stezek a pěšin (KČT / naučné stezky) před silnicemi
  const trails = options.trails || PILOT_HIKING_TRAILS;
  if (Array.isArray(trails) && trails.length > 0) {
    const trailAligned = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      trailAligned.push(a);
      const directDist = haversineMeters(a, b) ?? 0;
      if (directDist >= 450) {
        for (const trail of trails) {
          if (!Array.isArray(trail.coordinates) || trail.coordinates.length < 3) continue;
          let idxA = -1, minDA = Infinity;
          let idxB = -1, minDB = Infinity;
          for (let t = 0; t < trail.coordinates.length; t++) {
            const pt = { lat: trail.coordinates[t][0], lng: trail.coordinates[t][1] };
            const dA = haversineMeters(a, pt) ?? Infinity;
            const dB = haversineMeters(b, pt) ?? Infinity;
            if (dA < minDA) { minDA = dA; idxA = t; }
            if (dB < minDB) { minDB = dB; idxB = t; }
          }
          if (minDA <= 85 && minDB <= 85 && idxA !== -1 && idxB !== -1 && Math.abs(idxA - idxB) >= 1) {
            const step = idxA < idxB ? 1 : -1;
            const intermediate = [];
            for (let k = idxA; k !== idxB + step; k += step) {
              const tc = trail.coordinates[k];
              if (tc) intermediate.push({ lat: tc[0], lng: tc[1], isTrail: true });
            }
            let trailDist = (haversineMeters(a, intermediate[0]) ?? 0) + (haversineMeters(intermediate[intermediate.length - 1], b) ?? 0);
            for (let m = 0; m < intermediate.length - 1; m++) {
              trailDist += haversineMeters(intermediate[m], intermediate[m + 1]) ?? 0;
            }
            if (trailDist <= directDist * 1.25) {
              for (const ip of intermediate) {
                if ((haversineMeters(a, ip) ?? 0) > 18 && (haversineMeters(b, ip) ?? 0) > 18) {
                  trailAligned.push(ip);
                }
              }
              break;
            }
          }
        }
      }
    }
    trailAligned.push(waypoints[waypoints.length - 1]);
    waypoints = trailAligned;
  }

  // 3. Spočítáme celkovou pěší vzdálenost a souřadnice
  const coordinates = [];
  let distanceM = 0;
  for (let i = 0; i < waypoints.length; i++) {
    const pt = waypoints[i];
    const coord = [Number(pt.lat.toFixed(6)), Number(pt.lng.toFixed(6))];
    if (coordinates.length === 0 || coordinates[coordinates.length - 1][0] !== coord[0] || coordinates[coordinates.length - 1][1] !== coord[1]) {
      coordinates.push(coord);
    }
    if (i > 0) {
      distanceM += haversineMeters(waypoints[i - 1], waypoints[i]) ?? 0;
    }
  }

  return {
    coordinates,
    distanceM: Math.round(distanceM),
    waypoints,
  };
}

/**
 * Vypočítá matici skutečných pěších vzdáleností mezi body (Bod 27).
 * Zohledňuje řeky, mosty, břehy rybníků nebo volitelnou matici z OSRM / testu.
 */
export function buildWalkingDistanceMatrix(points, options = {}) {
  const n = Array.isArray(points) ? points.length : 0;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  if (n <= 1) return matrix;

  if (Array.isArray(options.customMatrix) && options.customMatrix.length === n) {
    return options.customMatrix;
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 0;
        continue;
      }
      const leg = computeLocalWalkingLeg(points[i], points[j], options);
      matrix[i][j] = leg.distanceM;
    }
  }
  return matrix;
}

/**
 * Seřadí zastávky podle skutečné pěší vzdálenosti (Bod 27):
 * - Pro limit do 10 zastávek prohledá pořadí důkladně (Held-Karp / branch-and-bound pro přesné minimum pěší trasy,
 *   nikoli jen hladový výběr nejbližšího souseda vzdušnou čarou).
 * - Zachová start (`origin`) a případný pevný cíl (`keepLastStopFixed: true`).
 * - U okruhu (`returnToOrigin: true`) započítá návrat z poslední zastávky zpět na `origin`.
 * - Při úpravě během chůze (`visitedStopIds`, `currentPosition`) zachová již navštívené zastávky na začátku
 *   a přeuspořádá pouze zbývající nenavštívené zastávky od `currentPosition`.
 */
export function optimizeRouteOrder(origin, places, options = {}) {
  if (!Array.isArray(places) || places.length <= 1) {
    return Array.isArray(places) ? [...places] : [];
  }

  const returnToOrigin = Boolean(options.returnToOrigin);
  const keepLastStopFixed = Boolean(options.keepLastStopFixed);
  const visitedSet = new Set(
    Array.isArray(options.visitedStopIds)
      ? options.visitedStopIds
      : options.visitedStopIds instanceof Set
      ? [...options.visitedStopIds]
      : []
  );

  const allPlaces = places.slice(0, 10);

  // Oddělíme již navštívené zastávky (ty zůstanou na začátku v původním pořadí) od zbývajících
  const visitedPlaces = [];
  const unvisitedPlaces = [];
  for (const p of allPlaces) {
    if (p && visitedSet.has(p.id)) {
      visitedPlaces.push(p);
    } else if (p) {
      unvisitedPlaces.push(p);
    }
  }

  if (unvisitedPlaces.length <= 1) {
    return [...visitedPlaces, ...unvisitedPlaces];
  }

  // Výchozí bod pro řazení zbývajících zastávek:
  // Pokud chůze probíhá a máme currentPosition, začínáme z currentPosition; jinak z poslední navštívené zastávky nebo origin.
  const startPoint =
    (options.currentPosition && Number.isFinite(options.currentPosition.lat) && Number.isFinite(options.currentPosition.lng))
      ? options.currentPosition
      : visitedPlaces.length > 0
      ? visitedPlaces[visitedPlaces.length - 1]
      : (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng))
      ? origin
      : unvisitedPlaces[0];

  const loopEndPoint = (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) ? origin : startPoint;

  // Pokud má zůstat poslední zastávka pevným cílem
  let fixedLastStop = null;
  let pool = [...unvisitedPlaces];
  if (keepLastStopFixed && pool.length >= 2) {
    fixedLastStop = pool.pop();
  }

  const m = pool.length;
  if (m <= 1) {
    return fixedLastStop ? [...visitedPlaces, ...pool, fixedLastStop] : [...visitedPlaces, ...pool];
  }

  // Sestavíme uzly pro matici pěších vzdáleností:
  // index 0 = startPoint
  // index 1..m = kandidátní zastávky v `pool`
  // index m+1 = loopEndPoint (pro returnToOrigin) nebo fixedLastStop
  const nodes = [startPoint, ...pool];
  const endNode = fixedLastStop || (returnToOrigin ? loopEndPoint : null);
  if (endNode) nodes.push(endNode);

  const distMatrix = buildWalkingDistanceMatrix(nodes, options);
  const endNodeIdx = endNode ? nodes.length - 1 : -1;

  // Důkladné vyhodnocení pořadí (Branch-and-Bound / Held-Karp pro m <= 10)
  let bestOrderIndices = pool.map((_, i) => i + 1);
  let bestCost = Infinity;

  const used = new Array(m + 1).fill(false);
  const currentPerm = new Array(m);

  function search(depth, prevNodeIdx, costSoFar) {
    if (costSoFar >= bestCost) return;
    if (depth === m) {
      const totalCost = endNodeIdx >= 0 ? costSoFar + distMatrix[prevNodeIdx][endNodeIdx] : costSoFar;
      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestOrderIndices = [...currentPerm];
      }
      return;
    }

    // Seřadíme větve od nejbližší pro rychlé ořezávání (branch-and-bound)
    const candidates = [];
    for (let i = 1; i <= m; i++) {
      if (!used[i]) {
        candidates.push({ idx: i, stepCost: distMatrix[prevNodeIdx][i] });
      }
    }
    candidates.sort((a, b) => a.stepCost - b.stepCost);

    for (const cand of candidates) {
      used[cand.idx] = true;
      currentPerm[depth] = cand.idx;
      search(depth + 1, cand.idx, costSoFar + cand.stepCost);
      used[cand.idx] = false;
    }
  }

  search(0, 0, 0);

  let orderedPool = bestOrderIndices.map(nodeIdx => pool[nodeIdx - 1]);
  // Pokud jde o okruh zpět na start (returnToOrigin) s >= 3 body, zkontrolujeme úhlové řazení po směru hodinových ručiček (Math.atan2),
  // aby se cesta nikdy nekřížila
  if (returnToOrigin && !fixedLastStop && orderedPool.length >= 3) {
    const cwPool = sortPlacesClockwise(startPoint, orderedPool);
    const cwNodes = [startPoint, ...cwPool, loopEndPoint];
    const cwMatrix = buildWalkingDistanceMatrix(cwNodes, options);
    let cwCost = 0;
    for (let i = 0; i < cwNodes.length - 1; i++) cwCost += cwMatrix[i][i + 1];
    // Pokud je hodinové seřazení bez křížení srovnatelné (do 12 % od TSP minima), použijeme čistý nezkřížený polygon
    if (cwCost <= bestCost * 1.12) {
      orderedPool = cwPool;
    }
  }

  return fixedLastStop
    ? [...visitedPlaces, ...orderedPool, fixedLastStop]
    : [...visitedPlaces, ...orderedPool];
}

export const optimizeRouteOrderByWalking = optimizeRouteOrder;

/**
 * ZADÁNÍ #09 (Fáze 2): Kruhové rozdělení na 4 směrové výseče (Koláč: SV, JV, JZ, SZ).
 * Vrací kvadrant ('NE', 'SE', 'SW', 'NW') a azimut ve stupních (0..360, 0 = sever, 90 = východ).
 */
export function computeQuadrantSector(center, point) {
  if (!center || !point || !Number.isFinite(center.lat) || !Number.isFinite(point.lat)) {
    return { sector: 'NE', bearingDeg: 0 };
  }
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const dy = point.lat - center.lat;
  const dx = (point.lng - center.lng) * cosLat;
  // atan2(dx, dy) dává 0 pro sever, +90 pro východ
  const bearingDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  let sector = 'NE';
  if (bearingDeg >= 0 && bearingDeg < 90) sector = 'NE';
  else if (bearingDeg >= 90 && bearingDeg < 180) sector = 'SE';
  else if (bearingDeg >= 180 && bearingDeg < 270) sector = 'SW';
  else sector = 'NW';
  return { sector, bearingDeg };
}

/**
 * ZADÁNÍ #09 (Fáze 2): Seřazení bodů po směru hodinových ručiček podle úhlu (Math.atan2)
 * kolem společného těžiště mezi startem a vybranými body. Zabraňuje křížení trasy.
 */
export function sortPlacesClockwise(origin, places = []) {
  const valid = (places || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length <= 2) return [...valid];

  const hasOrigin = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng);
  const allPts = hasOrigin ? [origin, ...valid] : [...valid];
  const centerLat = allPts.reduce((acc, p) => acc + p.lat, 0) / allPts.length;
  const centerLng = allPts.reduce((acc, p) => acc + p.lng, 0) / allPts.length;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);

  // Po směru hodinových ručiček: úhel od severu (0..2π) = atan2(dx, dy)upravený do <0, 2π)
  const cwAngle = pt => {
    const dy = pt.lat - centerLat;
    const dx = (pt.lng - centerLng) * cosLat;
    return (Math.atan2(dx, dy) + 2 * Math.PI) % (2 * Math.PI);
  };

  const originAngle = hasOrigin ? cwAngle(origin) : 0;

  return [...valid].sort((a, b) => {
    const relA = (cwAngle(a) - originAngle + 2 * Math.PI) % (2 * Math.PI);
    const relB = (cwAngle(b) - originAngle + 2 * Math.PI) % (2 * Math.PI);
    return relA - relB;
  });
}

/**
 * ZADÁNÍ FLASH #09 (Bod 2): Sjednocené seřazení bodů trasy po směru hodinových ručiček
 * kolem středu výpravy tak, aby tvořily otevřený okruh bez křížení.
 */
export function orderRouteWaypoints(origin, places = [], options = {}) {
  const cw = sortPlacesClockwise(origin, places);
  return optimizeRouteOrder(origin, cw, options);
}

/**
 * ZADÁNÍ #09 (Fáze 2): Kontrola překryvu v OSRM pro krátké trasy (1 až 2 zastávky).
 * Vytvoří boční průjezdní bod (~400 m kolmo na spojnici poslední zastávky a startu),
 * aby pěší router OSRM vedl zpáteční cestu po vedlejší lesní cestě a nevracel uživatele po vlastních stopách.
 */
export function computeLateralLoopWaypoint(_origin, _lastStop, _existingStops = []) {
  // DÁVKA 2 (v1.4-part2): Zákaz vytváření fiktivních bočních objížděk mimo síť cest.
  return null;
}

/**
 * ZADÁNÍ #09 (Fáze 3): Automaticky vloží novou zastávku na nejvhodnější místo v trase
 * a přeskládá nenavštívené body tak, aby se cesta nekřížila.
 */
export function insertStopAtBestPosition(origin, currentPlaces = [], newPlace, options = {}) {
  if (!newPlace || !Number.isFinite(newPlace.lat) || !Number.isFinite(newPlace.lng)) {
    return [...(currentPlaces || [])];
  }
  const existing = (currentPlaces || []).filter(p => p && p.id !== newPlace.id);
  const combined = [...existing, newPlace];
  return optimizeRouteOrder(origin, combined, {
    returnToOrigin: options.returnToOrigin !== false,
    visitedStopIds: options.visitedStopIds,
    currentPosition: options.currentPosition,
    keepLastStopFixed: Boolean(options.keepLastStopFixed),
  });
}

/**
 * Přehled plánované trasy (Bod 5, 6, 13, 15, 27, 28 & DÁVKA 2):
 * - Počítá délku včetně případného návratu na start (returnToOrigin).
 * - Odvozuje délku i čas ze stejné pěší trasy.
 * - Prázdný plán ani neznámý povrch nevydává za ověřenou cestu.
 */
export function analyzePlannedRoute(originOrObj, orderedPlacesArg, companionModeArg = 'solo', optionsArg = {}) {
  let origin = originOrObj;
  let orderedPlaces = orderedPlacesArg;
  let companionMode = companionModeArg;
  let options = optionsArg || {};
  if (
    originOrObj &&
    typeof originOrObj === 'object' &&
    !Number.isFinite(originOrObj.lat) &&
    (Array.isArray(originOrObj.orderedStops) || Array.isArray(originOrObj.orderedPlaces))
  ) {
    origin = originOrObj.origin;
    orderedPlaces = originOrObj.orderedStops || originOrObj.orderedPlaces || [];
    companionMode = originOrObj.companionMode || 'solo';
    const rg = originOrObj.routedGeometry || {};
    options = {
      ...originOrObj,
      routedDistanceM: originOrObj.routedDistanceM ?? (rg.isFallback ? 0 : rg.distanceM),
      routeMode: originOrObj.routeMode || (rg.isFallback ? 'fallback_direct' : (rg.distanceM > 0 ? 'routed_foot' : undefined)),
      structuredRoadClasses: originOrObj.structuredRoadClasses || rg.structuredRoadClasses,
    };
  }
  const places = Array.isArray(orderedPlaces) ? orderedPlaces.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
  const returnToOrigin = Boolean(options.returnToOrigin);
  const hasOrigin = Boolean(origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng));

  if (places.length === 0) {
    return {
      airDistanceM: 0,
      returnAirDistanceM: 0,
      estimatedWalkDistanceM: 0,
      estimatedMinutes: 0,
      returnToOrigin: false,
      routeMode: 'empty',
      routeStatus: 'empty',
      routeStatusLabel: 'Žádná trasa (volná procházka bez pevných zastávek)',
      routeModeLabel: 'Žádná trasa (volná procházka bez pevných zastávek)',
      surfaceSummary: 'Údaje o typu cesty nejsou k dispozici (žádné zastávky v plánu)',
      roadTypeSummary: 'Údaje o typu cesty nejsou k dispozici',
      warnings: [],
    };
  }

  let outboundAirM = 0;
  let localWalkM = 0;
  if (hasOrigin) {
    const firstDist = haversineMeters(origin, places[0]);
    if (firstDist != null) outboundAirM += firstDist;
    localWalkM += computeLocalWalkingLeg(origin, places[0], options).distanceM;
  }
  for (let i = 0; i < places.length - 1; i++) {
    const segDist = haversineMeters(places[i], places[i + 1]);
    if (segDist != null) outboundAirM += segDist;
    localWalkM += computeLocalWalkingLeg(places[i], places[i + 1], options).distanceM;
  }

  let returnAirM = 0;
  if (returnToOrigin && hasOrigin && places.length > 0) {
    const backDist = haversineMeters(places[places.length - 1], origin);
    if (backDist != null) returnAirM = backDist;
    localWalkM += computeLocalWalkingLeg(places[places.length - 1], origin, options).distanceM;
  }

  const airDistanceM = Math.round(outboundAirM + returnAirM);
  const rawMode = options.routeMode || (Number.isFinite(options.routedDistanceM) && options.routedDistanceM > 0 ? 'routed_foot' : 'fallback_direct');
  const isRouted = rawMode === 'routed' || rawMode === 'routed_foot';
  const routeMode = rawMode === 'routed' ? 'routed' : (isRouted ? 'routed_foot' : (rawMode === 'air_fallback' ? 'air_fallback' : 'fallback_direct'));
  const routeStatus = isRouted ? 'routed_foot' : 'fallback_direct';

  const estimatedWalkDistanceM =
    isRouted && Number.isFinite(options.routedDistanceM) && options.routedDistanceM > 0
      ? Math.round(options.routedDistanceM)
      : Math.max(Math.round(localWalkM), Math.round(airDistanceM * 1.28));

  // Rychlost chůze: 4.0 km/h pro sólo a psa (~66.7 m/min); 3.2 km/h pro kočárek a rodinu (~53.3 m/min)
  const isSlower = companionMode === 'stroller' || companionMode === 'family';
  const speedMpm = isSlower ? (3200 / 60) : (4000 / 60);
  const estimatedMinutes = estimatedWalkDistanceM > 0 ? Math.max(1, Math.round(estimatedWalkDistanceM / speedMpm)) : 0;

  // Shrnutí povrchu pouze ze známých údajů u zastávek
  const knownSurfaces = [];
  let missingSurfaceCount = 0;
  for (const p of places) {
    const surf = p.access?.surface || p.surface;
    if (surf && typeof surf === 'string' && !/neznáme|nezjištěn/i.test(surf)) {
      knownSurfaces.push(surf);
    } else {
      missingSurfaceCount++;
    }
  }

  let surfaceSummary = 'Údaje o typu cesty nejsou k dispozici (povrch trasy neověřen)';
  if (knownSurfaces.length > 0) {
    const hasForest = knownSurfaces.some(s => /lesn|kamen|pěšin|nezpev/i.test(s));
    const hasPaved = knownSurfaces.some(s => /asfalt|dlažb|chodn|zpevněn|ulic/i.test(s));
    let baseText = 'Různorodý povrch u zastávek';
    if (hasForest && hasPaved) baseText = 'U zastávek lesní pěšiny i zpevněné úseky';
    else if (hasForest) baseText = 'U zastávek převážně přírodní a lesní cesty';
    else if (hasPaved) baseText = 'U zastávek převážně zpevněný povrch';
    surfaceSummary = missingSurfaceCount > 0
      ? `${baseText} (část zastávek a mezilehlé úseky neověřeny)`
      : `${baseText} (mezilehlé úseky v terénu neověřeny)`;
  }

  const structuredClasses = Array.isArray(options.structuredRoadClasses)
    ? options.structuredRoadClasses.filter(c => typeof c === 'string' && c.trim())
    : [];
  const roadTypeSummary = structuredClasses.length > 0
    ? `Třídy cest z routeru: ${[...new Set(structuredClasses)].join(', ')}`
    : 'Údaje o typu cesty nejsou k dispozici';

  const routeStatusLabel = isRouted
    ? '🥾 Vypočteno pěším routerem (nezaručuje schůdnost ani bezpečný přístup)'
    : '⚠️ Orientační vzdušná spojnice';

  const routeModeLabel = isRouted
    ? `🥾 Vypočteno pěším routerem (nezaručuje schůdnost ani bezpečný přístup)${returnToOrigin ? ' · okruh včetně návratu na start' : ''}`
    : `⚠️ Orientační vzdušná spojnice${returnToOrigin ? ' (okruh vzdušně — pěší trasa neověřena)' : ' (výpočet pěší trasy nedostupný)'}`;

  const terrainDifficulty = ['easy', 'medium', 'hard'].includes(options.terrainDifficulty)
    ? options.terrainDifficulty
    : 'medium';

  let estimatedElevationGainM = Number.isFinite(options.elevationGainM) ? Math.round(options.elevationGainM) : 0;
  if (!Number.isFinite(options.elevationGainM)) {
    for (const p of places) {
      if (Number.isFinite(Number(p.elevationGainM)) && Number(p.elevationGainM) > 0) {
        estimatedElevationGainM += Math.round(Number(p.elevationGainM) * 0.55);
      } else if (isPeakOrSteepPlace(p)) {
        estimatedElevationGainM += 65;
      } else if (p.kind === 'view') {
        estimatedElevationGainM += 35;
      } else {
        estimatedElevationGainM += 10;
      }
    }
  }

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

  if (terrainDifficulty === 'easy') {
    for (const p of places) {
      if (isPeakOrSteepPlace(p)) {
        warnings.push(`${p.title || 'Zastávka'}: obsahuje stoupání nebo skalnatý úsek mimo lehký terén`);
      }
    }
  }

  return {
    airDistanceM,
    returnAirDistanceM: Math.round(returnAirM),
    estimatedWalkDistanceM,
    estimatedMinutes,
    estimatedElevationGainM,
    terrainDifficulty,
    returnToOrigin,
    routeMode,
    routeStatus,
    routeStatusLabel,
    routeModeLabel,
    roadTypeSummary,
    surfaceSummary,
    warnings,
  };
}

/**
 * Sestaví skutečný okruh (včetně návratu na start) odpovídající požadované délce `targetKm` a `terrainDifficulty` (Bod 5, 27 & v1.0).
 */
export function autoSuggestTrip({
  origin = START_PRESETS[0],
  targetKm = 5,
  companionMode = 'solo',
  terrainDifficulty = 'medium',
  categories = [],
  availablePlaces = [],
  discoveries = [],
} = {}) {
  const center = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
    ? origin
    : START_PRESETS[0];

  const target = Number(targetKm) > 0 ? Number(targetKm) : 5;
  const targetMeters = target * 1000;
  const minAcceptableM = Math.round(targetMeters * 0.65);
  const maxAcceptableM = Math.round(targetMeters * 1.35);

  const isStroller = companionMode === 'stroller';
  const isDog = companionMode === 'dog';
  const difficulty = ['easy', 'medium', 'hard'].includes(terrainDifficulty) ? terrainDifficulty : 'medium';
  const visitedSet = new Set(Array.isArray(discoveries) ? discoveries : []);
  const categorySet = Array.isArray(categories) && categories.length > 0 ? new Set(categories) : null;

  const filterByDifficultyAndCategory = (list, strictDifficulty = true) =>
    list.filter(p => {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
      if (p.pointKind === 'route-start') return false;
      if (isStroller && p.access?.stroller === 'no') return false;
      if (isDog && p.access?.dog === 'no') return false;
      if (strictDifficulty && difficulty === 'easy') {
        if (isPeakOrSteepPlace(p)) return false;
        if (p.access?.stroller === 'no') return false;
      }
      if (categorySet && p.category && !categorySet.has(p.category)) {
        // Povolíme shodu i pro spřízněné kategorie (např. benches <-> nature)
        if (!(categorySet.has('benches') && p.category === 'nature') && !(categorySet.has('nature') && p.category === 'benches')) {
          return false;
        }
      }
      return true;
    });

  let rawCandidates = filterByDifficultyAndCategory(availablePlaces || [], true);
  // Pokud by přísný filtr kategorií v malém okruhu nechal méně než 2 místa, uvolníme filtr kategorií při zachování náročnosti terénu
  if (rawCandidates.length < 2 && categorySet) {
    rawCandidates = (availablePlaces || []).filter(p => {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
      if (p.pointKind === 'route-start') return false;
      if (isStroller && p.access?.stroller === 'no') return false;
      if (isDog && p.access?.dog === 'no') return false;
      if (difficulty === 'easy' && (isPeakOrSteepPlace(p) || p.access?.stroller === 'no')) return false;
      return true;
    });
  }

  const candidates = rawCandidates
    .map(p => {
      const dist = haversineMeters(center, p) ?? 0;
      const isVisited = visitedSet.has(p.id) || visitedSet.has(`catalog:${p.id}`);
      const isPeak = isPeakOrSteepPlace(p) || p.kind === 'view';
      const { sector, bearingDeg } = computeQuadrantSector(center, p);
      return { ...p, _dist: dist, _visited: isVisited, _isPeak: isPeak, _sector: sector, _bearingDeg: bearingDeg };
    })
    .filter(p => p._dist >= 40 && p._dist <= targetMeters * 0.75);

  if (candidates.length < 2) {
    const emptyAnalysis = analyzePlannedRoute(center, [], companionMode, { returnToOrigin: true, terrainDifficulty: difficulty });
    return {
      found: false,
      origin: center,
      returnToOrigin: true,
      targetKm: target,
      terrainDifficulty: difficulty,
      places: [],
      selectedPlaceIds: [],
      analysis: emptyAnalysis,
      reason: `Pro délku ~${target} km (včetně návratu na start) nebyl v okolí nalezen dostatek vhodných zastávek. Zkus jinou délku nebo uprav filtry.`,
    };
  }

  const idealRadiusM = targetMeters * 0.32;
  const sortedByRing = [...candidates].sort((a, b) => {
    if (difficulty === 'hard' && a._isPeak !== b._isPeak) {
      return a._isPeak ? -1 : 1;
    }
    if (difficulty === 'easy' && a._isPeak !== b._isPeak) {
      return a._isPeak ? 1 : -1;
    }
    const da = Math.abs(a._dist - idealRadiusM);
    const db = Math.abs(b._dist - idealRadiusM);
    if (Math.abs(da - db) > 150) return da - db;
    if (a._visited !== b._visited) return a._visited ? 1 : -1;
    return a._dist - b._dist;
  });

  // ZADÁNÍ #09 (Fáze 2): Kruhové rozdělení na 4 směrové výseče (Koláč: SV, JV, JZ, SZ),
  // aby výběr tvořil otevřený trojúhelník nebo čtyřúhelník a nevracel se stejnou cestou („nudlí“)
  const bySector = { NE: [], SE: [], SW: [], NW: [] };
  for (const item of sortedByRing) {
    if (bySector[item._sector]) bySector[item._sector].push(item);
  }
  const pool = [];
  const usedIds = new Set();
  for (let round = 0; round < 4 && pool.length < 14; round++) {
    for (const sec of ['NE', 'SE', 'SW', 'NW']) {
      const cand = bySector[sec][round];
      if (cand && !usedIds.has(cand.id)) {
        usedIds.add(cand.id);
        pool.push(cand);
      }
    }
  }
  for (const item of sortedByRing) {
    if (pool.length >= 14) break;
    if (!usedIds.has(item.id)) {
      usedIds.add(item.id);
      pool.push(item);
    }
  }

  let bestCandidate = null;
  let bestScore = Infinity;

  const evaluateSubset = subset => {
    const cleanSubset = subset.map(p => {
      const copy = { ...p };
      delete copy._dist;
      delete copy._visited;
      delete copy._isPeak;
      delete copy._sector;
      delete copy._bearingDeg;
      return copy;
    });
    // Seřadíme podle hodinových ručiček (Math.atan2) + pěší optimalizace
    const cwSorted = sortPlacesClockwise(center, cleanSubset);
    const ordered = optimizeRouteOrder(center, cwSorted, { returnToOrigin: true });
    const analysis = analyzePlannedRoute(center, ordered, companionMode, {
      returnToOrigin: true,
      terrainDifficulty: difficulty,
    });
    const walkM = analysis.estimatedWalkDistanceM;
    const diffRatio = Math.abs(walkM - targetMeters) / targetMeters;
    const unvisitedCount = subset.filter(p => !p._visited).length;
    const visitedPenalty = (subset.length - unvisitedCount) * 0.04;
    const peakCount = subset.filter(p => p._isPeak).length;
    const terrainBonusOrPenalty =
      difficulty === 'hard'
        ? -peakCount * 0.14 - Math.min(0.25, (analysis.estimatedElevationGainM || 0) / 800)
        : difficulty === 'easy'
        ? peakCount * 0.45 + Math.min(0.35, (analysis.estimatedElevationGainM || 0) / 300)
        : 0;

    // Bonus za rozprostření do více směrových výsečí (otevřený okruh místo přímky tam a zpět)
    const distinctSectors = new Set(subset.map(p => p._sector)).size;
    const sectorBonus = distinctSectors >= 3 ? -0.16 : distinctSectors === 2 ? -0.08 : 0.10;

    const inTolerance = walkM >= minAcceptableM && walkM <= maxAcceptableM;
    const scoreVal = diffRatio + visitedPenalty + terrainBonusOrPenalty + sectorBonus + (inTolerance ? 0 : 2);

    if (scoreVal < bestScore) {
      bestScore = scoreVal;
      bestCandidate = {
        ordered,
        analysis,
        inTolerance,
      };
    }
  };

  const n = pool.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      evaluateSubset([pool[i], pool[j]]);
      for (let k = j + 1; k < n; k++) {
        evaluateSubset([pool[i], pool[j], pool[k]]);
        if (k < 8) {
          for (let m = k + 1; m < Math.min(n, 9); m++) {
            evaluateSubset([pool[i], pool[j], pool[k], pool[m]]);
          }
        }
      }
    }
  }

  if (!bestCandidate || !bestCandidate.inTolerance) {
    const emptyAnalysis = analyzePlannedRoute(center, [], companionMode, { returnToOrigin: true, terrainDifficulty: difficulty });
    return {
      found: false,
      returnToOrigin: true,
      targetKm: target,
      terrainDifficulty: difficulty,
      places: [],
      selectedPlaceIds: [],
      analysis: emptyAnalysis,
      reason: `V okolí se nepodařilo sestavit okruh o délce ~${target} km včetně návratu na start. Zkus zvolit jinou délku nebo povolit více kategorií.`,
    };
  }

  return {
    found: true,
    origin: center,
    returnToOrigin: true,
    targetKm: target,
    terrainDifficulty: difficulty,
    places: bestCandidate.ordered,
    selectedPlaceIds: bestCandidate.ordered.map(p => p.id),
    analysis: bestCandidate.analysis,
    reason: '',
  };
}

const walkingGeometryCache = new Map();

/**
 * Vypočítá azimut mezi dvěma body ve stupních (0–360°).
 */
export function computeBearingDeg(a, b) {
  if (!a || !b) return 0;
  const lat1 = ((Array.isArray(a) ? a[0] : a.lat) * Math.PI) / 180;
  const lng1 = ((Array.isArray(a) ? a[1] : a.lng) * Math.PI) / 180;
  const lat2 = ((Array.isArray(b) ? b[0] : b.lat) * Math.PI) / 180;
  const lng2 = ((Array.isArray(b) ? b[1] : b.lng) * Math.PI) / 180;
  const dLng = lng2 - lng1;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * ZADÁNÍ #11 (Bod 4.1): Algoritmus rohů a zlomů trasy (`buildDetailedCornerSteps`).
 * Posuvným oknem ~14 m (vektor ~12 m před vrcholem vs ~12 m za vrcholem) detekuje každý roh domu
 * a ohyb cesty s úhlem >= 24° a odstupem >= 12 m.
 * 24°–45°: ↖ Mírně vlevo / ↗ Mírně vpravo
 * 45°–125°: ↰ Na rohu odboč vlevo / ↱ Na rohu odboč vpravo
 * > 125°: ↩ Ostrá zatáčka vlevo / ↪ Ostrá zatáčka vpravo
 * Pro každý roh spočítá nextStraightMeters.
 */
export function buildDetailedCornerSteps(coordinates = [], stopTargets = [], osrmSteps = []) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
  const steps = [];
  let accumM = 0;

  for (let i = 1; i < coordinates.length - 1; i++) {
    const prev = { lat: coordinates[i - 1][0], lng: coordinates[i - 1][1] };
    const curr = { lat: coordinates[i][0], lng: coordinates[i][1] };
    const next = { lat: coordinates[i + 1][0], lng: coordinates[i + 1][1] };

    const segM = haversineMeters(prev, curr) ?? 0;
    accumM += segM;

    const stopHere = (stopTargets || []).find(st => st.coordIndex === i && st.waypointIndex > 0 && !st.isAuxiliaryVia);
    if (stopHere) {
      steps.push({
        lat: curr.lat,
        lng: curr.lng,
        coordIndex: i,
        distanceM: Math.round(accumM),
        maneuverType: 'arrive',
        modifier: 'straight',
        icon: '🏁',
        actionLabel: `cíl ${stopHere.title}`,
        voiceAction: `jste u cíle ${stopHere.title}`,
        name: stopHere.title,
        nextStraightMeters: 0,
      });
      accumM = 0;
      continue;
    }

    // Posuvné okno ~14 m (vektor ~12 m před vrcholem vs ~12 m za vrcholem)
    let lookBackIdx = i - 1;
    let backDist = segM;
    while (lookBackIdx > 0 && backDist < 12) {
      const pA = { lat: coordinates[lookBackIdx - 1][0], lng: coordinates[lookBackIdx - 1][1] };
      const pB = { lat: coordinates[lookBackIdx][0], lng: coordinates[lookBackIdx][1] };
      backDist += haversineMeters(pA, pB) ?? 0;
      lookBackIdx--;
    }

    let lookAheadIdx = i + 1;
    let aheadDist = haversineMeters(curr, next) ?? 0;
    while (lookAheadIdx < coordinates.length - 1 && aheadDist < 12) {
      const pA = { lat: coordinates[lookAheadIdx][0], lng: coordinates[lookAheadIdx][1] };
      const pB = { lat: coordinates[lookAheadIdx + 1][0], lng: coordinates[lookAheadIdx + 1][1] };
      aheadDist += haversineMeters(pA, pB) ?? 0;
      lookAheadIdx++;
    }

    const entryPt = { lat: coordinates[lookBackIdx][0], lng: coordinates[lookBackIdx][1] };
    const exitPt = { lat: coordinates[lookAheadIdx][0], lng: coordinates[lookAheadIdx][1] };

    const b1 = computeBearingDeg(entryPt, curr);
    const b2 = computeBearingDeg(curr, exitPt);
    const delta = ((b2 - b1 + 540) % 360) - 180; // -180..+180
    const absDelta = Math.abs(delta);

    // Každý zlom s úhlem >= 24° a minimální vzdáleností >= 12 m od předchozího ohlášeného rohu
    if (absDelta >= 24 && accumM >= 12) {
      const isLeft = delta < 0;
      let modifier = isLeft ? 'left' : 'right';
      let icon = isLeft ? '↰' : '↱';
      let actionLabel = isLeft ? 'na rohu odboč vlevo' : 'na rohu odboč vpravo';
      let voiceAction = isLeft ? 'odbočte vlevo' : 'odbočte vpravo';

      if (absDelta <= 45) {
        modifier = isLeft ? 'slight left' : 'slight right';
        icon = isLeft ? '↖' : '↗';
        actionLabel = isLeft ? 'mírně vlevo' : 'mírně vpravo';
        voiceAction = isLeft ? 'jděte mírně vlevo' : 'jděte mírně vpravo';
      } else if (absDelta > 125) {
        modifier = isLeft ? 'sharp left' : 'sharp right';
        icon = isLeft ? '↩' : '↪';
        actionLabel = isLeft ? 'ostrá zatáčka vlevo' : 'ostrá zatáčka vpravo';
        voiceAction = isLeft ? 'zahněte ostře vlevo' : 'zahněte ostře vpravo';
      }

      // Propojení s názvem ulice z OSRM kroků, pokud je k dispozici
      const matchedOsrm = (osrmSteps || []).find(
        st => st.name && (Math.abs(st.coordIndex - i) <= 2 || (haversineMeters(st, curr) ?? Infinity) <= 15)
      );
      const roadName = matchedOsrm?.name || '';
      if (roadName) {
        actionLabel += ` do ulice ${roadName}`;
        voiceAction += ` do ulice ${roadName}`;
      }

      steps.push({
        lat: curr.lat,
        lng: curr.lng,
        coordIndex: i,
        distanceM: Math.round(accumM),
        maneuverType: 'turn',
        modifier,
        turnAngleDeg: Math.round(delta),
        icon,
        actionLabel,
        voiceAction,
        name: roadName,
        nextStraightMeters: 0,
      });
      accumM = 0;
    }
  }

  const lastIdx = coordinates.length - 1;
  const prevLast = { lat: coordinates[lastIdx - 1][0], lng: coordinates[lastIdx - 1][1] };
  const lastPt = { lat: coordinates[lastIdx][0], lng: coordinates[lastIdx][1] };
  accumM += haversineMeters(prevLast, lastPt) ?? 0;
  const finalStop = (stopTargets || [])[stopTargets.length - 1];

  steps.push({
    lat: lastPt.lat,
    lng: lastPt.lng,
    coordIndex: lastIdx,
    distanceM: Math.round(accumM),
    maneuverType: 'arrive',
    modifier: 'straight',
    icon: '🏁',
    actionLabel: finalStop?.title ? `cíl ${finalStop.title}` : 'cíl trasy',
    voiceAction: finalStop?.title ? `jste u cíle ${finalStop.title}` : 'jste v cíli trasy',
    name: finalStop?.title || 'Cíl trasy',
    nextStraightMeters: 0,
  });

  // Výpočet nextStraightMeters pro každý roh (vzdálenost k dalšímu rohu / zastávce)
  for (let s = 0; s < steps.length - 1; s++) {
    const curStep = steps[s];
    const nextStep = steps[s + 1];
    let straightM = 0;
    const startC = Math.min(curStep.coordIndex, coordinates.length - 1);
    const endC = Math.min(nextStep.coordIndex, coordinates.length - 1);
    for (let c = startC; c < endC; c++) {
      const p1 = { lat: coordinates[c][0], lng: coordinates[c][1] };
      const p2 = { lat: coordinates[c + 1][0], lng: coordinates[c + 1][1] };
      straightM += haversineMeters(p1, p2) ?? 0;
    }
    curStep.nextStraightMeters = Math.max(5, Math.round(straightM));
  }

  return steps;
}

export function buildTurnStepsFromCoordinates(coordinates = [], stopTargets = []) {
  return buildDetailedCornerSteps(coordinates, stopTargets);
}

/**
 * Vytáhne odbočovací manévry (`steps`) z odpovědi OSRM (`steps=true`) A DOPLNÍ je o všechny geometrické rohy domů/ulic
 * podél `coordinates`, které OSRM nevypsalo jako změnu názvu ulice.
 */
export function extractStepsFromOsrmRoute(route, coordinates = [], stopTargets = []) {
  const osrmLegs = Array.isArray(route?.legs) ? route.legs : [];
  const extracted = [];

  for (let lIdx = 0; lIdx < osrmLegs.length; lIdx++) {
    const legSteps = Array.isArray(osrmLegs[lIdx]?.steps) ? osrmLegs[lIdx].steps : [];
    for (const st of legSteps) {
      const loc = st?.maneuver?.location;
      if (!Array.isArray(loc) || loc.length < 2) continue;
      const lat = Number(loc[1]);
      const lng = Number(loc[0]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const type = String(st.maneuver?.type || 'continue');
      const mod = String(st.maneuver?.modifier || 'straight');
      const roadName = typeof st.name === 'string' && st.name.trim() ? st.name.trim() : '';

      let icon = '↑';
      let actionLabel = roadName ? `pokračuj po ${roadName}` : 'pokračuj po stezce';
      let voiceAction = roadName ? `pokračujte po ulici ${roadName}` : 'pokračujte po cestě';

      if (type === 'arrive') {
        icon = '🏁';
        const targetMeta = stopTargets[lIdx + 1];
        actionLabel = targetMeta?.title ? `cíl ${targetMeta.title}` : 'jsi u cíle';
        voiceAction = targetMeta?.title ? `jste u cíle ${targetMeta.title}` : 'jste u cíle';
      } else if (mod.includes('left')) {
        icon = mod.includes('slight') ? '↖' : '↰';
        actionLabel = mod.includes('slight')
          ? 'mírně vlevo za roh'
          : mod.includes('sharp')
          ? 'ostře doleva za roh'
          : 'zahni doleva za roh';
        voiceAction = mod.includes('slight')
          ? 'jděte mírně vlevo za roh'
          : mod.includes('sharp')
          ? 'zahněte ostře doleva za roh'
          : 'zahněte doleva za roh';
        if (roadName) {
          actionLabel += ` (${roadName})`;
          voiceAction += ` na ${roadName}`;
        }
      } else if (mod.includes('right')) {
        icon = mod.includes('slight') ? '↗' : '↱';
        actionLabel = mod.includes('slight')
          ? 'mírně vpravo za roh'
          : mod.includes('sharp')
          ? 'ostře doprava za roh'
          : 'zahni doprava za roh';
        voiceAction = mod.includes('slight')
          ? 'jděte mírně vpravo za roh'
          : mod.includes('sharp')
          ? 'zahněte ostře doprava za roh'
          : 'zahněte doprava za roh';
        if (roadName) {
          actionLabel += ` (${roadName})`;
          voiceAction += ` na ${roadName}`;
        }
      } else if (type === 'depart') {
        icon = '↑';
        actionLabel = roadName ? `vyraz po ${roadName}` : 'pokračuj po trase';
        voiceAction = roadName ? `vyrazte po ${roadName}` : 'pokračujte po trase';
      }

      let bestCoordIdx = 0;
      let minD = Infinity;
      for (let cIdx = 0; cIdx < coordinates.length; cIdx++) {
        const d = haversineMeters({ lat, lng }, { lat: coordinates[cIdx][0], lng: coordinates[cIdx][1] }) ?? Infinity;
        if (d < minD) {
          minD = d;
          bestCoordIdx = cIdx;
        }
      }

      extracted.push({
        lat,
        lng,
        coordIndex: bestCoordIdx,
        distanceM: Math.round(Number(st.distance) || 0),
        maneuverType: type,
        modifier: mod,
        icon,
        actionLabel,
        voiceAction,
        name: roadName,
      });
    }
  }

  const geomCorners = buildDetailedCornerSteps(coordinates, stopTargets, extracted);
  if (extracted.length === 0) {
    return geomCorners;
  }

  // Sloučíme OSRM kroky s geometrickými rohy domů/ulic (pokud v okruhu 10 m od geometrického rohu není OSRM manévr)
  const merged = [...extracted];
  for (const corner of geomCorners) {
    if (corner.maneuverType !== 'turn') continue;
    const alreadyCovered = merged.some(
      m => m.maneuverType !== 'depart' && (Math.abs(m.coordIndex - corner.coordIndex) <= 1 || (haversineMeters(m, corner) ?? Infinity) < 10)
    );
    if (!alreadyCovered) {
      merged.push(corner);
    }
  }
  merged.sort((a, b) => a.coordIndex - b.coordIndex);
  return merged;
}

/**
 * Najde nejbližší úsek lomené čáry trasy vůči pozici hráče a vrátí index výchozího vrcholu úseku (`segIdx`),
 * kolmou vzdálenost k úseku (`distanceToRouteM`) a kolik metrů zbývá do konce tohoto úseku (`distToSegEndM`).
 */
export function locatePlayerOnPolyline(currentPos, coords = []) {
  if (!currentPos || !Number.isFinite(currentPos.lat) || !Number.isFinite(currentPos.lng) || !Array.isArray(coords) || coords.length === 0) {
    return { segIdx: 0, distanceToRouteM: 0, distToSegEndM: 0 };
  }
  if (coords.length === 1) {
    const d = haversineMeters(currentPos, { lat: coords[0][0], lng: coords[0][1] }) ?? 0;
    return { segIdx: 0, distanceToRouteM: d, distToSegEndM: d };
  }

  const cosLat = Math.cos((currentPos.lat * Math.PI) / 180) || 0.65;
  const px = currentPos.lng * 111320 * cosLat;
  const py = currentPos.lat * 111320;

  let bestSegIdx = 0;
  let bestDistM = Infinity;
  let bestDistToEndM = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][1] * 111320 * cosLat;
    const ay = coords[i][0] * 111320;
    const bx = coords[i + 1][1] * 111320 * cosLat;
    const by = coords[i + 1][0] * 111320;

    const dx = bx - ax;
    const dy = by - ay;
    const segLenSq = dx * dx + dy * dy;
    let t = 0;
    if (segLenSq > 0.01) {
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / segLenSq));
    }
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const dPerp = Math.hypot(px - projX, py - projY);
    const dToEnd = Math.hypot(bx - projX, by - projY);

    if (dPerp < bestDistM) {
      bestDistM = dPerp;
      bestSegIdx = i;
      bestDistToEndM = dToEnd;
    }
  }

  return {
    segIdx: bestSegIdx,
    distanceToRouteM: bestDistM,
    distToSegEndM: bestDistToEndM,
  };
}

/**
 * Vrátí aktuální navigační povel u kompasu („Za kolik metrů kam odbočit za roh“) pro hráče na trase.
 * Podporuje 3-fázové hlášení každého rohu domu (předběžné upozornění 35–85 m, blížící se roh 15–34 m, a povel TEĎ u rohu <= 14 m).
 */
export function computeActiveTurnInstruction(arg1, arg2, arg3 = null, arg4 = null) {
  let sharedRoute = null;
  let currentPos = null;
  let nextStop = null;

  if (arg1 && Array.isArray(arg1.coordinates)) {
    sharedRoute = arg1;
    currentPos = arg2;
  } else {
    currentPos = arg1;
    sharedRoute = arg2;
  }

  if (Array.isArray(arg3)) {
    const confirmedSet = arg4 instanceof Set ? arg4 : new Set(Array.isArray(arg4) ? arg4 : []);
    nextStop = arg3.find(p => p && !confirmedSet.has(p.id)) || null;
  } else if (arg3 && typeof arg3 === 'object') {
    nextStop = arg3;
  }

  if (!sharedRoute || !Array.isArray(sharedRoute.coordinates) || sharedRoute.coordinates.length < 2) {
    if (nextStop && currentPos && Number.isFinite(currentPos.lat) && Number.isFinite(currentPos.lng)) {
      const distM = Math.round(haversineMeters(currentPos, nextStop) ?? 0);
      const speechText = distM < 25 ? `Jste u cíle ${nextStop.title}.` : `Pokračujte ${distM} metrů k cíli ${nextStop.title}.`;
      return {
        icon: distM < 25 ? '🏁' : '↑',
        text: distM < 25 ? `🏁 Jsi u cíle: ${nextStop.title}` : `↑ Pokračuj ${distM} m · Směr: ${nextStop.title}`,
        speechText,
        voiceText: speechText,
        distanceToTurnM: distM,
        isNearTurn: distM <= 40,
        turnDirection: distM < 25 ? 'arrive' : 'straight',
        stepKey: `direct_${nextStop.id}_${distM < 25 ? 'arr' : 'go'}`,
      };
    }
    return {
      icon: '🧭',
      text: '↑ Volná procházka · sleduj mapu a kompas',
      speechText: '',
      voiceText: '',
      distanceToTurnM: null,
      isNearTurn: false,
      turnDirection: 'straight',
      stepKey: 'free',
    };
  }

  // DÁVKA 2 (Bod 3.1): Při výpadku routeru (orientační vzdušná spojnice `isFallback: true` / `fallback_direct`)
  // NIKDY nespouštíme hlasovou navigaci odboček!
  if (
    sharedRoute.isFallback ||
    sharedRoute.mode === 'fallback_direct' ||
    sharedRoute.mode === 'air_fallback' ||
    sharedRoute.routeStatus === 'fallback_direct'
  ) {
    const directDistM =
      nextStop && currentPos && Number.isFinite(currentPos.lat) && Number.isFinite(currentPos.lng)
        ? Math.round(haversineMeters(currentPos, nextStop) ?? 0)
        : null;
    const directSuffix = nextStop?.title
      ? ` · Směr: ${nextStop.title}${directDistM != null ? ` (~${directDistM} m vzdušně)` : ''}`
      : ' · sleduj mapu a terén';
    return {
      icon: '⚠️',
      text: `⚠️ Orientační vzdušná spojnice${directSuffix}`,
      speechText: '',
      voiceText: '',
      distanceToTurnM: directDistM,
      isNearTurn: false,
      isFallbackDirect: true,
      turnDirection: 'straight',
      stepKey: `fallback_direct_${nextStop?.id || 'none'}`,
    };
  }

  const coords = sharedRoute.coordinates;
  const steps = Array.isArray(sharedRoute.steps) && sharedRoute.steps.length > 0
    ? sharedRoute.steps
    : buildTurnStepsFromCoordinates(coords, sharedRoute.stopTargets || []);

  const loc = locatePlayerOnPolyline(currentPos, coords);
  const segIdx = loc.segIdx;
  const minDistanceToRouteM = loc.distanceToRouteM;

  // Pokud hráč seběhl z naplánované trasy (> 45 m), NIKDY ho nevracíme na start (náměstí),
  // ale nasměrujeme ho přímo k dalšímu nadcházejícímu cíli v pořadí!
  if (minDistanceToRouteM > 45 && nextStop && currentPos && Number.isFinite(currentPos.lat)) {
    const distDirectM = Math.max(5, Math.round(haversineMeters(currentPos, nextStop) ?? 0));
    const speech = distDirectM <= 30
      ? `Jste u cíle ${nextStop.title}. Získáváte razítko.`
      : `Pokračujte k dalšímu cíli ${nextStop.title}, ${distDirectM} metrů.`;
    return {
      icon: distDirectM <= 30 ? '🏁' : '↗',
      text: distDirectM <= 30 ? `🏁 Jsi u cíle: ${nextStop.title}` : `↗ K dalšímu cíli: ${nextStop.title} (${distDirectM} m)`,
      speechText: speech,
      voiceText: speech,
      distanceToTurnM: distDirectM,
      isNearTurn: distDirectM <= 40,
      isOffRoute: true,
      turnDirection: distDirectM <= 30 ? 'arrive' : 'straight',
      stepKey: `off_route_${nextStop.id}_${Math.floor(distDirectM / 20)}`,
    };
  }

  // Najdeme nejbližší nadcházející roh / odbočku nebo cíl na konci aktuálního úseku nebo dále (coordIndex >= segIdx + 1)
  let upcomingStep = steps.find(s => s.coordIndex >= segIdx + 1 && s.maneuverType !== 'depart') || steps[steps.length - 1];
  if (!upcomingStep) {
    return {
      icon: '↑',
      text: '↑ Pokračuj po naplánované trase',
      speechText: 'Pokračujte po naplánované trase.',
      voiceText: 'Pokračujte po naplánované trase.',
      distanceToTurnM: 0,
      isNearTurn: false,
      turnDirection: 'straight',
      stepKey: 'cont',
    };
  }

  // Přesná vzdálenost po trase od aktuální pozice hráče k vrcholu rohu `upcomingStep.coordIndex`
  let exactDistAlongM = loc.distToSegEndM;
  const targetCoordIdx = Math.min(coords.length - 1, Math.max(segIdx + 1, upcomingStep.coordIndex ?? coords.length - 1));
  for (let k = segIdx + 1; k < targetCoordIdx; k++) {
    const pA = { lat: coords[k][0], lng: coords[k][1] };
    const pB = { lat: coords[k + 1][0], lng: coords[k + 1][1] };
    exactDistAlongM += haversineMeters(pA, pB) ?? 0;
  }
  const distM = Math.max(2, Math.round(exactDistAlongM));

  const nextStopSuffix = nextStop?.title ? ` · Směr: ${nextStop.title}` : '';

  if (upcomingStep.maneuverType === 'arrive' && distM <= 25) {
    const speechText = `Jste u cíle ${nextStop?.title || upcomingStep.name || ''}. Získáváte razítko.`;
    return {
      icon: '🏁',
      text: `🏁 Jsi u cíle: ${nextStop?.title || upcomingStep.name || 'Zastávka'}`,
      speechText,
      voiceText: speechText,
      distanceToTurnM: distM,
      isNearTurn: true,
      turnDirection: 'arrive',
      stepKey: `arrive_${upcomingStep.coordIndex}`,
    };
  }

  const isTurn =
    upcomingStep.maneuverType === 'turn' ||
    upcomingStep.icon === '↰' ||
    upcomingStep.icon === '↱' ||
    upcomingStep.icon === '↖' ||
    upcomingStep.icon === '↗' ||
    upcomingStep.icon === '↩' ||
    upcomingStep.icon === '↪';

  if (isTurn) {
    const turnDir = String(upcomingStep.modifier || '').includes('left') ? 'left' : 'right';
    const voicePhrase = upcomingStep.voiceAction || upcomingStep.actionLabel || 'odbočte';
    const actionLabel = upcomingStep.actionLabel || 'odboč';

    // Fáze 2: Akce na rohu (<= 15 m)
    if (distM <= 15) {
      const nextStraightStr = upcomingStep.nextStraightMeters ? ` a pokračujte ${upcomingStep.nextStraightMeters} metrů` : '';
      const speechText = `Teď na rohu ${voicePhrase}${nextStraightStr}.`;
      const uiText = `${upcomingStep.icon} TEĎ: ${actionLabel}${upcomingStep.nextStraightMeters ? ` (pak ${upcomingStep.nextStraightMeters} m rovně)` : ''}`;
      return {
        icon: upcomingStep.icon,
        text: uiText,
        speechText,
        voiceText: speechText,
        distanceToTurnM: distM,
        isNearTurn: true,
        turnDirection: turnDir,
        stepKey: `exec_${upcomingStep.coordIndex}`,
      };
    }

    // Fáze 1: Příprava (30–55 m)
    if (distM >= 30 && distM <= 55) {
      const speechText = `Připravte se, za ${distM} metrů na rohu ${voicePhrase}.`;
      const uiText = `${upcomingStep.icon} Za ${distM} m ${actionLabel}${nextStopSuffix}`;
      return {
        icon: upcomingStep.icon,
        text: uiText,
        speechText,
        voiceText: speechText,
        distanceToTurnM: distM,
        isNearTurn: true,
        turnDirection: turnDir,
        stepKey: `prep_${upcomingStep.coordIndex}`,
      };
    }

    // Mezidobí (po projetí rohu nebo 16–29 m či > 55 m)
    // Pilulka nahoře u kompasu ukazuje: „↑ Rovně ${distM} m k dalšímu rohu (${upcomingStep.icon} pak ${actionLabel})“
    const uiText = `↑ Rovně ${distM} m k dalšímu rohu (${upcomingStep.icon} pak ${actionLabel})`;
    return {
      icon: '↑',
      text: uiText,
      speechText: '',
      voiceText: '',
      distanceToTurnM: distM,
      isNearTurn: distM <= 25,
      turnDirection: 'straight',
      stepKey: `mid_${upcomingStep.coordIndex}_${Math.floor(distM / 20)}`,
    };
  }

  const speechText = `Pokračujte po stezce ${distM} metrů.`;
  return {
    icon: '↑',
    text: `↑ Pokračuj po stezce ${distM} m${nextStopSuffix}`,
    speechText,
    voiceText: speechText,
    distanceToTurnM: distM,
    isNearTurn: distM <= 40,
    turnDirection: 'straight',
    stepKey: `straight_${upcomingStep.coordIndex}`,
  };
}

/**
 * Vyhledá město, obec nebo místo v ČR pomocí Nominatim API s vestavěnou zálohou českých obcí (ZADÁNÍ #08 Bod 1).
 */
export async function searchPlaceNominatim(query, fetchImpl = typeof fetch !== 'undefined' ? fetch : null) {
  const q = String(query || '').trim();
  if (!q) return [...CZECH_PLACE_PRESETS];

  const qNorm = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const localMatches = CZECH_PLACE_PRESETS.filter(item => {
    const lNorm = item.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return lNorm.includes(qNorm);
  });

  if (!fetchImpl || q.length < 2) {
    return localMatches.length > 0 ? localMatches : CZECH_PLACE_PRESETS.slice(0, 4);
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=cz&limit=5&q=${encodeURIComponent(q)}`;
    let timeoutId;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = controller ? controller.signal : undefined;
    if (controller) timeoutId = setTimeout(() => controller.abort(), 3500);

    try {
      const res = await fetchImpl(url, {
        signal,
        headers: { 'Accept-Language': 'cs' },
      });
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const remoteResults = data
            .map((item, idx) => ({
              id: `nom-${item.place_id || idx}`,
              label: String(item.display_name || q).split(',').slice(0, 2).join(', ').trim(),
              fullLabel: String(item.display_name || q),
              lat: Number(item.lat),
              lng: Number(item.lon),
            }))
            .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
          if (remoteResults.length > 0) {
            return remoteResults;
          }
        }
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    // Fallback to local presets on network error
  }

  return localMatches.length > 0 ? localMatches : CZECH_PLACE_PRESETS.slice(0, 4);
}

/**
 * Vypočítá nejkratší pěší trasu z aktuální polohy hráče zpět na start výpravy (`🏠 Návrat na start / k autu`).
 */
export async function buildReturnToOriginRoute(currentPos, origin, fetchImpl = typeof fetch !== 'undefined' ? fetch : null, options = {}) {
  const startPt = currentPos && Number.isFinite(currentPos.lat) && Number.isFinite(currentPos.lng)
    ? currentPos
    : origin || START_PRESETS[0];
  const targetOrigin = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
    ? { ...origin, id: origin.id || 'return-start', title: origin.label || origin.title || 'Start výpravy' }
    : { ...START_PRESETS[0], title: START_PRESETS[0].label };

  const geom = await fetchWalkingGeometry([startPt, targetOrigin], fetchImpl, options);
  if (!geom || geom.isFallback || !geom.coordinates || geom.coordinates.length < 2) {
    return buildLocalRoutedGeometry([startPt, targetOrigin], options);
  }
  return geom;
}

/**
 * ZADÁNÍ #09 (Fáze 2): Pokud je trasa okruhem zpět na start a má jen 1 nebo 2 zastávky,
 * automaticky vloží 1 boční průjezdní bod (cca 380–400 m vedle), aby pěší router OSRM
 * vedl zpáteční cestu jinudy a nevracel uživatele po vlastních stopách.
 */
/**
 * DÁVKA 2 (Bod 3.1): Neodvozujeme bezpečnost ze samotného názvu ulice a nevytváříme
 * fiktivní boční objížďky mimo skutečnou síť cest.
 */
export function ensureLoopDetourWaypoints(waypoints = []) {
  return (waypoints || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

function enrichLegWithStreetCorners(legCoords = []) {
  return Array.isArray(legCoords) ? legCoords : [];
}

export function buildLocalRoutedGeometry(waypoints, options = {}) {
  const rawValid = (waypoints || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (rawValid.length < 2) {
    return {
      coordinates: rawValid.map(p => [p.lat, p.lng]),
      distanceM: 0,
      legs: [],
      steps: [],
      stopTargets: [],
      mode: 'empty',
      isFallback: false,
      canSimulate: false,
    };
  }

  const valid = options.disableLoopDetour ? rawValid : ensureLoopDetourWaypoints(rawValid);

  const coordinates = [];
  const legs = [];
  const stopTargets = [];
  let totalDistanceM = 0;

  for (let i = 0; i < valid.length; i++) {
    const w = valid[i];
    const accessible = resolveAccessibleStopLocation(w, options.ponds);
    stopTargets.push({
      id: w.id || `wp_${i}`,
      title: w.title || w.label || `Bod ${i + 1}`,
      lat: accessible ? accessible.lat : w.lat,
      lng: accessible ? accessible.lng : w.lng,
      originalLat: w.lat,
      originalLng: w.lng,
      isShoreAccess: Boolean(accessible?.isShoreAccess),
      isAuxiliaryVia: Boolean(w.isAuxiliaryVia),
      waypointIndex: i,
      coordIndex: 0,
    });
  }

  for (let i = 0; i < valid.length - 1; i++) {
    const leg = computeLocalWalkingLeg(valid[i], valid[i + 1], options);
    const legCoords = enrichLegWithStreetCorners(leg.coordinates, leg.distanceM);
    const startCoordIdx = Math.max(0, coordinates.length - 1);
    for (const c of legCoords) {
      if (
        coordinates.length === 0 ||
        coordinates[coordinates.length - 1][0] !== c[0] ||
        coordinates[coordinates.length - 1][1] !== c[1]
      ) {
        coordinates.push(c);
      }
    }
    const endCoordIdx = Math.max(0, coordinates.length - 1);
    stopTargets[i + 1].coordIndex = endCoordIdx;
    legs.push({
      fromIndex: i,
      toIndex: i + 1,
      fromId: valid[i].id || `wp_${i}`,
      toId: valid[i + 1].id || `wp_${i + 1}`,
      distanceM: leg.distanceM,
      coordinates: legCoords,
      startCoordIdx,
      endCoordIdx,
    });
    totalDistanceM += leg.distanceM;
  }

  const steps = buildTurnStepsFromCoordinates(coordinates, stopTargets);

  return {
    coordinates,
    distanceM: Math.round(totalDistanceM),
    legs,
    steps,
    stopTargets,
    mode: 'routed',
    routeStatus: 'routed_foot',
    routeStatusLabel: '🥾 Vypočteno pěším routerem (nezaručuje schůdnost ani bezpečný přístup)',
    roadTypeSummary: 'Údaje o typu cesty nejsou k dispozici',
    isFallback: false,
    canSimulate: coordinates.length >= 2,
  };
}

/**
 * Fetches actual walking route geometry along footpaths using OSRM Foot Routing (`steps=true`),
 * or computes an obstacle-aware walking route around ponds and over bridges.
 * Explicitly distinguishes calculated footpath ('routed_foot' / 'routed') from straight-line fallback ('fallback_direct' / 'air_fallback') (DÁVKA 2 Bod 3.1).
 */
export async function fetchWalkingGeometry(waypoints, fetchImpl = typeof fetch !== 'undefined' ? fetch : null, options = {}) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    return { coordinates: [], distanceM: 0, legs: [], steps: [], stopTargets: [], mode: 'empty', routeStatus: 'empty', isFallback: false, canSimulate: false };
  }
  const rawValid = waypoints.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (rawValid.length < 2) {
    return {
      coordinates: rawValid.map(p => [p.lat, p.lng]),
      distanceM: 0,
      legs: [],
      steps: [],
      stopTargets: [],
      mode: 'empty',
      routeStatus: 'empty',
      isFallback: false,
      canSimulate: false,
    };
  }

  const valid = options.disableLoopDetour ? rawValid : ensureLoopDetourWaypoints(rawValid);

  // Převod zastávek uprostřed rybníka na přístupný bod na břehu (Bod 26)
  const accessibleWaypoints = valid.map(w => {
    const acc = resolveAccessibleStopLocation(w, options.ponds);
    return acc ? { ...w, lat: acc.lat, lng: acc.lng, originalLat: w.lat, originalLng: w.lng, isShoreAccess: acc.isShoreAccess } : w;
  });

  // Fallback direct polyline & haversine air distance — explicitly marked as fallback (`isFallback: true`, `routeStatus: 'fallback_direct'`)!
  const fallback = () => {
    let dist = 0;
    for (let i = 0; i < accessibleWaypoints.length - 1; i++) {
      const seg = haversineMeters(accessibleWaypoints[i], accessibleWaypoints[i + 1]);
      if (seg != null) dist += seg;
    }
    const stopTargets = accessibleWaypoints.map((w, idx) => ({
      id: w.id || `wp_${idx}`,
      title: w.title || w.label || `Bod ${idx + 1}`,
      lat: w.lat,
      lng: w.lng,
      waypointIndex: idx,
      coordIndex: idx,
    }));
    const coords = accessibleWaypoints.map(p => [p.lat, p.lng]);
    return {
      coordinates: coords,
      distanceM: Math.round(dist),
      legs: [],
      steps: [],
      stopTargets,
      mode: 'air_fallback',
      routeStatus: 'fallback_direct',
      routeStatusLabel: '⚠️ Orientační vzdušná spojnice',
      roadTypeSummary: 'Údaje o typu cesty nejsou k dispozici',
      isFallback: true,
      canSimulate: false,
    };
  };

  // Pokud volající explicitně požaduje lokální síť cest (např. s definovanými mosty a rybníky)
  if (options.useLocalFootpathGraph) {
    return buildLocalRoutedGeometry(accessibleWaypoints, options);
  }

  const cacheKey = accessibleWaypoints.map(p => `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`).join(';');
  if (walkingGeometryCache.has(cacheKey) && fetchImpl === (typeof fetch !== 'undefined' ? fetch : null)) {
    return walkingGeometryCache.get(cacheKey);
  }

  if (!fetchImpl) {
    return fallback();
  }

  try {
    const coordsStr = accessibleWaypoints.map(p => `${Number(p.lng).toFixed(5)},${Number(p.lat).toFixed(5)}`).join(';');
    // Priorita 1: OpenStreetMap Germany Foot & Hiking routing engine (pěší stezky, KČT trasy, nulová tolerance k dálnicím a silnicím bez chodníků)
    // Priorita 2: OSRM Project Foot router jako záložní server
    const primaryUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordsStr}?overview=full&geometries=geojson&steps=true`;
    const secondaryUrl = `https://router.project-osrm.org/route/v1/foot/${coordsStr}?overview=full&geometries=geojson&steps=true`;

    let data = null;
    let route = null;

    for (const url of [primaryUrl, secondaryUrl]) {
      let timeoutId;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const signal = controller ? controller.signal : undefined;
      if (controller) {
        timeoutId = setTimeout(() => controller.abort(), 3500);
      }
      try {
        const res = await fetchImpl(url, { signal });
        if (res && res.ok) {
          const json = await res.json();
          if (json?.routes?.[0]?.geometry?.coordinates?.length >= 2) {
            data = json;
            route = json.routes[0];
            break;
          }
        }
      } catch {
        // Try next router
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    if (!route) {
      return fallback();
    }
      if (route?.geometry?.coordinates && Array.isArray(route.geometry.coordinates) && route.geometry.coordinates.length >= 2) {
        const rawCoords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        // Ověříme, že vrácená trasa nevede přímou čarou přes rybník nebo řeku bez mostu;
        // pokud OSRM vrátilo jen 2 body přes vodní plochu, zpřesníme ji lokální břehovou/mostní geometrií
        const localCheck = buildLocalRoutedGeometry(accessibleWaypoints, options);
        const coordinates = rawCoords.length <= accessibleWaypoints.length && localCheck.coordinates.length > rawCoords.length
          ? localCheck.coordinates
          : rawCoords;

        // Namapujeme indexy zastávek na nejbližší vrcholy geometrie trasy
        const stopTargets = accessibleWaypoints.map((w, wIdx) => {
          let bestCoordIdx = 0;
          let minD = Infinity;
          for (let cIdx = 0; cIdx < coordinates.length; cIdx++) {
            const d = haversineMeters(w, { lat: coordinates[cIdx][0], lng: coordinates[cIdx][1] }) ?? Infinity;
            if (d < minD) {
              minD = d;
              bestCoordIdx = cIdx;
            }
          }
          return {
            id: w.id || `wp_${wIdx}`,
            title: w.title || w.label || `Bod ${wIdx + 1}`,
            lat: w.lat,
            lng: w.lng,
            isShoreAccess: Boolean(w.isShoreAccess),
            waypointIndex: wIdx,
            coordIndex: bestCoordIdx,
          };
        });

        const osrmLegs = Array.isArray(route.legs) ? route.legs : [];
        const legs = [];
        for (let i = 0; i < accessibleWaypoints.length - 1; i++) {
          const sIdx = stopTargets[i].coordIndex;
          const eIdx = Math.max(sIdx, stopTargets[i + 1].coordIndex);
          const legCoords = coordinates.slice(sIdx, eIdx + 1);
          const legDist = osrmLegs[i]?.distance != null
            ? Math.round(Number(osrmLegs[i].distance))
            : computePolylineLengthM(legCoords);
          legs.push({
            fromIndex: i,
            toIndex: i + 1,
            fromId: accessibleWaypoints[i].id || `wp_${i}`,
            toId: accessibleWaypoints[i + 1].id || `wp_${i + 1}`,
            distanceM: legDist,
            coordinates: legCoords.length >= 2 ? legCoords : [[accessibleWaypoints[i].lat, accessibleWaypoints[i].lng], [accessibleWaypoints[i + 1].lat, accessibleWaypoints[i + 1].lng]],
            startCoordIdx: sIdx,
            endCoordIdx: eIdx,
          });
        }

        const steps = extractStepsFromOsrmRoute(route, coordinates, stopTargets);
        const distanceM = Math.round(Number(route.distance) || computePolylineLengthM(coordinates));
        const structuredRoadClasses = [];
        for (const legItem of osrmLegs) {
          for (const st of legItem?.steps || []) {
            if (Array.isArray(st?.intersections)) {
              for (const inter of st.intersections) {
                if (Array.isArray(inter?.classes)) {
                  for (const cls of inter.classes) {
                    if (typeof cls === 'string' && cls.trim()) structuredRoadClasses.push(cls.trim());
                  }
                }
              }
            }
          }
        }
        const roadTypeSummary = structuredRoadClasses.length > 0
          ? `Třídy cest z routeru: ${[...new Set(structuredRoadClasses)].join(', ')}`
          : 'Údaje o typu cesty nejsou k dispozici';
        const result = {
          coordinates,
          distanceM,
          legs,
          steps,
          stopTargets,
          mode: 'routed',
          routeStatus: 'routed_foot',
          routeStatusLabel: '🥾 Vypočteno pěším routerem (nezaručuje schůdnost ani bezpečný přístup)',
          roadTypeSummary,
          structuredRoadClasses: [...new Set(structuredRoadClasses)],
          isFallback: false,
          canSimulate: true,
        };
        if (fetchImpl === (typeof fetch !== 'undefined' ? fetch : null)) {
          walkingGeometryCache.set(cacheKey, result);
        }
        return result;
      }
  } catch {
    // Return fallback on network error or timeout
  }

  return fallback();
}

export function computePolylineLengthM(coords = []) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = Array.isArray(coords[i]) ? { lat: coords[i][0], lng: coords[i][1] } : coords[i];
    const b = Array.isArray(coords[i + 1]) ? { lat: coords[i + 1][0], lng: coords[i + 1][1] } : coords[i + 1];
    total += haversineMeters(a, b) ?? 0;
  }
  return Math.round(total);
}

/**
 * Vypočítá zbývající vzdálenost, vzdálenost k další zastávce a zbývající čas PŘÍMO ze společné pěší trasy
 * (`sharedRoute`) od aktuální polohy hráče přes dosud nepotvrzené zastávky (Základní pravidlo & Bod 28).
 * Pokud společná pěší trasa není k dispozici (`isFallback`), vrací `isRouteValid: false` a neslibuje falešnou hodnotu.
 */
export function computeRemainingFromSharedRoute({
  sharedRoute,
  currentPos,
  plannedPlaces = [],
  confirmedStopIds = [],
  companionMode = 'solo',
  returnToOrigin = false,
  origin = null,
}) {
  const confirmedSet = new Set(
    Array.isArray(confirmedStopIds)
      ? confirmedStopIds
      : confirmedStopIds instanceof Set
      ? [...confirmedStopIds]
      : []
  );

  const unvisited = (plannedPlaces || []).filter(p => p && !confirmedSet.has(p.id));
  if (unvisited.length === 0) {
    return {
      isRouteValid: Boolean(sharedRoute && !sharedRoute.isFallback),
      nextStop: null,
      nextStopDistanceM: 0,
      remainingDistanceM: 0,
      remainingMinutes: 0,
    };
  }

  const nextStop = unvisited[0];
  const nextStopAccessible = resolveAccessibleStopLocation(nextStop) || nextStop;
  const isSlower = companionMode === 'stroller' || companionMode === 'family';
  const speedMpm = isSlower ? (3200 / 60) : (4000 / 60);

  // Pokud nemáme vypočtenou pěší trasu (pouze vzdušný fallback), přiznáme nedostupnost pěší trasy
  const isRouted = sharedRoute && !sharedRoute.isFallback && (sharedRoute.mode === 'routed' || sharedRoute.mode === 'routed_foot' || sharedRoute.routeStatus === 'routed_foot');
  if (!isRouted || !Array.isArray(sharedRoute.coordinates) || sharedRoute.coordinates.length < 2) {
    const directNextM = currentPos ? haversineMeters(currentPos, nextStopAccessible) : null;
    return {
      isRouteValid: false,
      nextStop,
      nextStopDistanceM: directNextM != null ? Math.round(directNextM) : null,
      remainingDistanceM: null,
      remainingMinutes: null,
    };
  }

  const coords = sharedRoute.coordinates;
  const stopTargets = Array.isArray(sharedRoute.stopTargets) ? sharedRoute.stopTargets : [];

  // Najdeme index vrcholu na geometrii trasy odpovídající další nepotvrzené zastávce
  const nextTargetMeta = stopTargets.find(st => st.id === nextStop.id && st.waypointIndex > 0) || stopTargets[1] || null;
  const nextStopCoordIdx = nextTargetMeta ? nextTargetMeta.coordIndex : coords.length - 1;

  // Najdeme vrchol na geometrii trasy nejbližší aktuální poloze hráče (před nebo u nextStopCoordIdx)
  let playerCoordIdx = 0;
  let distToRouteM = 0;
  if (currentPos && Number.isFinite(currentPos.lat) && Number.isFinite(currentPos.lng)) {
    let minD = Infinity;
    const searchLimit = Math.min(coords.length - 1, Math.max(nextStopCoordIdx, 1));
    for (let i = 0; i <= searchLimit; i++) {
      const d = haversineMeters(currentPos, { lat: coords[i][0], lng: coords[i][1] }) ?? Infinity;
      if (d < minD) {
        minD = d;
        playerCoordIdx = i;
      }
    }
    distToRouteM = minD < 500 ? minD : 0;
  }

  // Vzdálenost po pěší trase od hráče k další zastávce
  const sliceToNext = coords.slice(playerCoordIdx, Math.max(playerCoordIdx + 1, nextStopCoordIdx + 1));
  const nextStopDistanceM = Math.round(distToRouteM + computePolylineLengthM(sliceToNext));

  // Celková zbývající vzdálenost po pěší trase od hráče až do konce trasy (včetně návratu na start u okruhu)
  const sliceToEnd = coords.slice(playerCoordIdx);
  const remainingDistanceM = Math.round(distToRouteM + computePolylineLengthM(sliceToEnd));
  const remainingMinutes = remainingDistanceM > 0 ? Math.max(1, Math.round(remainingDistanceM / speedMpm)) : 0;

  return {
    isRouteValid: true,
    nextStop,
    nextStopDistanceM,
    remainingDistanceM,
    remainingMinutes,
  };
}

/**
 * Fetches elevation profile from open-meteo API with 4s timeout.
 * Coordinates are rounded to 3 decimal places.
 * Fails safely returning { elevationGainM: null, verified: false } when offline or on error.
 */
export async function fetchElevationProfile(points, fetchImpl = typeof fetch !== 'undefined' ? fetch : null) {
  if (!Array.isArray(points) || points.length < 1 || !fetchImpl) {
    return { elevationGainM: null, currentElevationM: null, verified: false };
  }

  try {
    const validPoints = points.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validPoints.length < 1) return { elevationGainM: null, currentElevationM: null, verified: false };

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
      if (!res || !res.ok) return { elevationGainM: null, currentElevationM: null, verified: false };
      const data = await res.json();
      if (!Array.isArray(data?.elevation) || data.elevation.length < 1) {
        return { elevationGainM: null, currentElevationM: null, verified: false };
      }
      const firstElev = Number.isFinite(Number(data.elevation[0])) ? Math.round(Number(data.elevation[0])) : null;
      let gain = 0;
      let loss = 0;
      for (let i = 1; i < data.elevation.length; i++) {
        const diff = data.elevation[i] - data.elevation[i - 1];
        if (Number.isFinite(diff)) {
          if (diff > 0) gain += diff;
          else loss += Math.abs(diff);
        }
      }
      return {
        currentElevationM: firstElev,
        elevationGainM: Math.round(gain),
        elevationLossM: Math.round(loss),
        elevations: data.elevation,
        verified: false,
        source: 'open-meteo-waypoints',
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    return { elevationGainM: null, currentElevationM: null, verified: false };
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
 */
export function encodeRouteShareCode(plan, availablePlaces = []) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Neplatný plán pro sdílení.');
  }

  const selectedIds = Array.isArray(plan.selectedPlaceIds)
    ? plan.selectedPlaceIds.filter(p => typeof p === 'string').slice(0, 10)
    : [];

  const placeMap = new Map();
  if (Array.isArray(availablePlaces)) {
    for (const p of availablePlaces) {
      if (p && p.id) placeMap.set(p.id, p);
    }
  }
  if (Array.isArray(plan.stops)) {
    for (const p of plan.stops) {
      if (p && p.id && !placeMap.has(p.id)) placeMap.set(p.id, p);
    }
  }

  const stopSnapshots = [];
  for (const id of selectedIds) {
    const found = placeMap.get(id);
    if (found && Number.isFinite(found.lat) && Number.isFinite(found.lng)) {
      stopSnapshots.push([
        id,
        String(found.title || id).slice(0, 80),
        Number(found.lat.toFixed(5)),
        Number(found.lng.toFixed(5)),
        String(found.kind || 'forest'),
      ]);
    }
  }

  const payload = {
    v: 1,
    o: plan.origin && Number.isFinite(plan.origin.lat) && Number.isFinite(plan.origin.lng)
      ? [Number(plan.origin.lat.toFixed(4)), Number(plan.origin.lng.toFixed(4))]
      : null,
    r: Number(plan.radiusKm) || 10,
    c: Array.isArray(plan.categories) ? plan.categories.filter(c => typeof c === 'string').slice(0, 10) : [],
    p: selectedIds,
    m: COMPANION_MODES.includes(plan.companionMode) ? plan.companionMode : 'solo',
    e: EXPLORATION_MODES.includes(plan.explorationMode) ? plan.explorationMode : 'focus',
    ret: Boolean(plan.returnToOrigin),
  };

  if (stopSnapshots.length === selectedIds.length && stopSnapshots.length > 0) {
    payload.s = stopSnapshots;
  }

  return `CZK1-${toBase64Url(JSON.stringify(payload))}`;
}

/**
 * Decodes and validates a shareable route code (Bod 9).
 */
export function decodeRouteShareCode(code, knownPlaces = null) {
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
    if (
      !Array.isArray(parsed.o) ||
      parsed.o.length !== 2 ||
      !Number.isFinite(parsed.o[0]) ||
      !Number.isFinite(parsed.o[1]) ||
      Math.abs(parsed.o[0]) > 85 ||
      Math.abs(parsed.o[1]) > 180
    ) {
      throw new Error('Neplatné souřadnice startu.');
    }
    origin = { id: 'shared-origin', label: `Sdílený start [${parsed.o[0]}, ${parsed.o[1]}]`, lat: parsed.o[0], lng: parsed.o[1] };
  }

  if (!Array.isArray(parsed.p) || parsed.p.some(id => typeof id !== 'string' || !id.trim() || id.length > 100)) {
    throw new Error('Neplatný seznam míst.');
  }

  if (!COMPANION_MODES.includes(parsed.m)) {
    throw new Error('Neplatný režim parťáka.');
  }

  if (!EXPLORATION_MODES.includes(parsed.e)) {
    throw new Error('Neplatný herní režim.');
  }

  const selectedPlaceIds = parsed.p.slice(0, 10);
  const embeddedStops = [];
  if (Array.isArray(parsed.s)) {
    for (const item of parsed.s) {
      if (
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'string' &&
        Number.isFinite(item[2]) &&
        Number.isFinite(item[3]) &&
        Math.abs(item[2]) <= 85 &&
        Math.abs(item[3]) <= 180
      ) {
        embeddedStops.push({
          id: item[0],
          title: item[1],
          lat: item[2],
          lng: item[3],
          kind: typeof item[4] === 'string' ? item[4] : 'forest',
          pointKind: 'place',
          collectible: true,
        });
      }
    }
  }

  const decodedPlan = {
    origin,
    radiusKm: [1, 2, 3, 5, 10].includes(Number(parsed.r)) ? Number(parsed.r) : 10,
    categories: Array.isArray(parsed.c) ? parsed.c.filter(c => typeof c === 'string') : [],
    selectedPlaceIds,
    companionMode: parsed.m,
    explorationMode: parsed.e,
    returnToOrigin: Boolean(parsed.ret),
    embeddedStops,
  };

  if (Array.isArray(knownPlaces)) {
    validateDecodedRoutePlan(decodedPlan, knownPlaces);
  }

  return decodedPlan;
}

/**
 * Ověří úplnost sdílené trasy před jejím nastavením (Bod 9).
 */
export function validateDecodedRoutePlan(decodedPlan, knownPlaces = []) {
  if (!decodedPlan || !Array.isArray(decodedPlan.selectedPlaceIds)) {
    throw new Error('Neplatný sdílený plán trasy.');
  }
  const knownIds = new Set((knownPlaces || []).map(p => p?.id).filter(Boolean));
  const embeddedMap = new Map((decodedPlan.embeddedStops || []).map(s => [s.id, s]));

  const missingIds = decodedPlan.selectedPlaceIds.filter(id => !knownIds.has(id) && !embeddedMap.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Sdílená trasa je neúplná: ${missingIds.length} zastávek (${missingIds.join(', ')}) v tomto zařízení chybí. Původní plán zůstal zachován.`
    );
  }
  return true;
}