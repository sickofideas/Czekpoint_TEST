import { parseWalk, score } from './walk-engine.js';
import { validateProfile, isValidAvatarId } from './avatars.js';

export const STATE_KEY = 'czekpoint.state.v2';
export const WALK_KEY = 'czekpoint.walk.v1';
export const WALK_META_KEY = 'czekpoint.walk.meta.v1';
export const RESET_MARKER_KEY = 'czekpoint.reset.done';
export const MAX_EXPEDITION_HISTORY = 100;

export const emptyState = () => ({
  schemaVersion: 2,
  revision: 1,
  profile: { avatarId: 'liska' },
  cells: [],
  meters: 0,
  discoveries: [],
  legacyScore: 0,
  baseline: { cells: 0, meters: 0, discoveries: 0 },
  legacyRewards: {
    tiers: {},
    pioneerAwards: [],
    dailyClaimed: [],
    watchtowers: [],
  },
  seals: [],
  activeExpedition: null,
  expeditionHistory: [],
});

export const emptyWalkMeta = () => ({
  trail: [],
  watchtowers: [],
  tiers: {},
  pioneerAwards: [],
  dailyClaimed: [],
});

/**
 * Computes legacy score for a v0.3 user data structure
 */
export function computeLegacyScore(cells = [], meters = 0, discoveries = [], legacyMeta = {}) {
  const c = cells.length;
  const m = meters;
  const d = discoveries.length;
  let pts = 10 * c + Math.floor(m / 50) + 25 * Math.floor(c / 6) + 30 * d;

  const tiers = legacyMeta.tiers || {};
  for (const [placeId, tier] of Object.entries(tiers)) {
    const hasDisc = discoveries.includes(placeId) || discoveries.includes(`catalog:${placeId}`);
    if (tier === 'gold') pts += hasDisc ? 90 : 120;
    else if (tier === 'silver') pts += hasDisc ? 30 : 60;
    else if (tier === 'bronze' && !hasDisc) pts += 30;
  }
  pts += (legacyMeta.pioneerAwards || []).length * 100;
  pts += (legacyMeta.dailyClaimed || []).length * 50;
  return pts;
}

/**
 * Loads the unified version 2 explorer state.
 * Performs migration from v1 keys on first run if reset marker is not set.
 */
export function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.schemaVersion === 2) {
        return {
          schemaVersion: 2,
          revision: Number(data.revision) || 1,
          profile: validateProfile(data.profile),
          cells: Array.isArray(data.cells) ? data.cells : [],
          meters: Number(data.meters) || 0,
          discoveries: Array.isArray(data.discoveries) ? [...new Set(data.discoveries)] : [],
          legacyScore: Number(data.legacyScore) || 0,
          baseline: data.baseline && typeof data.baseline === 'object' ? data.baseline : { cells: 0, meters: 0, discoveries: 0 },
          legacyRewards: data.legacyRewards && typeof data.legacyRewards === 'object' ? data.legacyRewards : { tiers: {}, pioneerAwards: [], dailyClaimed: [], watchtowers: [] },
          seals: Array.isArray(data.seals) ? data.seals : [],
          activeExpedition: data.activeExpedition ?? null,
          expeditionHistory: Array.isArray(data.expeditionHistory) ? data.expeditionHistory.slice(0, MAX_EXPEDITION_HISTORY) : [],
        };
      }
    }
  } catch {
    // If state is corrupted, fall back to empty or legacy
  }

  // Check if reset was explicitly performed
  try {
    if (localStorage.getItem(RESET_MARKER_KEY) === '1') {
      return emptyState();
    }
  } catch {}

  // Check for legacy v1 data to migrate
  let legacyWalk = null;
  let legacyMeta = null;
  try {
    const rawWalk = localStorage.getItem(WALK_KEY);
    if (rawWalk) legacyWalk = parseWalk(rawWalk);
  } catch {}

  try {
    const rawMeta = localStorage.getItem(WALK_META_KEY);
    if (rawMeta) legacyMeta = JSON.parse(rawMeta);
  } catch {}

  if (legacyWalk || legacyMeta) {
    const cells = legacyWalk?.cells || [];
    const meters = legacyWalk?.meters || 0;
    const rawDiscoveries = legacyWalk?.discoveries || [];
    const discoveries = [...new Set(rawDiscoveries)];
    const metaObj = {
      tiers: legacyMeta?.tiers && typeof legacyMeta.tiers === 'object' ? legacyMeta.tiers : {},
      pioneerAwards: Array.isArray(legacyMeta?.pioneerAwards) ? legacyMeta.pioneerAwards : [],
      dailyClaimed: Array.isArray(legacyMeta?.dailyClaimed) ? legacyMeta.dailyClaimed : [],
      watchtowers: Array.isArray(legacyMeta?.watchtowers) ? legacyMeta.watchtowers : [],
    };

    const legacyScore = computeLegacyScore(cells, meters, discoveries, metaObj);
    const baseline = { cells: cells.length, meters, discoveries: discoveries.length };

    const migrated = {
      schemaVersion: 2,
      revision: 1,
      profile: { avatarId: 'liska' },
      cells,
      meters,
      discoveries,
      legacyScore,
      baseline,
      legacyRewards: metaObj,
      seals: [],
      activeExpedition: null,
      expeditionHistory: [],
    };

    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(migrated));
    } catch {}

    return migrated;
  }

  return emptyState();
}

