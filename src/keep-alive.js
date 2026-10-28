// ============================================================
// CZEKPOINT v1.2 — Běh na pozadí, Kapesní režim, Obnova mezery a Kompas (src/keep-alive.js)
// 1. Web Audio Keep-Alive + MediaSession API ('Výprava běží' / 'Czekpoint GPS aktivní') + WakeLock
// 2. Kapesní režim (#000000 černá obrazovka se zbývající vzdáleností a odemknutím dvojklikem/posuvníkem)
// 3. Background Gap Recovery (> 12 s do 3 km rychlostí <= 3.5 m/s po naplánované trase)
// 4. Vibrace v kapse ([250, 120, 250]) + zvukové upozornění (< 35 m od zastávky nebo při razítku)
// 5. Stabilizace kompasu (sin/cos low-pass 0.88/0.12, deadband 2.5°, spojitý úhel bez skoku 359° -> 0°, 80 ms)
// ============================================================

import { haversineMeters as distanceMeters } from './domain.js';

/**
 * 3. UKLIDNĚNÍ KOMPASU („KOMPAS LÍTÁ JAK ZBĚSILÝ“)
 * Exponenciální vyhlazování přes sin/cos (Low-pass filter 0.88 / 0.12),
 * pásmo necitlivosti (Deadband 2.5°), plynulý přechod přes 360° (continuousAngle)
 * a omezení překreslování na max 12× za sekundu (80 ms).
 */
export function createCompassStabilizer(options = {}) {
  const alpha = Number(options.alpha) > 0 && Number(options.alpha) < 1 ? Number(options.alpha) : 0.12;
  const retain = 1 - alpha; // 0.88
  const deadbandDeg = Number(options.deadbandDeg) >= 0 ? Number(options.deadbandDeg) : 2.5;
  const minIntervalMs = Number(options.minIntervalMs) >= 0 ? Number(options.minIntervalMs) : 80;

  let smoothSin = 0;
  let smoothCos = 1;
  let initialized = false;
  let lastHeading = 0;
  let continuousAngle = 0;
  let lastUpdateMs = 0;

  return {
    reset() {
      smoothSin = 0;
      smoothCos = 1;
      initialized = false;
      lastHeading = 0;
      continuousAngle = 0;
      lastUpdateMs = 0;
    },
    update(rawHeadingDeg, nowMs = Date.now()) {
      const normalizedRaw = ((Number(rawHeadingDeg) % 360) + 360) % 360;
      const rawRad = (normalizedRaw * Math.PI) / 180;

      if (!initialized) {
        smoothSin = Math.sin(rawRad);
        smoothCos = Math.cos(rawRad);
        initialized = true;
        lastHeading = normalizedRaw;
        continuousAngle = normalizedRaw;
        lastUpdateMs = nowMs;
        return {
          updated: true,
          smoothedHeading: normalizedRaw,
          continuousAngle,
          cssTransform: `rotate(${(-continuousAngle).toFixed(1)}deg)`,
        };
      }

      // Exponenciální vyhlazování přes sin/cos
      smoothSin = smoothSin * retain + Math.sin(rawRad) * alpha;
      smoothCos = smoothCos * retain + Math.cos(rawRad) * alpha;

      let newHeading = (Math.atan2(smoothSin, smoothCos) * 180) / Math.PI;
      newHeading = ((newHeading % 360) + 360) % 360;

      // Omezení frekvence překreslování (80 ms = max 12.5× za sekundu)
      if (nowMs - lastUpdateMs < minIntervalMs) {
        return {
          updated: false,
          smoothedHeading: lastHeading,
          continuousAngle,
          cssTransform: `rotate(${(-continuousAngle).toFixed(1)}deg)`,
        };
      }

      // Nejkratší úhlový rozdíl v rozsahu [-180, 180]
      const deltaAngle = ((newHeading - lastHeading + 540) % 360) - 180;

      // Pásmo necitlivosti (Deadband 2.5°)
      if (Math.abs(deltaAngle) < deadbandDeg) {
        return {
          updated: false,
          smoothedHeading: lastHeading,
          continuousAngle,
          cssTransform: `rotate(${(-continuousAngle).toFixed(1)}deg)`,
        };
      }

      continuousAngle += deltaAngle;
      lastHeading = newHeading;
      lastUpdateMs = nowMs;

      return {
        updated: true,
        smoothedHeading: newHeading,
        continuousAngle,
        cssTransform: `rotate(${(-continuousAngle).toFixed(1)}deg)`,
      };
    },
    getState() {
      return {
        smoothedHeading: lastHeading,
        continuousAngle,
        smoothSin,
        smoothCos,
      };
    },
  };
}

