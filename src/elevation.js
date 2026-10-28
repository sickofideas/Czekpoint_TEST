// ============================================================
// CZEKPOINT v1.2 — Výškový profil a převýšení trasy (src/elevation.js)
// - Vzorkuje 25–40 rovnoměrných bodů po naplánované trase
// - Dotazuje bezplatné Open-Meteo Elevation API (https://api.open-meteo.com/v1/elevation)
// - Při offline stavu nebo výpadku sítě použije lokální deterministický výškový model ČR (Brdy / Třemšín / ČR)
// - Počítá celkové stoupání (+XX m), klesání (-XX m), minEle a maxEle
// - Vykresluje přehledný SVG výškový profil (.elevation-profile-card) s vyznačenými zastávkami a polohou hráče
// ============================================================

import { haversineMeters } from './domain.js';
import { escapeHtml as e } from './ui.js';

const ELEVATION_CACHE_KEY = 'czekpoint_v12_elevation_cache';
const MAX_CACHE_ENTRIES = 40;

function normalizeCoordPair(pt) {
  if (!pt) return null;
  if (Array.isArray(pt) && pt.length >= 2) {
    const lat = Number(pt[0]);
    const lng = Number(pt[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  const lat = Number(pt.lat);
  const lng = Number(pt.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Lokální deterministický model nadmořské výšky pro ČR (zejména Podbrdsko, Brdy, Třemšín a střední Čechy),
 * používaný jako okamžitý offline fallback.
 */
export function estimateCzechTerrainElevationM(lat, lng) {
  const baseLat = Number(lat) || 49.6014;
  const baseLng = Number(lng) || 13.8644;

  // Vzdálenost od vrcholu Třemšína (49.5675, 13.8380 -> 827 m n. m.)
  const dTremsinM = haversineMeters({ lat: baseLat, lng: baseLng }, { lat: 49.5675, lng: 13.8380 }) ?? 10000;
  const tremsinPeakBoost = Math.max(0, 295 * Math.exp(-(dTremsinM * dTremsinM) / (2 * 3800 * 3800)));

  // Vzdálenost od Prahy / Brdského hřebene (Praha 862 m n. m. - 49.658, 13.819)
  const dPrahaBrdyM = haversineMeters({ lat: baseLat, lng: baseLng }, { lat: 49.6580, lng: 13.8190 }) ?? 12000;
  const brdyBoost = Math.max(0, 310 * Math.exp(-(dPrahaBrdyM * dPrahaBrdyM) / (2 * 4500 * 4500)));

  // Jemné zvlnění krajiny podle zeměpisných souřadnic
  const wave1 = Math.sin(baseLat * 290) * 18 + Math.cos(baseLng * 240) * 14;
  const wave2 = Math.sin((baseLat + baseLng) * 620) * 8;

  const rawEle = 515 + tremsinPeakBoost + brdyBoost + wave1 + wave2;
  return Math.round(Math.max(180, Math.min(1602, rawEle)));
}

/**
 * Ze souřadnic naplánované trasy vyvzorkuje 25–40 rovnoměrných bodů se vzdáleností distKm.
 */
export function sampleRouteCoordinates(coordinates, targetCount = 32) {
  const clean = (Array.isArray(coordinates) ? coordinates : [])
    .map(normalizeCoordPair)
    .filter(Boolean);

  const count = Math.max(25, Math.min(40, Number(targetCount) || 32));

  if (clean.length === 0) {
    const def = { lat: 49.6014, lng: 13.8644 };
    return Array.from({ length: count }, (_, idx) => ({
      lat: def.lat + idx * 0.0002,
      lng: def.lng + idx * 0.0002,
      distKm: Number((idx * 0.03).toFixed(3)),
    }));
  }

  if (clean.length === 1) {
    const p = clean[0];
    return Array.from({ length: count }, (_, idx) => ({
      lat: p.lat,
      lng: p.lng,
      distKm: 0,
      index: idx,
    }));
  }

  // Spočítáme kumulativní délku po jednotlivých segmentech
  const cumMeters = [0];
  let totalMeters = 0;
  for (let i = 1; i < clean.length; i++) {
    const segM = haversineMeters(clean[i - 1], clean[i]) ?? 0;
    totalMeters += segM;
    cumMeters.push(totalMeters);
  }

  if (totalMeters <= 1) {
    return Array.from({ length: count }, (_, idx) => ({
      lat: clean[0].lat,
      lng: clean[0].lng,
      distKm: 0,
      index: idx,
    }));
  }

  const sampled = [];
  for (let s = 0; s < count; s++) {
    const ratio = count <= 1 ? 0 : s / (count - 1);
    const targetM = ratio * totalMeters;

    // Najdeme segment obsahující targetM
    let segIdx = 0;
    while (segIdx < cumMeters.length - 2 && cumMeters[segIdx + 1] < targetM) {
      segIdx++;
    }

    const m0 = cumMeters[segIdx];
    const m1 = cumMeters[segIdx + 1];
    const segSpan = Math.max(0.0001, m1 - m0);
    const localT = Math.max(0, Math.min(1, (targetM - m0) / segSpan));

    const a = clean[segIdx];
    const b = clean[segIdx + 1] || a;
    const lat = Number((a.lat + (b.lat - a.lat) * localT).toFixed(6));
    const lng = Number((a.lng + (b.lng - a.lng) * localT).toFixed(6));

    sampled.push({
      lat,
      lng,
      distKm: Number((targetM / 1000).toFixed(3)),
    });
  }

  return sampled;
}

/**
 * Spočítá celkové stoupání (gainM), klesání (lossM), minEle a maxEle z pole výškových bodů.
 */
export function computeElevationMetrics(points, deadbandM = 2) {
  const arr = Array.isArray(points) ? points : [];
  if (arr.length === 0) {
    return {
      gainM: 0,
      lossM: 0,
      minEle: 500,
      maxEle: 500,
      minEleM: 500,
      maxEleM: 500,
    };
  }

  const elevations = arr.map((p) => {
    if (typeof p === 'number') return p;
    return Number(p?.eleM ?? p?.elevation ?? p?.ele ?? 500);
  });

  let gainM = 0;
  let lossM = 0;
  let minEle = elevations[0];
  let maxEle = elevations[0];
  let anchorEle = elevations[0];

  for (let i = 1; i < elevations.length; i++) {
    const cur = elevations[i];
    if (cur < minEle) minEle = cur;
    if (cur > maxEle) maxEle = cur;

    const diff = cur - anchorEle;
    if (Math.abs(diff) >= deadbandM) {
      if (diff > 0) gainM += diff;
      else lossM += Math.abs(diff);
      anchorEle = cur;
    }
  }

  const roundedGain = Math.round(gainM);
  const roundedLoss = Math.round(lossM);
  const roundedMin = Math.round(minEle);
  const roundedMax = Math.round(maxEle);

  return {
    gainM: roundedGain,
    lossM: roundedLoss,
    minEle: roundedMin,
    maxEle: roundedMax,
    minEleM: roundedMin,
    maxEleM: roundedMax,
  };
}

export const computeElevationStats = computeElevationMetrics;

/**
 * Sestaví syntetický (offline) výškový profil trasy.
 */
export function buildSyntheticElevationProfile(coordinates, targetCount = 32) {
  const sampled = sampleRouteCoordinates(coordinates, targetCount);
  const points = sampled.map((pt) => {
    const eleM = estimateCzechTerrainElevationM(pt.lat, pt.lng);
    return {
      lat: pt.lat,
      lng: pt.lng,
      distKm: pt.distKm,
      eleM,
      elevation: eleM,
    };
  });

  const metrics = computeElevationMetrics(points);
  const totalDistKm = points.length > 0 ? points[points.length - 1].distKm : 0;

  return {
    points,
    samples: points,
    gainM: metrics.gainM,
    lossM: metrics.lossM,
    minEle: metrics.minEle,
    maxEle: metrics.maxEle,
    minEleM: metrics.minEle,
    maxEleM: metrics.maxEle,
    totalDistKm,
    source: 'offline-model',
  };
}

function readElevationCache(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(ELEVATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed[key] ? parsed[key] : null;
  } catch {
    return null;
  }
}

function writeElevationCache(key, profile) {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(ELEVATION_CACHE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const keys = Object.keys(map);
    if (keys.length >= MAX_CACHE_ENTRIES) {
      delete map[keys[0]];
    }
    map[key] = profile;
    localStorage.setItem(ELEVATION_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Hlavní funkce pro získání výškového profilu trasy:
 * - Vyvzorkuje 25–40 rovnoměrných bodů
 * - Dotáže Open-Meteo Elevation API (`https://api.open-meteo.com/v1/elevation?latitude=...&longitude=...`)
 * - Při offline stavu použije lokální výškový model
 */
export async function fetchRouteElevationProfile(coordinates, options = {}) {
  const sampleCount = Math.max(25, Math.min(40, Number(options.sampleCount) || 32));
  const sampled = sampleRouteCoordinates(coordinates, sampleCount);

  const cacheKey = sampled
    .filter((_, i) => i % 4 === 0 || i === sampled.length - 1)
    .map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`)
    .join('|');

  const cached = readElevationCache(cacheKey);
  if (cached && Array.isArray(cached.points) && cached.points.length >= 25) {
    return cached;
  }

  const fetchFn =
    options.fetchImpl !== undefined
      ? options.fetchImpl
      : typeof fetch === 'function'
      ? fetch.bind(globalThis)
      : null;

  if (fetchFn) {
    try {
      const lats = sampled.map((p) => p.lat.toFixed(5)).join(',');
      const lngs = sampled.map((p) => p.lng.toFixed(5)).join(',');
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;

      const res = await fetchFn(url, { signal: options.signal });
      if (res && res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.elevation) && data.elevation.length === sampled.length) {
          const points = sampled.map((pt, idx) => {
            const rawEle = Number(data.elevation[idx]);
            const eleM = Number.isFinite(rawEle)
              ? Math.round(rawEle)
              : estimateCzechTerrainElevationM(pt.lat, pt.lng);
            return {
              lat: pt.lat,
              lng: pt.lng,
              distKm: pt.distKm,
              eleM,
              elevation: eleM,
            };
          });

          const metrics = computeElevationMetrics(points);
          const totalDistKm = points.length > 0 ? points[points.length - 1].distKm : 0;
          const result = {
            points,
            samples: points,
            gainM: metrics.gainM,
            lossM: metrics.lossM,
            minEle: metrics.minEle,
            maxEle: metrics.maxEle,
            minEleM: metrics.minEle,
            maxEleM: metrics.maxEle,
            totalDistKm,
            source: 'open-meteo',
          };
          writeElevationCache(cacheKey, result);
          return result;
        }
      }
    } catch {
      // Při chybě sítě plynule přejdeme na lokální výškový model
    }
  }

  return buildSyntheticElevationProfile(coordinates, sampleCount);
}

/**
 * Vykreslí samotné SVG výškového profilu.
 */
export function renderElevationProfileSvg(profile, stops = [], progressRatio = null) {
  if (!profile || !Array.isArray(profile.points) || profile.points.length < 2) {
    return '';
  }

  const pts = profile.points;
  const width = 560;
  const height = 135;
  const padLeft = 38;
  const padRight = 18;
  const padTop = 22;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const minE = Number.isFinite(profile.minEle) ? profile.minEle : 450;
  const maxE = Number.isFinite(profile.maxEle) ? profile.maxEle : 650;
  const eleSpan = Math.max(20, maxE - minE);
  const totalKm = Math.max(0.1, pts[pts.length - 1].distKm || 1);

  const coordsSvg = pts.map((p, idx) => {
    const xRatio = totalKm > 0 ? p.distKm / totalKm : idx / Math.max(1, pts.length - 1);
    const yRatio = (p.eleM - minE) / eleSpan;
    const x = Number((padLeft + xRatio * plotW).toFixed(1));
    const y = Number((padTop + plotH - yRatio * plotH).toFixed(1));
    return { x, y, eleM: p.eleM, distKm: p.distKm };
  });

  const linePoints = coordsSvg.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPath = `M ${coordsSvg[0].x},${padTop + plotH} L ${ coordsSvg.map((c) => `${c.x},${c.y}`).join(' L ') } L ${coordsSvg[coordsSvg.length - 1].x},${padTop + plotH} Z`;

  // Zastávky rozložené podél profilu
  const stopList = Array.isArray(stops) ? stops.filter(Boolean) : [];
  const stopMarkersSvg = stopList
    .slice(0, 8)
    .map((stop, idx) => {
      const stopRatio = (idx + 1) / (stopList.length + 1);
      const ptIdx = Math.min(coordsSvg.length - 1, Math.max(0, Math.round(stopRatio * (coordsSvg.length - 1))));
      const c = coordsSvg[ptIdx];
      const shortTitle = String(stop.title || `Bod ${idx + 1}`).slice(0, 16);
      return `
        <g class="ele-stop-marker">
          <line x1="${c.x}" y1="${c.y}" x2="${c.x}" y2="${padTop + plotH}" stroke="#8c5a2b" stroke-width="1" stroke-dasharray="2,2" opacity="0.7" />
          <circle cx="${c.x}" cy="${c.y}" r="4" fill="#fffdf7" stroke="#5c3a18" stroke-width="2" />
          <text x="${c.x}" y="${Math.max(12, c.y - 7)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#3d2712">${e(shortTitle)}</text>
        </g>
      `;
    })
    .join('');

  // Ukazatel aktuální polohy hráče na výškovém profilu
  let playerMarkerSvg = '';
  if (progressRatio != null && Number.isFinite(Number(progressRatio))) {
    const clamped = Math.max(0, Math.min(1, Number(progressRatio)));
    const pIdx = Math.min(coordsSvg.length - 1, Math.max(0, Math.round(clamped * (coordsSvg.length - 1))));
    const pc = coordsSvg[pIdx];
    playerMarkerSvg = `
      <g class="ele-player-marker" aria-label="Tvoje poloha na výškovém profilu">
        <circle cx="${pc.x}" cy="${pc.y}" r="7" fill="rgba(46, 125, 50, 0.25)" />
        <circle cx="${pc.x}" cy="${pc.y}" r="4.5" fill="#2e7d32" stroke="#ffffff" stroke-width="2" />
      </g>
    `;
  }

  const totalKmLabel = `${totalKm.toFixed(1).replace('.', ',')} km`;

  return `
    <svg class="elevation-profile-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Výškový profil trasy: stoupání +${profile.gainM} m, klesání -${profile.lossM} m">
      <defs>
        <linearGradient id="eleFillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6b8e3d" stop-opacity="0.52" />
          <stop offset="100%" stop-color="#d9c398" stop-opacity="0.10" />
        </linearGradient>
      </defs>
      <!-- Pomocné výškové linky -->
      <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}" stroke="#d6c6a5" stroke-width="1" stroke-dasharray="3,3" />
      <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" stroke="#b8a27a" stroke-width="1.2" />
      <text x="${padLeft - 5}" y="${padTop + 4}" text-anchor="end" font-size="10" fill="#6b533b">${maxE} m</text>
      <text x="${padLeft - 5}" y="${padTop + plotH}" text-anchor="end" font-size="10" fill="#6b533b">${minE} m</text>
      <text x="${padLeft}" y="${height - 6}" text-anchor="start" font-size="10" fill="#6b533b">0 km</text>
      <text x="${width - padRight}" y="${height - 6}" text-anchor="end" font-size="10" fill="#6b533b">${totalKmLabel}</text>

      <!-- Vyplněná křivka nadmořské výšky -->
      <path d="${areaPath}" fill="url(#eleFillGrad)" />
      <polyline fill="none" stroke="#476924" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" points="${linePoints}" />

      ${stopMarkersSvg}
      ${playerMarkerSvg}
    </svg>
  `;
}

/**
 * Vykreslí kompletní HTML kartu výškového profilu (.elevation-profile-card) pod mapou.
 */
export function renderElevationProfileCardHtml(profile, stops = [], progressRatio = null) {
  if (!profile || !Array.isArray(profile.points) || profile.points.length < 2) {
    return '';
  }

  const svgHtml = renderElevationProfileSvg(profile, stops, progressRatio);

  return `
    <div class="elevation-profile-card" data-testid="elevation-profile-card">
      <div class="elevation-profile-header">
        <strong class="elevation-profile-title">⛰️ Výškový profil trasy</strong>
        <div class="elevation-profile-badges">
          <span class="ele-badge gain">📈 Stoupání +${profile.gainM} m</span>
          <span class="ele-badge loss">📉 Klesání -${profile.lossM} m</span>
          <span class="ele-badge range">↕ ${profile.minEle}–${profile.maxEle} m n. m.</span>
        </div>
      </div>
      <div class="elevation-profile-svg-wrap">
        ${svgHtml}
      </div>
    </div>
  `;
}
