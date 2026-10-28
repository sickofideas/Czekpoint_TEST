/**
 * Czekpoint — Turistická telemetrie, výškový filtr, výpočet rychlosti a sledování hráče na mapě (Body 25 & 28)
 */

import { haversineMeters } from './domain.js';
import { MAX_GPS_ACCURACY_M } from './walk-engine.js';

export const STATIONARY_SPEED_DEADBAND_KMH = 0.8; // Rychlost pod 0,8 km/h при chvění GPS zobrazíme jako 0,0 km/h
export const ELEVATION_HYSTERESIS_M = 4.5; // Pásmo necitlivosti (hystereze) pro filtraci šumu výšky při stání
export const GPS_OUTAGE_WARNING_MS = 14000; // Po 14 s bez platného vzorku zobrazíme upozornění na výpadek GPS

/**
 * Vypočítá cílový střed mapy (lat, lng) tak, aby se hráč nacházel ve viditelné části mapy
 * NAD spodním panelem (Bod 25). Respektuje aktuální přiblížení (zoom) zvolené uživatelem.
 *
 * @param {{lat: number, lng: number}} playerPos - poloha hráče
 * @param {{width: number, height: number}} viewportPx - rozměry mapového kontejneru v px
 * @param {number} bottomPanelHeightPx - výška spodního panelu zasahujícího do mapy v px
 * @param {number} topBarHeightPx - výška horního překryvu v px
 * @param {number} zoom - aktuální zoom mapy (např. 15–18)
 * @returns {{lat: number, lng: number, offsetYPx: number}}
 */
export function computeVisibleMapCenterForPlayer(
  playerPos,
  viewportPx = { width: 390, height: 600 },
  bottomPanelHeightPx = 0,
  topBarHeightPx = 0,
  zoom = 16
) {
  if (!playerPos || !Number.isFinite(playerPos.lat) || !Number.isFinite(playerPos.lng)) {
    return { lat: 49.6018, lng: 13.8635, offsetYPx: 0 };
  }

  const H = Math.max(120, Number(viewportPx?.height) || 600);
  const bottomObs = Math.max(0, Math.min(H * 0.72, Number(bottomPanelHeightPx) || 0));
  const topObs = Math.max(0, Math.min(H * 0.35, Number(topBarHeightPx) || 0));

  // Viditelný vertikální střed je uprostřed mezi horní lištou a horní hranou spodního panelu
  const visibleCenterY = topObs + (H - topObs - bottomObs) / 2;
  const containerCenterY = H / 2;
  // O kolik pixelů níže má být střed celé mapy, aby hráč (na visibleCenterY) byl nad spodním panelem:
  const offsetYPx = Math.round(containerCenterY - visibleCenterY);

  if (Math.abs(offsetYPx) < 2) {
    return { lat: playerPos.lat, lng: playerPos.lng, offsetYPx: 0 };
  }

  // Převod posunu v pixelech na zeměpisnou šířku při daném zoomu (Web Mercator: 256 * 2^zoom px na 360°)
  const worldPixels = 256 * Math.pow(2, Math.max(3, Math.min(20, Number(zoom) || 16)));
  const cosLat = Math.cos((playerPos.lat * Math.PI) / 180);
  const degPerPixelLat = (360 / worldPixels) * cosLat;

  // Pokud je spodní panel vysunutý (offsetYPx > 0), posuneme střed mapy mírně na jih,
  // takže značka hráče se vykreslí výše (v odkryté horní části mapy).
  const targetLat = playerPos.lat - offsetYPx * degPerPixelLat;

  return {
    lat: Number(targetLat.toFixed(7)),
    lng: playerPos.lng,
    offsetYPx,
  };
}

/**
 * Vytvoří výchozí stav telemetrie pro výpravu (Bod 28).
 */