/**
 * 8.3 DOPLNĚNÍ TRASY PO PROBUZENÍ (Background Gap Recovery)
 * Pokud mobil v kapse usnul a po rozsvícení displeje vznikla mezera > 12 s
 * (a posun je do 3 km s průměrnou rychlostí <= 3.5 m/s), dopočítá body
 * podél naplánované trasy (nebo přímkou), takže se zpětně odkryje mlha,
 * přičtou ušlé metry a uznají navštívené zastávky.
 */
export function interpolateBackgroundGap({
  prevFix,
  nextFix,
  plannedCoords = [],
  minGapSec = 12,
  maxDistM = 3000,
  maxSpeedMps = 3.5,
  stepMeters = 22,
} = {}) {
  if (!prevFix || !nextFix) {
    return { recovered: false, points: [], distanceM: 0, elapsedSec: 0 };
  }
  const t1 = Number(prevFix.ts || prevFix.timestamp || 0);
  const t2 = Number(nextFix.ts || nextFix.timestamp || Date.now());
  const elapsedSec = Math.max(0, (t2 - t1) / 1000);
  if (elapsedSec <= minGapSec) {
    return { recovered: false, points: [], distanceM: 0, elapsedSec };
  }

  const directDistM = distanceMeters(
    { lat: prevFix.lat, lng: prevFix.lng },
    { lat: nextFix.lat, lng: nextFix.lng }
  );

  if (directDistM < 18 || directDistM > maxDistM) {
    return { recovered: false, points: [], distanceM: directDistM, elapsedSec };
  }

  const avgSpeedMps = directDistM / elapsedSec;
  if (avgSpeedMps > maxSpeedMps) {
    return { recovered: false, points: [], distanceM: directDistM, elapsedSec, avgSpeedMps };
  }

  // Zkusíme najít úsek na naplánované trase mezi prevFix a nextFix
  let pathVertices = [];
  if (Array.isArray(plannedCoords) && plannedCoords.length >= 2) {
    let idxStart = -1;
    let idxEnd = -1;
    let bestStartDist = Infinity;
    let bestEndDist = Infinity;

    for (let i = 0; i < plannedCoords.length; i++) {
      const c = plannedCoords[i];
      const lat = Array.isArray(c) ? c[0] : c.lat;
      const lng = Array.isArray(c) ? c[1] : c.lng;
      const dStart = distanceMeters({ lat: prevFix.lat, lng: prevFix.lng }, { lat, lng });
      const dEnd = distanceMeters({ lat: nextFix.lat, lng: nextFix.lng }, { lat, lng });
      if (dStart < bestStartDist) {
        bestStartDist = dStart;
        idxStart = i;
      }
      if (dEnd < bestEndDist) {
        bestEndDist = dEnd;
        idxEnd = i;
      }
    }

    // Pokud byl hráč blízko naplánované trasy (< 160 m), vedeme interpolaci po ní
    if (bestStartDist <= 160 && bestEndDist <= 160 && idxStart !== -1 && idxEnd !== -1 && idxStart !== idxEnd) {
      const step = idxStart <= idxEnd ? 1 : -1;
      pathVertices.push({ lat: prevFix.lat, lng: prevFix.lng });
      for (let i = idxStart; i !== idxEnd + step; i += step) {
        const c = plannedCoords[i];
        const lat = Array.isArray(c) ? c[0] : c.lat;
        const lng = Array.isArray(c) ? c[1] : c.lng;
        pathVertices.push({ lat, lng });
      }
      pathVertices.push({ lat: nextFix.lat, lng: nextFix.lng });
    }
  }

  if (pathVertices.length < 2) {
    pathVertices = [
      { lat: prevFix.lat, lng: prevFix.lng },
      { lat: nextFix.lat, lng: nextFix.lng },
    ];
  }

  // Rozvzorkujeme pathVertices po ~stepMeters metrech
  const interpolated = [];
  let totalPathDistM = 0;
  for (let i = 1; i < pathVertices.length; i++) {
    const a = pathVertices[i - 1];
    const b = pathVertices[i];
    const segDist = distanceMeters(a, b);
    if (segDist <= 0.5) continue;
    totalPathDistM += segDist;
    const steps = Math.max(1, Math.min(140, Math.ceil(segDist / stepMeters)));
    for (let s = 1; s <= steps; s++) {
      const ratio = s / steps;
      interpolated.push({
        lat: Number((a.lat + (b.lat - a.lat) * ratio).toFixed(6)),
        lng: Number((a.lng + (b.lng - a.lng) * ratio).toFixed(6)),
      });
    }
  }

  // Přiřadíme časové značky rovnoměrně mezi t1 a t2
  const count = interpolated.length;
  const timedPoints = interpolated.map((pt, idx) => ({
    lat: pt.lat,
    lng: pt.lng,
    ts: Math.round(t1 + ((idx + 1) / Math.max(1, count)) * (t2 - t1)),
    interpolated: true,
  }));

  return {
    recovered: timedPoints.length > 0,
    points: timedPoints,
    distanceM: Math.round(totalPathDistM || directDistM),
    elapsedSec: Math.round(elapsedSec),
    avgSpeedMps: Number(avgSpeedMps.toFixed(2)),
  };
}

