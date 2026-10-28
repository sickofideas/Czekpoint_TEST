import { parseWalk, score } from './walk-engine.js';
import { validateProfile, isValidAvatarId } from './avatars.js';

export const STATE_KEY = 'czekpoint.state.v2';
export const WALK_KEY = 'czekpoint.walk.v1';
export const WALK_META_KEY = 'czekpoint.walk.meta.v1';
export const RESET_MARKER_KEY = 'czekpoint.reset.done';
export const MAX_EXPEDITION_HISTORY = 100;
export const COMPANION_MODES = ['solo', 'dog', 'stroller', 'family'];
export const EXPLORATION_MODES = ['compass', 'focus', 'radar'];
export const MAX_STICK_BADGES = 200;

export const DEFAULT_APP_SETTINGS = Object.freeze({
  fogParchment: true,     // 📜 Tajemný pergamen (odkrývání mlhy)
  kctTrails: true,        // 🥾 Turistické značky KČT a stezky
  contours: true,         // ⛰️ Vrstevnice a terén
  footprints: true,       // 👣 Stopy pohorek za mnou
  orbitalArrow: true,     // 🎯 Zlatá směrová šipka u Avatara
  voiceNav: true,         // 🗣️ Česká hlasová navigace
  soundFx: true,          // 🔊 Zvukové efekty a fanfáry
  keepAwake: true,        // 📱 Držet rozsvícený displej
  autoSortStops: true,    // 🔄 Chytré řazení zastávek podle pěší trasy
  showExternalPhotos: true, // 🖼️ Zobrazovat externí fotografie míst (Wikipedie)
  mindfulnessPrompts: true, // 🍃 Jemné výzvy všímavosti během chůze
  gameMode: 'gamified',   // 'explorer' (Objevitel) | 'gamified' (Výprava s gamifikací) | 'casual' (Pohodová procházka)
});

export const PERSONAL_MEMORY_SYMBOLS = Object.freeze([
  { id: 'tree', icon: '🌳', label: '🌳 Strom', shortTitle: 'Zajímavý strom' },
  { id: 'view', icon: '🌄', label: '🌄 Výhled', shortTitle: 'Pěkný výhled' },
  { id: 'calm', icon: '🍃', label: '🍃 Klidné místo', shortTitle: 'Klidné zákoutí' },
  { id: 'water', icon: '💧', label: '💧 Voda / studánka', shortTitle: 'Voda nebo studánka' },
  { id: 'nature', icon: '🐾', label: '🐾 Příroda', shortTitle: 'Setkání s přírodou' },
  { id: 'detail', icon: '🔎', label: '🔎 Zajímavý detail', shortTitle: 'Zajímavý detail' },
]);

export const MINDFULNESS_PROMPTS = Object.freeze([
  {
    id: 'pleasant_stop',
    icon: '🍃',
    text: 'Všimni si místa, kde je příjemné se na chvíli zastavit a jen pozorovat okolí.',
    safetyNote: 'Zastav se pouze na bezpečném a volně přístupném místě mimo vozovku.',
  },
  {
    id: 'distant_horizon',
    icon: '🌄',
    text: 'Rozhlédni se do dálky — jaké linie stromů, střech nebo kopců dnes tvoří obzor?',
    safetyNote: 'Rozhlížej se jen tehdy, když bezpečně stojíš mimo silnici.',
  },
  {
    id: 'quiet_sound',
    icon: '🌳',
    text: 'Zaposlouchej se na deset vteřin: slyšíš spíš vítr v korunách, vodu, nebo ptáky?',
    safetyNote: 'Nepřekračuj soukromé pozemky a nesahej na volně žijící přírodu.',
  },
  {
    id: 'light_and_shadow',
    icon: '🔎',
    text: 'Všimni si, jak dnes světlo a stín kreslí tvary na cestě nebo mezi stromy.',
    safetyNote: 'Při chůzi i přecházení vždy sleduj cestu před sebou, ne obrazovku.',
  },
]);