export function createTelemetryState(now = Date.now()) {
  return {
    startedAtMs: now,
    lastTickMs: now,
    activeWalkMs: 0,
    pausedMs: 0,
    isPaused: false,
    recentSpeedSamples: [], // [{ ts, speedMs }]
    currentSpeedKmH: 0,
    lastAcceptedPos: null,
    lastAcceptedTs: null,
    // Nadmořská výška a převýšení
    altitudeM: null,
    altitudeSource: null, // 'terrain_model' | 'gps_wgs84' | null
    elevationAnchorM: null,
    elevationSmoothedM: null,
    elevationGainM: 0,
    elevationLossM: 0,
    lastValidFixTs: null,
    lastKnownPosition: null,
  };
}

/**
 * Aktualizuje čas chůze a celkový čas výpravy (odlišuje aktivní chůzi od pauzy — Bod 28).
 */
export function updateTelemetryTimers(telemetry, now = Date.now(), isActiveWalk = false) {
  if (!telemetry) return createTelemetryState(now);
  const dt = Math.max(0, now - (telemetry.lastTickMs || now));
  const cappedDt = Math.min(dt, 60000); // Ochrana proti skoku po uspání

  const nextActiveMs = isActiveWalk ? (telemetry.activeWalkMs || 0) + cappedDt : (telemetry.activeWalkMs || 0);
  const nextPausedMs = !isActiveWalk ? (telemetry.pausedMs || 0) + cappedDt : (telemetry.pausedMs || 0);

  return {
    ...telemetry,
    lastTickMs: now,
    activeWalkMs: nextActiveMs,
    pausedMs: nextPausedMs,
    isPaused: !isActiveWalk,
  };
}

/**
 * Zpracuje nový vzorek nadmořské výšky s hysterezním filtrem (pásmo necitlivosti 4,5 m),
 * takže 10 minut stání na místě s kolísáním GPS výšky nepřidá žádné falešné stoupání ani klesání (Bod 28).
 *
 * @param {Object} telemetry
 * @param {number|null|undefined} rawAltitudeM
 * @param {'terrain_model'|'gps_wgs84'|null} source
 * @param {boolean} isMoving - zda se uživatel prokazatelně pohybuje
 * @returns {Object} aktualizovaný telemetry objekt
 */
export function updateTelemetryAltitude(telemetry, rawAltitudeM, source = 'gps_wgs84', isMoving = true) {
  if (!telemetry) telemetry = createTelemetryState();

  // Chybějící nebo neplatná výška (nikdy nedosazujeme 0 m!)
  if (rawAltitudeM == null || !Number.isFinite(Number(rawAltitudeM))) {
    return telemetry;
  }

  const alt = Number(rawAltitudeM);
  if (alt < -400 || alt > 9000) {
    return telemetry;
  }

  // Exponenciální vyhlazení (EMA)
  const prevSmoothed = telemetry.elevationSmoothedM != null ? telemetry.elevationSmoothedM : alt;
  const alpha = source === 'terrain_model' ? 0.55 : 0.25;
  const smoothed = prevSmoothed + alpha * (alt - prevSmoothed);

  let anchor = telemetry.elevationAnchorM != null ? telemetry.elevationAnchorM : smoothed;
  let gain = telemetry.elevationGainM || 0;
  let loss = telemetry.elevationLossM || 0;

  // Pokud hráč stojí na místě, neakumulujeme šum GPS výšky do nastoupaných metrů
  if (isMoving) {
    const diff = smoothed - anchor;
    if (diff >= ELEVATION_HYSTERESIS_M) {
      gain += Math.round(diff);
      anchor = smoothed;
    } else if (diff <= -ELEVATION_HYSTERESIS_M) {
      loss += Math.round(Math.abs(diff));
      anchor = smoothed;
    }
  }

  return {
    ...telemetry,
    altitudeM: Math.round(smoothed),
    altitudeSource: source,
    elevationSmoothedM: smoothed,
    elevationAnchorM: anchor,
    elevationGainM: gain,
    elevationLossM: loss,
  };
}