/**
 * 8.4 VIBRACE A ZVUK V KAPSE PŘI PŘIBLÍŽENÍ K ZASTÁVCE (< 35 m nebo razítko)
 */
let sharedAudioCtx = null;

function getSharedAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch (_) {
      return null;
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function triggerPocketProximityAlert(kind = 'proximity') {
  // Vibrace: [250, 120, 250] dle zadání #10
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([250, 120, 250]);
    }
  } catch (_) {}

  // Jemný dvoutónový gong přes Web Audio API
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return true;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const firstFreq = kind === 'stamp' ? 587.33 : 523.25; // D5 nebo C5
    const secondFreq = kind === 'stamp' ? 880.0 : 659.25; // A5 nebo E5
    osc.frequency.setValueAtTime(firstFreq, now);
    osc.frequency.setValueAtTime(secondFreq, now + 0.16);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.46);
  } catch (_) {}

  return true;
}

export function playTurnAudioCue(direction = 'straight') {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    if (direction === 'left') {
      // 1x beep 440 Hz (~0.18s)
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.20);
    } else if (direction === 'right') {
      // 2x beep 587 Hz
      osc.frequency.setValueAtTime(587.33, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (direction === 'arrive') {
      // Akord 523.25, 659.25, 783.99 Hz
      osc.frequency.setValueAtTime(523.25, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.37);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now);
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.37);
    } else {
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        if (direction === 'right') {
          navigator.vibrate([90, 60, 90]);
        } else if (direction === 'left') {
          navigator.vibrate([140]);
        } else if (direction === 'arrive') {
          navigator.vibrate([100, 50, 150]);
        }
      } catch {}
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 8.1 & 8.2 SPRÁVCE BĚHU NA POZADÍ A KAPESNÍHO REŽIMU
 * Udržuje GPS, pohyb postavičky i hlasovou navigaci v chodu i při zhasnutém displeji pomocí:
 * - Neškrceného Web Worker časovače (1000 ms tik na pozadí mimo hlavní vlákno)
 * - Screen Wake Lock API (pokud je displej zapnutý nebo v Kapesním režimu)
 * - Tiché neslyšné smyčky Web Audio API + MediaSession ('Výprava běží' / 'Czekpoint GPS aktivní')
 */