export function sanitizeMemoryNoteText(rawNote) {
  if (typeof rawNote !== 'string') return '';
  return rawNote
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function sanitizePersonalMemories(memories) {
  if (!Array.isArray(memories)) return [];
  const validSymbolMap = new Map(PERSONAL_MEMORY_SYMBOLS.map(s => [s.id, s]));
  const clean = [];
  const seenIds = new Set();

  for (const item of memories.slice(0, 300)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const symbolMeta = validSymbolMap.get(item.symbolId) || PERSONAL_MEMORY_SYMBOLS[0];
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) continue;
    const id = typeof item.id === 'string' && /^[-a-zA-Z0-9:_]{1,80}$/.test(item.id)
      ? item.id
      : `mem_${Date.now()}_${clean.length}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    clean.push({
      id,
      symbolId: symbolMeta.id,
      symbolIcon: symbolMeta.icon,
      symbolLabel: symbolMeta.label,
      title: symbolMeta.shortTitle,
      note: sanitizeMemoryNoteText(item.note || ''),
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      createdAt: typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString(),
      recordType: 'user_memory',
      recordBadge: '✨ Vlastnoruční vzpomínka uživatele',
      isUserMemory: true,
    });
  }
  return clean;
}

export function createPersonalMemoryEntry(input = {}) {
  const validSymbolMap = new Map(PERSONAL_MEMORY_SYMBOLS.map(s => [s.id, s]));
  const symbolMeta = validSymbolMap.get(input.symbolId) || PERSONAL_MEMORY_SYMBOLS[0];
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
    throw new Error('Pro uložení vzpomínky jsou potřeba platné souřadnice místa.');
  }
  const safeNote = sanitizeMemoryNoteText(input.note || '');
  return {
    id: typeof input.id === 'string' && /^[-a-zA-Z0-9:_]{1,80}$/.test(input.id)
      ? input.id
      : `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    symbolId: symbolMeta.id,
    symbolIcon: symbolMeta.icon,
    symbolLabel: symbolMeta.label,
    title: symbolMeta.shortTitle,
    note: safeNote,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : new Date().toISOString(),
    recordType: 'user_memory',
    recordBadge: '✨ Vlastnoruční vzpomínka uživatele',
    isUserMemory: true,
  };
}

export const emptyState = () => ({
  schemaVersion: 2,
  revision: 1,
  profile: { avatarId: 'liska' },
  cells: [],
  meters: 0,
  discoveries: [],
  personalMemories: [],
  walkSegments: [],
  revealedFeatures: [],
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
  companionMode: 'solo',
  explorationMode: 'focus',
  soundEnabled: true,
  pilgrimsOptIn: false,
  clinksCount: 0,
  stickBadges: [],
  summitEntries: {},
  plannedRoute: null,
  confirmedStopIds: [],
  savedTrips: [],
  voiceNavEnabled: true,
  appSettings: { ...DEFAULT_APP_SETTINGS },
});

export function sanitizeWalkSegments(segments) {
  if (!Array.isArray(segments)) return [];
  const clean = [];
  for (const seg of segments.slice(-600)) {
    if (!Array.isArray(seg)) continue;
    const pts = [];
    for (const pt of seg.slice(-1500)) {
      if (Array.isArray(pt) && pt.length >= 2) {
        const lat = Number(pt[0]);
        const lng = Number(pt[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180) {
          pts.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
        }
      } else if (pt && typeof pt === 'object') {
        const lat = Number(pt.lat);
        const lng = Number(pt.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180) {
          pts.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
        }
      }
    }
    if (pts.length > 0) clean.push(pts);
  }
  return clean;
}

export function sanitizeRevealedFeatures(features) {
  if (!Array.isArray(features)) return [];
  return [...new Set(features.filter(id => typeof id === 'string' && /^[-a-zA-Z0-9:_/]{1,100}$/.test(id)))].slice(0, 1000);
}

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

export const CORRUPTED_BACKUP_KEY = 'czekpoint.state.corrupted.backup';

export function isValidCellId(id) {
  if (typeof id !== 'string' || !/^[-\d]+:[-\d]+$/.test(id)) return false;
  const parts = id.split(':').map(Number);
  return parts.length === 2 && parts.every(v => Number.isInteger(v) && Math.abs(v) <= 156544);
}

export function isValidDiscoveryId(id) {
  return typeof id === 'string' && /^[-a-zA-Z0-9:_/]{1,100}$/.test(id);
}

export function isValidExpeditionEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (typeof entry.id !== 'string' || !entry.id.trim()) return false;
  if (entry.distanceMeters != null && (!Number.isFinite(entry.distanceMeters) || entry.distanceMeters < 0)) return false;
  if (entry.newCellsCount != null && (!Number.isFinite(entry.newCellsCount) || entry.newCellsCount < 0)) return false;
  if (entry.newStampsCount != null && (!Number.isFinite(entry.newStampsCount) || entry.newStampsCount < 0)) return false;
  if (entry.pointsEarned != null && (!Number.isFinite(entry.pointsEarned) || entry.pointsEarned < 0)) return false;
  return true;
}