/**
 * Zpracuje GPS vzorek pro výpočet krátkodobě vyhlazené aktuální rychlosti.
 * Při stání na místě a chvění GPS ukazuje 0,0 km/h a nepřičítá falešnou vzdálenost (Bod 28).
 */
export function updateTelemetryFromFix(telemetry, fix, acceptResult, now = Date.now()) {
  let next = updateTelemetryTimers(telemetry, now, true);

  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
    return next;
  }

  const fixTs = Number.isFinite(fix.timestamp) ? fix.timestamp : now;

  // Uložíme poslední známou polohu (pro zobrazení při výpadku GPS — Bod 25)
  if (fix.accuracy <= MAX_GPS_ACCURACY_M) {
    next = {
      ...next,
      lastValidFixTs: fixTs,
      lastKnownPosition: {
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        timestamp: fixTs,
      },
    };
  }

  // Pokud vzorek nebyl přijat jako platný posun (např. chvění na místě pod prahem, nebo nepřesná GPS),
  // považujeme pohyb za nulový (stání na místě -> 0,0 km/h).
  const metersAdded = Number(acceptResult?.metersAdded) || 0;
  const isAcceptedMove = Boolean(acceptResult?.accepted && metersAdded > 0);

  let instantSpeedMs = 0;
  if (isAcceptedMove && next.lastAcceptedPos && next.lastAcceptedTs) {
    const dtSec = Math.max(1, (fixTs - next.lastAcceptedTs) / 1000);
    instantSpeedMs = metersAdded / dtSec;
  } else if (isAcceptedMove && Number.isFinite(fix.speed) && fix.speed > 0) {
    instantSpeedMs = fix.speed;
  } else {
    instantSpeedMs = 0;
  }

  // Uchováme vzorky za posledních 25 sekund
  const recent = [...(next.recentSpeedSamples || []), { ts: fixTs, speedMs: instantSpeedMs, moved: isAcceptedMove }]
    .filter(s => fixTs - s.ts <= 25000)
    .slice(-8);

  const anyMovedRecently = recent.some(s => s.moved && fixTs - s.ts <= 15000);
  let smoothedKmH = 0;

  if (anyMovedRecently) {
    const sumMs = recent.reduce((acc, s) => acc + s.speedMs, 0);
    const avgMs = sumMs / recent.length;
    const rawKmH = avgMs * 3.6;
    smoothedKmH = rawKmH < STATIONARY_SPEED_DEADBAND_KMH ? 0 : Math.round(rawKmH * 10) / 10;
  } else {
    smoothedKmH = 0;
  }

  if (isAcceptedMove) {
    next.lastAcceptedPos = { lat: fix.lat, lng: fix.lng };
    next.lastAcceptedTs = fixTs;
  }

  next.recentSpeedSamples = recent;
  next.currentSpeedKmH = smoothedKmH;

  // Pokud vzorek obsahuje výšku z GPS (altitude), zpracujeme ji pouze tehdy, když nemáme přesnější výšku z modelu terénu
  if (Number.isFinite(fix.altitude) && next.altitudeSource !== 'terrain_model') {
    next = updateTelemetryAltitude(next, fix.altitude, 'gps_wgs84', isAcceptedMove);
  }

  return next;
}

/**
 * Vypočítá souhrnné turistické ukazatele pro hlavní lištu a rozbalovací přehled (Bod 28).
 */
