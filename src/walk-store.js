import { parseWalk } from './walk-engine.js';

export const WALK_KEY = 'czekpoint.walk.v1';
export const WALK_META_KEY = 'czekpoint.walk.meta.v1';

export const emptyWalkMeta = () => ({
  trail: [],
  watchtowers: [],
  tiers: {},
  pioneerAwards: [],
  dailyClaimed: [],
});

export function loadWalk() { return parseWalk(localStorage.getItem(WALK_KEY)); }

export function saveWalk(progress) {
  try { localStorage.setItem(WALK_KEY, JSON.stringify(progress)); }
  catch { throw new Error('Průzkum se nepodařilo uložit. Záznam se pozastavil; uvolni místo v prohlížeči.'); }
}

export function clearWalk() { localStorage.removeItem(WALK_KEY); }

export function loadWalkMeta() {
  const base = emptyWalkMeta();
  try {
    const raw = localStorage.getItem(WALK_META_KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return base;
    return {
      trail: Array.isArray(data.trail) ? data.trail : [],
      watchtowers: Array.isArray(data.watchtowers) ? data.watchtowers : [],
      tiers: data.tiers && typeof data.tiers === 'object' ? data.tiers : {},
      pioneerAwards: Array.isArray(data.pioneerAwards) ? data.pioneerAwards : [],
      dailyClaimed: Array.isArray(data.dailyClaimed) ? data.dailyClaimed : [],
    };
  } catch {
    return base;
  }
}

export function saveWalkMeta(meta) {
  try {
    localStorage.setItem(WALK_META_KEY, JSON.stringify(meta));
  } catch {
    // Non-fatal meta persistence failure
  }
}

export function clearWalkMeta() {
  localStorage.removeItem(WALK_META_KEY);
}
