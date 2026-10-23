import { parseWalk, score } from './walk-engine.js';

export const STATE_KEY = 'czekpoint.state.v2';
export const WALK_KEY = 'czekpoint.walk.v1';
export const WALK_META_KEY = 'czekpoint.walk.meta.v1';

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
 * Performs migration from v1 keys (czekpoint.walk.v1 and czekpoint.walk.meta.v1) on first run.
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
          profile: data.profile && typeof data.profile === 'object' ? data.profile : { avatarId: 'liska' },
          cells: Array.isArray(data.cells) ? data.cells : [],
          meters: Number(data.meters) || 0,
          discoveries: Array.isArray(data.discoveries) ? [...new Set(data.discoveries)] : [],
          legacyScore: Number(data.legacyScore) || 0,
          baseline: data.baseline && typeof data.baseline === 'object' ? data.baseline : { cells: 0, meters: 0, discoveries: 0 },
          legacyRewards: data.legacyRewards && typeof data.legacyRewards === 'object' ? data.legacyRewards : { tiers: {}, pioneerAwards: [], dailyClaimed: [], watchtowers: [] },
          seals: Array.isArray(data.seals) ? data.seals : [],
          activeExpedition: data.activeExpedition ?? null,
          expeditionHistory: Array.isArray(data.expeditionHistory) ? data.expeditionHistory : [],
        };
      }
    }
  } catch {
    // If state is corrupted, check if we can migrate or fall back
  }

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
    // Deduplicate canonical IDs
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
      revision: (Number(state.revision) || 0) + 1,
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(nextState));
    return nextState;
  } catch (err) {
    if (err.message.includes('jiné záložce')) throw err;
    throw new Error('Průzkum se nepodařilo uložit. Záznam se pozastavil; uvolni místo v prohlížeči.');
  }
}

/**
 * Completely clears state and all legacy migration keys.
 */
export function clearState() {
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(WALK_KEY);
  localStorage.removeItem(WALK_META_KEY);
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