export function isValidStickBadge(badge) {
  if (!badge || typeof badge !== 'object' || Array.isArray(badge)) return false;
  if (typeof badge.id !== 'string' || !badge.id.trim()) return false;
  if (badge.distanceMeters != null && (!Number.isFinite(badge.distanceMeters) || badge.distanceMeters < 0)) return false;
  return true;
}

/**
 * Loads the unified version 2 explorer state.
 * Distinguishes first launch from a corrupted stored profile (Bod 3):
 * - First launch: STATE_KEY is absent -> returns emptyState() (or migrates v1).
 * - Corrupted stored profile: STATE_KEY is present, but JSON/schema/items are invalid ->
 *   preserves original raw value in CORRUPTED_BACKUP_KEY and marks `storageCorrupted: true`
 *   with `storageError` so automatic saves do not silently overwrite user data.
 */
export function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STATE_KEY);
  } catch {}

  if (raw !== null && raw !== '') {
    try {
      const data = JSON.parse(raw);
      if (
        !data ||
        typeof data !== 'object' ||
        data.schemaVersion !== 2 ||
        !Array.isArray(data.cells) ||
        data.cells.some(c => !isValidCellId(c)) ||
        !Number.isFinite(Number(data.meters)) ||
        Number(data.meters) < 0 ||
        !Array.isArray(data.discoveries) ||
        data.discoveries.some(d => !isValidDiscoveryId(d))
      ) {
        throw new Error('Poškozená struktura uloženého profilu.');
      }

      const safeBaseline = data.baseline && typeof data.baseline === 'object'
        ? {
            cells: Math.max(0, Number(data.baseline.cells) || 0),
            meters: Math.max(0, Number(data.baseline.meters) || 0),
            discoveries: Math.max(0, Number(data.baseline.discoveries) || 0),
          }
        : { cells: 0, meters: 0, discoveries: 0 };

      return {
        schemaVersion: 2,
        revision: Math.max(1, Number(data.revision) || 1),
        profile: validateProfile(data.profile),
        cells: [...new Set(data.cells)],
        meters: Math.max(0, Number(data.meters) || 0),
        discoveries: [...new Set(data.discoveries)],
        personalMemories: sanitizePersonalMemories(data.personalMemories),
        walkSegments: sanitizeWalkSegments(data.walkSegments),
        revealedFeatures: sanitizeRevealedFeatures(data.revealedFeatures),
        legacyScore: Math.max(0, Number(data.legacyScore) || 0),
        baseline: safeBaseline,
        legacyRewards: data.legacyRewards && typeof data.legacyRewards === 'object' ? data.legacyRewards : { tiers: {}, pioneerAwards: [], dailyClaimed: [], watchtowers: [] },
        seals: Array.isArray(data.seals) ? data.seals : [],
        activeExpedition: data.activeExpedition ?? null,
        expeditionHistory: Array.isArray(data.expeditionHistory)
          ? data.expeditionHistory.filter(isValidExpeditionEntry).slice(0, MAX_EXPEDITION_HISTORY)
          : [],
        companionMode: COMPANION_MODES.includes(data.companionMode) ? data.companionMode : 'solo',
        explorationMode: EXPLORATION_MODES.includes(data.explorationMode) ? data.explorationMode : 'focus',
        soundEnabled: typeof data.soundEnabled === 'boolean' ? data.soundEnabled : true,
        pilgrimsOptIn: typeof data.pilgrimsOptIn === 'boolean' ? data.pilgrimsOptIn : false,
        clinksCount: Number.isFinite(data.clinksCount) && data.clinksCount >= 0 ? Math.floor(data.clinksCount) : 0,
        stickBadges: Array.isArray(data.stickBadges)
          ? data.stickBadges.filter(isValidStickBadge).slice(0, MAX_STICK_BADGES)
          : [],
        summitEntries: data.summitEntries && typeof data.summitEntries === 'object' && !Array.isArray(data.summitEntries) ? data.summitEntries : {},
        plannedRoute: data.plannedRoute && typeof data.plannedRoute === 'object' ? data.plannedRoute : null,
        confirmedStopIds: Array.isArray(data.confirmedStopIds) ? [...new Set(data.confirmedStopIds)] : [],
        savedTrips: Array.isArray(data.savedTrips) ? data.savedTrips.slice(0, 50) : [],
        voiceNavEnabled: typeof data.voiceNavEnabled === 'boolean' ? data.voiceNavEnabled : true,
        appSettings: {
          ...DEFAULT_APP_SETTINGS,
          ...(data.appSettings && typeof data.appSettings === 'object' ? data.appSettings : {}),
        },
        storageCorrupted: false,
        storageError: '',
      };
    } catch {
      try {
        localStorage.setItem(CORRUPTED_BACKUP_KEY, raw);
      } catch {}
      return {
        ...emptyState(),
        storageCorrupted: true,
        storageError: 'Uložený profil je poškozený. Původní data zůstala zachována; obnov předchozí zálohu nebo profil vymaž v nastavení.',
      };
    }
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
      walkSegments: [],
      revealedFeatures: [],
      legacyScore,
      baseline,
      legacyRewards: metaObj,
      seals: [],
      activeExpedition: null,
      expeditionHistory: [],
      companionMode: 'solo',
      explorationMode: 'focus',
      soundEnabled: true,
      pilgrimsOptIn: false,
      clinksCount: 0,
      stickBadges: [],
      summitEntries: {},
      plannedRoute: null,
      confirmedStopIds: [],
      savedTrips: [],
      voiceNavEnabled: false,
    };

    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(migrated));
    } catch {}

    return migrated;
  }

  return emptyState();
}