/**
 * Saves state atomically with revision increment and tab concurrency check.
 */
export function saveState(state) {
  if (!state || typeof state !== 'object') throw new Error('Neplatný stav k uložení.');
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      try {
        const persisted = JSON.parse(raw);
        if (persisted?.revision && state.revision != null && persisted.revision > state.revision) {
          throw new Error('Stav byl upraven v jiné záložce prohlížeče. Obnovte stránku.');
        }
      } catch (e) {
        if (e.message.includes('jiné záložce')) throw e;
      }
    }

    const nextState = {
      ...state,
      schemaVersion: 2,
      profile: validateProfile(state.profile),
      expeditionHistory: Array.isArray(state.expeditionHistory)
        ? state.expeditionHistory.slice(0, MAX_EXPEDITION_HISTORY)
        : [],
      revision: (Number(state.revision) || 0) + 1,
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(nextState));
    try {
      localStorage.removeItem(RESET_MARKER_KEY);
    } catch {}
    return nextState;
  } catch (err) {
    if (err.message.includes('jiné záložce')) throw err;
    throw new Error('Průzkum se nepodařilo uložit. Záznam se pozastavil; uvolni místo v prohlížeči.');
  }
}

/**
 * Updates profile avatar safely and saves atomically.
 */
export function setProfileAvatar(avatarId) {
  const current = loadState();
  const nextProfile = validateProfile({ avatarId });
  const updated = {
    ...current,
    profile: nextProfile,
  };
  return saveState(updated);
}

/**
 * Completely clears state and all legacy migration keys, marking reset.
 */
export function clearState() {
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(WALK_KEY);
  localStorage.removeItem(WALK_META_KEY);
  try {
    localStorage.setItem(RESET_MARKER_KEY, '1');
  } catch {}
}

/**
 * Exports personal exploration state as a formatted JSON string.
 */
export function exportStateJson() {
  const state = loadState();
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    appName: 'czekpoint',
    appVersion: '0.5.0',
    schemaVersion: 2,
    data: {
      profile: state.profile,
      cells: state.cells,
      meters: state.meters,
      discoveries: state.discoveries,
      legacyScore: state.legacyScore,
      baseline: state.baseline,
      legacyRewards: state.legacyRewards,
      seals: state.seals,
      expeditionHistory: state.expeditionHistory,
    },
  };
  return JSON.stringify(exportPayload, null, 2);
}

/**
 * Previews an imported JSON backup without modifying storage.
 */
