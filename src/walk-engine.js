import { haversineMeters } from './domain.js';

const R = 6378137, RAD = Math.PI / 180;
export const CELL_SIZE = 128; // Mercator metres; about 83 ground metres in Rožmitál.
export const MAX_CELLS = 12000;

export const emptyWalk = () => ({ version: 1, cells: [], meters: 0, discoveries: [] });

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
  return { version: 1, cells: p.cells, meters: p.meters, discoveries: [...new Set(p.discoveries)] };
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
 * Total = legacyScore + F(current) - F(baseline)
 */
export function totalScore(stateOrProgress = emptyWalk(), legacyScore = 0, baseline = null) {
  if (stateOrProgress && stateOrProgress.schemaVersion === 2) {
    const legScore = Number(stateOrProgress.legacyScore) || 0;
    const base = stateOrProgress.baseline;
    const currentF = score(stateOrProgress);
    const baselineF = base ? score(base) : 0;
    return legScore + currentF - baselineF;
  }
  if (legacyScore || baseline) {
    const currentF = score(stateOrProgress);
    const baselineF = baseline ? score(baseline) : 0;
    return (Number(legacyScore) || 0) + currentF - baselineF;
  }
  return score(stateOrProgress);
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
 * GPS continuity handler for walk engine.
 * Separates lastValidFix from distanceAnchor to prevent false outages during slow walking.
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
    reason,
    ...extra,
  });

  if (!fix || !['lat', 'lng', 'accuracy', 'timestamp'].every(k => Number.isFinite(fix[k])) ||
      Math.abs(fix.lat) > 85 || Math.abs(fix.lng) > 180 || fix.accuracy < 0) {
    return reject('Neplatná GPS poloha.');
  }

  if (fix.accuracy > 40) {
    return reject(`GPS je nepřesná (±${Math.round(fix.accuracy)} m). Čekám na lepší signál.`);
  }

  if (now - fix.timestamp > 15000 || fix.timestamp > now + 5000) {
    return reject('Čekám na čerstvou GPS polohu.');
  }

  // Session start (first valid sample)
  if (!currentLastValid || !currentDistanceAnchor) {
    if (Number.isFinite(fix.speed) && fix.speed > 3.5) {
      return reject('Počkej, až se budeš pohybovat pěšky.');
    }
    const id = cellId(fix);
    const fresh = !progress.cells.includes(id);
    if (fresh && progress.cells.length >= MAX_CELLS) {
      return reject('Dosažen limit místního pilotu. Exportuj svůj průzkum.');
    }
    const nextProgress = {
      ...progress,
      cells: fresh ? [...progress.cells, id] : progress.cells,
      meters: progress.meters,
    };
    const newAnchor = {
      lastValidFix: fix,
      distanceAnchor: fix,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      timestamp: fix.timestamp,
      speed: fix.speed,
    };
    const mystery = fresh && nextProgress.cells.length % 6 === 0;
    return {
      progress: nextProgress,
      anchor: newAnchor,
      accepted: true,
      fresh,
      mystery,
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

  // True outage (> 60s without a valid fix)
  if (dtLast > 60) {
    const resetAnchor = {
      lastValidFix: fix,
      distanceAnchor: fix,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      timestamp: fix.timestamp,
      speed: fix.speed,
    };
    return {
      progress,
      anchor: resetAnchor,
      accepted: false,
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
    };
    return {
      progress,
      anchor: resetAnchor,
      accepted: false,
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
    // Sub-threshold movement: update lastValidFix to keep GPS session alive, keep distanceAnchor
    const subAnchor = {
      lastValidFix: nextLastValid,
      distanceAnchor: currentDistanceAnchor,
      lat: currentDistanceAnchor.lat,
      lng: currentDistanceAnchor.lng,
      accuracy: currentDistanceAnchor.accuracy,
      timestamp: currentDistanceAnchor.timestamp,
    };
    return {
      progress,
      anchor: subAnchor,
      accepted: false,
      activeGps: true,
      reason: 'GPS běží. Pro další postup popojdi přibližně 20–60 metrů.',
    };
  }

  // Threshold reached: credit meters and advance distanceAnchor
  const metersToAdd = Math.round(distFromAnchor);
  const id = cellId(fix);
  const fresh = !progress.cells.includes(id);
  if (fresh && progress.cells.length >= MAX_CELLS) {
    return reject('Dosažen limit místního pilotu. Exportuj svůj průzkum.');
  }

  const nextProgress = {
    ...progress,
    cells: fresh ? [...progress.cells, id] : progress.cells,
    meters: progress.meters + metersToAdd,
  };

  const nextAnchor = {
    lastValidFix: nextLastValid,
    distanceAnchor: fix,
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    timestamp: fix.timestamp,
    speed: fix.speed,
  };

  const mystery = fresh && nextProgress.cells.length % 6 === 0;
  return {
    progress: nextProgress,
    anchor: nextAnchor,
    accepted: true,
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
 * - Requires 2 valid fresh GPS fixes within 60 m of a collectible place
 * - Spaced between 10 s and 60 s apart
 * - Accuracy <= 40 m
 * - One canonical discovery (+30 b.) per place in lifetime
 */
export function discoverNearby(progress, fix, places = [], pending = {}) {
  if (!fix || fix.accuracy > 40) return progress;
  const newDiscoveries = [];
  const now = fix.timestamp || Date.now();

  for (const p of places) {
    if (!isCollectiblePlace(p)) {
      if (pending[p.id]) delete pending[p.id];
      continue;
    }
    const loc = p.location || p;
    if (!loc || loc.lat == null || loc.lng == null) continue;
    if (progress.discoveries.includes(p.id)) {
      if (pending[p.id]) delete pending[p.id];
      continue;
    }
    const dist = haversineMeters(fix, loc);
    if (dist != null && dist <= 60) {
      const prev = pending[p.id];
      if (!prev) {
        // First valid fix within 60m: record timestamp
        pending[p.id] = { timestamp: now, lat: fix.lat, lng: fix.lng };
      } else {
        const dt = (now - prev.timestamp) / 1000;
        if (dt >= 10 && dt <= 60) {
          // Second valid fix after 10s-60s within 60m: award discovery!
          newDiscoveries.push(p.id);
          delete pending[p.id];
        } else if (dt > 60) {
          // Outdated arrival, restart timer with current fix
          pending[p.id] = { timestamp: now, lat: fix.lat, lng: fix.lng };
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

/** Trail point retention: in-memory up to 1 hour (3600_000 ms), max 600 points */
export function appendTrail(trail, fix, now = Date.now()) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return Array.isArray(trail) ? trail : [];
  const fresh = (Array.isArray(trail) ? trail : []).filter(
    p => p && Number.isFinite(p.ts) && now - p.ts <= 3600_000 && p.ts <= now + 5000
  );
  const point = {
    lat: Math.round(fix.lat * 1e5) / 1e5,
    lng: Math.round(fix.lng * 1e5) / 1e5,
    ts: now,
    segmentBreak: Boolean(fix.segmentBreak),
  };
  return [...fresh, point].slice(-600);
}

/** Prunes points older than 1h and returns them with computed fading opacity */
export function pruneTrail(trail, now = Date.now()) {
  const list = Array.isArray(trail) ? trail : [];
  return list
    .filter(p => p && Number.isFinite(p.ts) && now - p.ts <= 3600_000 && p.ts <= now + 5000)
    .map(p => {
      const age = Math.max(0, now - p.ts);
      const ratio = 1 - Math.min(1, age / 3600_000);
      const opacity = Math.round((0.15 + 0.75 * ratio) * 100) / 100;
      return { lat: p.lat, lng: p.lng, ts: p.ts, opacity, segmentBreak: p.segmentBreak };
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