/**
 * Saves state atomically with revision increment.
 * Mutates `state.revision` in place in addition to returning `nextState` so callers in the same
 * tab never drift out of sync (Bod 2).
 * Protects corrupted storage from silent overwrite unless explicitly restoring or resetting (Bod 3).
 */
export function saveState(state, options = {}) {
  if (!state || typeof state !== 'object') throw new Error('Neplatný stav k uložení.');
  if (state.storageCorrupted && !options.allowOverwriteCorrupted) {
    throw new Error(state.storageError || 'Uložený profil je poškozený. Obnov zálohu nebo profil nejprve resetuj.');
  }

  try {
    let persistedRevision = 0;
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      let parsedOk = false;
      try {
        const persisted = JSON.parse(raw);
        if (persisted && typeof persisted === 'object' && persisted.schemaVersion === 2) {
          parsedOk = true;
          persistedRevision = Number(persisted.revision) || 0;
        }
      } catch {}

      if (!parsedOk && !options.allowOverwriteCorrupted) {
        try { localStorage.setItem(CORRUPTED_BACKUP_KEY, raw); } catch {}
        throw new Error('Uložený profil v prohlížeči je poškozený. Původní data jsme zachovali; obnov zálohu.');
      }

      if (
        options.enforceConcurrency &&
        persistedRevision > 0 &&
        state.revision != null &&
        persistedRevision > state.revision
      ) {
        throw new Error('Stav byl upraven v jiné záložce prohlížeče. Obnovte stránku.');
      }
    }

    const nextRevision = Math.max(persistedRevision, Number(state.revision) || 0) + 1;
    const safeBaseline = state.baseline && typeof state.baseline === 'object'
      ? {
          cells: Math.max(0, Number(state.baseline.cells) || 0),
          meters: Math.max(0, Number(state.baseline.meters) || 0),
          discoveries: Math.max(0, Number(state.baseline.discoveries) || 0),
        }
      : { cells: 0, meters: 0, discoveries: 0 };

    const nextState = {
      ...state,
      schemaVersion: 2,
      profile: validateProfile(state.profile),
      cells: Array.isArray(state.cells) ? [...new Set(state.cells.filter(isValidCellId))] : [],
      meters: Math.max(0, Number(state.meters) || 0),
      discoveries: Array.isArray(state.discoveries) ? [...new Set(state.discoveries.filter(isValidDiscoveryId))] : [],
      personalMemories: sanitizePersonalMemories(state.personalMemories),
      walkSegments: sanitizeWalkSegments(state.walkSegments),
      revealedFeatures: sanitizeRevealedFeatures(state.revealedFeatures),
      legacyScore: Math.max(0, Number(state.legacyScore) || 0),
      baseline: safeBaseline,
      expeditionHistory: Array.isArray(state.expeditionHistory)
        ? state.expeditionHistory.filter(isValidExpeditionEntry).slice(0, MAX_EXPEDITION_HISTORY)
        : [],
      companionMode: COMPANION_MODES.includes(state.companionMode) ? state.companionMode : 'solo',
      explorationMode: EXPLORATION_MODES.includes(state.explorationMode) ? state.explorationMode : 'focus',
      soundEnabled: typeof state.soundEnabled === 'boolean' ? state.soundEnabled : true,
      pilgrimsOptIn: typeof state.pilgrimsOptIn === 'boolean' ? state.pilgrimsOptIn : false,
      clinksCount: Number.isFinite(state.clinksCount) && state.clinksCount >= 0 ? Math.floor(state.clinksCount) : 0,
      stickBadges: Array.isArray(state.stickBadges)
        ? state.stickBadges.filter(isValidStickBadge).slice(0, MAX_STICK_BADGES)
        : [],
      summitEntries: state.summitEntries && typeof state.summitEntries === 'object' && !Array.isArray(state.summitEntries) ? state.summitEntries : {},
      plannedRoute: state.plannedRoute && typeof state.plannedRoute === 'object' ? state.plannedRoute : null,
      confirmedStopIds: Array.isArray(state.confirmedStopIds) ? [...new Set(state.confirmedStopIds)] : [],
      savedTrips: Array.isArray(state.savedTrips) ? state.savedTrips.slice(0, 50) : [],
      voiceNavEnabled: typeof state.voiceNavEnabled === 'boolean' ? state.voiceNavEnabled : true,
      appSettings: {
        ...DEFAULT_APP_SETTINGS,
        ...(state.appSettings && typeof state.appSettings === 'object' ? state.appSettings : {}),
      },
      revision: nextRevision,
    };
    delete nextState.storageCorrupted;
    delete nextState.storageError;

    localStorage.setItem(STATE_KEY, JSON.stringify(nextState));
    try {
      localStorage.removeItem(RESET_MARKER_KEY);
    } catch {}

    // Synchronizujeme revizi i přímo na předaném objektu, aby opakované uložení nikdy neselhalo
    state.revision = nextRevision;
    state.storageCorrupted = false;
    state.storageError = '';
    return nextState;
  } catch (err) {
    if (err.message.includes('jiné záložce') || err.message.includes('poškozený')) throw err;
    throw new Error('Uložení se nezdařilo. Záznam se pozastavil; uvolni místo v prohlížeči.');
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
  localStorage.removeItem(CORRUPTED_BACKUP_KEY);
  try {
    localStorage.setItem(RESET_MARKER_KEY, '1');
  } catch {}
}

