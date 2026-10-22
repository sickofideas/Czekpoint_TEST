import { parseWalk } from './walk-engine.js';
export const WALK_KEY='czekpoint.walk.v1';
export function loadWalk() { return parseWalk(localStorage.getItem(WALK_KEY)); }
export function saveWalk(progress) {
  try { localStorage.setItem(WALK_KEY,JSON.stringify(progress)); }
  catch { throw new Error('Průzkum se nepodařilo uložit. Záznam se pozastavil; uvolni místo v prohlížeči.'); }
}
export function clearWalk() { localStorage.removeItem(WALK_KEY); }