export function createKeepAliveController() {
  let active = false;
  let pocketMode = false;
  let wakeLockSentinel = null;
  let keepAliveOsc = null;
  let keepAliveGain = null;
  let heartbeatTimer = null;
  let bgWorker = null;
  let bgFallbackTimer = null;
  let lastTickFiredAt = 0;
  const tickListeners = new Set();

  function fireBackgroundTick(force = false) {
    if (!active && !force) return;
    const now = Date.now();
    // Zabráníme duplicitnímu tiku pod 450 ms, pokud se sejdou Worker i Audio timeupdate
    if (!force && now - lastTickFiredAt < 450) return;
    lastTickFiredAt = now;

    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    for (const fn of tickListeners) {
      try {
        fn(now);
      } catch (_) {}
    }
  }

  function startBackgroundWorker() {
    stopBackgroundWorker();
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
      try {
        const workerCode = `
          let timer = null;
          self.onmessage = function(e) {
            if (e.data === 'start') {
              if (timer) clearInterval(timer);
              timer = setInterval(function() { self.postMessage('tick'); }, 1000);
            } else if (e.data === 'stop') {
              if (timer) clearInterval(timer);
              timer = null;
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        bgWorker = new Worker(blobUrl);
        bgWorker.onmessage = () => {
          fireBackgroundTick();
        };
        bgWorker.postMessage('start');
      } catch (_) {
        bgWorker = null;
      }
    }
    bgFallbackTimer = setInterval(() => {
      fireBackgroundTick();
    }, 1000);
  }

  function stopBackgroundWorker() {
    if (bgWorker) {
      try {
        bgWorker.postMessage('stop');
        bgWorker.terminate();
      } catch (_) {}
      bgWorker = null;
    }
    if (bgFallbackTimer) {
      clearInterval(bgFallbackTimer);
      bgFallbackTimer = null;
    }
  }

  async function acquireWakeLock() {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return false;
    try {
      if (wakeLockSentinel && !wakeLockSentinel.released) return true;
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener?.('release', () => {
        wakeLockSentinel = null;
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function releaseWakeLock() {
    if (!wakeLockSentinel) return;
    try {
      await wakeLockSentinel.release();
    } catch (_) {}
    wakeLockSentinel = null;
  }

  function startAudioAndMediaSession(subtitle = 'Czekpoint GPS aktivní') {
    try {
      const ctx = getSharedAudioContext();
      if (ctx && !keepAliveOsc) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        // Sub-audible 22 Hz s téměř nulovou hlasitostí udrží audio vlákno aktivní na iOS/Android
        osc.type = 'sine';
        osc.frequency.value = 22;
        gain.gain.value = 0.0002;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        keepAliveOsc = osc;
        keepAliveGain = gain;
      }
    } catch (_) {}

    try {
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Výprava běží',
          artist: subtitle || 'Czekpoint GPS aktivní',
          album: 'Czekpoint v1.2',
        });
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch (_) {}
  }

  function stopAudioAndMediaSession() {
    try {
      if (keepAliveOsc) {
        keepAliveOsc.stop();
        keepAliveOsc.disconnect();
      }
      if (keepAliveGain) {
        keepAliveGain.disconnect();
      }
    } catch (_) {}
    keepAliveOsc = null;
    keepAliveGain = null;

    try {
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
      }
    } catch (_) {}
  }

  return {
    async start(subtitle = 'Czekpoint GPS aktivní') {
      active = true;
      await acquireWakeLock();
      startAudioAndMediaSession(subtitle);
      startBackgroundWorker();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (!active) return;
        const ctx = getSharedAudioContext();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          acquireWakeLock();
        }
      }, 4000);
      return true;
    },
    async stop() {
      active = false;
      pocketMode = false;
      stopBackgroundWorker();
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      stopAudioAndMediaSession();
      await releaseWakeLock();
      return true;
    },
    onTick(fn) {
      if (typeof fn === 'function') {
        tickListeners.add(fn);
      }
      return () => tickListeners.delete(fn);
    },
    triggerManualTick() {
      fireBackgroundTick(true);
    },
    updateMediaSessionStatus(subtitle) {
      if (!active) return;
      startAudioAndMediaSession(subtitle);
    },
    setPocketMode(enabled) {
      pocketMode = Boolean(enabled);
      if (pocketMode && active) {
        acquireWakeLock();
      }
      return pocketMode;
    },
    isPocketMode() {
      return pocketMode;
    },
    isActive() {
      return active;
    },
  };
}