/**
 * Exports personal exploration state as a formatted JSON string.
 */
export function exportStateJson(passedState) {
  const state = passedState || loadState();
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    appName: 'czekpoint',
    appVersion: '1.0.0',
    schemaVersion: 2,
    data: {
      profile: state.profile,
      cells: state.cells,
      meters: state.meters,
      discoveries: state.discoveries,
      personalMemories: sanitizePersonalMemories(state.personalMemories),
      walkSegments: state.walkSegments || [],
      revealedFeatures: state.revealedFeatures || [],
      legacyScore: state.legacyScore,
      baseline: state.baseline,
      legacyRewards: state.legacyRewards,
      seals: state.seals,
      expeditionHistory: state.expeditionHistory,
      companionMode: state.companionMode || 'solo',
      explorationMode: state.explorationMode || 'focus',
      soundEnabled: state.soundEnabled ?? true,
      pilgrimsOptIn: state.pilgrimsOptIn ?? false,
      clinksCount: state.clinksCount || 0,
      stickBadges: state.stickBadges || [],
      summitEntries: state.summitEntries || {},
      plannedRoute: state.plannedRoute || null,
      confirmedStopIds: state.confirmedStopIds || [],
      savedTrips: state.savedTrips || [],
      voiceNavEnabled: state.voiceNavEnabled ?? false,
      appSettings: state.appSettings || { ...DEFAULT_APP_SETTINGS },
    },
  };
  return JSON.stringify(exportPayload, null, 2);
}

