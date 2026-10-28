/**
 * Czekpoint — Stručné počasí pro následujících 60 minut (Bod 29)
 * Využívá veřejné rozhraní Open-Meteo (15minutová / hodinová předpověď) se šetrným dotazováním
 * (nejvýše jednou za 15 minut nebo při posunu o více než 3 km, se zaokrouhlenou polohou).
 */

import { haversineMeters } from './domain.js';

export const WEATHER_CACHE_KEY = 'czekpoint.weather.v1';
export const WEATHER_MIN_INTERVAL_MS = 15 * 60 * 1000; // 15 minut
export const WEATHER_MIN_MOVE_M = 3000; // 3 km

let memoryWeatherState = {
  lastAttemptMs: 0,
  lastCoords: null,
  inFlight: null,
};

/**
 * Zaokrouhlí souřadnice na 2 desetinná místa (~1,1 km), aby se neposílala přesná poloha uživatele.
 */
export function roundWeatherCoords(pos) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) {
    return { lat: 49.60, lng: 13.86 };
  }
  return {
    lat: Math.round(pos.lat * 100) / 100,
    lng: Math.round(pos.lng * 100) / 100,
  };
}

/**
 * Rozhodne, zda je povoleno odeslat nový síťový dotaz na počasí (omezení: min. 15 min nebo posun > 3 km).
 */
export function shouldFetchWeather(pos, cached, now = Date.now()) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return false;
  if (!cached || !cached.fetchedAtMs || !cached.coords) return true;

  const elapsedMs = now - cached.fetchedAtMs;
  if (elapsedMs >= WEATHER_MIN_INTERVAL_MS) return true;

  const movedM = haversineMeters(pos, cached.coords) ?? 0;
  if (movedM >= WEATHER_MIN_MOVE_M) return true;

  return false;
}

/**
 * Sestaví upřímnou jednořádkovou větu pro sbalený přehled podle 15minutových / hodinových dat (Bod 29).
 * Nikdy nepředstírá minutovou přesnost radaru (např. „za 7 minut začne pršet“).
 */
export function buildWeatherSentence({ temperatureC, precipNext60Mm, windSpeedKmH, weatherCode }) {
  const tempRound = temperatureC != null && Number.isFinite(temperatureC) ? Math.round(temperatureC) : null;
  const precip = Number.isFinite(precipNext60Mm) ? Math.round(precipNext60Mm * 10) / 10 : 0;
  const wind = Number.isFinite(windSpeedKmH) ? Math.round(windSpeedKmH) : 0;

  let precipPhrase = 'V příští hodině bez očekávaných srážek';
  let icon = '🌤️';

  if (weatherCode != null && weatherCode >= 95) {
    precipPhrase = `V příští hodině hrozí bouřka nebo přeháňky (${precip.toFixed(1).replace('.', ',')} mm)`;
    icon = '⛈️';
  } else if (precip >= 1.5) {
    precipPhrase = `V příští hodině se očekává déšť (kolem ${precip.toFixed(1).replace('.', ',')} mm)`;
    icon = '🌧️';
  } else if (precip >= 0.2) {
    precipPhrase = `V příští hodině možné slabé přeháňky (cca ${precip.toFixed(1).replace('.', ',')} mm)`;
    icon = '🌦️';
  } else if (weatherCode != null && weatherCode >= 71 && weatherCode <= 77) {
    precipPhrase = 'V příští hodině možné sněžení';
    icon = '🌨️';
  } else if (weatherCode != null && weatherCode >= 45 && weatherCode <= 48) {
    precipPhrase = 'V příští hodině mlhavo, bez výrazných srážek';
    icon = '🌫️';
  } else if (weatherCode != null && weatherCode <= 1) {
    icon = '☀️';
  }

  const tempPart = tempRound != null ? `, kolem ${tempRound} °C` : '';
  const windPart = wind >= 28 ? `, čerstvý vítr ${wind} km/h` : '';

  return {
    icon,
    sentence: `${precipPhrase}${tempPart}${windPart}.`,
  };
}

/**
 * Zpracuje JSON odpověď z Open-Meteo (current + minutely_15 / hourly) na strukturovaný přehled na 60 minut.
 */
