/**
 * Czekpoint — Testovací Fake GPS Simulátor chůze (v0.9)
 * Umožňuje testovat chůzi, odkrývání Mapy objevování, azimut kompasu,
 * boční legendu i potvrzování zastávek a GPS razítek v izolovaném režimu.
 *
 * Bod 26: Simulovaná chůze vede výhradně po skutečně vypočtených pěších cestách (`sharedWalkingRoute`),
 * včetně zatáček, mostů a břehových cest kolem rybníků. Pokud pěší trasu nelze získat, autopilot se pozastaví
 * a vysvětlí důvod.
 */

import { haversineMeters } from './domain.js';
import {
  emptyWalk,
  acceptFix,
  discoverNearby,
  evaluateStopConfirmation,
  MAX_GPS_ACCURACY_M,
  FOG_REVEAL_RADIUS_M,
  STOP_CONFIRM_RADIUS_M,
} from './walk-engine.js';
import { buildLocalRoutedGeometry } from './planner.js';
import { resolveAccessibleStopLocation, evaluateNaturalFeatureReveals } from './natural-features.js';

export const ROZMITAL_CENTER = Object.freeze({ lat: 49.6018, lng: 13.8635 });
export const EARTH_RADIUS_M = 6378137;
export const MAX_SUBSTEP_M = 14;

export const SPEED_PRESETS = Object.freeze([
  { id: 'slow', label: '🐢 Pomalá (0,8 m/s)', speed: 0.8, kmh: 2.9, mode: 'accelerated' },
  { id: 'normal', label: '🥾 Běžná (1,4 m/s)', speed: 1.4, kmh: 5.0, mode: 'accelerated' },
  { id: 'fast', label: '🏃 Rychlá (2,9 m/s)', speed: 2.9, kmh: 10.4, mode: 'accelerated' },
  { id: 'fast100', label: '⚡ 100 km/h (zrychleně)', speed: 100 / 3.6, kmh: 100, mode: 'accelerated' },
  { id: 'fast1000', label: '🚀 1 000 km/h (zrychleně)', speed: 1000 / 3.6, kmh: 1000, mode: 'accelerated' },
  { id: 'car', label: '🚗 Test auta (6 m/s >3,5)', speed: 6.0, kmh: 21.6, mode: 'overspeed_test' },
]);

export const ACCURACY_PRESETS = Object.freeze([
  { id: 'ideal', label: '±6 m (Ideální přesnost)', accuracy: 6 },
  { id: 'forest', label: '±28 m (Lesní stín)', accuracy: 28 },
  { id: 'poor', label: '±55 m (Nepřesnost >40 m — pozastaví)', accuracy: 55 },
]);

export const DIRECTIONS = Object.freeze([
  { id: 'NW', label: '↖ SZ', deg: 315 },
  { id: 'N', label: '↑ S', deg: 0 },
  { id: 'NE', label: '↗ SV', deg: 45 },
  { id: 'W', label: '← Z', deg: 270 },
  { id: 'STOP', label: '⏹ STOP', deg: null },
  { id: 'E', label: '→ V', deg: 90 },
  { id: 'SW', label: '↙ JZ', deg: 225 },
  { id: 'S', label: '↓ J', deg: 180 },
  { id: 'SE', label: '↘ JV', deg: 135 },
]);

/**
 * Vypočítá azimut (bearing) z bodu A do bodu B ve stupních [0, 360).
 * @param {{lat: number, lng: number}} from
 * @param {{lat: number, lng: number}} to
 * @returns {number} azimut ve stupních
 */