export function previewImportState(jsonString) {
  if (typeof jsonString !== 'string') {
    throw new Error('Vstupní data pro import musejí být textový JSON.');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Soubor není platný JSON formát.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Neplatná struktura zálohy.');
  }

  // Support direct state or wrapped exportPayload
  const d = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
  const schemaVer = parsed.schemaVersion ?? d.schemaVersion;

  if (schemaVer !== 2) {
    throw new Error(`Nepodporovaná verze schématu (${schemaVer}). Tato verze Czekpointu podporuje pouze schéma v2.`);
  }

  if (!Array.isArray(d.cells)) throw new Error('Chybí nebo je neplatný seznam prozkoumaných dílků.');
  if (!Number.isFinite(d.meters) || d.meters < 0) throw new Error('Neplatná ušlá vzdálenost.');
  if (!Array.isArray(d.discoveries)) throw new Error('Neplatný seznam nalezených míst.');

  const profile = validateProfile(d.profile);
  const cellsCount = d.cells.length;
  const metersKm = (d.meters / 1000).toFixed(1).replace('.', ',');
  const stampsCount = d.discoveries.length;
  const historyCount = Array.isArray(d.expeditionHistory) ? d.expeditionHistory.length : 0;

  return {
    valid: true,
    avatarId: profile.avatarId,
    cellsCount,
    metersKm,
    stampsCount,
    historyCount,
    payload: d,
  };
}

/**
 * Imports state atomically after full validation.
 * Never starts GPS; imported activeExpedition is at most 'paused'.
 */
export function importStateJson(jsonString) {
  const preview = previewImportState(jsonString);
  const d = preview.payload;

  let activeExp = null;
  if (d.activeExpedition && typeof d.activeExpedition === 'object') {
    activeExp = {
      ...d.activeExpedition,
      state: 'paused', // Imported expedition is at most paused, NEVER running GPS!
    };
  }

  const newState = {
    schemaVersion: 2,
    revision: 1,
    profile: validateProfile(d.profile),
    cells: [...new Set(d.cells)],
    meters: Number(d.meters) || 0,
    discoveries: [...new Set(d.discoveries)],
    legacyScore: Number(d.legacyScore) || 0,
    baseline: d.baseline && typeof d.baseline === 'object' ? d.baseline : { cells: 0, meters: 0, discoveries: 0 },
    legacyRewards: d.legacyRewards && typeof d.legacyRewards === 'object' ? d.legacyRewards : { tiers: {}, pioneerAwards: [], dailyClaimed: [], watchtowers: [] },
    seals: Array.isArray(d.seals) ? d.seals : [],
    activeExpedition: activeExp,
    expeditionHistory: Array.isArray(d.expeditionHistory) ? d.expeditionHistory.slice(0, MAX_EXPEDITION_HISTORY) : [],
  };

  saveState(newState);
  return newState;
}

// Backwards-compatible adapters for existing callers and tests
export function loadWalk() {
  const s = loadState();
  return { version: 1, cells: s.cells, meters: s.meters, discoveries: s.discoveries };
}

export function saveWalk(progress) {
  const current = loadState();
  const next = {
    ...current,
    cells: progress.cells || [],
    meters: progress.meters || 0,
    discoveries: progress.discoveries || [],
  };
  saveState(next);
}

export function clearWalk() {
  clearState();
}

export function loadWalkMeta() {
  const s = loadState();
  return {
    trail: [],
    watchtowers: s.legacyRewards?.watchtowers || [],
    tiers: s.legacyRewards?.tiers || {},
    pioneerAwards: s.legacyRewards?.pioneerAwards || [],
    dailyClaimed: s.legacyRewards?.dailyClaimed || [],
  };
}

export function saveWalkMeta(meta) {
  const s = loadState();
  s.legacyRewards = {
    ...s.legacyRewards,
    watchtowers: meta?.watchtowers || s.legacyRewards?.watchtowers || [],
    tiers: meta?.tiers || s.legacyRewards?.tiers || {},
    pioneerAwards: meta?.pioneerAwards || s.legacyRewards?.pioneerAwards || [],
    dailyClaimed: meta?.dailyClaimed || s.legacyRewards?.dailyClaimed || [],
  };
  saveState(s);
}

export function clearWalkMeta() {
  const s = loadState();
  s.legacyRewards = { tiers: {}, pioneerAwards: [], dailyClaimed: [], watchtowers: [] };
  saveState(s);
  localStorage.removeItem(WALK_META_KEY);
}
