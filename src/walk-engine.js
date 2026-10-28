import { haversineMeters } from './domain.js';
import { resolveAccessibleStopLocation } from './natural-features.js';

const R = 6378137, RAD = Math.PI / 180;
export const CELL_SIZE = 128; // Mercator metres; about 83 ground metres in Rožmitál.
export const MAX_CELLS = 12000;
export const MAX_GPS_ACCURACY_M = 40; // Maximální povolená nepřesnost GPS pro průzkum (40 m)
export const FOG_REVEAL_RADIUS_M = 65; // Samostatný dosah vykreslovaného odkrytí v mlze (65 m)
export const STOP_CONFIRM_RADIUS_M = 20; // Jednotný dosah pro potvrzení zastávky podle GPS (< 20 m, opakované vzorky)
export const NEARBY_RECORD_RADIUS_M = 60; // Dosah pro zaznamenání průchodu v okolí dle GPS (<= 60 m, opakované vzorky; žádné umělé pásmo 21-45 m)
export const MAX_WALK_SEGMENTS = 600;
export const MAX_POINTS_PER_SEGMENT = 1500;

export const VISIT_RECORD_TYPES = Object.freeze({
  gps_stop: {
    id: 'gps_stop',
    badge: '📍 Potvrzeno podle GPS',
    shortBadge: '📍 Potvrzeno podle GPS (zastávka)',
    explanation: 'Opakované kvalitní měření GPS v dosahu zastávky. GPS měří přiblížení v terénu (nedokazuje vstup do objektu ani překročení břehu).',
  },
  gps_nearby: {
    id: 'gps_nearby',
    badge: '📍 Zaznamenáno poblíž (dle GPS)',
    shortBadge: '📍 Zaznamenáno poblíž (dle GPS)',
    explanation: 'Průchod v okolí zaznamenaný opakovanými vzorky GPS. GPS měří přiblížení v terénu (nedokazuje fyzický vstup).',
  },
  user_memory: {
    id: 'user_memory',
    badge: '✨ Vlastnoruční vzpomínka uživatele',
    shortBadge: '✨ Vlastní poznámka uživatele',
    explanation: 'Soukromý záznam uložený samotným uživatelem — nejde o GPS ověřenou památku.',
  },
});

export function classifyVisitRecord(itemOrId, context = {}) {
  if (itemOrId && typeof itemOrId === 'object' && (itemOrId.isUserMemory || itemOrId.recordType === 'user_memory')) {
    return { ...VISIT_RECORD_TYPES.user_memory, recordType: 'user_memory' };
  }
  const id = typeof itemOrId === 'string' ? itemOrId : itemOrId?.id;
  const confirmedSet = context.confirmedStopIds instanceof Set
    ? context.confirmedStopIds
    : new Set(Array.isArray(context.confirmedStopIds) ? context.confirmedStopIds : []);
  const discoveriesSet = context.discoveries instanceof Set
    ? context.discoveries
    : new Set(Array.isArray(context.discoveries) ? context.discoveries : []);

  if (id && confirmedSet.has(id)) {
    return { ...VISIT_RECORD_TYPES.gps_stop, recordType: 'gps_stop' };
  }
  if (id && (discoveriesSet.has(id) || discoveriesSet.has(`catalog:${id}`))) {
    return { ...VISIT_RECORD_TYPES.gps_nearby, recordType: 'gps_nearby' };
  }
  return null;
}

export const emptyWalk = () => ({ version: 1, cells: [], meters: 0, discoveries: [], walkSegments: [], revealedFeatures: [] });

export function project(p) {
  return { x: R * p.lng * RAD, y: R * Math.log(Math.tan(Math.PI / 4 + p.lat * RAD / 2)) };
}

export function unproject(x, y) {
  return { lng: x / R / RAD, lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / RAD };
}

export function cellId(p) {
  const q = project(p);
  return `${Math.floor(q.x / CELL_SIZE)}:${Math.floor(q.y / CELL_SIZE)}`;
}

export function cellCenter(id) {
  const [x, y] = id.split(':').map(Number);
  return unproject((x + 0.5) * CELL_SIZE, (y + 0.5) * CELL_SIZE);
}