/**
 * Previews and strictly validates an imported JSON backup without modifying storage (Bod 3).
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

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Neplatná struktura zálohy.');
  }

  // Support direct state or wrapped exportPayload
  const d = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : parsed;
  const schemaVer = parsed.schemaVersion ?? d.schemaVersion;

  if (schemaVer !== 2) {
    throw new Error(`Nepodporovaná verze schématu (${schemaVer}). Tato verze Czekpointu podporuje pouze schéma v2.`);
  }

  if (!Array.isArray(d.cells)) throw new Error('Chybí nebo je neplatný seznam prozkoumaných dílků.');
  if (d.cells.length > 12000 || d.cells.some(c => !isValidCellId(c))) {
    throw new Error('Záloha obsahuje neplatné souřadnice prozkoumaných dílků.');
  }

  if (!Number.isFinite(d.meters) || d.meters < 0 || d.meters > 1e9) {
    throw new Error('Neplatná ušlá vzdálenost v záloze.');
  }

  if (!Array.isArray(d.discoveries)) throw new Error('Neplatný seznam nalezených míst.');
  if (d.discoveries.length > 5000 || d.discoveries.some(id => !isValidDiscoveryId(id))) {
    throw new Error('Záloha obsahuje neplatné identifikátory objevených míst.');
  }

  if (d.legacyScore != null && (!Number.isFinite(d.legacyScore) || d.legacyScore < 0)) {
    throw new Error('Záloha obsahuje neplatné poškozené skóre.');
  }

  if (d.baseline != null) {
    if (
      typeof d.baseline !== 'object' ||
      Array.isArray(d.baseline) ||
      (d.baseline.cells != null && (!Number.isFinite(d.baseline.cells) || d.baseline.cells < 0)) ||
      (d.baseline.meters != null && (!Number.isFinite(d.baseline.meters) || d.baseline.meters < 0)) ||
      (d.baseline.discoveries != null && (!Number.isFinite(d.baseline.discoveries) || d.baseline.discoveries < 0))
    ) {
      throw new Error('Záloha obsahuje neplatný výchozí stav bodů (baseline).');
    }
  }

  if (d.expeditionHistory != null) {
    if (!Array.isArray(d.expeditionHistory) || d.expeditionHistory.some(item => !isValidExpeditionEntry(item))) {
      throw new Error('Záloha obsahuje neplatné položky v historii výprav.');
    }
  }

  if (d.stickBadges != null) {
    if (!Array.isArray(d.stickBadges) || d.stickBadges.some(b => !isValidStickBadge(b))) {
      throw new Error('Záloha obsahuje neplatné štítky na holi.');
    }
  }

  if (d.profile != null && typeof d.profile === 'object') {
    if (d.profile.avatarId != null && !isValidAvatarId(d.profile.avatarId)) {
      throw new Error('Záloha obsahuje neznámého avatara.');
    }
  }

  const profile = validateProfile(d.profile);
  const cellsCount = new Set(d.cells).size;
  const metersKm = (d.meters / 1000).toFixed(1).replace('.', ',');
  const stampsCount = new Set(d.discoveries).size;
  const historyCount = Array.isArray(d.expeditionHistory) ? d.expeditionHistory.length : 0;
  const badgesCount = Array.isArray(d.stickBadges) ? d.stickBadges.length : 0;

  return {
    valid: true,
    avatarId: profile.avatarId,
    cellsCount,
    metersKm,
    stampsCount,
    historyCount,
    badgesCount,
    payload: d,
  };
}

/**
 * Imports state atomically after full validation (Bod 3).
 * Works reliably even after further walking (higher revision in localStorage)
 * and never starts GPS automatically.
 */