export function parseOpenMeteoForecast(data, coords, locationLabel = 'Rožmitálsko a okolí', now = Date.now()) {
  if (!data || typeof data !== 'object') {
    throw new Error('Neplatná odpověď služby počasí.');
  }

  const cur = data.current || {};
  const temperatureC = Number.isFinite(Number(cur.temperature_2m)) ? Number(cur.temperature_2m) : null;
  const apparentTemperatureC = Number.isFinite(Number(cur.apparent_temperature))
    ? Number(cur.apparent_temperature)
    : temperatureC;
  const windSpeedKmH = Number.isFinite(Number(cur.wind_speed_10m)) ? Number(cur.wind_speed_10m) : null;
  const weatherCode = Number.isFinite(Number(cur.weather_code)) ? Number(cur.weather_code) : null;

  // Výpočet očekávaných srážek na následujících 60 minut (4 × 15 min nebo 1 × hodinový úhrn)
  let precipNext60Mm = 0;
  let resolutionLabel = 'hodinový odhad';

  if (Array.isArray(data.minutely_15?.precipitation) && data.minutely_15.precipitation.length >= 4) {
    const times = data.minutely_15.time || [];
    let startIdx = 0;
    if (times.length > 0) {
      const nowIsoPrefix = new Date(now).toISOString().slice(0, 13);
      const foundIdx = times.findIndex(t => typeof t === 'string' && t >= nowIsoPrefix);
      if (foundIdx >= 0) startIdx = foundIdx;
    }
    const slice4 = data.minutely_15.precipitation.slice(startIdx, startIdx + 4);
    precipNext60Mm = slice4.reduce((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
    resolutionLabel = '15minutové intervaly na 60 min';
  } else if (Array.isArray(data.hourly?.precipitation) && data.hourly.precipitation.length > 0) {
    const times = data.hourly.time || [];
    let idx = 0;
    if (times.length > 0) {
      const nowHour = new Date(now).toISOString().slice(0, 13);
      const foundIdx = times.findIndex(t => typeof t === 'string' && t.startsWith(nowHour));
      if (foundIdx >= 0) idx = foundIdx;
    }
    precipNext60Mm = Number(data.hourly.precipitation[idx]) || 0;
    resolutionLabel = 'hodinový úhrn';
  } else if (Number.isFinite(Number(cur.precipitation))) {
    precipNext60Mm = Number(cur.precipitation);
  }

  precipNext60Mm = Math.max(0, Math.round(precipNext60Mm * 10) / 10);

  const { icon, sentence } = buildWeatherSentence({
    temperatureC,
    precipNext60Mm,
    windSpeedKmH,
    weatherCode,
  });

  return {
    coords: roundWeatherCoords(coords),
    locationLabel: locationLabel || `Oblast [${roundWeatherCoords(coords).lat.toFixed(2)}, ${roundWeatherCoords(coords).lng.toFixed(2)}]`,
    fetchedAtMs: now,
    fetchedAtIso: new Date(now).toISOString(),
    temperatureC: temperatureC != null ? Math.round(temperatureC * 10) / 10 : null,
    apparentTemperatureC: apparentTemperatureC != null ? Math.round(apparentTemperatureC * 10) / 10 : null,
    precipNext60Mm,
    windSpeedKmH: windSpeedKmH != null ? Math.round(windSpeedKmH) : null,
    weatherCode,
    resolutionLabel,
    icon,
    sentence,
    sourceLabel: 'Open-Meteo.com (CC BY 4.0)',
    sourceUrl: 'https://open-meteo.com/',
  };
}

export function loadCachedWeather(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.fetchedAtMs || !parsed.sentence) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedWeather(forecast, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (!storage || !forecast) return;
  try {
    storage.setItem(WEATHER_CACHE_KEY, JSON.stringify(forecast));
  } catch {}
}

/**
 * Načte předpověď počasí na příštích 60 minut s přísným dodržením limitu dotazování
 * (max. jednou za 15 min nebo při posunu > 3 km) a offline zálohou s vyznačeným stářím.
 */
export async function getWeatherForNext60Min({
  pos,
  locationLabel = 'Rožmitál pod Třemšínem',
  now = Date.now(),
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  force = false,
} = {}) {
  const rounded = roundWeatherCoords(pos);
  const cached = loadCachedWeather(storage);

  if (!force && cached && !shouldFetchWeather(rounded, cached, now)) {
    const ageMin = Math.max(0, Math.round((now - cached.fetchedAtMs) / 60000));
    return {
      ...cached,
      isCached: true,
      isOffline: false,
      ageMinutes: ageMin,
    };
  }

  // Ochrana proti rychlému opakování při chybě sítě (min. 60 s mezi pokusy o síťový dotaz)
  if (!force && now - memoryWeatherState.lastAttemptMs < 60000 && cached) {
    const ageMin = Math.max(0, Math.round((now - cached.fetchedAtMs) / 60000));
    return {
      ...cached,
      isCached: true,
      isOffline: false,
      ageMinutes: ageMin,
    };
  }

  if (!fetchImpl) {
    if (cached) {
      return {
        ...cached,
        isCached: true,
        isOffline: true,
        ageMinutes: Math.max(0, Math.round((now - cached.fetchedAtMs) / 60000)),
      };
    }
    return null;
  }

  memoryWeatherState.lastAttemptMs = now;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${rounded.lat.toFixed(2)}&longitude=${rounded.lng.toFixed(2)}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&minutely_15=precipitation&hourly=precipitation&forecast_days=1&timezone=auto`;

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 6500) : null;
    try {
      const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const forecast = parseOpenMeteoForecast(json, rounded, locationLabel, now);
      saveCachedWeather(forecast, storage);
      return {
        ...forecast,
        isCached: false,
        isOffline: false,
        ageMinutes: 0,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch {
    if (cached) {
      return {
        ...cached,
        isCached: true,
        isOffline: true,
        ageMinutes: Math.max(0, Math.round((now - cached.fetchedAtMs) / 60000)),
      };
    }
    return null;
  }
}

export function resetWeatherRateLimiterForTest() {
  memoryWeatherState = { lastAttemptMs: 0, lastCoords: null, inFlight: null };
}