export function cellBounds(id) {
  const [x, y] = id.split(':').map(Number);
  return [unproject(x * CELL_SIZE, y * CELL_SIZE), unproject((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE)];
}

/**
 * Připojí bod k souvislým úsekům chůze (`walkSegments`).
 * Pokud je `startNewSegment === true` (např. po startu, pauze, výpadku GPS nebo skoku),
 * založí nový nespojený úsek, aby se nikdy nepropojila místa přes neprojité území (Bod 30 & 31).
 */
export function appendToWalkSegments(segments = [], pt, startNewSegment = false) {
  if (!pt || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) {
    return Array.isArray(segments) ? segments : [];
  }
  const cleanPt = [Math.round(pt.lat * 1e6) / 1e6, Math.round(pt.lng * 1e6) / 1e6];
  const list = Array.isArray(segments) ? segments.map(s => (Array.isArray(s) ? [...s] : [])).filter(s => s.length > 0) : [];

  if (startNewSegment || list.length === 0) {
    return [...list, [cleanPt]].slice(-MAX_WALK_SEGMENTS);
  }

  const lastSeg = list[list.length - 1];
  const lastPt = lastSeg[lastSeg.length - 1];
  if (lastPt) {
    const dist = haversineMeters({ lat: lastPt[0], lng: lastPt[1] }, { lat: cleanPt[0], lng: cleanPt[1] }) ?? 0;
    // Ignorujeme mikroskopické posuny < 1,5 m
    if (dist < 1.5) return list;
    // Pokud by vzdálenost mezi body přesáhla 180 m bez mezibodů, začneme raději nový úsek
    if (dist > 180) {
      return [...list, [cleanPt]].slice(-MAX_WALK_SEGMENTS);
    }
  }

  lastSeg.push(cleanPt);
  if (lastSeg.length > MAX_POINTS_PER_SEGMENT) {
    lastSeg.splice(0, lastSeg.length - MAX_POINTS_PER_SEGMENT);
  }
  return list.slice(-MAX_WALK_SEGMENTS);
}

/**
 * Vypočítá rozmístění střídavých levých a pravých stop bot (`side: 'L' | 'R'`)
 * podél skutečně prošlých souvislých úseků GPS (`walkSegments`) s hustotou přizpůsobenou přiblížení mapy (Bod 30).
 * Nikdy nespojuje nesouvislé úseky po výpadku GPS nebo teleportu.
 */
export function computeFootprintPlacements(walkSegments = [], zoom = 16) {
  if (!Array.isArray(walkSegments) || walkSegments.length === 0) return [];

  // Rozestup stop v metrech podle zoomu, aby mapa nebyla přeplněná
  const z = Number.isFinite(Number(zoom)) ? Number(zoom) : 16;
  const stepSpacingM =
    z >= 18 ? 16 :
    z >= 17 ? 24 :
    z >= 16 ? 38 :
    z >= 15 ? 65 :
    z >= 14 ? 115 : 220;

  const footprints = [];
  let isLeft = true;

  for (let sIdx = 0; sIdx < walkSegments.length; sIdx++) {
    const seg = walkSegments[sIdx];
    if (!Array.isArray(seg) || seg.length < 2) continue;

    let distCarry = stepSpacingM * 0.65; // První stopa brzy po začátku úseku

    for (let i = 0; i < seg.length - 1; i++) {
      const p1 = Array.isArray(seg[i]) ? { lat: seg[i][0], lng: seg[i][1] } : seg[i];
      const p2 = Array.isArray(seg[i + 1]) ? { lat: seg[i + 1][0], lng: seg[i + 1][1] } : seg[i + 1];
      if (!p1 || !p2 || !Number.isFinite(p1.lat) || !Number.isFinite(p2.lat)) continue;

      const segLen = haversineMeters(p1, p2) ?? 0;
      if (segLen < 0.5 || segLen > 250) continue;

      // Směr chůze (azimut ve stupních)
      const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
      const lat1 = (p1.lat * Math.PI) / 180;
      const lat2 = (p2.lat * Math.PI) / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      const bearingDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

      let d = stepSpacingM - distCarry;
      while (d <= segLen) {
        const t = d / segLen;
        const lat = p1.lat + (p2.lat - p1.lat) * t;
        const lng = p1.lng + (p2.lng - p1.lng) * t;
        footprints.push({
          lat,
          lng,
          bearingDeg: Math.round(bearingDeg),
          side: isLeft ? 'L' : 'R',
          segmentIndex: sIdx,
        });
        isLeft = !isLeft;
        d += stepSpacingM;
      }
      distCarry = segLen - (d - stepSpacingM);
    }
  }

  return footprints.slice(-400);
}

/**
 * Vrátí všechny průzkumné buňky ležící na úsečce z bodu `from` do bodu `to`
 * (včetně obou koncových bodů), aby při chůzi ani při zrychlené simulaci nevznikaly díry v odkrytí.
 */
export function cellsAlongSegment(from, to, maxStepM = 20) {
  if (!from || !to || !Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) {
    return [];
  }
  const dist = haversineMeters(from, to) ?? 0;
  const steps = Math.max(1, Math.min(200, Math.ceil(dist / Math.max(5, maxStepM))));
  const ids = [];
  const seen = new Set();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = {
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    };
    const id = cellId(pt);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function parseWalk(raw) {
  if (raw == null) return emptyWalk();
  const p = JSON.parse(raw);
  if (
    p?.version !== 1 ||
    !Array.isArray(p.cells) ||
    p.cells.length > MAX_CELLS ||
    p.cells.some(
      id => typeof id !== 'string' || !/^[-\d]+:[-\d]+$/.test(id) || id.split(':').some(v => !Number.isInteger(Number(v)) || Math.abs(Number(v)) > 156544)
    ) ||
    new Set(p.cells).size !== p.cells.length ||
    !Number.isFinite(p.meters) ||
    p.meters < 0 ||
    p.meters > 1e9 ||
    !Array.isArray(p.discoveries) ||
    p.discoveries.length > 5000 ||
    p.discoveries.some(id => typeof id !== 'string' || !/^[-a-zA-Z0-9:/]{1,100}$/.test(id))
  ) {
    throw new Error('Uložený průzkum nelze přečíst. Data zachována; před resetem si je exportuj.');
  }
  return {
    version: 1,
    cells: p.cells,
    meters: p.meters,
    discoveries: [...new Set(p.discoveries)],
    walkSegments: Array.isArray(p.walkSegments) ? p.walkSegments : [],
    revealedFeatures: Array.isArray(p.revealedFeatures) ? p.revealedFeatures : [],
  };
}

/**
 * Pure scoring function: F(c, m, d) = 10 * c + Math.floor(m / 50) + 25 * Math.floor(c / 6) + 30 * d
 */
export function scoreWalk(c = 0, m = 0, d = 0) {
  const cellsCount = Math.max(0, Number(c) || 0);
  const metersCount = Math.max(0, Number(m) || 0);
  const discoveriesCount = Math.max(0, Number(d) || 0);
  return 10 * cellsCount + Math.floor(metersCount / 50) + 25 * Math.floor(cellsCount / 6) + 30 * discoveriesCount;
}

export function score(p) {
  if (!p) return 0;
  const c = Array.isArray(p.cells) ? p.cells.length : (Number(p.cells) || 0);
  const m = Number(p.meters) || 0;
  const d = Array.isArray(p.discoveries) ? p.discoveries.length : (Number(p.discoveries) || 0);
  return scoreWalk(c, m, d);
}

/**
 * Calculates total score including legacy baseline preservation:
 * Total = Math.max(0, legacyScore + F(current) - F(baseline))
 */
export function totalScore(stateOrProgress = emptyWalk(), legacyScore = 0, baseline = null) {
  if (stateOrProgress && stateOrProgress.schemaVersion === 2) {
    const legScore = Math.max(0, Number(stateOrProgress.legacyScore) || 0);
    const base = stateOrProgress.baseline;
    const currentF = score(stateOrProgress);
    const baselineF = base ? score(base) : 0;
    return Math.max(0, legScore + Math.max(0, currentF - baselineF));
  }
  if (legacyScore || baseline) {
    const currentF = score(stateOrProgress);
    const baselineF = baseline ? score(baseline) : 0;
    return Math.max(0, Math.max(0, Number(legacyScore) || 0) + Math.max(0, currentF - baselineF));
  }
  return Math.max(0, score(stateOrProgress));
}

/**
 * Jednotný výpočet bodového přírůstku výpravy (Bod 7):
 * Používá tutéž funkci scoreWalk(cells, meters, discoveries) jako celkové skóre v pasu,
 * včetně bonusu +25 b. za každých 6 odkrytých dílků.
 */
export function expeditionPointsDelta(expedition, currentProgress) {
  if (!expedition || !currentProgress) return 0;
  const startC = Math.max(0, Number(expedition.startCells) || 0);
  const startM = Math.max(0, Number(expedition.startMeters) || 0);
  const startD = Math.max(0, Number(expedition.startDiscoveries) || 0);

  const curC = Array.isArray(currentProgress.cells) ? currentProgress.cells.length : Math.max(0, Number(currentProgress.cells) || 0);
  const curM = Math.max(0, Number(currentProgress.meters) || 0);
  const curD = Array.isArray(currentProgress.discoveries) ? currentProgress.discoveries.length : Math.max(0, Number(currentProgress.discoveries) || 0);

  return Math.max(0, scoreWalk(curC, curM, curD) - scoreWalk(startC, startM, startD));
}

export function trophies(p) {
  const cellsCount = Array.isArray(p?.cells) ? p.cells.length : 0;
  const metersCount = Number(p?.meters) || 0;
  const discCount = Array.isArray(p?.discoveries) ? p.discoveries.length : 0;
  return [
    ['first', 'První stopa', cellsCount >= 1, 'Prozkoumej první dílek'],
    ['scout', 'Průzkumník', cellsCount >= 6, 'Prozkoumej 6 dílků'],
    ['kilometer', 'Kilometr venku', metersCount >= 1000, 'Nasbírej 1 km chůze'],
    ['wanderer', 'Tulák', cellsCount >= 25, 'Prozkoumej 25 dílků'],
    ['three', 'Dál než včera', metersCount >= 3000, 'Nasbírej 3 km chůze'],
    ['place', 'Místní objev', discCount >= 1, 'Přibliž se k načtenému skutečnému místu'],
  ].map(([id, title, earned, goal]) => ({ id, title, earned, goal }));
}

/**
 * Kompletní validace vzorku GPS podle 4 kritérií (DÁVKA 1 v1.4-part1, Bod 3.2):
 * (a) platné číselné souřadnice lat/lng (a kladná konečná accuracy + timestamp),
 * (b) časová následnost (timestamp není starší než předchozí přijatý vzorek),
 * (c) přesnost accuracy <= 40 m (MAX_GPS_ACCURACY_M),
 * (d) přiměřená rychlost posunu vůči času (odfiltruje nereálné GPS teleporty).
 */
export function validateGpsSample(fix, lastAcceptedFix = null, now = Date.now()) {
  // (a) Platné číselné souřadnice lat/lng
  if (
    !fix ||
    !['lat', 'lng', 'accuracy', 'timestamp'].every(k => Number.isFinite(fix[k])) ||
    Math.abs(fix.lat) > 85 ||
    Math.abs(fix.lng) > 180 ||
    fix.accuracy < 0
  ) {
    return { valid: false, criterion: 'coords', failedCriterion: 'coords', reason: 'Neplatná GPS poloha.' };
  }

  // (b) Časová následnost (timestamp není starší než předchozí přijatý vzorek)
  if (lastAcceptedFix && Number.isFinite(lastAcceptedFix.timestamp)) {
    if (fix.timestamp < lastAcceptedFix.timestamp) {
      return {
        valid: false,
        criterion: 'timestamp',
        failedCriterion: 'timestamp',
        nonMonotonic: true,
        reason: 'Vzorek GPS má starší časové razítko než předchozí přijatý bod.',
      };
    }
    if (fix.timestamp === lastAcceptedFix.timestamp) {
      return {
        valid: false,
        criterion: 'timestamp',
        failedCriterion: 'timestamp',
        duplicateTimestamp: true,
        reason: 'Čekám na novou polohu.',
      };
    }
  }

  // (c) Přesnost accuracy <= 40 m
  if (fix.accuracy > MAX_GPS_ACCURACY_M) {
    return {
      valid: false,
      criterion: 'accuracy',
      failedCriterion: 'accuracy',
      pausedByAccuracy: true,
      accuracyM: Math.round(fix.accuracy),
      maxAccuracyM: MAX_GPS_ACCURACY_M,
      reason: `Průzkum pozastaven: nepřesnost GPS (±${Math.round(fix.accuracy)} m) překračuje povolený limit ${MAX_GPS_ACCURACY_M} m. (Dosah odkrývání v mlze je ${FOG_REVEAL_RADIUS_M} m.)`,
    };
  }

  if (now - fix.timestamp > 15000 || fix.timestamp > now + 5000) {
    return {
      valid: false,
      criterion: 'stale',
      failedCriterion: 'stale',
      staleFix: true,
      reason: 'Čekám na čerstvou GPS polohu.',
    };
  }

  // (d) Přiměřená rychlost posunu vůči času (odfiltruje nereálné GPS teleporty)
  if (Number.isFinite(fix.speed) && fix.speed > 3.5) {
    return {
      valid: false,
      criterion: 'speed',
      failedCriterion: 'speed',
      speedJump: true,
      reason: 'Příliš vysoká rychlost. Počkej, až se budeš pohybovat pěšky.',
    };
  }

  if (lastAcceptedFix && Number.isFinite(lastAcceptedFix.lat) && Number.isFinite(lastAcceptedFix.lng) && Number.isFinite(lastAcceptedFix.timestamp)) {
    const dtSec = (fix.timestamp - lastAcceptedFix.timestamp) / 1000;
    if (dtSec > 0 && dtSec <= 60) {
      const distM = haversineMeters(lastAcceptedFix, fix) ?? 0;
      const impliedSpeedMs = distM / dtSec;
      if (impliedSpeedMs > 3.5) {
        return {
          valid: false,
          criterion: 'speed',
          failedCriterion: 'speed',
          speedJump: true,
          reason: 'Příliš rychlý pohyb nebo skok GPS. Tento úsek nepočítáme.',
        };
      }
    }
  }

  return { valid: true, criterion: null, failedCriterion: null, reason: '' };
}

/**
 * GPS continuity handler for walk engine.
 * Separates lastValidFix from distanceAnchor to prevent false outages during slow walking.
 * Explicitly separates GPS accuracy limit (40 m) from fog reveal radius (65 m).
 * Preserves original measurement timestamp and sets `eligibleForVisit` independently (Bod 8).
 * Records continuous `walkSegments` for smooth corridor fog reveal and footprints (Body 30 & 31).
 */
export function acceptFix(progress, anchor, fix, now = Date.now()) {
  const currentLastValid = anchor?.lastValidFix || (anchor?.lat != null ? anchor : null);
  const currentDistanceAnchor = anchor?.distanceAnchor || (anchor?.lat != null ? anchor : null);

  const reject = (reason, extra = {}) => ({
    progress,
    anchor: anchor ? {
      lastValidFix: currentLastValid,
      distanceAnchor: currentDistanceAnchor,
      lat: currentDistanceAnchor?.lat ?? currentLastValid?.lat,
      lng: currentDistanceAnchor?.lng ?? currentLastValid?.lng,
      accuracy: currentDistanceAnchor?.accuracy ?? currentLastValid?.accuracy,
      timestamp: currentDistanceAnchor?.timestamp ?? currentLastValid?.timestamp,
    } : null,
    accepted: false,
    eligibleForVisit: false,
    reason,
    ...extra,
  });

  if (!fix || !['lat', 'lng', 'accuracy', 'timestamp'].every(k => Number.isFinite(fix[k])) ||
      Math.abs(fix.lat) > 85 || Math.abs(fix.lng) > 180 || fix.accuracy < 0) {
    return reject('Neplatná GPS poloha.');
  }

  // Check temporal sequence before accepting
  if (currentLastValid && Number.isFinite(currentLastValid.timestamp) && fix.timestamp < currentLastValid.timestamp) {
    return reject('Vzorek GPS má starší časové razítko než předchozí přijatý bod.', { nonMonotonic: true });
  }

  if (fix.accuracy > MAX_GPS_ACCURACY_M) {
    return reject(
      `Průzkum pozastaven: nepřesnost GPS (±${Math.round(fix.accuracy)} m) překračuje povolený limit ${MAX_GPS_ACCURACY_M} m. (Dosah odkrývání v mlze je ${FOG_REVEAL_RADIUS_M} m.)`,
      { pausedByAccuracy: true, accuracyM: Math.round(fix.accuracy), maxAccuracyM: MAX_GPS_ACCURACY_M, fogRadiusM: FOG_REVEAL_RADIUS_M }
    );
  }

  if (now - fix.timestamp > 15000 || fix.timestamp > now + 5000) {
    return reject('Čekám na čerstvou GPS polohu.', { staleFix: true });
  }

  // Session start (first valid sample or after pause/teleport)
  if (!currentLastValid || !currentDistanceAnchor) {
    if (Number.isFinite(fix.speed) && fix.speed > 3.5) {
      return reject('Příliš vysoká rychlost. Počkej, až se budeš pohybovat pěšky.', { speedJump: true });
    }
    const id = cellId(fix);
    const fresh = !progress.cells.includes(id);
    if (fresh && progress.cells.length >= MAX_CELLS) {
      return reject('Dosažen limit místního pilotu. Exportuj svůj průzkum.');
    }
    const nextWalkSegments = appendToWalkSegments(progress.walkSegments, fix, true);
    const nextProgress = {
      ...progress,
      cells: fresh ? [...progress.cells, id] : progress.cells,
      meters: progress.meters,
      walkSegments: nextWalkSegments,
    };
    const newAnchor = {
      lastValidFix: fix,
      distanceAnchor: fix,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      timestamp: fix.timestamp,
      speed: fix.speed,
      needsNewSegment: false,
    };
    const mystery = fresh && nextProgress.cells.length % 6 === 0;
    return {
      progress: nextProgress,
      anchor: newAnchor,
      accepted: true,
      eligibleForVisit: true,
      fresh,
      mystery,
      metersAdded: 0,
      reason: mystery
        ? 'Mystery nález! Odhalil/a jsi další fragment příběhu. +25 bodů'
        : fresh
        ? 'Nový dílek mapy! +10 bodů'
        : 'Pokračuješ po známé cestě. Vzdálenost přibývá.',
    };
  }

  // Check continuity against lastValidFix
  const dtLast = (fix.timestamp - currentLastValid.timestamp) / 1000;
  if (dtLast <= 0) {
    return reject('Čekám na novou polohu.');
  }

  // True outage (> 60s without a valid fix) -> start new segment on next move!
  if (dtLast > 60) {
    const resetAnchor = {
      lastValidFix: fix,
      distanceAnchor: fix,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      timestamp: fix.timestamp,
      speed: fix.speed,
      needsNewSegment: true,
    };
    return {
      progress,
      anchor: resetAnchor,
      accepted: false,
      eligibleForVisit: false,
      outage: true,
      reason: 'GPS se vrátila po výpadku. Pokračuj v chůzi; mezeru nepočítáme.',
    };
  }

  // Speed jump check relative to lastValidFix
  const distFromLast = haversineMeters(currentLastValid, fix);
  if (distFromLast / dtLast > 3.5 || (Number.isFinite(fix.speed) && fix.speed > 3.5)) {
    const resetAnchor = {
      lastValidFix: fix,
      distanceAnchor: fix,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      timestamp: fix.timestamp,
      speed: fix.speed,
      needsNewSegment: true,
    };
    return {
      progress,
      anchor: resetAnchor,
      accepted: false,
      eligibleForVisit: false,
      speedJump: true,
      reason: 'Příliš rychlý pohyb nebo skok GPS. Tento úsek nepočítáme.',
    };
  }

  // Continuous movement: update lastValidFix
  const nextLastValid = fix;

  // Measure displacement from distanceAnchor
  const distFromAnchor = haversineMeters(currentDistanceAnchor, fix);
  // Threshold balances rejecting stationary jitter vs. crediting slow walking in forest terrain
  const threshold = Math.max(10, Math.min(28, (currentDistanceAnchor.accuracy + fix.accuracy) * 0.45));

  if (distFromAnchor < threshold) {
    // Even if sub-threshold for distance, if the walker crossed into a brand-new fog cell, reveal it!
    const currentId = cellId(fix);
    const crossedIntoNewCell = !progress.cells.includes(currentId) && progress.cells.length < MAX_CELLS;
    const subAnchor = {
      lastValidFix: nextLastValid,
      distanceAnchor: currentDistanceAnchor,
      lat: currentDistanceAnchor.lat,
      lng: currentDistanceAnchor.lng,
      accuracy: currentDistanceAnchor.accuracy,
      timestamp: currentDistanceAnchor.timestamp,
      needsNewSegment: anchor?.needsNewSegment || false,
    };
    if (crossedIntoNewCell) {
      let nextWalkSegments = progress.walkSegments;
      if (anchor?.needsNewSegment) {
        nextWalkSegments = appendToWalkSegments(nextWalkSegments, currentDistanceAnchor, true);
      }
      nextWalkSegments = appendToWalkSegments(nextWalkSegments, fix, false);
      const nextProgress = {
        ...progress,
        cells: [...progress.cells, currentId],
        walkSegments: nextWalkSegments,
      };
      subAnchor.needsNewSegment = false;
      const mystery = nextProgress.cells.length % 6 === 0;
      return {
        progress: nextProgress,
        anchor: subAnchor,
        accepted: true,
        eligibleForVisit: true,
        fresh: true,
        mystery,
        metersAdded: 0,
        reason: mystery
          ? 'Mystery nález! Odhalil/a jsi další fragment příběhu. +25 bodů'
          : 'Nový dílek mapy! +10 bodů',
      };
    }
    return {
      progress,
      anchor: subAnchor,
      accepted: false,
      eligibleForVisit: true,
      activeGps: true,
      reason: 'GPS běží. Pro další postup popojdi přibližně 20–60 metrů.',
    };
  }

  // Threshold reached: credit meters, uncover all cells along segment, record continuous walkSegment, and advance distanceAnchor
  const metersToAdd = Math.round(distFromAnchor);
  const segmentCellIds = cellsAlongSegment(currentDistanceAnchor, fix, 20);
  const newCells = [];
  for (const cid of segmentCellIds) {
    if (!progress.cells.includes(cid) && !newCells.includes(cid)) {
      newCells.push(cid);
    }
  }
  const id = cellId(fix);
  if (!progress.cells.includes(id) && !newCells.includes(id)) {
    newCells.push(id);
  }
  const fresh = newCells.length > 0;
  if (fresh && progress.cells.length + newCells.length > MAX_CELLS) {
    return reject('Dosažen limit místního pilotu. Exportuj svůj průzkum.');
  }

  let nextWalkSegments = progress.walkSegments;
  if (anchor?.needsNewSegment || !Array.isArray(nextWalkSegments) || nextWalkSegments.length === 0) {
    nextWalkSegments = appendToWalkSegments(nextWalkSegments, currentDistanceAnchor, true);
  }
  nextWalkSegments = appendToWalkSegments(nextWalkSegments, fix, false);

  const nextProgress = {
    ...progress,
    cells: fresh ? [...progress.cells, ...newCells] : progress.cells,
    meters: progress.meters + metersToAdd,
    walkSegments: nextWalkSegments,
  };

  const nextAnchor = {
    lastValidFix: nextLastValid,
    distanceAnchor: fix,
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    timestamp: fix.timestamp,
    speed: fix.speed,
    needsNewSegment: false,
  };

  const prevRelics = Math.floor(progress.cells.length / 6);
  const nextRelics = Math.floor(nextProgress.cells.length / 6);
  const mystery = fresh && nextRelics > prevRelics;
  return {
    progress: nextProgress,
    anchor: nextAnchor,
    accepted: true,
    eligibleForVisit: true,
    fresh,
    mystery,
    metersAdded: metersToAdd,
    reason: mystery
      ? 'Mystery nález! Odhalil/a jsi další fragment příběhu. +25 bodů'
      : fresh
      ? 'Nový dílek mapy! +10 bodů'
      : 'Pokračuješ po známé cestě. Vzdálenost přibývá.',
  };
}

export function isCollectiblePlace(place) {
  if (!place || typeof place !== 'object') return false;
  if (place.pointKind === 'route-start') return false;
  if (place.collectible === false) return false;
  const loc = place.location || place;
  if (!loc || loc.lat == null || loc.lng == null) return false;
  if (place.pointKind && place.pointKind !== 'place') return false;
  return place.collectible === true || place.collectible === undefined;
}

/**
 * Evaluates place GPS stamps with the 2-fix rule:
 * - Requires 2 valid fresh GPS fixes within 60 m of a collectible place (or <20 m confirmed stop)
 * - Spaced between 2 s and 60 s apart
 * - Accuracy <= 40 m
 * - One canonical discovery (+30 b.) per place in lifetime
 * - Uses shore access point if place is inside a pond (Bod 26 & 32)
 */
export function discoverNearby(progress, fix, places = [], pending = {}) {
  if (!fix || fix.accuracy > MAX_GPS_ACCURACY_M) return progress;
  const newDiscoveries = [];
  const now = fix.timestamp || Date.now();

  for (const p of places) {
    if (!isCollectiblePlace(p)) {
      if (pending[p.id]) delete pending[p.id];
      continue;
    }
    const loc = resolveAccessibleStopLocation(p) || p.location || p;
    if (!loc || loc.lat == null || loc.lng == null) continue;
    if (progress.discoveries.includes(p.id)) {
      if (pending[p.id]) delete pending[p.id];
      continue;
    }
    const dist = haversineMeters(fix, loc);
    if (dist != null && dist <= 60) {
      const prev = pending[p.id];
      if (!prev) {
        pending[p.id] = { timestamp: now, lat: fix.lat, lng: fix.lng, count: 1 };
      } else {
        const dt = (now - prev.timestamp) / 1000;
        const minWaitSec = dist < STOP_CONFIRM_RADIUS_M ? 2 : 10;
        if (dt >= minWaitSec && dt <= 60) {
          newDiscoveries.push(p.id);
          delete pending[p.id];
        } else if (dt > 60) {
          pending[p.id] = { timestamp: now, lat: fix.lat, lng: fix.lng, count: 1 };
        }
      }
    } else {
      if (pending[p.id]) delete pending[p.id];
    }
  }

  if (newDiscoveries.length === 0) return progress;
  return {
    ...progress,
    discoveries: [...new Set([...progress.discoveries, ...newDiscoveries])].slice(0, 5000),
  };
}

/**
 * Jednotné automatické potvrzování zastávek výpravy (Bod 19 & 26):
 * - Vyžaduje odhad vzdálenosti GPS pod 20 m (`STOP_CONFIRM_RADIUS_M = 20`) k přístupnému bodu zastávky
 *   (u vodních ploch k bodu na břehu / hrázi `accessPoint`, nikoli doprostřed rybníka).
 * - Potvrzeno opakovanými čerstvými a dostatečně přesnými měřeními (alespoň 2 vzorky s accuracy <= 40 m
 *   v odstupu 2 až 60 s; jeden nepřesný skok nestačí).
 * - Každá zastávka se zapíše a oznámí právě jednou.
 */
export function evaluateStopConfirmation(
  fix,
  plannedStops = [],
  arg3 = [],
  arg4 = {},
  now = fix?.timestamp || Date.now()
) {
  // Podpora obou pořadí argumentů: (fix, stops, confirmedIds, pendingObj) i (fix, stops, pendingObj, confirmedIds)
  const isArg3Confirmed = Array.isArray(arg3) || arg3 instanceof Set;
  const confirmedInput = isArg3Confirmed ? arg3 : arg4;
  const pendingInput = isArg3Confirmed ? arg4 : arg3;

  const currentConfirmed = Array.isArray(confirmedInput)
    ? [...confirmedInput]
    : confirmedInput instanceof Set
    ? [...confirmedInput]
    : [];
  const nextPending = pendingInput && typeof pendingInput === 'object' && !(pendingInput instanceof Set)
    ? pendingInput
    : {};
  const newlyConfirmedStops = [];
  const newlyConfirmedIds = [];

  if (
    !fix ||
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy > MAX_GPS_ACCURACY_M ||
    Math.abs(now - (fix.timestamp || now)) > 15000
  ) {
    const nextTargetStop = (plannedStops || []).find(s => s && !currentConfirmed.includes(s.id)) || null;
    return {
      confirmedStopIds: currentConfirmed,
      newlyConfirmedStops: [],
      newlyConfirmedIds: [],
      nextTargetStop,
      pendingStopConfirmations: nextPending,
    };
  }

  const fixTime = fix.timestamp || now;

  for (const stop of (plannedStops || [])) {
    if (!stop || !stop.id) continue;
    if (currentConfirmed.includes(stop.id)) {
      delete nextPending[stop.id];
      continue;
    }
    const loc = resolveAccessibleStopLocation(stop) || stop.location || stop;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;

    const dist = haversineMeters(fix, loc);
    if (dist != null && dist < STOP_CONFIRM_RADIUS_M) {
      const prev = nextPending[stop.id];
      if (!prev) {
        nextPending[stop.id] = {
          firstTimestamp: fixTime,
          lastTimestamp: fixTime,
          samples: 1,
          minDistM: Math.round(dist),
        };
      } else {
        const dt = (fixTime - prev.firstTimestamp) / 1000;
        if (dt >= 2 && dt <= 60) {
          currentConfirmed.push(stop.id);
          newlyConfirmedStops.push(stop);
          newlyConfirmedIds.push(stop.id);
          delete nextPending[stop.id];
        } else if (dt > 60) {
          nextPending[stop.id] = {
            firstTimestamp: fixTime,
            lastTimestamp: fixTime,
            samples: 1,
            minDistM: Math.round(dist),
          };
        } else {
          nextPending[stop.id] = {
            ...prev,
            lastTimestamp: fixTime,
            samples: (prev.samples || 1) + 1,
            minDistM: Math.min(prev.minDistM ?? Math.round(dist), Math.round(dist)),
          };
        }
      }
    } else {
      delete nextPending[stop.id];
    }
  }

  const nextTargetStop = (plannedStops || []).find(s => s && !currentConfirmed.includes(s.id)) || null;

  return {
    confirmedStopIds: currentConfirmed,
    newlyConfirmedStops,
    newlyConfirmedIds,
    nextTargetStop,
    pendingStopConfirmations: nextPending,
  };
}

/**
 * Čisté funkce pro úpravu zastávek (posun nahoru/dolů, nahrazení, odebrání) bez ztráty ušlé vzdálenosti a návštěv (Bod 19).
 */
export function reorderPlannedStops(selectedPlaceIds = [], index, directionOrTargetIndex) {
  const list = Array.isArray(selectedPlaceIds) ? [...selectedPlaceIds] : [];
  const targetIndex =
    directionOrTargetIndex === 'up'
      ? index - 1
      : directionOrTargetIndex === 'down'
      ? index + 1
      : typeof directionOrTargetIndex === 'number'
      ? directionOrTargetIndex
      : -1;
  if (index < 0 || index >= list.length || targetIndex < 0 || targetIndex >= list.length || index === targetIndex) {
    return list;
  }
  const [moved] = list.splice(index, 1);
  list.splice(targetIndex, 0, moved);
  return list;
}

export function replacePlannedStop(selectedPlaceIds = [], index, newPlaceId) {
  const list = Array.isArray(selectedPlaceIds) ? [...selectedPlaceIds] : [];
  if (index < 0 || index >= list.length || !newPlaceId || typeof newPlaceId !== 'string') {
    return list;
  }
  if (list.includes(newPlaceId) && list[index] !== newPlaceId) {
    return list;
  }
  list[index] = newPlaceId;
  return list;
}

export function removePlannedStop(selectedPlaceIds = [], placeIdOrIndex) {
  const list = Array.isArray(selectedPlaceIds) ? [...selectedPlaceIds] : [];
  if (typeof placeIdOrIndex === 'number') {
    if (placeIdOrIndex < 0 || placeIdOrIndex >= list.length) return list;
    list.splice(placeIdOrIndex, 1);
    return list;
  }
  return list.filter(id => id !== placeIdOrIndex);
}

/** Trail point retention: in-memory up to 1 hour (3600_000 ms), max 600 points.
 * Computes walking azimuth `bearing` and alternates `isLeft` (`side: 'L' | 'R'`) every ~8-12 m (ZADÁNÍ #08 Bod 3).
 */
export function appendTrail(trail, fix, now = Date.now()) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return Array.isArray(trail) ? trail : [];
  const fresh = (Array.isArray(trail) ? trail : []).filter(
    p => p && Number.isFinite(p.ts) && now - p.ts <= 3600_000 && p.ts <= now + 5000
  );
  const lastPt = fresh.length > 0 ? fresh[fresh.length - 1] : null;
  let bearing = Number.isFinite(fix.bearing) ? Math.round(fix.bearing) : 0;

  if (lastPt && !lastPt.segmentBreak && !fix.segmentBreak) {
    const dist = haversineMeters(lastPt, fix) ?? 0;
    // Pokud se hráč posunul o méně než 8 m a nejde o přerušení úseku, nepřidáváme novou stopu na totéž místo
    if (dist < 8 && fresh.length > 0 && !fix.forceTrailPoint) {
      return fresh;
    }
    if (dist >= 0.5) {
      const dLng = ((fix.lng - lastPt.lng) * Math.PI) / 180;
      const lat1 = (lastPt.lat * Math.PI) / 180;
      const lat2 = (fix.lat * Math.PI) / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      bearing = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    } else if (Number.isFinite(lastPt.bearing)) {
      bearing = lastPt.bearing;
    }
  }

  const nextIndex = fresh.length;
  const isLeft = nextIndex % 2 === 0;
  const point = {
    lat: Math.round(fix.lat * 1e5) / 1e5,
    lng: Math.round(fix.lng * 1e5) / 1e5,
    ts: now,
    bearing,
    isLeft,
    side: isLeft ? 'L' : 'R',
    segmentBreak: Boolean(fix.segmentBreak),
  };
  return pruneTrail([...fresh, point].slice(-600), now);
}

/** Prunes points older than 1h and returns them with computed fading opacity (0.85 down to 0.15) */
export function pruneTrail(trail, now = Date.now()) {
  const list = Array.isArray(trail) ? trail : [];
  return list
    .filter(p => p && Number.isFinite(p.ts) && now - p.ts <= 3600_000 && p.ts <= now + 5000)
    .map((p, idx) => {
      const age = Math.max(0, now - p.ts);
      const ratio = 1 - Math.min(1, age / 3600_000);
      const opacity = Math.round((0.15 + 0.70 * ratio) * 100) / 100;
      const isLeft = typeof p.isLeft === 'boolean' ? p.isLeft : idx % 2 === 0;
      return {
        lat: p.lat,
        lng: p.lng,
        ts: p.ts,
        bearing: Number.isFinite(p.bearing) ? p.bearing : 0,
        isLeft,
        side: p.side || (isLeft ? 'L' : 'R'),
        opacity,
        segmentBreak: p.segmentBreak,
      };
    });
}

/**
 * Explorer ranks: Cosmetic milestones.
 * fogRadiusM is fixed to standard 65m across all levels.
 */
export function explorerRank(totalPoints = 0) {
  const pts = Math.max(0, Number(totalPoints) || 0);
  if (pts < 200) {
    return { level: 1, title: 'Sváteční chodec', nextAt: 200, fogRadiusM: 65, revealDistanceM: 180 };
  } else if (pts < 500) {
    return { level: 2, title: 'Místní stopař', nextAt: 500, fogRadiusM: 65, revealDistanceM: 230 };
  } else if (pts < 1000) {
    return { level: 3, title: 'Průzkumník Třemšínska', nextAt: 1000, fogRadiusM: 65, revealDistanceM: 290 };
  } else if (pts < 2000) {
    return { level: 4, title: 'Strážce stezek', nextAt: 2000, fogRadiusM: 65, revealDistanceM: 360 };
  } else {
    return { level: 5, title: 'Král Brd', nextAt: null, fogRadiusM: 65, revealDistanceM: 450 };
  }
}

/**
 * Chapters status: tracks count of verified collectible stops (X z Y zastávek).
 * A chapter with 0 collectible points or incomplete verified stops is not completed.
 */
export function chapterStatus(chapters = {}, routes = [], discoveries = []) {
  const chapterList = Array.isArray(chapters) ? chapters : Object.values(chapters || {});
  const discSet = new Set(Array.isArray(discoveries) ? discoveries : Object.keys(discoveries || {}));
  const result = {};

  for (const ch of chapterList) {
    const chapterPlaces = (Array.isArray(routes) ? routes : []).filter(
      r => (r.chapter === ch.id || r.sector === ch.id) && r.pointKind === 'place' && r.collectible === true
    );
    const total = chapterPlaces.length;
    const completed = chapterPlaces.filter(r => discSet.has(r.id) || discSet.has(`catalog:${r.id}`)).length;
    const unlocked = total > 0 && completed === total;

    result[ch.id] = {
      id: ch.id,
      title: ch.title,
      total,
      completed,
      unlocked,
      isCompleted: unlocked,
      sealTitle: ch.sealTitle,
      center: ch.center,
      radiusM: ch.radiusM,
    };
  }
  return result;
}

export const sectorStatus = chapterStatus;

/** Daily challenge descriptor */
export function dailyChallenge(dateStr, progress = {}, sessionStats = {}, meta = {}) {
  const challenges = [
    { id: 'cells', title: 'Odkryj 3 nové dílky v mlze', target: 3, points: 50, metric: sessionStats?.cells ?? 0 },
    { id: 'distance', title: 'Ujdi na procházce alespoň 500 m', target: 500, points: 50, metric: sessionStats?.meters ?? 0 },
    { id: 'stamp', title: 'Získej 1 ověřené GPS razítko místa', target: 1, points: 80, metric: sessionStats?.stamps ?? sessionStats?.discoveries ?? 0 },
  ];
  let hash = 0;
  const str = String(dateStr || '');
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  const index = Math.abs(hash) % challenges.length;
  const ch = challenges[index];
  const progressVal = ch.metric || 0;
  const completed = progressVal >= ch.target;
  const claimed = Boolean(meta?.dailyClaimed?.includes(str));
  return { ...ch, date: str, progress: progressVal, completed, claimed };
}