export function importStateJson(jsonString) {
  const preview = previewImportState(jsonString);
  const d = preview.payload;

  let activeExp = null;
  if (d.activeExpedition && typeof d.activeExpedition === 'object' && !Array.isArray(d.activeExpedition)) {
    activeExp = {
      ...d.activeExpedition,
      state: 'paused', // Imported expedition is at most paused, NEVER running GPS!
    };
  }

  const safeBaseline = d.baseline && typeof d.baseline === 'object'
    ? {
        cells: Math.max(0, Number(d.baseline.cells) || 0),
        meters: Math.max(0, Number(d.baseline.meters) || 0),
        discoveries: Math.max(0, Number(d.baseline.discoveries) || 0),
      }
    : { cells: 0, meters: 0, discoveries: 0 };

  const newState = {
    schemaVersion: 2,
    revision: Number(d.revision) || 1,
    profile: validateProfile(d.profile),
    cells: [...new Set(d.cells)],
    meters: Math.max(0, Number(d.meters) || 0),
    discoveries: [...new Set(d.discoveries)],
    personalMemories: sanitizePersonalMemories(d.personalMemories),
    walkSegments: sanitizeWalkSegments(d.walkSegments),
    revealedFeatures: sanitizeRevealedFeatures(d.revealedFeatures),
    legacyScore: Math.max(0, Number(d.legacyScore) || 0),
    baseline: safeBaseline,
    legacyRewards: d.legacyRewards && typeof d.legacyRewards === 'object' ? d.legacyRewards : { tiers: {}, pioneerAwards: [], dailyClaimed: [], watchtowers: [] },
    seals: Array.isArray(d.seals) ? d.seals : [],
    activeExpedition: activeExp,
    expeditionHistory: Array.isArray(d.expeditionHistory) ? d.expeditionHistory.slice(0, MAX_EXPEDITION_HISTORY) : [],
    companionMode: COMPANION_MODES.includes(d.companionMode) ? d.companionMode : 'solo',
    explorationMode: EXPLORATION_MODES.includes(d.explorationMode) ? d.explorationMode : 'focus',
    soundEnabled: typeof d.soundEnabled === 'boolean' ? d.soundEnabled : true,
    pilgrimsOptIn: typeof d.pilgrimsOptIn === 'boolean' ? d.pilgrimsOptIn : false,
    clinksCount: Number.isFinite(d.clinksCount) && d.clinksCount >= 0 ? Math.floor(d.clinksCount) : 0,
    stickBadges: Array.isArray(d.stickBadges) ? d.stickBadges.slice(0, MAX_STICK_BADGES) : [],
    summitEntries: d.summitEntries && typeof d.summitEntries === 'object' && !Array.isArray(d.summitEntries) ? d.summitEntries : {},
    plannedRoute: d.plannedRoute && typeof d.plannedRoute === 'object' ? d.plannedRoute : null,
    confirmedStopIds: Array.isArray(d.confirmedStopIds) ? [...new Set(d.confirmedStopIds)] : [],
    savedTrips: Array.isArray(d.savedTrips) ? d.savedTrips.slice(0, 50) : [],
    voiceNavEnabled: typeof d.voiceNavEnabled === 'boolean' ? d.voiceNavEnabled : true,
    appSettings: {
      ...DEFAULT_APP_SETTINGS,
      ...(d.appSettings && typeof d.appSettings === 'object' ? d.appSettings : {}),
    },
  };

  return saveState(newState, { allowOverwriteCorrupted: true });
}

// Backwards-compatible adapters for existing callers and tests
export function loadWalk() {
  const s = loadState();
  return {
    version: 1,
    cells: s.cells,
    meters: s.meters,
    discoveries: s.discoveries,
    walkSegments: s.walkSegments || [],
    revealedFeatures: s.revealedFeatures || [],
  };
}

export function saveWalk(progress) {
  const current = loadState();
  const next = {
    ...current,
    cells: progress.cells || [],
    meters: progress.meters || 0,
    discoveries: progress.discoveries || [],
    walkSegments: progress.walkSegments || current.walkSegments || [],
    revealedFeatures: progress.revealedFeatures || current.revealedFeatures || [],
  };
  return saveState(next);
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
  return saveState(s);
}

export function clearWalkMeta() {
  const s = loadState();
  s.legacyRewards = { tiers: {}, pioneerAwards: [], dailyClaimed: [], watchtowers: [] };
  saveState(s);
  localStorage.removeItem(WALK_META_KEY);
}