export function calculateBearing(from, to) {
  if (!from || !to) return 0;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Posune souřadnice o danou vzdálenost v metrech a daný azimut ve stupních.
 * @param {{lat: number, lng: number}} origin
 * @param {number} distanceMeters
 * @param {number} bearingDeg
 * @returns {{lat: number, lng: number}}
 */
export function moveCoordinates(origin, distanceMeters, bearingDeg) {
  if (!origin || !distanceMeters) return { lat: origin?.lat || 0, lng: origin?.lng || 0 };
  const d = distanceMeters / EARTH_RADIUS_M;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

/**
 * Udělá krok směrem k cílovému bodu o max distanceMeters.
 * @param {{lat: number, lng: number}} current
 * @param {{lat: number, lng: number}} target
 * @param {number} distanceMeters
 * @returns {{lat: number, lng: number, arrived: boolean, distanceRemaining: number, heading: number}}
 */
export function stepTowards(current, target, distanceMeters) {
  const dist = haversineMeters(current, target) ?? 0;
  const heading = calculateBearing(current, target);
  if (dist <= distanceMeters || dist < 0.5) {
    return {
      lat: target.lat,
      lng: target.lng,
      arrived: true,
      distanceRemaining: 0,
      heading,
    };
  }
  const nextPos = moveCoordinates(current, distanceMeters, heading);
  const remaining = Math.max(0, dist - distanceMeters);
  return {
    lat: nextPos.lat,
    lng: nextPos.lng,
    arrived: false,
    distanceRemaining: remaining,
    heading,
  };
}

/**
 * Vytvoří čistý syntetický GPS fix splňující rozhraní aplikace Czekpoint.
 * @param {{lat: number, lng: number}} coords
 * @param {Object} options
 * @returns {{lat: number, lng: number, accuracy: number, speed: number, timestamp: number, simulated: boolean}}
 */
export function createSyntheticFix(coords, options = {}) {
  const {
    accuracy = 6,
    speed = 1.4,
    timestamp = Date.now(),
    simulated = true,
  } = options;

  return {
    lat: coords.lat,
    lng: coords.lng,
    accuracy: Math.max(1, Number(accuracy) || 6),
    speed: Number.isFinite(Number(speed)) ? Number(speed) : 0,
    timestamp,
    simulated,
  };
}

/**
 * Čistá deterministická simulace průchodu vypočtené pěší trasy pro libovolnou rychlost (5 km/h, 100 km/h, 1 000 km/h).
 * - Pohybuje se postupně po všech úsecích pěší trasy (`sharedRoute.coordinates`), včetně zatáček, mostů a břehových cest (Bod 26).
 * - Bod zájmu uprostřed rybníka nahradí přístupným bodem u břehu (`resolveAccessibleStopLocation`).
 * - Pokud pěší trasu nelze získat (`sharedRoute.isFallback === true` nebo `canSimulate === false`), autopilot se pozastaví a vysvětlí důvod.
 * - V režimu 'accelerated' používá pevný mezilehlý krok (~14 m) a simulační čas, takže 5, 100 i 1 000 km/h
 *   projdou všechny mezilehlé úseky a zastávky se 100% shodným výsledkem.
 */
export function simulateWalkPlayback(waypointsOrRoute, speedKmH = 5, places = [], options = {}) {
  const playbackMode = options.playbackMode || 'accelerated';
  const accuracy = options.accuracy ?? 6;
  const speedMs = Math.max(0.5, Number(speedKmH) / 3.6);
  let progress = options.initialProgress || emptyWalk();
  let anchor = null;
  const pendingPlaceStamps = {};
  const pendingStopTracker = {};
  const confirmedStops = new Set();
  const rejectedReasons = [];
  const visitedPath = [];

  // Rozpoznáme, zda volající předal přímo objekt společné trasy (`sharedRoute`), nebo pole zastávek
  let sharedRoute = null;
  let stopList = [];

  if (waypointsOrRoute && !Array.isArray(waypointsOrRoute) && typeof waypointsOrRoute === 'object') {
    sharedRoute = waypointsOrRoute;
    stopList = Array.isArray(options.stops)
      ? options.stops
      : Array.isArray(sharedRoute.stopTargets)
      ? sharedRoute.stopTargets
      : [];
  } else if (Array.isArray(waypointsOrRoute) && waypointsOrRoute.length > 0) {
    stopList = waypointsOrRoute.map(w => {
      const acc = resolveAccessibleStopLocation(w, options.ponds);
      return acc ? { ...w, lat: acc.lat, lng: acc.lng, isShoreAccess: acc.isShoreAccess } : w;
    });
    sharedRoute = options.sharedRoute || (
      stopList.length >= 2
        ? buildLocalRoutedGeometry(stopList, options)
        : {
            coordinates: [[stopList[0].lat, stopList[0].lng]],
            distanceM: 0,
            stopTargets: [{ ...stopList[0], coordIndex: 0 }],
            mode: 'routed',
            isFallback: false,
            canSimulate: true,
          }
    );
  } else {
    return { progress, confirmedStops: [], rejectedReasons, pausedReason: null, visitedPath };
  }

  // Bod 26: Pokud pěší trasu nelze získat, autopilot se pozastaví a vysvětlí důvod
  if (sharedRoute.isFallback || sharedRoute.canSimulate === false || !Array.isArray(sharedRoute.coordinates) || sharedRoute.coordinates.length === 0) {
    const pausedReason = '⏸ Autopilot pozastaven: pěší trasu po cestách se nepodařilo získat (k dispozici je jen vzdušná spojnice).';
    rejectedReasons.push(pausedReason);
    return {
      progress,
      confirmedStops: [],
      rejectedReasons,
      pausedReason,
      visitedPath,
    };
  }

  const routeCoords = sharedRoute.coordinates.map(c => (Array.isArray(c) ? { lat: Number(c[0]), lng: Number(c[1]) } : { lat: Number(c.lat), lng: Number(c.lng) }));
  const evalStops = stopList.length > 0 ? stopList : (sharedRoute.stopTargets || []);
  const stopTargets = Array.isArray(sharedRoute.stopTargets) && sharedRoute.stopTargets.length > 0
    ? sharedRoute.stopTargets
    : evalStops.map((s, idx) => ({ ...s, coordIndex: idx }));

  let simTime = options.startTime || 1_700_000_000_000;
  let pos = { lat: routeCoords[0].lat, lng: routeCoords[0].lng };

  const emitFix = (coords, reportedSpeed) => {
    const fix = createSyntheticFix(coords, {
      accuracy,
      speed: reportedSpeed,
      timestamp: simTime,
    });
    visitedPath.push({ lat: coords.lat, lng: coords.lng, timestamp: simTime });
    const res = acceptFix(progress, anchor, fix, simTime);
    anchor = res.anchor;
    if (!res.accepted) {
      rejectedReasons.push(res.reason);
    } else {
      progress = res.progress;
    }

    const validFix = res.anchor?.lastValidFix || (res.accepted ? fix : null);
    if (validFix) {
      const stopEval = evaluateStopConfirmation(validFix, evalStops, pendingStopTracker, confirmedStops, simTime);
      for (const id of stopEval.newlyConfirmedIds) {
        confirmedStops.add(id);
      }
      progress = discoverNearby(progress, validFix, places, pendingPlaceStamps);
      const natEval = evaluateNaturalFeatureReveals(validFix, progress.revealedFeatures, options.naturalFeatures);
      if (natEval.newlyRevealedFeatures.length > 0) {
        progress = {
          ...progress,
          revealedFeatures: natEval.revealedFeatureIds,
        };
      }
    }
  };

  // Startovní fix + potvrzení případné zastávky na startu
  emitFix(pos, 0.8);
  simTime += 4000;
  emitFix(pos, 0.4);
  simTime += 11000;
  emitFix(pos, 0.4);

  // Mapa vrcholů geometrie, na kterých leží zastávky
  const stopsAtCoordIdx = new Map();
  for (const st of stopTargets) {
    const cIdx = Number.isInteger(st.coordIndex) ? st.coordIndex : 0;
    if (!stopsAtCoordIdx.has(cIdx)) stopsAtCoordIdx.set(cIdx, []);
    stopsAtCoordIdx.get(cIdx).push(st);
  }

  for (let i = 0; i < routeCoords.length; i++) {
    const target = routeCoords[i];
    let guard = 0;
    while (guard++ < 10000) {
      const distRem = haversineMeters(pos, target) ?? 0;
      if (distRem < 0.5) break;

      if (playbackMode === 'overspeed_test') {
        const stepDist = Math.min(distRem, speedMs * 2);
        const step = stepTowards(pos, target, stepDist);
        pos = { lat: step.lat, lng: step.lng };
        simTime += 2000;
        emitFix(pos, speedMs);
        if (step.arrived) break;
      } else {
        // Zrychlené přehrávání chůze: pevný prostorový krok MAX_SUBSTEP_M po geometrii cesty
        const stepDist = Math.min(distRem, MAX_SUBSTEP_M);
        const step = stepTowards(pos, target, stepDist);
        pos = { lat: step.lat, lng: step.lng };
        const walkDtMs = Math.max(10000, Math.round((stepDist / 1.4) * 1000));
        simTime += walkDtMs;
        emitFix(pos, 1.4);
        if (step.arrived) break;
      }
    }

    // Pokud na tomto vrcholu cesty leží zastávka (nebo jsme do 20 m od některé zastávky),
    // provedeme v režimu zrychleného přehrávání krátké potvrzovací měření v simulačním čase
    if (playbackMode !== 'overspeed_test') {
      const nearbyStop = evalStops.find(s => {
        const acc = resolveAccessibleStopLocation(s, options.ponds) || s;
        return !confirmedStops.has(s.id) && (haversineMeters(target, acc) ?? Infinity) < STOP_CONFIRM_RADIUS_M;
      });
      if (stopsAtCoordIdx.has(i) || nearbyStop) {
        pos = { lat: target.lat, lng: target.lng };
        simTime += 4000;
        emitFix(pos, 0.3);
        simTime += 11000;
        emitFix(pos, 0.3);
      }
    }
  }

  return {
    progress,
    confirmedStops: [...confirmedStops],
    rejectedReasons,
    pausedReason: null,
    visitedPath,
    sharedRoute,
  };
}

/**
 * Simulátor chůze pro plovoucí UI a mapu.
 */
export class GpsSimulator {
  constructor(options = {}) {
    this.map = options.map || null;
    this.container = options.container || (typeof document !== 'undefined' ? document.body : null);
    this.onFix = options.onFix || (() => {});
    this.onResetAnchor = options.onResetAnchor || (() => {});
    this.onStopRealGps = options.onStopRealGps || (() => {});
    this.onOpen = options.onOpen || (() => {});
    this.onClose = options.onClose || (() => {});
    this.getPlannedWaypoints = options.getPlannedWaypoints || (() => []);
    this.getSharedWalkingRoute = options.getSharedWalkingRoute || (() => null);
    this.getCollectiblePlaces = options.getCollectiblePlaces || (() => []);
    this.onHeadingChange = options.onHeadingChange || (() => {});
    this.onAutopilotPause = options.onAutopilotPause || (() => {});

    const startPos = options.initialPosition || ROZMITAL_CENTER;
    this.position = { lat: startPos.lat, lng: startPos.lng };
    this.heading = 0;
    this.speed = 1.4; // m/s (běžná chůze)
    this.accuracy = 6; // ±6 m (ideální)
    this.playbackMode = 'accelerated'; // 'accelerated' | 'overspeed_test'
    this.simTimestamp = Date.now();

    this.mode = 'idle'; // 'idle' | 'direction' | 'walkTo' | 'autopilot' | 'paused_no_route'
    this.clickMode = 'walk'; // 'walk' | 'teleport'
    this.currentDirectionDeg = null;
    this.autopilotPauseReason = '';

    this.targetPoint = null;
    this.targetPolyline = null;

    this.sharedWalkingRoute = null;
    this.autopilotWaypoints = [];
    this.autopilotRouteCoords = [];
    this.autopilotCoordIndex = 0;
    this.autopilotIndex = 0;
    this.waitingAtPlace = null;
    this.stampWaitElapsed = 0;
    this.stampedPlaces = new Set();

    this.timer = null;
    this.isOpen = false;
    this.isCollapsed = false;
    this.panelEl = null;

    this.boundOnMapClick = this.handleMapClick.bind(this);
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
  }

  setSharedWalkingRoute(route) {
    this.sharedWalkingRoute = route || null;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.simTimestamp = Date.now();
    this.onStopRealGps();
    this.onOpen();
    this.render();
    this.startLoop();
    this.bindEvents();
    this.sendCurrentFix(this.simTimestamp);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.stopLoop();
    this.unbindEvents();
    this.clearDottedLine();
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
    if (this.container && this.container.id === 'simulator-test-zone') {
      this.container.hidden = true;
    }
    this.onClose();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  pause() {
    this.isPaused = true;
    this.pausedModeBackup = this.mode;
    if (this.mode === 'autopilot' || this.mode === 'direction' || this.mode === 'walkTo') {
      this.mode = 'idle';
    }
    this.statusMessage = '⏸ Simulátor pozastaven (autopilot zastaven).';
    this.updateStatusUi?.();
  }

  resume() {
    this.isPaused = false;
    if (this.pausedModeBackup && this.mode === 'idle') {
      this.mode = this.pausedModeBackup;
    }
    this.pausedModeBackup = null;
    this.lastWallTickMs = Date.now();
    this.statusMessage = '▶ Simulátor pokračuje.';
    this.updateStatusUi?.();
  }

  triggerLoopTick(now = Date.now()) {
    if (!this.isOpen || this.isPaused) return;
    if (this.lastWallTickMs && now - this.lastWallTickMs < 480) {
      return;
    }
    const elapsedSec = this.lastWallTickMs
      ? Math.min(20, Math.max(0.2, (now - this.lastWallTickMs) / 1000))
      : 1;
    this.lastWallTickMs = now;
    this.tick(now, elapsedSec);
  }

  startLoop() {
    this.stopLoop();
    this.lastWallTickMs = Date.now();
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      try {
        const workerCode = `
          let t = null;
          self.onmessage = function(e) {
            if (e.data === 'start') {
              if (t) clearInterval(t);
              t = setInterval(function() { self.postMessage('tick'); }, 1000);
            } else if (e.data === 'stop') {
              if (t) clearInterval(t);
              t = null;
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.bgWorker = new Worker(URL.createObjectURL(blob));
        this.bgWorker.onmessage = () => {
          this.triggerLoopTick(Date.now());
        };
        this.bgWorker.postMessage('start');
      } catch {
        this.bgWorker = null;
      }
    }
    this.timer = setInterval(() => {
      this.triggerLoopTick(Date.now());
    }, 1000);
  }

  stopLoop() {
    if (this.bgWorker) {
      try {
        this.bgWorker.postMessage('stop');
        this.bgWorker.terminate();
      } catch {}
      this.bgWorker = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastWallTickMs = 0;
  }

  bindEvents() {
    if (this.map) {
      this.map.on('click', this.boundOnMapClick);
    }
    window.addEventListener('keydown', this.boundOnKeyDown);
  }

  unbindEvents() {
    if (this.map) {
      this.map.off('click', this.boundOnMapClick);
    }
    window.removeEventListener('keydown', this.boundOnKeyDown);
  }

  handleMapClick(ev) {
    if (!this.isOpen || !ev?.latlng) return;
    const clicked = { lat: ev.latlng.lat, lng: ev.latlng.lng };

    if (this.clickMode === 'teleport') {
      this.teleportTo(clicked);
    } else {
      this.walkTo(clicked);
    }
  }

  handleKeyDown(ev) {
    if (!this.isOpen) return;
    const key = ev.key.toLowerCase();
    const tag = ev.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (key === 'w' || key === 'arrowup') {
      ev.preventDefault();
      this.setDirection(0);
    } else if (key === 's' || key === 'arrowdown') {
      ev.preventDefault();
      this.setDirection(180);
    } else if (key === 'a' || key === 'arrowleft') {
      ev.preventDefault();
      this.setDirection(270);
    } else if (key === 'd' || key === 'arrowright') {
      ev.preventDefault();
      this.setDirection(90);
    } else if (key === ' ' || key === 'escape') {
      ev.preventDefault();
      this.stopMovement();
    }
  }

  teleportTo(coords) {
    this.mode = 'idle';
    this.autopilotPauseReason = '';
    this.currentDirectionDeg = null;
    this.targetPoint = null;
    this.clearDottedLine();

    const accessible = resolveAccessibleStopLocation(coords) || coords;
    this.position = { lat: accessible.lat, lng: accessible.lng };
    this.onResetAnchor();
    this.simTimestamp += 3000;
    this.sendCurrentFix(this.simTimestamp);
    this.updateStatusUi();
  }

  walkTo(coords) {
    this.autopilotPauseReason = '';
    const leg = buildLocalRoutedGeometry([this.position, coords]);
    if (leg.coordinates && leg.coordinates.length >= 2) {
      this.autopilotWaypoints = [{
        id: 'walk-to-target',
        title: 'Zvolený bod v mapě',
        lat: leg.coordinates[leg.coordinates.length - 1][0],
        lng: leg.coordinates[leg.coordinates.length - 1][1],
      }];
      this.autopilotRouteCoords = leg.coordinates.map(([lat, lng]) => ({ lat, lng }));
      this.autopilotCoordIndex = 1;
      this.autopilotIndex = 0;
      this.mode = 'autopilot';
      const nextVertex = this.autopilotRouteCoords[this.autopilotCoordIndex] || this.autopilotRouteCoords[0];
      this.heading = calculateBearing(this.position, nextVertex);
      this.onHeadingChange(this.heading);
      this.drawDottedPolyline(this.autopilotRouteCoords);
      this.updateStatusUi();
      return;
    }

    this.mode = 'walkTo';
    this.currentDirectionDeg = null;
    this.targetPoint = { lat: coords.lat, lng: coords.lng };
    this.heading = calculateBearing(this.position, this.targetPoint);
    this.onHeadingChange(this.heading);

    this.drawDottedLine(this.position, this.targetPoint);
    this.updateStatusUi();
  }

  setDirection(deg) {
    if (deg === null) {
      this.stopMovement();
      return;
    }
    this.mode = 'direction';
    this.autopilotPauseReason = '';
    this.currentDirectionDeg = deg;
    this.heading = deg;
    this.targetPoint = null;
    this.clearDottedLine();
    this.onHeadingChange(this.heading);
    this.updateStatusUi();
  }

  stopMovement() {
    this.mode = 'idle';
    this.autopilotPauseReason = '';
    this.currentDirectionDeg = null;
    this.targetPoint = null;
    this.clearDottedLine();
    this.waitingAtPlace = null;
    this.stampWaitElapsed = 0;
    this.updateStatusUi();
  }

  stepOnce(distanceMeters = 15) {
    const bearing = this.currentDirectionDeg != null ? this.currentDirectionDeg : this.heading;
    const nextPos = moveCoordinates(this.position, distanceMeters, bearing);
    this.position = nextPos;
    this.heading = bearing;
    this.onHeadingChange(this.heading);
    this.simTimestamp += 11000;
    this.sendCurrentFix(this.simTimestamp, 1.4);
    this.updateStatusUi();
  }

  /**
   * Spustí autopilota po celé geometrii vypočtené pěší trasy (Bod 26).
   * Pokud pěší trasu nelze získat (`isFallback === true`), autopilot se pozastaví a vysvětlí důvod.
   */
  startAutopilot(waypoints, collectiblePlaces, sharedRouteOverride = null) {
    const wp = Array.isArray(waypoints) && waypoints.length > 0
      ? waypoints
      : this.getPlannedWaypoints();

    let rawStops = [];
    if (!wp || wp.length === 0) {
      const places = (collectiblePlaces || this.getCollectiblePlaces()).slice(0, 5);
      if (places.length > 0) {
        rawStops = places.map(p => ({ lat: p.lat, lng: p.lng, id: p.id, title: p.title }));
      } else {
        return;
      }
    } else {
      rawStops = wp.map(p => ({ lat: p.lat, lng: p.lng, id: p.id, title: p.title || p.label || 'Zastávka' }));
    }

    // Každý cíl uprostřed rybníka nahradíme přístupným bodem na břehu (Bod 26)
    this.autopilotWaypoints = rawStops.map(p => {
      const acc = resolveAccessibleStopLocation(p);
      return acc ? { ...p, lat: acc.lat, lng: acc.lng, isShoreAccess: acc.isShoreAccess } : p;
    });

    const candidateRoute = sharedRouteOverride || this.sharedWalkingRoute || this.getSharedWalkingRoute();
    let activeRoute = candidateRoute;

    if (!activeRoute || !Array.isArray(activeRoute.coordinates) || activeRoute.coordinates.length < 2) {
      activeRoute = buildLocalRoutedGeometry([this.position, ...this.autopilotWaypoints]);
    }

    // Bod 26: Pokud pěší trasu nelze získat, autopilot se pozastaví a vysvětlí důvod
    if (!activeRoute || activeRoute.isFallback || activeRoute.canSimulate === false || !Array.isArray(activeRoute.coordinates) || activeRoute.coordinates.length < 2) {
      this.mode = 'paused_no_route';
      this.autopilotPauseReason = '⏸ Autopilot pozastaven: pěší trasu po cestách se nepodařilo získat (k dispozici jsou jen orientační spojnice).';
      this.clearDottedLine();
      this.onAutopilotPause(this.autopilotPauseReason);
      this.updateStatusUi();
      return;
    }

    // Propojíme aktuální polohu s prvním bodem trasy po pěší cestě, pokud ještě nejsme na začátku
    const firstCoord = { lat: activeRoute.coordinates[0][0], lng: activeRoute.coordinates[0][1] };
    let fullCoords = activeRoute.coordinates.map(([lat, lng]) => ({ lat, lng }));
    if ((haversineMeters(this.position, firstCoord) ?? 0) > 15) {
      const leadIn = buildLocalRoutedGeometry([this.position, firstCoord]);
      if (leadIn.coordinates && leadIn.coordinates.length >= 2) {
        const leadPts = leadIn.coordinates.slice(0, -1).map(([lat, lng]) => ({ lat, lng }));
        fullCoords = [...leadPts, ...fullCoords];
      }
    }

    this.autopilotRouteCoords = fullCoords;
    this.autopilotCoordIndex = 0;
    this.mode = 'autopilot';
    this.autopilotPauseReason = '';
    this.autopilotIndex = 0;
    this.waitingAtPlace = null;
    this.stampWaitElapsed = 0;
    this.stampedPlaces = new Set();
    this.currentDirectionDeg = null;
    this.clearDottedLine();

    if (this.autopilotRouteCoords.length > 0) {
      const target = this.autopilotRouteCoords[Math.min(1, this.autopilotRouteCoords.length - 1)];
      this.heading = calculateBearing(this.position, target);
      this.onHeadingChange(this.heading);
      this.drawDottedPolyline(this.autopilotRouteCoords);
    }

    this.updateStatusUi();
  }

  /**
   * Posune simulovanou postavu o zadanou vzdálenost.
   * V režimu 'accelerated' rozdělí dlouhý krok (např. při 100 nebo 1000 km/h)
   * na mezilehlé polohy po max 14 m se zrychleným simulačním časem, aby nevznikaly díry v odkrytí
   * a nepřeskočila se žádná zastávka.
   */
  advanceAlongBearing(totalDistMeters, bearingDeg) {
    if (this.playbackMode === 'overspeed_test') {
      this.position = moveCoordinates(this.position, totalDistMeters, bearingDeg);
      this.heading = bearingDeg;
      this.onHeadingChange(this.heading);
      this.simTimestamp += 2000;
      this.sendCurrentFix(this.simTimestamp, this.speed);
      return;
    }

    let remaining = totalDistMeters;
    let substeps = 0;
    while (remaining > 0.05 && substeps < 120) {
      substeps++;
      const stepDist = Math.min(remaining, MAX_SUBSTEP_M);
      this.position = moveCoordinates(this.position, stepDist, bearingDeg);
      remaining -= stepDist;
      this.heading = bearingDeg;
      this.simTimestamp += Math.max(10000, Math.round((stepDist / 1.4) * 1000));
      this.sendCurrentFix(this.simTimestamp, Math.min(this.speed, 1.4));
    }
    this.onHeadingChange(this.heading);
  }

  /**
   * Posune simulovanou postavu směrem k cíli `target` o `totalDistMeters`.
   * Nikdy nepřeskočí cílový bod ani při rychlosti 100 nebo 1 000 km/h.
   */
  advanceTowardsPoint(target, totalDistMeters) {
    if (this.playbackMode === 'overspeed_test') {
      const step = stepTowards(this.position, target, totalDistMeters);
      this.position = { lat: step.lat, lng: step.lng };
      this.heading = step.heading;
      this.onHeadingChange(this.heading);
      this.simTimestamp += 2000;
      this.sendCurrentFix(this.simTimestamp, this.speed);
      return step.arrived;
    }

    let remaining = totalDistMeters;
    let substeps = 0;
    let arrived = false;
    while (remaining > 0.05 && substeps < 120) {
      substeps++;
      const distToTarget = haversineMeters(this.position, target) ?? 0;
      const stepDist = Math.min(remaining, distToTarget, MAX_SUBSTEP_M);
      const step = stepTowards(this.position, target, stepDist);
      this.position = { lat: step.lat, lng: step.lng };
      this.heading = step.heading;
      remaining -= stepDist;
      this.simTimestamp += Math.max(10000, Math.round((Math.max(1, stepDist) / 1.4) * 1000));
      this.sendCurrentFix(this.simTimestamp, Math.min(this.speed, 1.4));
      if (step.arrived || (haversineMeters(this.position, target) ?? 0) < 0.5) {
        arrived = true;
        break;
      }
    }
    this.onHeadingChange(this.heading);
    return arrived;
  }

  tick(now = Date.now(), dtSeconds = 1) {
    if (!this.isOpen) return;

    const totalDist = this.speed * dtSeconds;

    if (this.mode === 'paused_no_route') {
      this.updateStatusUi();
      return;
    }

    if (this.mode === 'direction' && this.currentDirectionDeg != null) {
      this.advanceAlongBearing(totalDist, this.currentDirectionDeg);
    } else if (this.mode === 'walkTo' && this.targetPoint) {
      const arrived = this.advanceTowardsPoint(this.targetPoint, totalDist);
      if (this.targetPoint) {
        this.drawDottedLine(this.position, this.targetPoint);
      }
      if (arrived) {
        this.mode = 'idle';
        this.targetPoint = null;
        this.clearDottedLine();
      }
    } else if (this.mode === 'autopilot') {
      const routeVerts = this.autopilotRouteCoords && this.autopilotRouteCoords.length > 0
        ? this.autopilotRouteCoords
        : this.autopilotWaypoints;

      let remainingBudget = totalDist;
      let vertexLoops = 0;

      while (remainingBudget > 0.1 && vertexLoops < 60) {
        vertexLoops++;
        const currentVertex = routeVerts[this.autopilotCoordIndex];
        if (!currentVertex) {
          this.stopMovement();
          break;
        }

        // Režim čekání na potvrzení zastávky a razítka u místa (< 20 m)
        if (this.waitingAtPlace) {
          const waitStep = this.speed >= 20 ? 12 : dtSeconds * Math.max(1, this.speed / 1.4);
          this.stampWaitElapsed += waitStep;
          this.simTimestamp += 4500;
          this.sendCurrentFix(this.simTimestamp, 0.3);
          if (this.stampWaitElapsed >= 12) {
            this.simTimestamp += 11000;
            this.sendCurrentFix(this.simTimestamp, 0.3);
            this.waitingAtPlace = null;
            this.stampWaitElapsed = 0;
            this.autopilotIndex = Math.min(this.autopilotWaypoints.length, this.autopilotIndex + 1);
            this.autopilotCoordIndex++;

            if (this.autopilotCoordIndex >= routeVerts.length) {
              this.stopMovement();
              break;
            }
            const nextVertex = routeVerts[this.autopilotCoordIndex];
            this.heading = calculateBearing(this.position, nextVertex);
            this.onHeadingChange(this.heading);
            this.drawDottedPolyline(routeVerts.slice(this.autopilotCoordIndex));
          }
          break;
        }

        // Zjistíme, zda je aktuální poloha v dosahu (< 20 m) některé dosud nepotvrzené zastávky
        const nearbyUnstampedStop = this.autopilotWaypoints.find((wp, idx) => {
          const key = wp.id || `${wp.lat},${wp.lng}`;
          if (this.stampedPlaces.has(key)) return false;
          const d = haversineMeters(this.position, wp) ?? Infinity;
          if (d < STOP_CONFIRM_RADIUS_M) {
            this.autopilotIndex = idx;
            return true;
          }
          return false;
        });

        if (nearbyUnstampedStop) {
          const targetKey = nearbyUnstampedStop.id || `${nearbyUnstampedStop.lat},${nearbyUnstampedStop.lng}`;
          this.stampedPlaces.add(targetKey);
          this.position = { lat: nearbyUnstampedStop.lat, lng: nearbyUnstampedStop.lng };

          if (this.playbackMode !== 'overspeed_test' && this.speed >= 20) {
            // Při 100 / 1 000 km/h provedeme potvrzovací vzorky okamžitě v simulačním čase,
            // aby se zastávka i razítko 100% potvrdily bez vizuální prodlevy
            this.simTimestamp += 4000;
            this.sendCurrentFix(this.simTimestamp, 0.3);
            this.simTimestamp += 11000;
            this.sendCurrentFix(this.simTimestamp, 0.3);
            this.autopilotIndex = Math.min(this.autopilotWaypoints.length - 1, this.autopilotIndex + 1);
            continue;
          } else {
            this.waitingAtPlace = nearbyUnstampedStop;
            this.stampWaitElapsed = 0;
            this.simTimestamp += 4000;
            this.sendCurrentFix(this.simTimestamp, 0.3);
            break;
          }
        }

        const distToVertex = haversineMeters(this.position, currentVertex) ?? 0;
        const stepBudget = Math.min(remainingBudget, Math.max(0.5, distToVertex));
        const arrived = this.advanceTowardsPoint(currentVertex, stepBudget);
        remainingBudget -= stepBudget;
        this.drawDottedPolyline([this.position, ...routeVerts.slice(this.autopilotCoordIndex)]);

        if (arrived) {
          // Zkontrolujeme, zda přímo na tomto vrcholu cesty neleží nepotvrzená zastávka
          const stopAtVertex = this.autopilotWaypoints.find(wp => {
            const key = wp.id || `${wp.lat},${wp.lng}`;
            return !this.stampedPlaces.has(key) && (haversineMeters(this.position, wp) ?? Infinity) < STOP_CONFIRM_RADIUS_M;
          });
          if (stopAtVertex) {
            remainingBudget = Math.max(remainingBudget, 1);
            continue;
          }

          this.autopilotCoordIndex++;
          if (this.autopilotCoordIndex >= routeVerts.length) {
            this.stopMovement();
            break;
          }
          const nextVertex = routeVerts[this.autopilotCoordIndex];
          this.heading = calculateBearing(this.position, nextVertex);
          this.onHeadingChange(this.heading);
        }
      }
    } else {
      // V klidovém režimu posíláme pravidelný heartbeat fix
      this.simTimestamp += 3500;
      this.sendCurrentFix(this.simTimestamp, 0);
    }

    this.updateStatusUi();
  }

  sendCurrentFix(timestamp = this.simTimestamp, overrideSpeed = null) {
    const reportedSpeed = overrideSpeed != null
      ? overrideSpeed
      : (this.mode === 'idle' || this.mode === 'paused_no_route')
      ? 0
      : this.playbackMode === 'overspeed_test'
      ? this.speed
      : Math.min(this.speed, 1.4);

    const fix = createSyntheticFix(this.position, {
      accuracy: this.accuracy,
      speed: reportedSpeed,
      timestamp,
      simulated: true,
    });
    this.onFix(fix, this.heading);
  }

  drawDottedLine(from, to) {
    this.drawDottedPolyline([from, to]);
  }

  drawDottedPolyline(points = []) {
    if (!this.map || typeof window.L === 'undefined') return;
    const L = window.L;
    this.clearDottedLine();
    const latlngs = points
      .map(p => (Array.isArray(p) ? p : [p?.lat, p?.lng]))
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (latlngs.length < 2) return;
    this.targetPolyline = L.polyline(latlngs, {
      color: '#f27a24',
      weight: 3.5,
      dashArray: '6, 8',
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(this.map);
  }

  clearDottedLine() {
    if (this.targetPolyline) {
      this.targetPolyline.remove();
      this.targetPolyline = null;
    }
  }

  render() {
    if (this.panelEl) this.panelEl.remove();

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'fake-gps-panel';
    this.panelEl.id = 'fake-gps-panel';
    this.panelEl.innerHTML = `
      <div class="fake-gps-header">
        <div class="fake-gps-title">
          <span class="fake-gps-badge">🧪 Test GPS</span>
          <strong>Izolovaný simulátor</strong>
        </div>
        <div class="fake-gps-actions">
          <button type="button" class="fake-gps-btn small" id="sim-btn-collapse" title="Sbalit / rozbalit ovladač">
            ${this.isCollapsed ? '⬇ Rozbalit' : '⬆ Sbalit'}
          </button>
          <button type="button" class="fake-gps-btn small danger" id="sim-btn-close" title="Zavřít simulátor a vrátit skutečný stav">✕</button>
        </div>
      </div>

      <div class="fake-gps-isolation-note" id="fake-gps-isolation-note">
        🔒 <strong>Izolovaný režim:</strong> Simulátor nemění tvůj skutečný profil, body ani uložená území.
      </div>

      <div class="fake-gps-body" id="fake-gps-body" ${this.isCollapsed ? 'hidden' : ''}>
        <!-- 1. Směrový kříž a tlačítko 1 krok -->
        <div class="fake-gps-section">
          <div class="fake-gps-section-label">1. Pohyb (WASD / Šipky)</div>
          <div class="dpad-grid">
            ${DIRECTIONS.map(d => `
              <button type="button" class="dpad-btn ${d.id === 'STOP' ? 'dpad-stop' : ''}" data-dir="${d.id}" data-deg="${d.deg ?? ''}">
                ${d.label}
              </button>
            `).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button type="button" class="fake-gps-btn full lime" id="sim-btn-step">👣 1 krok (+15 m)</button>
          </div>
        </div>

        <!-- 2. Režim kliknutí do mapy a Autopilot -->
        <div class="fake-gps-section">
          <div class="fake-gps-section-label">2. Klik do mapy & Autopilot po pěších cestách</div>
          <div class="fake-gps-row">
            <button type="button" class="fake-gps-btn ${this.clickMode === 'walk' ? 'active' : ''}" id="sim-btn-click-walk">🎯 Jít sem chůzí</button>
            <button type="button" class="fake-gps-btn ${this.clickMode === 'teleport' ? 'active' : ''}" id="sim-btn-click-teleport">⚡ Teleport</button>
          </div>
          <button type="button" class="fake-gps-btn full gold" id="sim-btn-autopilot" style="margin-top:6px">
            🤖 Autopilot po vypočtené trase
          </button>
        </div>

        <!-- 3. Rychlost a režim simulace -->
        <div class="fake-gps-section">
          <div class="fake-gps-section-label">3. Rychlost (vč. 100 a 1 000 km/h)</div>
          <div class="speed-presets-row">
            ${SPEED_PRESETS.map(sp => `
              <button type="button" class="fake-gps-btn mini ${Math.abs(this.speed - sp.speed) < 0.05 && this.playbackMode === sp.mode ? 'active' : ''}" data-speed="${sp.speed}" data-playback-mode="${sp.mode}">
                ${sp.label}
              </button>
            `).join('')}
          </div>
          <div class="slider-row">
            <input type="range" id="sim-speed-slider" min="0.5" max="280" step="0.5" value="${this.speed}">
            <span id="sim-speed-val">${this.speed.toFixed(1)} m/s (${(this.speed * 3.6).toFixed(0)} km/h)</span>
          </div>
          <div class="fake-gps-row" style="margin-top:6px">
            <button type="button" class="fake-gps-btn mini ${this.playbackMode === 'accelerated' ? 'active' : ''}" id="sim-mode-accelerated" title="Zrychlený simulační čas a mezilehlé kroky po cestách bez děr v odkrytí">
              ⏩ Zrychlené přehrávání chůze
            </button>
            <button type="button" class="fake-gps-btn mini ${this.playbackMode === 'overspeed_test' ? 'active' : ''}" id="sim-mode-overspeed" title="Předá skutečnou vysokou rychlost pro ověření, že aplikace odmítne jízdu autem (>3,5 m/s)">
              🚫 Test odmítnutí rychlosti
            </button>
          </div>

          <div class="fake-gps-section-label" style="margin-top:8px">4. Nepřesnost GPS vs. Dosah odkrývání</div>
          <div class="accuracy-presets-row">
            ${ACCURACY_PRESETS.map(ap => `
              <button type="button" class="fake-gps-btn mini ${this.accuracy === ap.accuracy ? 'active' : ''}" data-accuracy="${ap.accuracy}">
                ${ap.label}
              </button>
            `).join('')}
          </div>
          <div class="fake-gps-sep-info" id="sim-accuracy-explain">
            <span>📡 <strong>Nepřesnost GPS:</strong> ±<strong id="sim-stat-acc">${this.accuracy}</strong> m (limit ${MAX_GPS_ACCURACY_M} m)</span>
            <span>🗺️ <strong>Dosah odkrývání:</strong> <strong>${FOG_REVEAL_RADIUS_M} m</strong> (pevný poloměr)</span>
          </div>
        </div>
      </div>

      <!-- 4. Stavový řádek -->
      <div class="fake-gps-status-bar" id="fake-gps-status-bar">
        <div class="status-col">
          <div><strong>Souřadnice:</strong> <span id="sim-stat-coords">${this.position.lat.toFixed(4)}, ${this.position.lng.toFixed(4)}</span></div>
          <div><strong>Azimut:</strong> <span id="sim-stat-heading">${Math.round(this.heading)}°</span> · <strong>Rychlost:</strong> <span id="sim-stat-speed">${(this.speed * 3.6).toFixed(1)} km/h</span></div>
        </div>
        <div class="status-stamp" id="sim-stat-stamp">Zastávky (&lt;${STOP_CONFIRM_RADIUS_M} m): připraveno</div>
      </div>
    `;

    const targetContainer = this.container || document.querySelector('#simulator-test-zone') || document.querySelector('.walk-map-wrap') || document.body;
    targetContainer.appendChild(this.panelEl);
    if (targetContainer.id === 'simulator-test-zone') {
      targetContainer.hidden = false;
      targetContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    this.wirePanelEvents();
  }

  wirePanelEvents() {
    if (!this.panelEl) return;

    this.panelEl.querySelector('#sim-btn-close')?.addEventListener('click', () => this.close());
    this.panelEl.querySelector('#sim-btn-collapse')?.addEventListener('click', () => {
      this.isCollapsed = !this.isCollapsed;
      const body = this.panelEl.querySelector('#fake-gps-body');
      const btn = this.panelEl.querySelector('#sim-btn-collapse');
      if (body) body.hidden = this.isCollapsed;
      if (btn) btn.textContent = this.isCollapsed ? '⬇ Rozbalit' : '⬆ Sbalit';
    });

    // D-Pad
    this.panelEl.querySelectorAll('.dpad-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const degStr = btn.dataset.deg;
        if (!degStr) {
          this.stopMovement();
        } else {
          this.setDirection(Number(degStr));
        }
      });
    });

    // 1 krok
    this.panelEl.querySelector('#sim-btn-step')?.addEventListener('click', () => {
      this.stepOnce(15);
    });

    // Click modes
    const btnWalk = this.panelEl.querySelector('#sim-btn-click-walk');
    const btnTeleport = this.panelEl.querySelector('#sim-btn-click-teleport');
    btnWalk?.addEventListener('click', () => {
      this.clickMode = 'walk';
      btnWalk.classList.add('active');
      btnTeleport?.classList.remove('active');
    });
    btnTeleport?.addEventListener('click', () => {
      this.clickMode = 'teleport';
      btnTeleport.classList.add('active');
      btnWalk?.classList.remove('active');
    });

    // Autopilot
    this.panelEl.querySelector('#sim-btn-autopilot')?.addEventListener('click', () => {
      this.startAutopilot();
    });

    // Playback mode buttons
    const btnAcc = this.panelEl.querySelector('#sim-mode-accelerated');
    const btnOver = this.panelEl.querySelector('#sim-mode-overspeed');
    btnAcc?.addEventListener('click', () => {
      this.playbackMode = 'accelerated';
      btnAcc.classList.add('active');
      btnOver?.classList.remove('active');
      this.updateSpeedDisplay();
    });
    btnOver?.addEventListener('click', () => {
      this.playbackMode = 'overspeed_test';
      btnOver.classList.add('active');
      btnAcc?.classList.remove('active');
      this.updateSpeedDisplay();
    });

    // Speed presets & slider
    this.panelEl.querySelectorAll('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.speed);
        const mode = btn.dataset.playbackMode || 'accelerated';
        this.speed = val;
        this.playbackMode = mode;
        const slider = this.panelEl.querySelector('#sim-speed-slider');
        if (slider) slider.value = String(val);
        this.panelEl.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', b === btn));
        btnAcc?.classList.toggle('active', this.playbackMode === 'accelerated');
        btnOver?.classList.toggle('active', this.playbackMode === 'overspeed_test');
        this.updateSpeedDisplay();
      });
    });

    const speedSlider = this.panelEl.querySelector('#sim-speed-slider');
    speedSlider?.addEventListener('input', (ev) => {
      this.speed = Number(ev.target.value);
      this.panelEl.querySelectorAll('[data-speed]').forEach(b => {
        b.classList.toggle('active', Math.abs(Number(b.dataset.speed) - this.speed) < 0.1);
      });
      this.updateSpeedDisplay();
    });

    // Accuracy presets
    this.panelEl.querySelectorAll('[data-accuracy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.accuracy);
        this.accuracy = val;
        this.panelEl.querySelectorAll('[data-accuracy]').forEach(b => b.classList.toggle('active', b === btn));
        const accEl = this.panelEl.querySelector('#sim-stat-acc');
        if (accEl) accEl.textContent = String(this.accuracy);
        this.simTimestamp += 3500;
        this.sendCurrentFix(this.simTimestamp);
      });
    });
  }

  updateSpeedDisplay() {
    const valEl = this.panelEl?.querySelector('#sim-speed-val');
    if (valEl) {
      const kmh = this.speed * 3.6;
      valEl.textContent = `${this.speed.toFixed(1)} m/s (${kmh >= 50 ? Math.round(kmh) : kmh.toFixed(1)} km/h)`;
    }
    this.updateStatusUi();
  }

  updateStatusUi() {
    if (!this.panelEl) return;
    const coordsEl = this.panelEl.querySelector('#sim-stat-coords');
    const headingEl = this.panelEl.querySelector('#sim-stat-heading');
    const speedEl = this.panelEl.querySelector('#sim-stat-speed');
    const stampEl = this.panelEl.querySelector('#sim-stat-stamp');
    const accEl = this.panelEl.querySelector('#sim-stat-acc');

    if (coordsEl) coordsEl.textContent = `${this.position.lat.toFixed(4)}, ${this.position.lng.toFixed(4)}`;
    if (headingEl) headingEl.textContent = `${Math.round(this.heading)}°`;
    if (speedEl) {
      const kmh = this.speed * 3.6;
      speedEl.textContent = `${kmh >= 50 ? Math.round(kmh) : kmh.toFixed(1)} km/h (${this.playbackMode === 'overspeed_test' ? 'test odmítnutí' : 'zrychleně'})`;
    }
    if (accEl) accEl.textContent = String(this.accuracy);

    if (stampEl) {
      if (this.mode === 'paused_no_route') {
        stampEl.textContent = this.autopilotPauseReason || '⏸ Autopilot pozastaven: pěší trasu po cestách se nepodařilo získat.';
        stampEl.classList.add('waiting');
      } else if (this.accuracy > MAX_GPS_ACCURACY_M) {
        stampEl.textContent = `⏸ Průzkum pozastaven: nepřesnost GPS ±${this.accuracy} m překračuje limit ${MAX_GPS_ACCURACY_M} m`;
        stampEl.classList.add('waiting');
      } else if (this.waitingAtPlace) {
        stampEl.textContent = `🎯 Potvrzuji zastávku (<${STOP_CONFIRM_RADIUS_M} m): ${this.waitingAtPlace.title || 'Místo'}`;
        stampEl.classList.add('waiting');
      } else if (this.mode === 'autopilot') {
        const stopCount = Math.max(1, this.autopilotWaypoints.length);
        const doneCount = this.stampedPlaces.size;
        stampEl.textContent = `🤖 Autopilot po pěší cestě: zastávky ${doneCount}/${stopCount} (úsek ${this.autopilotCoordIndex + 1}/${this.autopilotRouteCoords.length})`;
        stampEl.classList.remove('waiting');
      } else {
        stampEl.textContent = `Zastávky (<${STOP_CONFIRM_RADIUS_M} m): připraveno`;
        stampEl.classList.remove('waiting');
      }
    }
  }

  destroy() {
    this.close();
  }
}

/**
 * Inicializuje simulátor pro modul walk.
 * @param {Object} options
 * @returns {GpsSimulator}
 */
export function initGpsSimulator(options = {}) {
  return new GpsSimulator(options);
}