export function computeTouristStatsSummary({
  telemetry,
  walkedMeters = 0,
  nextStopDistanceM = null,
  nextStopTitle = null,
  remainingRouteDistanceM = null,
  remainingRouteMinutes = null,
  isRouteValid = false,
  now = Date.now(),
}) {
  const t = telemetry || createTelemetryState(now);
  const totalElapsedSec = Math.max(0, Math.floor((now - (t.startedAtMs || now)) / 1000));
  const activeWalkSec = Math.max(0, Math.floor((t.activeWalkMs || 0) / 1000));

  // Průměrná rychlost chůze: započítaná vzdálenost dělená časem aktivní chůze (bez pauz)
  let avgWalkSpeedKmH = 0;
  if (walkedMeters >= 15 && activeWalkSec >= 5) {
    avgWalkSpeedKmH = Math.round(((walkedMeters / activeWalkSec) * 3.6) * 10) / 10;
  }

  const currentSpeedKmH = Number.isFinite(t.currentSpeedKmH) && t.currentSpeedKmH >= STATIONARY_SPEED_DEADBAND_KMH
    ? t.currentSpeedKmH
    : 0;

  // Formátování nadmořské výšky: chybějící hodnota je vždy '—', nikdy '0'
  let altitudeLabel = '—';
  let altitudeSourceLabel = 'Výška není k dispozici';
  if (t.altitudeM != null && Number.isFinite(t.altitudeM)) {
    if (t.altitudeSource === 'terrain_model') {
      altitudeLabel = `${Math.round(t.altitudeM)} m n. m. (odhad)`;
      altitudeSourceLabel = 'Odhad z digitálního modelu terénu (Open-Meteo)';
    } else {
      altitudeLabel = `${Math.round(t.altitudeM)} m (odhad GPS WGS84)`;
      altitudeSourceLabel = 'Odhad ze senzoru GPS (vztaženo k elipsoidu WGS84; může se lišit o desítky metrů od m n. m.)';
    }
  }

  // Zbývající vzdálenost a čas: pouze ze společné pěší trasy
  const hasValidRemaining = Boolean(
    isRouteValid &&
    remainingRouteDistanceM != null &&
    Number.isFinite(remainingRouteDistanceM) &&
    remainingRouteDistanceM >= 0
  );

  return {
    walkedMeters: Math.max(0, Math.round(walkedMeters)),
    activeWalkSec,
    totalElapsedSec,
    activeWalkFormatted: formatDurationCz(activeWalkSec),
    totalElapsedFormatted: formatDurationCz(totalElapsedSec),
    currentSpeedKmH,
    currentSpeedFormatted: `${currentSpeedKmH.toFixed(1).replace('.', ',')} km/h`,
    avgWalkSpeedKmH,
    avgWalkSpeedFormatted: `${avgWalkSpeedKmH.toFixed(1).replace('.', ',')} km/h`,
    altitudeM: t.altitudeM != null && Number.isFinite(t.altitudeM) ? Math.round(t.altitudeM) : null,
    altitudeLabel,
    altitudeSourceLabel,
    elevationGainM: Math.max(0, Math.round(t.elevationGainM || 0)),
    elevationLossM: Math.max(0, Math.round(t.elevationLossM || 0)),
    elevationFormatted: `+${Math.max(0, Math.round(t.elevationGainM || 0))} m / -${Math.max(0, Math.round(t.elevationLossM || 0))} m`,
    nextStopDistanceM: nextStopDistanceM != null && Number.isFinite(nextStopDistanceM) ? Math.round(nextStopDistanceM) : null,
    nextStopTitle: nextStopTitle || null,
    remainingDistanceM: hasValidRemaining ? Math.round(remainingRouteDistanceM) : null,
    remainingMinutes: hasValidRemaining && remainingRouteMinutes != null ? Math.max(0, Math.round(remainingRouteMinutes)) : null,
    remainingFormatted: hasValidRemaining
      ? `${formatMetersCz(remainingRouteDistanceM)} (~${Math.max(1, Math.round(remainingRouteMinutes || 1))} min)`
      : '—',
  };
}

export function formatDurationCz(totalSeconds = 0) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h} h ${String(m).padStart(2, '0')} min`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMetersCz(meters) {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return '—';
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
  }
  return `${Math.round(meters)} m`;
}
