import {
  emptyWalk,
  acceptFix,
  cellBounds,
  cellCenter,
  score,
  trophies,
  discoverNearby,
  appendTrail,
  pruneTrail,
  explorerRank,
  chapterStatus,
  dailyChallenge,
  totalScore,
  expeditionPointsDelta,
  MAX_GPS_ACCURACY_M,
  FOG_REVEAL_RADIUS_M,
  STOP_CONFIRM_RADIUS_M,
  NEARBY_RECORD_RADIUS_M,
  VISIT_RECORD_TYPES,
  classifyVisitRecord,
  evaluateStopConfirmation,
  reorderPlannedStops,
  replacePlannedStop,
  removePlannedStop,
  computeFootprintPlacements,
  appendToWalkSegments,
  validateGpsSample,
} from './walk-engine.js';
import {
  loadState,
  saveState,
  emptyState,
  exportStateJson,
  previewImportState,
  importStateJson,
  STATE_KEY,
  COMPANION_MODES,
  EXPLORATION_MODES,
  DEFAULT_APP_SETTINGS,
  PERSONAL_MEMORY_SYMBOLS,
  MINDFULNESS_PROMPTS,
  sanitizeMemoryNoteText,
  createPersonalMemoryEntry,
} from './walk-store.js';
import {
  createExpedition,
  pauseExpedition,
  resumeExpedition,
  updateExpeditionGoal,
  isGoalAchieved,
  recordExpeditionVisit,
  endExpedition,
  DEFAULT_GOALS,
} from './expedition-engine.js';
import { renderPostcard, generatePostcardBlob, generatePostcardDataUrl } from './postcard.js';
import { renderPostcardSvgDataUrl } from './postcards.js';
import { fetchNearby } from './nearby.js';
import { loadAutoPlacesForArea, getLastAutoPlacesStatus } from './auto-places.js';
import {
  getFallbackBitmapUrl,
  getCachedPlacePhoto,
  resolveVerifiedPlacePhoto,
  prefetchVerifiedPhotosForPlaces,
} from './poi-photos.js';
import {
  getPlacePhotoSync,
  resolvePlacePhoto,
  prefetchPlacePhotos,
  formatPhotoSourceLabel,
} from './place-photos.js';
import {
  fetchRouteElevationProfile,
  renderElevationProfileCardHtml,
} from './elevation.js';
import {
  downloadOfflineArea,
  loadOfflineAreaData,
} from './offline-maps.js';
import {
  createCompassStabilizer,
  interpolateBackgroundGap,
  triggerPocketProximityAlert,
  playTurnAudioCue,
  createKeepAliveController,
} from './keep-alive.js';
import { haversineMeters } from './domain.js';
import { escapeHtml as e, number } from './ui.js';
import { CHAPTERS, COLLECTIONS, RELICS } from './data.js';
import {
  START_PRESETS,
  PLANNER_RADII,
  PLANNER_CATEGORIES,
  TERRAIN_DIFFICULTIES,
  CZECH_PLACE_PRESETS,
  COMPANION_STYLES,
  optimizeRouteOrder,
  analyzePlannedRoute,
  autoSuggestTrip,
  fetchWalkingGeometry,
  fetchElevationProfile,
  encodeRouteShareCode,
  decodeRouteShareCode,
  validateDecodedRoutePlan,
  computeRemainingFromSharedRoute,
  buildLocalRoutedGeometry,
  computeActiveTurnInstruction,
  searchPlaceNominatim,
  buildReturnToOriginRoute,
  computeQuadrantSector,
  sortPlacesClockwise,
  computeLateralLoopWaypoint,
  insertStopAtBestPosition,
  ensureLoopDetourWaypoints,
} from './planner.js';
import { ALLOWED_AVATARS, avatarUrl } from './avatars.js';
import {
  getWalkingStickTier,
  createStickBadge,
  renderStickBadgeSvg,
  renderWalkingStickHtml,
} from './walking-stick.js';
import {
  getLocalRevirPilgrims,
  renderPilgrimsSection,
  recordSummitEntry,
} from './pilgrims.js';
import {
  playTick,
  playHammer,
  playRadar,
  playStampChord,
  animateValue,
  triggerHaptic,
  applyStaggerAnimation,
} from './fx.js';
import { initGpsSimulator, ROZMITAL_CENTER } from './gps-simulator.js';
import { getHikingTrails, renderOsmcBadgeSvg, parseOsmcSymbol } from './hiking-trails.js';
import { makeMapLibreLayer } from './maplibre-base.js';
import {
  computeVisibleMapCenterForPlayer,
  createTelemetryState,
  updateTelemetryTimers,
  updateTelemetryAltitude,
  updateTelemetryFromFix,
  computeTouristStatsSummary,
  GPS_OUTAGE_WARNING_MS,
  formatMetersCz,
} from './telemetry.js';
import { getWeatherForNext60Min } from './weather.js';
import {
  BUILTIN_NATURAL_FEATURES,
  evaluateNaturalFeatureReveals,
  resolveAccessibleStopLocation,
} from './natural-features.js';
import {
  startBackgroundTracking,
  updateBackgroundTracking,
  pauseBackgroundTracking,
  stopBackgroundTracking,
} from './background-keepalive.js';

export function formatDistanceLabel(meters, suffix = '') {
  if (meters == null || !Number.isFinite(meters) || meters < 0) {
    return 'Poloha není určena';
  }
  const base = meters >= 1000
    ? `${(meters / 1000).toFixed(1).replace('.', ',')} km`
    : `${Math.round(meters)} m`;
  return suffix ? `${base} ${suffix}` : base;
}

/**
 * Vykreslí jemné vektorové SVG pro vnitřek mapové značky podle kategorie místa.
 * Samotná poloha značky na mapě zůstává výhradně v režii Leafletu; animuje se jen tento vnitřní prvek.
 */
function renderCategoryMarkerGlyph(kind, state = 'default') {
  if (state === 'visited') {
    return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="marker-glyph-svg"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (kind === 'water') {
    return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="marker-glyph-svg"><path class="glyph-wave-1" d="M3 10.5c2.2-1.8 4.5-1.8 6.7 0s4.5 1.8 6.7 0 3.4-1.4 4.6-.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path class="glyph-wave-2" d="M3 15.5c2.2-1.8 4.5-1.8 6.7 0s4.5 1.8 6.7 0 3.4-1.4 4.6-.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }
  if (kind === 'forest') {
    return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="marker-glyph-svg"><g class="glyph-tree-crown"><polygon points="12,3 6,11 9.5,11 5.5,17 18.5,17 14.5,11 18,11" fill="currentColor"/></g><rect x="10.8" y="17" width="2.4" height="4" rx="1" fill="currentColor"/></svg>`;
  }
  if (kind === 'view') {
    return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="marker-glyph-svg"><path d="M2.5 18.5L9.5 7.5l4.2 6.2 2.8-4.2 5 9H2.5z" fill="currentColor"/><circle class="glyph-sun-glint" cx="17.5" cy="6" r="2.2" fill="currentColor"/></svg>`;
  }
  if (kind === 'culture') {
    return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="marker-glyph-svg"><path d="M5 19V8l3-3 4 3 4-3 3 3v11H5zm5-5v5h4v-5h-4z" fill="currentColor"/><circle class="glyph-sun-glint" cx="12" cy="4" r="1.6" fill="currentColor"/></svg>`;
  }
  if (kind === 'route-start') {
    return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="marker-glyph-svg"><line x1="6" y1="4" x2="6" y2="20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path class="glyph-flag-cloth" d="M6 5h11l-2.4 3.8L17 12.5H6V5z" fill="currentColor"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" class="marker-glyph-svg"><circle cx="12" cy="12" r="5.5" fill="currentColor"/></svg>`;
}

/**
 * Vykreslí ikonu levé nebo pravé podrážky pohorky (`.footprint-marker`, 18 × 18 px)
 * natočenou ve směru chůze (`bearingDeg`) se stárnoucí průhledností (`opacity` 0.85 až 0.15) (ZADÁNÍ #08 Bod 3).
 */
export function renderBootFootprintSvg(side = 'L', bearingDeg = 0, opacity = 0.82) {
  const isLeft = side === 'L';
  const offsetX = isLeft ? -2.2 : 2.2;
  const scaleX = isLeft ? 1 : -1;
  const safeOpacity = Number.isFinite(Number(opacity)) ? Math.max(0.15, Math.min(0.9, Number(opacity))) : 0.82;
  return `
    <span class="footprint-marker czekpoint-footprint-rotator" style="opacity:${safeOpacity};transform: rotate(${Math.round(bearingDeg)}deg) translateX(${offsetX}px) scaleX(${scaleX})">
      <svg viewBox="0 0 18 26" width="14" height="18" aria-hidden="true" class="footprint-svg">
        <path d="M5.6 2.2 C3.6 2.6 2.6 4.8 2.9 8.0 C3.2 10.9 4.0 12.6 4.4 14.3 L12.4 14.3 C12.8 12.4 13.5 10.5 13.6 7.7 C13.7 4.4 12.1 2.2 9.5 2.0 C8.1 1.9 6.8 2.0 5.6 2.2 Z" fill="#2c5530" stroke="#f4f8ec" stroke-width="1.25"/>
        <line x1="4.6" y1="6.5" x2="12.2" y2="6.5" stroke="#f4f8ec" stroke-width="0.9" stroke-opacity="0.65"/>
        <line x1="4.8" y1="10.2" x2="12.0" y2="10.2" stroke="#f4f8ec" stroke-width="0.9" stroke-opacity="0.65"/>
        <path d="M4.6 16.2 L12.2 16.2 L11.8 21.0 C11.6 22.8 10.1 23.8 8.4 23.8 C6.7 23.8 5.2 22.8 5.0 21.0 Z" fill="#2c5530" stroke="#f4f8ec" stroke-width="1.25"/>
      </svg>
    </span>
  `;
}

/**
 * Vykreslí živého animovaného Avatara hráče na mapě (`.player-avatar-marker`, 54 × 54 px)
 * s obíhající zlatou směrovou šipkou (`.avatar-direction-pointer`) (ZADÁNÍ #08 Bod 2).
 */
export function renderPlayerAvatarMarkerHtml(arg1 = 'liska', arg2 = 0, arg3 = false) {
  const opts = typeof arg1 === 'object' && arg1 !== null
    ? arg1
    : { avatarId: arg1, bearingDeg: arg2, isWalking: arg3 };
  const avatarId = opts.avatarId || 'liska';
  const bearingDeg = Number.isFinite(Number(opts.bearingDeg)) ? Number(opts.bearingDeg) : 0;
  const isWalking = Boolean(opts.isWalking);
  const imgSrc = avatarUrl(avatarId);
  const avatarMeta = ALLOWED_AVATARS.find(a => a.id === avatarId) || ALLOWED_AVATARS[0];
  const showArrow = opts.orbitalArrow !== false && opts.showOrbitalArrow !== false;
  return `
    <div class="player-avatar-marker ${isWalking ? 'is-walking' : 'is-idle'}" data-avatar-id="${e(avatarMeta.id)}">
      <div class="avatar-direction-pointer" style="transform: rotate(${Math.round(bearingDeg)}deg); ${showArrow ? '' : 'display:none;'}" title="Směr k další zastávce">
        <svg viewBox="0 0 20 20" class="avatar-direction-arrow" aria-hidden="true">
          <path d="M10 1 L17 15 L10 11.5 L3 15 Z" fill="#ffd25a" stroke="#231709" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="avatar-medallion-core">
        <img src="${e(imgSrc)}" alt="${e(avatarMeta.name)}" width="34" height="34" class="player-avatar-img">
      </div>
    </div>
  `;
}

export function mountWalk(root, routes, config, actions = {}) {
  const L = window.L;
  const { onAddVisit } = actions;
  let stateObj = loadState();
  let progress = {
    version: 1,
    cells: [...(stateObj.cells || [])],
    meters: Number(stateObj.meters) || 0,
    discoveries: [...(stateObj.discoveries || [])],
    walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
    revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
  };
  let storageError = stateObj._corruptedBackupDetected || stateObj.storageCorrupted
    ? (stateObj.storageError || 'Uložený profil byl poškozen. Původní data jsme uložili do nouzové zálohy v prohlížeči a načetli čistý profil.')
    : '';

  // Izolovaný sandbox pro simulátor (Bod 17: Simulátor nesmí měnit skutečný profil, body ani objevená území)
  let simSandboxActive = false;

  // Potvrzené zastávky aktuální výpravy (< 20 m, opakované měření) a záznamy průchodu poblíž (dle GPS)
  let confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
  let nearbyRecordedIds = new Set();
  let pendingStopSamples = {};
  let justConfirmedStopId = null;
  let replacingStopIndex = null;
  let appearedPlaceIds = new Set();

  // DÁVKA 2 (Bod 1): Osobní atlas malých objevů (soukromé vlastní vzpomínky v zařízení) a bezpečné výzvy všímavosti
  let personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
  let saveMemoryModalOpen = false;
  let selectedMemorySymbolId = PERSONAL_MEMORY_SYMBOLS[0].id;
  let mindfulnessPromptIndex = 0;
  let mindfulnessSkippedSession = false;

  // Turistická telemetrie a počasí (Body 28 & 29)
  let telemetry = createTelemetryState(Date.now());
  let statsDrawerOpen = false;
  let weatherData = null;
  let weatherExpanded = false;
  let gpsOutageWarning = false;
  let activeLocalReveals = [];

  // Pracovní návrh pro dialog „Upravit procházku“ (Bod 20: Potvrdit změny / Zrušit)
  let editDraft = null;
  let editModalOpen = false;

  let map, fog, tileLayer, waymarkedHikingLayer, contourTileLayer = null, trailLayer, player, accuracyRing;
  let mapLibreLayer = null, mapBase = 'original', mapBaseSwitchToken = 0;
  let fogMaskCanvas = null;
  let fogInnerCanvas = null;
  let plannedRouteLayer = L?.layerGroup();
  let playerLeadLayer = L?.layerGroup();
  let appSettings = { ...DEFAULT_APP_SETTINGS, ...(stateObj.appSettings || {}) };
  let hikingTrailsLayer = L?.layerGroup();
  let showHikingTrails = appSettings.kctTrails !== false;
  let showContourLayer = Boolean(appSettings.contours);
  let loadedHikingTrails = [];

  const routeGeometryCache = new Map();
  let plannedRouteRenderKey = null;
  let plannedRouteRenderToken = 0;
  let plannedRouteCoords = null;
  let lastRoutedGeometry = null;
  let currentElevationProfile = null;
  let elevationProfileToken = 0;
  let autoPlacesLoading = false;
  let autoPanFetchTimer = null;
  let lastAutoPanCenter = null;
  let pendingAutoPanCenter = null;
  let radiusCircle = null;
  let fakeGpsSim = null;

  const compassStabilizer = createCompassStabilizer({ alpha: 0.12, deadbandDeg: 2.5, minIntervalMs: 80 });
  const keepAliveCtrl = createKeepAliveController();
  let lastSampledFix = null;
  const alertedProximityStopIds = new Set();
  let arrivalGoalPromptShownForKey = '';
  let lupaSearchTimer = null;
  let lastLupaResults = [];

  let anchor = null, lastFix = null, lastAcceptedFix = null, watch = null;
  let active = false, disposed = false, demo = false, demoIndex = 0;
  let releaseLock = null, wake = null, frame = null, starting = false;
  // DÁVKA 1 (Bod 2.1): Sjednocený stavový model procházky: 'idle' | 'locating' | 'running' | 'paused' | 'finished'
  let walkState = stateObj.activeExpedition ? 'paused' : 'idle';
  let gpsBrowseOnlyMode = false;
  let gpsLocatingTaskId = null;

  // DÁVKA 1 (Bod 1): Počítadlo aktivních úloh v mapě (beginMapTask / endMapTask)
  let mapTaskSeq = 0;
  const activeMapTasks = new Map();

  function updateMapBusyIndicator() {
    if (disposed) return;
    const el = root.querySelector('#map-busy-indicator');
    const textEl = root.querySelector('#map-busy-text');
    if (!el || !textEl) return;
    if (activeMapTasks.size === 0) {
      el.hidden = true;
      textEl.textContent = '';
      return;
    }
    const labels = [...activeMapTasks.values()];
    const currentLabel = labels[labels.length - 1] || '⏳ Pracuji…';
    textEl.textContent = currentLabel;
    el.hidden = false;
  }

  function beginMapTask(label = '⏳ Pracuji…') {
    const taskId = ++mapTaskSeq;
    activeMapTasks.set(taskId, label);
    updateMapBusyIndicator();
    return taskId;
  }

  function endMapTask(taskId) {
    if (taskId != null && activeMapTasks.has(taskId)) {
      activeMapTasks.delete(taskId);
      updateMapBusyIndicator();
    }
  }

  function clearAllMapTasks() {
    activeMapTasks.clear();
    gpsLocatingTaskId = null;
    updateMapBusyIndicator();
  }

  let follow = true, nearby = [];
  let memoryTrail = [];
  let pendingPlaceStamps = {};
  const aborter = new AbortController();

  // Plynulá LERP animace Avatara na mapě (ZADÁNÍ #08 Bod 2)
  let playerLerpRafId = null;

  // Hlasová navigace v češtině (Web Speech API, ZADÁNÍ #08 Bod 5)
  let voiceNavEnabled = appSettings.voiceNav !== false;
  let lastSpokenNavStepKey = '';
  let lastOffRouteRecalcAt = 0;

  // 100% automatické nastavení enginu (Výprava s pergamenem + české turistické značky KČT)
  let fogMode = 'explore';
  showHikingTrails = true;
  showContourLayer = false;

  // UI stavy a Průvodce výpravou
  let sheetCollapsed = false;
  let p1PlannerCollapsed = false;
  let zenMode = false;
  let pickingStartOnMap = false;
  let pickingCustomEndOnMap = false;
  let phase4MenuOpen = false;
  let moreMenuOpen = false;
  let lastRadarAlertId = null;
  let selectedDetailPlace = null;
  let appSettingsModalOpen = false;

  // Aktivní výprava
  let currentExpedition = stateObj.activeExpedition;
  if (currentExpedition && currentExpedition.state === 'active') {
    currentExpedition = pauseExpedition(currentExpedition);
    stateObj.activeExpedition = currentExpedition;
    walkState = 'paused';
    try { stateObj = saveState(stateObj); } catch (err) { storageError = err.message; }
  }

  // ZADÁNÍ #09 (Bod 1 & 2): Výchozí tempo pevně 4,0 km/h ('solo'), střední terén, výchozí délka ~2 hod (6 km), okruh zpět sem
  let plannedRoute = stateObj.plannedRoute || {
    origin: null,
    radiusKm: 10,
    targetKm: 6,
    terrainDifficulty: 'medium',
    categories: PLANNER_CATEGORIES.map(c => c.id),
    selectedPlaceIds: [],
    companionMode: 'solo',
    explorationMode: 'focus',
    routeType: 'loop',
    embeddedStops: [],
  };
  plannedRoute.companionMode = 'solo';
  plannedRoute.terrainDifficulty = 'medium';
  stateObj.companionMode = 'solo';

  let phase1Theme = 'all';
  let phase1DurationKm = Number(plannedRoute.targetKm) === 3 || Number(plannedRoute.targetKm) === 9 ? Number(plannedRoute.targetKm) : 6;
  let phase1EndMode = plannedRoute.routeType === 'oneway' ? 'custom' : 'loop';

  let userExplicitlyPickedOrigin = Boolean(
    plannedRoute.origin &&
    plannedRoute.origin.id !== 'namesti' &&
    plannedRoute.origin.id !== 'my-gps' &&
    plannedRoute.origin.custom
  );
  let lockedExpeditionOrigin = null;

  let wizardCollapsed = true;
  let wizardScenario = userExplicitlyPickedOrigin ? 'from-home' : 'on-site';
  let wizardCategories = Array.isArray(plannedRoute.categories) && plannedRoute.categories.length
    ? [...plannedRoute.categories]
    : PLANNER_CATEGORIES.map(c => c.id);
  let wizardDistanceMode = String(phase1DurationKm);
  let wizardDifficulty = 'medium';

  const catalogue = routes
    .filter(r => r.location)
    .map(r => {
      const acc = resolveAccessibleStopLocation({ ...r, lat: r.location.lat, lng: r.location.lng });
      return {
        id: r.id,
        routeId: r.id,
        title: r.pointKind === 'place' ? r.title : `Start trasy: ${r.title}`,
        lat: acc ? acc.lat : r.location.lat,
        lng: acc ? acc.lng : r.location.lng,
        originalLat: r.location.lat,
        originalLng: r.location.lng,
        isShoreAccess: Boolean(acc?.isShoreAccess),
        kind: r.kind,
        category: r.kind === 'culture' ? 'castles' : r.kind === 'view' ? 'views' : r.kind === 'water' ? 'water' : 'nature',
        chapter: r.chapter || r.sector,
        hintAnchor: Boolean(r.hintAnchor || r.watchtower),
        url: `#/trasa/${r.id}`,
        pointKind: r.pointKind || 'place',
        collectible: r.collectible !== false && r.pointKind === 'place',
        access: r.access || {},
      };
    });

  root.innerHTML = `
    <h1 tabindex="-1" class="visually-hidden">Mapa objevování a procházka · Czekpoint v1.4-part2</h1>

    <!-- Horní přehledový panel trasy: zobrazí se AŽ ve chvíli, kdy má uživatel vybraný alespoň 1 bod v trase -->
    <section class="phase1-top-bar" id="phase1-top-bar" hidden aria-label="Souhrn trasy, plán zastávek a spuštění výpravy">
      <div class="p1-top-main-row">
        <div class="p1-top-summary" id="phase1-top-summary" role="status" aria-live="polite">
          <span class="p1-top-icon">🧭</span>
          <span class="p1-top-text" id="phase1-top-text">Vyber si zastávky v mapě nebo v seznamu níže</span>
        </div>
        <div class="p1-top-actions" id="phase1-top-actions">
          <button type="button" class="button accent-action-btn phase1-go-btn" id="btn-phase1-go">
            ▶ Vyrazit
          </button>
          <button type="button" class="button small dark-ctrl-btn" id="btn-top-pause" hidden>
            ⏸ Pauza
          </button>
          <button type="button" class="button small dark-ctrl-btn" id="btn-top-fullscreen" title="Zvětšit mapu na celou obrazovku">
            ⛶ Celá obrazovka
          </button>
          <button type="button" class="button small dark-ctrl-btn" id="btn-top-edit-walk" title="Podrobně upravit zastávky a parametry trasy">
            ✏️ Upravit body
          </button>
          <button type="button" class="button small dark-ctrl-btn" id="btn-top-settings" title="Nastavení aplikace a herního stylu">
            ⚙️ Nastavení
          </button>
        </div>
      </div>

      <!-- Vizuální plán dnešní cesty: všechny zastávky v pořadí 1 -> 2 -> 3 přímo na očích -->
      <div class="top-route-itinerary-wrap" id="top-route-itinerary-wrap">
        <div class="top-itinerary-header">
          <span class="top-itinerary-label" id="top-itinerary-label">🗺️ Plán dnešní cesty a zastávky (kliknutím ukážeš místo na mapě):</span>
          <button type="button" class="top-itinerary-toggle-btn" id="btn-toggle-p1-bar" aria-expanded="true">
            ▲ Sbalit volby trasy
          </button>
        </div>
        <div class="top-route-itinerary-strip" id="top-route-itinerary-strip" role="list" aria-label="Body na naplánované trase"></div>
      </div>
    </section>

    <!-- Zjednodušený panel pro 50+: velké dlaždice Herního stylu a Co chci vidět -->
    <section class="phase1-bottom-bar phase1-planner-card" id="phase1-bottom-bar" role="region" aria-label="Výběr herního stylu a filtru míst">
      <div class="p1-row">
        <span class="p1-row-label">1. Herní styl:</span>
        <div class="p1-btn-group p1-gamemode-row" role="group" aria-label="Výběr ze 3 herních stylů">
          <button type="button" class="p1-choice-btn p1-gamemode-btn ${appSettings.gameMode === 'explorer' ? 'active' : ''}" data-p1-gamemode="explorer" aria-pressed="${appSettings.gameMode === 'explorer'}">
            🧭 Objevování
          </button>
          <button type="button" class="p1-choice-btn p1-gamemode-btn ${(appSettings.gameMode || 'gamified') === 'gamified' ? 'active' : ''}" data-p1-gamemode="gamified" aria-pressed="${(appSettings.gameMode || 'gamified') === 'gamified'}">
            📜 Výprava s pergamenem
          </button>
          <button type="button" class="p1-choice-btn p1-gamemode-btn ${appSettings.gameMode === 'casual' ? 'active' : ''}" data-p1-gamemode="casual" aria-pressed="${appSettings.gameMode === 'casual'}">
            🗺️ Turistická mapa
          </button>
        </div>
      </div>

      <div class="p1-row">
        <span class="p1-row-label">2. Co chci vidět:</span>
        <div class="p1-btn-group" role="group" aria-label="Co chci vidět">
          <button type="button" class="p1-choice-btn p1-cat-btn active" data-p1-theme="all" aria-pressed="true">✨ Vše zajímavé</button>
          <button type="button" class="p1-choice-btn p1-cat-btn" data-p1-theme="castles" aria-pressed="false">🏰 Památky a hrady</button>
          <button type="button" class="p1-choice-btn p1-cat-btn" data-p1-theme="nature" aria-pressed="false">🌲 Příroda a vyhlídky</button>
          <button type="button" class="p1-choice-btn p1-cat-btn" data-p1-theme="water" aria-pressed="false">💧 Voda a rybníky</button>
        </div>
      </div>
    </section>

    <!-- DÁVKA 2 (Bod 3.3): Zpřístupněný panel „📊 Moje chůze a počasí“ přímo pod ovládáním (nadmořská výška při nedostupnosti jako —) -->
    <section class="map-command-bar" id="map-command-bar" aria-label="Moje chůze a počasí">
      <div class="mcb-primary-row">
        <div class="mcb-section-heading">
          <strong>📊 Moje chůze a počasí</strong>
        </div>
        <div class="mcb-walk-actions" id="expedition-buttons" hidden>
          <button type="button" id="walk-start" class="button accent-action-btn main-start-btn">▶ Začít procházku</button>
          <button type="button" id="walk-stop" class="button dark-ctrl-btn" disabled>II Pozastavit</button>
          <button type="button" id="walk-end" class="button danger-ctrl-btn" disabled>⏹ Ukončit</button>
        </div>

        <div class="mcb-secondary-actions">
          <button type="button" class="button edit-walk-trigger-btn" id="btn-open-settings-modal" title="Nastavení aplikace a herního stylu">
            ⚙️ Nastavení
          </button>
          <button type="button" class="button edit-walk-trigger-btn" id="btn-open-edit-walk" aria-haspopup="dialog">
            ✏️ Upravit zastávky
          </button>
          <a href="#/pas" class="mcb-passport-pill" id="compact-top-summary" title="Sbírky, hůl a hodnosti najdeš v Mém pasu">
            ⭐ 0 b. · 🏅 Úroveň 1 · Můj pas →
          </a>
        </div>
      </div>

      <div class="tourist-main-hud" id="tourist-main-hud" aria-label="Hlavní ukazatele chůze">
        <div class="tmh-metrics">
          <div class="tmh-metric">
            <span class="tmh-label">👣 Ušlá vzdálenost</span>
            <strong class="tmh-value" id="hud-walked-dist">0 m</strong>
          </div>
          <div class="tmh-metric">
            <span class="tmh-label">⏱ Čas chůze</span>
            <strong class="tmh-value" id="hud-walk-time">0:00</strong>
          </div>
          <div class="tmh-metric">
            <span class="tmh-label">🎯 Další zastávka</span>
            <strong class="tmh-value" id="hud-next-stop">—</strong>
          </div>
        </div>
        <button type="button" class="button small dark-ctrl-btn tmh-expand-btn" id="btn-toggle-tourist-stats" aria-expanded="false" aria-controls="tourist-stats-drawer">
          📊 Podrobné údaje ▼
        </button>
      </div>

      <div class="tourist-stats-drawer" id="tourist-stats-drawer" hidden>
        <div class="tsd-grid">
          <div class="tsd-item">
            <span class="tsd-label">Aktuální rychlost (vyhlazená)</span>
            <strong class="tsd-val" id="stat-current-speed">0,0 km/h</strong>
            <small class="tsd-note">Při stání ukazuje 0,0 km/h</small>
          </div>
          <div class="tsd-item">
            <span class="tsd-label">Průměrná rychlost chůze</span>
            <strong class="tsd-val" id="stat-avg-speed">0,0 km/h</strong>
            <small class="tsd-note">Z aktivního času chůze (bez pauz)</small>
          </div>
          <div class="tsd-item">
            <span class="tsd-label">Čas aktivní chůze / Celkem</span>
            <strong class="tsd-val" id="stat-total-time">0:00 / 0:00</strong>
            <small class="tsd-note">Odděluje chůzi od zastavení</small>
          </div>
          <div class="tsd-item">
            <span class="tsd-label">Nadmořská výška (odhad)</span>
            <strong class="tsd-val" id="stat-altitude">—</strong>
            <small class="tsd-note" id="stat-altitude-source">Výška není k dispozici</small>
          </div>
          <div class="tsd-item">
            <span class="tsd-label">Nastoupáno / Sestoupáno</span>
            <strong class="tsd-val" id="stat-elevation">+0 m / -0 m</strong>
            <small class="tsd-note">Filtrovaný výškový přírůstek</small>
          </div>
          <div class="tsd-item">
            <span class="tsd-label">Zbývá do cíle (pěší trasa)</span>
            <strong class="tsd-val" id="stat-remaining">—</strong>
            <small class="tsd-note" id="stat-remaining-note">Ze společné pěší trasy</small>
          </div>
        </div>
      </div>

      <div class="weather-strip" id="weather-strip" role="region" aria-label="Předpověď počasí na příštích 60 minut">
        <div class="weather-strip-main">
          <span class="weather-strip-sentence" id="weather-sentence">🌤️ Načítám stručný výhled počasí na příštích 60 minut…</span>
          <button type="button" class="mcb-link-btn" id="btn-toggle-weather-detail" aria-expanded="false" aria-controls="weather-detail-panel">
            Počasí podrobně ▼
          </button>
        </div>
        <div class="weather-detail-panel" id="weather-detail-panel" hidden>
          <div class="weather-detail-grid" id="weather-detail-grid"></div>
        </div>
      </div>

      <div class="mcb-telemetry-row" role="status" aria-live="polite">
        <span class="telemetry-pill state-ready" id="walk-state-pill">● Připraveno</span>
        <span class="telemetry-pill gps-pill" id="gps-accuracy-badge">
          📡 Nepřesnost GPS: čekám na signál (limit ≤ ${MAX_GPS_ACCURACY_M} m)
        </span>
        <span class="telemetry-pill fog-pill" id="fog-radius-badge">
          🗺️ Dosah odkrývání: ${FOG_REVEAL_RADIUS_M} m
        </span>
        <span class="telemetry-session-text" id="walk-session">Tato výprava: 0 m · 0 dílků · 0 zastávek</span>
      </div>

      <div class="mcb-status-line">
        <strong id="walk-status" role="status" aria-live="polite">${e(storageError || 'Mapa připravena.')}</strong>
        <div class="mcb-toggles">
          <label class="mcb-check"><input type="checkbox" id="walk-awake" checked> Držet displej</label>
          <label class="mcb-check" title="Záznam pokračuje i se zhasnutou obrazovkou v kapse"><input type="checkbox" id="walk-bg-record" checked disabled> 🔋 Záznam při zhasnutém displeji: ZAP</label>
          <label class="mcb-check"><input type="checkbox" id="walk-sound" ${stateObj.soundEnabled !== false ? 'checked' : ''}> 🔊 Zvuk</label>
          <label class="mcb-check"><input type="checkbox" id="walk-voice-nav" ${voiceNavEnabled ? 'checked' : ''}> 🗣️ Hlasová navigace</label>
          <span id="wake-status" class="visually-hidden">Displej: zámek není aktivní.</span>
        </div>
      </div>
    </section>

    <section class="trip-wizard-sheet collapsed" id="trip-wizard-sheet" hidden aria-label="Průvodce výpravou">
      <div class="trip-wizard-head">
        <button type="button" class="button small ghost" id="btn-toggle-trip-wizard" aria-expanded="false">▼ Rozbalit přípravu</button>
      </div>
      <div class="trip-wizard-body" id="trip-wizard-body" hidden>
        <div id="wiz-home-panel" hidden>
          <input type="search" id="wiz-place-search-input" autocomplete="off">
          <button type="button" id="btn-wiz-search-place">Najít</button>
          <button type="button" id="btn-wiz-pick-map">Kliknout do mapy</button>
          <button type="button" id="btn-wiz-save-trip">Uložit výlet</button>
          <div id="wiz-place-search-results" hidden></div>
          <div id="wiz-saved-trips-wrap" hidden><div id="wiz-saved-trips-list"></div></div>
        </div>
        <strong id="wiz-active-origin-label"></strong>
        <button type="button" id="btn-wiz-calc-route">Vypočítat</button>
        <div id="wiz-route-preview-box" hidden>
          <strong id="wiz-route-summary-line"></strong>
          <button type="button" id="btn-wiz-confirm-go">Vyrazit</button>
        </div>
      </div>
    </section>

    <!-- Varovný pruh při pozastavení průzkumu kvůli nepřesné GPS (> 40 m), výpadku GPS nebo aktivním sandboxu -->
    <div id="walk-accuracy-banner" class="walk-accuracy-banner" hidden role="alert"></div>
    <div id="walk-sandbox-banner" class="walk-sandbox-banner" hidden role="status">
      🔒 <strong>Testovací režim simulátoru je aktivní:</strong> Veškerý pohyb, odkrývání mapy a potvrzování zastávek probíhá odděleně v paměti a <strong>nemění tvůj skutečný profil, body ani uložená území</strong>.
    </div>
    <div id="walk-demo-banner" class="notice" hidden>UKÁZKA · Simulovaný pohyb v Rožmitále. Žádná GPS, žádné ukládání bodů.</div>
    <div id="walk-radar-banner" class="walk-radar-banner" hidden></div>

    <div id="next-checkpoint-hero-card" class="next-checkpoint-hero-card" role="region" aria-label="Následující cíl trasy"></div>

    <!-- Hlavní mapa zabírající většinu obrazovky -->
    <div class="walk-map-wrap" id="walk-map-wrap">
      <div id="walk-map" aria-label="Interaktivní Mapa objevování"></div>

      <!-- DÁVKA 1 (Bod 1.1): Plovoucí stavový indikátor načítání a výpočtu přímo v mapě (z-index: 1200) -->
      <div id="map-busy-indicator" class="map-busy-indicator" role="status" aria-live="polite" hidden>
        <span class="map-spinner" aria-hidden="true"></span>
        <span id="map-busy-text" class="map-busy-text">⏳ Pracuji…</span>
      </div>

      <!-- 2.2 Horní vyhledávací pole s lupou přímo v mapě (top: 12px; left: 12px; right: 12px; z-index: 800) -->
      <div class="map-search-overlay" id="map-search-overlay" role="search" aria-label="Vyhledávání v mapě">
        <div class="map-search-bar">
          <span class="map-search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            id="map-lupa-search-input"
            class="map-search-input"
            placeholder="Hledat město, památku nebo rozcestí..."
            aria-label="Hledat město, památku nebo rozcestí"
            autocomplete="off"
          />
          <button type="button" id="map-lupa-search-clear" class="map-search-clear" hidden aria-label="Vymazat hledání">✕</button>
        </div>
        <div id="map-lupa-search-results" class="map-search-results" hidden role="listbox" aria-label="Výsledky vyhledávání"></div>
      </div>

      <!-- Ukazatel uložení offline oblasti -->
      <div id="offline-download-banner" class="offline-download-banner" hidden role="status" aria-live="polite"></div>

      <!-- Bublina po kliknutí na ikonu v mapě (Vynechat zastávku / Přidat po cestě / Nastavit jako nový konec) -->
      <div id="place-detail-sheet" class="place-detail-sheet" hidden role="dialog" aria-label="Úprava bodu na trase"></div>

      <!-- Výrazné tlačítko „🎯 Zpět ke mně“ při ručním posunu mapy (DÁVKA 1 Bod 3.2) -->
      <button type="button" id="btn-return-to-gps" class="return-to-gps-btn" hidden title="Obnovit automatické sledování tvé polohy">
        🎯 Zpět ke mně
      </button>

      <!-- Aktivní otočný kompas -->
      <div class="active-compass-widget compass-widget" id="active-compass-widget" title="Aktivní kompas výpravy" role="button" tabindex="0">
        <div class="compass-dial compass-rose-svg" id="compass-dial">
          <svg viewBox="0 0 100 100" class="compass-dial-svg" id="compass-rose-svg">
            <circle cx="50" cy="50" r="47" fill="#1e2d24" stroke="#d8b25c" stroke-width="3"/>
            <circle cx="50" cy="50" r="41" fill="#f7f2e4" stroke="#6e5332" stroke-width="1.5"/>
            <text x="50" y="21" text-anchor="middle" font-size="13" font-weight="900" fill="#b82518">S</text>
            <text x="83" y="55" text-anchor="middle" font-size="12" font-weight="800" fill="#2d2012">V</text>
            <text x="50" y="88" text-anchor="middle" font-size="12" font-weight="800" fill="#2d2012">J</text>
            <text x="17" y="55" text-anchor="middle" font-size="12" font-weight="800" fill="#2d2012">Z</text>
            <line x1="50" y1="8" x2="50" y2="13" stroke="#b82518" stroke-width="2.5"/>
            <circle cx="50" cy="50" r="5" fill="#b58938" stroke="#1e2d24" stroke-width="1.5"/>
          </svg>
          <div class="compass-needle" id="compass-needle">
            <div class="needle-north"></div>
            <div class="needle-south"></div>
          </div>
        </div>
        <div class="compass-target-arrow" id="compass-target-arrow">
          <div class="target-gem" title="Směr k další zastávce">◆</div>
        </div>
        <div class="compass-dist-badge" id="compass-dist-badge">-- m</div>
      </div>

      <!-- Odbočovací navigace u kompasu (.turn-nav-pill) -->
      <div class="turn-nav-pill" id="turn-nav-pill" role="status" aria-live="polite" hidden>
        <span class="turn-nav-icon" id="turn-nav-icon">↑</span>
        <span class="turn-nav-text" id="turn-nav-text">Trasa připravena</span>
        <button type="button" class="voice-nav-pill-btn ${voiceNavEnabled ? 'active' : ''}" id="btn-voice-nav-pill" title="Zapnout/vypnout českou hlasovou navigaci" aria-pressed="${voiceNavEnabled}">
          ${voiceNavEnabled ? '🔊 Hlas ZAP' : '🔈 Hlas'}
        </button>
      </div>

      <div class="quest-hud-panel collapsed" id="quest-hud-panel" hidden>
        <button type="button" class="quest-hud-header" id="quest-hud-toggle-btn" aria-expanded="false" aria-controls="quest-hud-content">
          <span class="quest-hud-title qhud-compact-pill-title" id="qhud-compact-pill-label">📊 Trasa</span>
          <span class="quest-hud-toggle-icon" id="qhud-toggle-icon">▼ Detail</span>
        </button>
        <div class="qhud-compact" id="qhud-next-target">
          <div class="qhud-target-name">🎯 <span id="qhud-next-name">--</span> (<span id="qhud-progress">0/0</span>)</div>
          <div class="qhud-target-eta"><span id="qhud-next-eta">-- m</span> · 🏁 V cíli <strong id="qhud-eta-clock">--:--</strong></div>
        </div>
        <div class="quest-hud-content" id="quest-hud-content">
          <div class="qhud-stops-list" id="qhud-stops-list"></div>
          <div class="qhud-eta-summary" id="qhud-eta-summary">
            <div class="qhud-eta-row"><strong>🏁 Zbývá ujít:</strong> <span id="qhud-total-dist">-- km</span></div>
            <div class="qhud-eta-row"><strong>⏱ Odhad času:</strong> <span id="qhud-total-time">~-- min</span></div>
          </div>
          <button type="button" class="button small primary return-home-btn" id="btn-return-to-start">
            🏠 Navést zpět na start
          </button>
        </div>
      </div>

      <button type="button" id="zen-close-btn" class="zen-close-btn" hidden>× Zmenšit mapu z celé obrazovky</button>
      <button type="button" id="zen-follow-btn" class="zen-follow-fab is-following" hidden title="Vycentrovat a sledovat moji polohu na mapě">
        <span class="zen-fab-icon">◎</span>
        <span class="zen-fab-label" id="zen-follow-label">Sleduji polohu</span>
      </button>

      <!-- DÁVKA 1 (Bod 2.3): Sjednocená ovládací tlačítka mapy (>= 44 × 44 px): ➕, ➖, 🔍, ⛶ -->
      <div class="walk-map-toolbar map-right-toolbar" role="toolbar" aria-label="Ovládání mapy">
        <button type="button" class="map-right-btn map-base-btn" id="walk-map-base" aria-pressed="false" aria-label="Mapa: původní. Přepnout na moderní mapu" title="Přepnout mapový podklad"><span aria-hidden="true">🗺️</span><span id="walk-map-base-label">Původní</span></button>
        <button type="button" class="map-right-btn" id="walk-zoom-in" title="Přiblížit mapu (+)" aria-label="Přiblížit mapu">➕</button>
        <button type="button" class="map-right-btn" id="walk-zoom-out" title="Oddálit mapu (−)" aria-label="Oddálit mapu">➖</button>
        <button type="button" class="map-right-btn" id="walk-search-toggle" title="Hledat místo na mapě (🔍)" aria-label="Hledat v mapě">🔍</button>
        <button type="button" class="map-right-btn" id="walk-zen-toggle" aria-pressed="false" title="Celá obrazovka" aria-label="Celá obrazovka">⛶</button>
        <button type="button" class="map-right-btn" id="walk-center" hidden title="Vycentrovat na mě" aria-label="Vycentrovat na mě">🎯</button>
        <button type="button" class="map-right-btn active" id="walk-fog-toggle" hidden title="Přepnout pergamen / běžnou mapu">📜</button>
      </div>

      <!-- TRVALE VIDITELNÁ AKČNÍ LIŠTA PŘÍMO U MAPY (.map-action-bar) -->
      <div class="map-action-bar" id="map-action-bar" role="region" aria-label="Hlavní ovládání výpravy">
        <!-- Stav 1 — Výprava ještě neběží (walkState === 'idle' | 'finished') -->
        <div class="mab-inactive-group" id="mab-inactive-group">
          <button type="button" class="button mab-btn mab-start-btn" id="walk-start-unified">
            ▶ Vyrazit
          </button>
        </div>
        <!-- Stav 2 — Výprava se zaměřuje, běží nebo je pozastavena (walkState === 'locating' | 'running' | 'paused') -->
        <div class="mab-active-group" id="mab-active-group" hidden>
          <button type="button" class="button mab-btn mab-pause-btn" id="walk-pause">
            ⏸ Pauza
          </button>
          <button type="button" class="button mab-btn mab-finish-btn" id="walk-finish">
            ⏹ Dokončit
          </button>
          <div class="mab-more-wrap">
            <button type="button" class="button mab-btn mab-more-btn" id="walk-more-btn" aria-expanded="false" aria-haspopup="menu" aria-controls="walk-more-menu">
              ⋯ Další
            </button>
            <div class="mab-more-menu" id="walk-more-menu" role="menu" hidden>
              <button type="button" class="mab-more-item" id="walk-shorten-to-start" role="menuitem">
                🏠 Návrat na start
              </button>
              <button type="button" class="mab-more-item" id="btn-pocket-mode" role="menuitem">
                🌙 Kapesní režim
              </button>
              <button type="button" class="mab-more-item" id="walk-more-settings" role="menuitem">
                ⚙️ Nastavení stylu a zvuku
              </button>
            </div>
          </div>
        </div>
        <!-- DÁVKA 2 (Bod 1.1): Tlačítko „✨ Uložit vzpomínku“ (#walk-save-memory) přímo u mapy -->
        <button type="button" class="button mab-btn mab-memory-btn" id="walk-save-memory" title="Uložit vlastní soukromou vzpomínku na toto místo">
          ✨ Uložit vzpomínku
        </button>
      </div>

      <!-- Kompatibilní skryté prvky pro Fázi 4 -->
      <div class="phase4-finish-bar" id="phase4-finish-bar" hidden style="display:none !important">
        <div class="phase4-options-sheet" id="phase4-options-sheet" hidden>
          <button type="button" class="phase4-option-btn shorten" id="btn-phase4-shorten">🏠 Zkrátit</button>
          <button type="button" class="phase4-option-btn finish-now" id="btn-phase4-finish-now">⏹ Ukončit</button>
        </div>
        <button type="button" class="button phase4-main-trigger-btn" id="btn-phase4-toggle">Dokončit</button>
      </div>
    </div>

    <div class="map-sub-bar">
      <span class="trail-note" id="trail-info">Stopy pohorek za poslední chůzi: 0 kroků · Potvrzení zastávky podle GPS: pod ${STOP_CONFIRM_RADIUS_M} m (opakované vzorky)</span>
      <span class="trail-note bg-record-note" id="bg-record-status">🔋 Záznam na pozadí: Běží i při zhasnutém displeji v kapse</span>
      <span class="trail-note osm-trails-attribution" id="osm-trails-attribution">Mapový podklad a KČT trasy: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL)</span>
    </div>
    <div class="walk-test-strip" aria-label="Ukázka a testovací nástroje">
      <button type="button" id="walk-demo" class="button small ghost">Ukázka pohybu</button>
      <button type="button" id="walk-step" class="button small ghost" hidden>+ Krok ukázky</button>
      <button type="button" id="walk-fake-gps-toggle" class="button small ghost fake-gps-toggle-btn" title="Testovací simulátor chůze (izolovaný od skutečného profilu)">🧪 Testovací simulátor GPS</button>
    </div>
    <!-- Zóna pro simulátor pod mapou (nepřekrývá mapu) -->
    <div id="simulator-test-zone" class="simulator-test-zone" hidden></div>
    <p id="tile-status" class="small-note" role="status"></p>

    <!-- Podrobný plán a zastávky výpravy pod mapou (vždy přístupný a přehledný) -->
    <section class="bottom-sheet" id="walk-bottom-sheet" aria-label="Plán a zastávky procházky">
      <div class="bottom-sheet-bar">
        <div class="sheet-header-summary">
          <strong>🧭 Zastávky na trase (<span id="basket-count">${plannedRoute.selectedPlaceIds.length}</span>), osobní atlas a místa v okolí</strong>
          <span class="sheet-header-sub" id="sheet-header-sub">Seřazeno od nejbližšího místa · Potvrzení podle GPS vyžaduje opakované kvalitní vzorky (≤ ${MAX_GPS_ACCURACY_M} m)</span>
        </div>
        <div class="sheet-bar-actions">
          <button type="button" class="button small ghost" id="btn-sheet-edit-walk" title="Otevřít sjednocený editor zastávek s potvrzením/zrušením změn">✏️ Upravit zastávky</button>
          <button type="button" class="button small ghost sheet-toggle-btn" id="sheet-toggle-btn" aria-expanded="true">⬇ Sbalit panel</button>
        </div>
      </div>

      <div class="sheet-body" id="sheet-body">
        <!-- DÁVKA 2 (Bod 1.2): Volitelná a bezpečná výzva všímavosti -->
        <div class="mindfulness-prompt-card" id="mindfulness-prompt-card" role="region" aria-label="Volitelná výzva všímavosti">
          <div class="mindfulness-prompt-head">
            <span class="eyebrow">🍃 Volitelná výzva všímavosti (zůstaň na bezpečné cestě)</span>
            <div class="mindfulness-prompt-actions">
              <button type="button" class="button small ghost" id="btn-next-mindfulness" title="Další jemný tip">↻ Jiný tip</button>
              <button type="button" class="button small ghost" id="btn-skip-mindfulness" title="Přeskočit tuto výzvu bez postihu">Přeskočit</button>
            </div>
          </div>
          <p class="mindfulness-prompt-text" id="mindfulness-prompt-text"></p>
          <div class="mindfulness-prompt-foot">
            <small class="small-note">Bezpečnost: Nikdy nevstupuj na nepřístupné pozemky, nesahej na přírodu a nesleduj displej při přecházení silnice.</small>
            <button type="button" class="button small lime" id="btn-mindfulness-save-memory">✨ Uložit vzpomínku</button>
          </div>
        </div>

        <div class="planner-box">
          <div id="planner-basket-list" class="planner-basket-list"></div>
          <div id="stop-replace-picker" class="stop-replace-picker" hidden></div>
        </div>

        <!-- Souhrn zbývající a celkové trasy + stav routeru + SVG Výškový profil (.elevation-profile-card) -->
        <div class="route-xray-card" id="route-xray-card"></div>

        <!-- DÁVKA 2 (Bod 1.1): Osobní atlas malých objevů (vlastní soukromé vzpomínky v zařízení) -->
        <div class="planner-box personal-atlas-box" id="personal-atlas-section">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <span class="eyebrow">✨ Osobní atlas malých objevů (<span id="personal-memories-count">0</span>)</span>
              <p class="small-note" style="margin:2px 0 0">Vlastnoruční vzpomínky uživatele (soukromé poznámky v zařízení, nikoliv GPS ověřené památky).</p>
            </div>
            <button type="button" class="button small lime" id="btn-sheet-save-memory">✨ Uložit vzpomínku</button>
          </div>
          <div id="personal-memories-list" class="personal-memories-list" style="margin-top:8px"></div>
        </div>

        <!-- 4. Místa v okolí seřazená striktně od nejbližšího s fotkou (88x72 px) -->
        <div class="planner-box" style="margin-top:4px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <span class="eyebrow">📍 Zajímavá místa v okolí (seřazeno od nejbližšího)</span>
          </div>
          <div id="nearby-status" role="status"></div>
          <p id="nearby-origin" class="small-note"></p>
          <div id="walk-places"></div>
        </div>

        <!-- Sdílení kódu trasy a záloha -->
        <div class="planner-share-row">
          <button type="button" class="button small" id="btn-share-route-code">📤 Sdílet kód trasy</button>
          <button type="button" class="button small" id="btn-import-route-code">📥 Načíst kód trasy</button>
          <button type="button" class="button small" id="walk-export">💾 Exportovat průzkum (JSON)</button>
          <button type="button" class="button small" id="walk-import-btn">📂 Obnovit ze zálohy</button>
          <input type="file" id="walk-import-file" accept=".json,application/json" hidden>
        </div>
      </div>
    </section>

    <!-- 1.2 Krok 4: Dialogové okno po příchodu do cíle trasy -->
    <div id="arrival-goal-modal" class="arrival-goal-backdrop" hidden role="dialog" aria-modal="true" aria-labelledby="arrival-goal-title">
      <div class="arrival-goal-dialog" style="position:relative">
        <button type="button" class="button small ghost" id="btn-arrival-close-x" aria-label="Zavřít okno" style="position:absolute;top:10px;right:10px;padding:4px 10px;min-height:36px;font-weight:800">✕</button>
        <h2 id="arrival-goal-title" class="arrival-goal-title">🎉 Jsi v cíli své trasy! Co chceš udělat dál?</h2>
        <p class="arrival-goal-sub" id="arrival-goal-sub">Prošel jsi všemi vybranými zastávkami na trase. Chceš se nechat navést zpátky na místo startu, nebo výpravu rovnou uzavřít a převzít pohlednici?</p>
        <div class="arrival-goal-actions">
          <button type="button" class="arrival-goal-btn return-start" id="btn-arrival-return-start">
            🏠 Navést zpět na místo startu
          </button>
          <button type="button" class="arrival-goal-btn finish-postcard" id="btn-arrival-finish-postcard">
            🏁 Ukončit výpravu a převzít pohlednici
          </button>
        </div>
      </div>
    </div>

    <!-- 8.2 Kapesní režim (#000000 černá obrazovka šetřící baterii) -->
    <div id="pocket-mode-overlay" class="pocket-mode-overlay" hidden role="dialog" aria-modal="true" aria-label="Kapesní režim aktivní">
      <div class="pocket-mode-box">
        <h2 class="pocket-mode-title">🌙 Kapesní režim aktivní</h2>
        <p class="pocket-mode-stats" id="pocket-mode-stats">GPS zaznamenává trasu na pozadí</p>
        <p class="pocket-mode-hint">Obrazovka je zhasnutá pro maximální úsporu baterie (až 90 %). Při přiblížení k zastávce (&lt; 35 m) telefon zavibruje a cinkne.<br><br>Pro návrat do mapy dvakrát poklepej nebo stiskni tlačítko níže.</p>
        <button type="button" class="pocket-mode-unlock-btn" id="btn-pocket-unlock">
          🔓 Rozsvítit mapu
        </button>
      </div>
    </div>

    <!-- Sjednocený modální dialog „Upravit procházku“ s „Potvrdit změny“ a „Zrušit“ (Bod 20) -->
    <div class="edit-walk-modal-backdrop" id="edit-walk-modal" hidden role="dialog" aria-modal="true" aria-labelledby="edit-walk-title">
      <div class="edit-walk-modal-card">
        <div class="edit-walk-modal-header">
          <div>
            <span class="eyebrow">Nastavení trasy a režimu</span>
            <h2 id="edit-walk-title" style="margin:2px 0 0">✏️ Upravit procházku</h2>
          </div>
          <button type="button" class="button small ghost" id="btn-close-edit-walk-x" aria-label="Zrušit úpravy">✕</button>
        </div>

        <p class="small-note" style="margin:0">
          Změny se projeví až po kliknutí na <strong>Potvrdit změny</strong>. Již ušlá vzdálenost, objevená území ani potvrzené zastávky se při úpravě nesmažou.
        </p>

        <div class="edit-walk-modal-body">
          <!-- 1. Rychlý záměr / generátor -->
          <div class="planner-box">
            <span class="eyebrow">1. Rychlá volba záměru</span>
            <div class="edit-intent-row">
              <button type="button" class="button small" id="draft-btn-free">📡 Volná chůze s radarem (bez pevných zastávek)</button>
              <button type="button" class="button small lime" id="draft-btn-auto-2">✨ Krátký okruh (~2 km)</button>
              <button type="button" class="button small lime" id="draft-btn-auto-5">✨ Střední okruh (~5 km)</button>
              <button type="button" class="button small lime" id="draft-btn-auto-10">✨ Delší okruh (~10 km)</button>
            </div>
            <p class="small-note" id="draft-auto-feedback" style="margin:6px 0 0" hidden></p>
          </div>

          <!-- 2. Startovní bod a Okruh -->
          <div class="planner-controls-grid">
            <div class="planner-box">
              <span class="eyebrow">2. Startovní bod</span>
              <div class="planner-origin-buttons" id="draft-origin-buttons">
                <button type="button" class="button small" data-draft-origin="my-gps">📍 Moje GPS</button>
                <button type="button" class="button small" data-draft-origin="namesti">Náměstí</button>
                <button type="button" class="button small" data-draft-origin="nadrazi">Nádraží</button>
                <button type="button" class="button small" data-draft-origin="stary-rozmital">Starý Rožmitál</button>
                <button type="button" class="button small" id="draft-btn-origin-map">🗺️ Kliknout do mapy</button>
              </div>
              <p class="small-note" id="draft-origin-desc"></p>
            </div>

            <div class="planner-box">
              <span class="eyebrow">3. Parťák a herní režim</span>
              <div class="companion-button-row" id="draft-companion-buttons">
                ${COMPANION_STYLES.map(comp => `
                  <button type="button" class="button small" data-draft-companion="${comp.id}">
                    <span>${comp.icon}</span> ${e(comp.label)}
                  </button>
                `).join('')}
              </div>
              <div class="exploration-button-row" id="draft-mode-buttons" style="margin-top:8px">
                <button type="button" class="button small" data-draft-mode="focus">🎯 Trasa</button>
                <button type="button" class="button small" data-draft-mode="compass">🧭 Kompas</button>
                <button type="button" class="button small" data-draft-mode="radar">📡 Radar</button>
              </div>
            </div>
          </div>

          <!-- 4. Okruh a kategorie -->
          <div class="planner-box">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <span class="eyebrow">4. Okruh hledání a kategorie míst</span>
              <div class="radius-selector" id="draft-radius-buttons">
                ${PLANNER_RADII.map(r => `
                  <button type="button" class="button small" data-draft-radius="${r}">${r} km</button>
                `).join('')}
              </div>
            </div>
            <div class="planner-categories-chips" id="draft-category-chips" style="margin-top:8px">
              ${PLANNER_CATEGORIES.map(cat => `
                <button type="button" class="cat-chip" data-draft-cat="${cat.id}">
                  <span>${cat.icon}</span> ${e(cat.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- 5. Zastávky v návrhu (Nahoru, Dolů, Nahradit, Odebrat + Přidat) -->
          <div class="planner-box">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <span class="eyebrow">5. Zastávky v plánu (<span id="draft-basket-count">0</span> / 10)</span>
              <button type="button" class="button small lime" id="draft-btn-optimize">🔄 Uspořádat zastávky</button>
            </div>
            <div id="draft-stops-list" class="planner-basket-list"></div>

            <div style="margin-top:10px">
              <span class="eyebrow">Přidat další zastávku z okolí:</span>
              <div id="draft-available-places" class="draft-available-places"></div>
            </div>
          </div>
        </div>

        <div class="edit-walk-modal-footer">
          <button type="button" class="button ghost" id="btn-cancel-walk-edit">✕ Zrušit</button>
          <button type="button" class="button accent-action-btn" id="btn-confirm-walk-edit">✓ Potvrdit změny</button>
        </div>
      </div>
    </div>

    <!-- Modální dialog Nastavení aplikace (3 herní módy + pilulkové přepínače [ ✓ Zapnuto ] [ Vypnuto ]) -->
    <div class="edit-walk-modal-backdrop" id="app-settings-modal" hidden role="dialog" aria-modal="true" aria-labelledby="app-settings-title">
      <div class="edit-walk-modal-card">
        <div class="edit-walk-modal-header">
          <div>
            <span class="eyebrow">Předvolby zobrazení a gamifikace</span>
            <h2 id="app-settings-title" style="margin:2px 0 0">⚙️ Nastavení aplikace a herního stylu</h2>
          </div>
          <button type="button" class="button small ghost" id="btn-close-app-settings-x" aria-label="Zavřít nastavení">✕</button>
        </div>

        <div class="edit-walk-modal-body">
          <div class="planner-box">
            <span class="eyebrow">Výběr herního stylu (1 kliknutím nastaví vše):</span>
            <div class="wizard-mode-row" style="margin-top:8px">
              <button type="button" class="wizard-mode-btn ${appSettings.gameMode === 'explorer' ? 'active' : ''}" data-modal-game-mode="explorer">
                <span class="wmode-icon">🧭</span>
                <span class="wmode-text">
                  <strong>🧭 Objevování</strong>
                  <small>Zahalená mapa, bez čáry na zemi, jen kompas a orientace v terénu.</small>
                </span>
              </button>
              <button type="button" class="wizard-mode-btn ${appSettings.gameMode === 'gamified' ? 'active' : ''}" data-modal-game-mode="gamified">
                <span class="wmode-icon">📜</span>
                <span class="wmode-text">
                  <strong>📜 Výprava s pergamenem</strong>
                  <small>Doporučeno: poloprůhledný pergamen, stopy pohorek, KČT značky a razítka.</small>
                </span>
              </button>
              <button type="button" class="wizard-mode-btn ${appSettings.gameMode === 'casual' ? 'active' : ''}" data-modal-game-mode="casual">
                <span class="wmode-icon">🗺️</span>
                <span class="wmode-text">
                  <strong>🗺️ Turistická mapa</strong>
                  <small>Čistá otevřená turistická mapa bez mlhy, vše viditelné od začátku.</small>
                </span>
              </button>
            </div>
          </div>

          <div class="planner-box">
            <span class="eyebrow">Jednotlivá nastavení (zapnuto / vypnuto):</span>
            <p class="small-note" style="margin:2px 0 10px">Ve výchozím stavu je vše zapnuto pro nejbohatší herní zážitek v terénu.</p>
            <div class="settings-pills-container" id="walk-settings-pills-list"></div>
          </div>
        </div>

        <div class="edit-walk-modal-footer">
          <button type="button" class="button accent-action-btn" id="btn-close-app-settings">✓ Hotovo (Uložit)</button>
        </div>
      </div>
    </div>

    <!-- DÁVKA 2 (Bod 1.1): Modální okno „✨ Uložit vzpomínku“ (soukromé vlastní symboly + čistá textová poznámka) -->
    <div class="edit-walk-modal-backdrop" id="save-memory-modal" hidden role="dialog" aria-modal="true" aria-labelledby="save-memory-title">
      <div class="edit-walk-modal-card" style="max-width:520px">
        <div class="edit-walk-modal-header">
          <div>
            <span class="eyebrow">✨ Vlastnoruční vzpomínka uživatele (soukromě v zařízení)</span>
            <h2 id="save-memory-title" style="margin:2px 0 0">✨ Uložit vzpomínku do osobního atlasu</h2>
          </div>
          <button type="button" class="button small ghost" id="btn-close-save-memory-x" aria-label="Zavřít uložení vzpomínky">✕</button>
        </div>

        <p class="small-note" style="margin:0">
          Vyber si ilustrovaný symbol a případně připiš krátkou poznámku. Vzpomínka se ukládá <strong>výhradně soukromě v tvém zařízení</strong> jako čistý text (nejde o GPS ověřenou památku ani o veřejné nahrávání fotografií).
        </p>

        <div class="edit-walk-modal-body">
          <div class="planner-box">
            <span class="eyebrow">1. Vyber symbol objevu:</span>
            <div class="memory-symbols-grid" id="memory-symbols-grid" role="radiogroup" aria-label="Výběr symbolu vzpomínky" style="margin-top:8px">
              ${PERSONAL_MEMORY_SYMBOLS.map((sym, i) => `
                <button type="button" class="memory-symbol-btn ${i === 0 ? 'selected' : ''}" data-memory-symbol="${e(sym.id)}" role="radio" aria-checked="${i === 0 ? 'true' : 'false'}">
                  <span class="memory-symbol-icon">${sym.icon}</span>
                  <span class="memory-symbol-title">${e(sym.title)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="planner-box">
            <label for="memory-note-input" class="eyebrow" style="display:block;margin-bottom:6px">2. Krátká soukromá poznámka (volitelné, čistý text):</label>
            <textarea
              id="memory-note-input"
              class="memory-note-textarea"
              rows="3"
              maxlength="240"
              placeholder="Např. Starý dub u rozcestí s lavičkou ve stínu…"
            ></textarea>
            <small class="small-note" style="display:block;margin-top:4px">
              🔒 Soukromé v zařízení · Žádné nahrávání fotografií · Vykresleno bezpečně jako prostý text.
            </small>
          </div>
        </div>

        <div class="edit-walk-modal-footer">
          <button type="button" class="button ghost" id="btn-cancel-save-memory">✕ Zrušit</button>
          <button type="button" class="button accent-action-btn" id="btn-confirm-save-memory">✨ Uložit vzpomínku</button>
        </div>
      </div>
    </div>

    <div id="session-summary-container"></div>
  `;

  const $ = id => root.querySelector(`#${id}`);
  const status = text => {
    if (!disposed && $('walk-status')) {
      $('walk-status').textContent = text;
    }
  };
  const placesLayer = L?.layerGroup();
  const placeMarkersById = new Map();
  const prefetchedPhotoPlaceIds = new Set();
  const prefetchedVerifiedPlaceIds = new Set();
  let lastTrailRenderKey = '';
  trailLayer = L?.layerGroup();

  function canPersistRealState(fix = null) {
    if (demo || simSandboxActive || fix?.simulated) return false;
    return true;
  }

  function saveAppState() {
    if (!canPersistRealState()) return true;
    stateObj.plannedRoute = plannedRoute;
    stateObj.confirmedStopIds = [...confirmedStopIds];
    stateObj.walkSegments = progress.walkSegments;
    stateObj.revealedFeatures = progress.revealedFeatures;
    stateObj.personalMemories = personalMemories;
    try {
      stateObj = saveState(stateObj);
      storageError = '';
      return true;
    } catch (err) {
      storageError = err.message;
      status('Uložení se nezdařilo: ' + err.message);
      return false;
    }
  }

  /**
   * Bod 25: Sledování hráče s vycentrováním do viditelné části mapy nad spodním panelem.
   * Respektuje uživatelem zvolené přiblížení (zoom) a nikdy automaticky neoddaluje na celou trasu.
   */
  function getBottomSheetOverlapPx() {
    if (!map || zenMode || sheetCollapsed) return 0;
    const mapRect = $('walk-map')?.getBoundingClientRect?.();
    const sheetRect = $('walk-bottom-sheet')?.getBoundingClientRect?.();
    if (!mapRect || !sheetRect) return 80;
    // Pokud spodní panel leží pod mapou nebo částečně překrývá spodní část obrazovky,
    // posuneme viditelný střed o ~22 % výšky mapy nahoru, aby byl hráč pohodlně nad spodní lištou/panelem
    const overlap = Math.max(0, mapRect.bottom - sheetRect.top);
    return overlap > 0 ? Math.min(mapRect.height * 0.5, overlap + 32) : Math.round(mapRect.height * 0.16);
  }

  let userZoomLocked = false;
  let lastUserZoomAt = 0;

  function centerMapOnPlayer(pos = lastFix || telemetry.lastKnownPosition, animate = false) {
    if (!map || !pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;
    const mapEl = $('walk-map');
    const width = zenMode ? window.innerWidth : (mapEl?.clientWidth || map.getSize().x || 390);
    const height = zenMode ? window.innerHeight : (mapEl?.clientHeight || map.getSize().y || 600);
    const bottomObsPx = zenMode ? 0 : getBottomSheetOverlapPx();
    const currentZoom = map.getZoom() || 16.5;

    const targetCenter = computeVisibleMapCenterForPlayer(
      pos,
      { width, height },
      bottomObsPx,
      0,
      currentZoom
    );

    map.setView([targetCenter.lat, targetCenter.lng], currentZoom, { animate });
  }

  function updateFollowUi() {
    const returnBtn = $('btn-return-to-gps');
    if (returnBtn) {
      returnBtn.hidden = Boolean(follow);
    }
    const zenBtn = $('zen-follow-btn');
    const zenLabel = $('zen-follow-label');
    if (zenBtn) {
      zenBtn.classList.toggle('is-following', Boolean(follow));
      if (zenLabel) {
        zenLabel.textContent = follow ? 'Sleduji polohu' : '◎ Vycentrovat';
      }
    }
  }

  // DÁVKA 1 (Bod 2.2): Úplná izolace Simulátoru od skutečných dat v odděleném paměťovém prostoru
  let realSnapshotBeforeSim = null;

  function enterSimulatorSandbox() {
    if (simSandboxActive) return;
    // Před vstupem do simulace uložíme případný rozpracovaný reálný stav a vytvoříme nepropustný snímek
    if (watch !== null) {
      try { navigator.geolocation?.clearWatch?.(watch); } catch {}
      watch = null;
    }
    if (gpsLocatingTaskId !== null) {
      endMapTask(gpsLocatingTaskId);
      gpsLocatingTaskId = null;
    }
    const freshReal = loadState();
    realSnapshotBeforeSim = JSON.parse(JSON.stringify(freshReal));

    simSandboxActive = true;
    // Pracovní paměť simulace je hluboká kopie oddělená od localStorage
    stateObj = JSON.parse(JSON.stringify(freshReal));
    progress = {
      version: 1,
      cells: [...(stateObj.cells || [])],
      meters: Number(stateObj.meters) || 0,
      discoveries: [...(stateObj.discoveries || [])],
      walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
      revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
    };
    confirmedStopIds = new Set();
    nearbyRecordedIds = new Set();
    personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
    pendingPlaceStamps = {};
    pendingStopSamples = {};
    memoryTrail = [];
    lastAcceptedFix = null;
    anchor = null;
    telemetry = createTelemetryState(Date.now());
    currentExpedition = null;
    walkState = 'idle';
    active = false;
    starting = false;

    keepAliveCtrl.start('Czekpoint Simulátor aktivní');
    const banner = $('walk-sandbox-banner');
    if (banner) banner.hidden = false;
    updateMapActionBar();
    stats();
    status('🧪 Simulátor zapnut v izolovaném paměťovém prostoru — tvůj skutečný pas, body, buňky mlhy ani historie se nemění.');
  }

  function exitSimulatorSandbox() {
    if (!simSandboxActive) return;
    simSandboxActive = false;
    active = false;
    starting = false;
    anchor = null;
    lastFix = null;
    lastAcceptedFix = null;
    pendingPlaceStamps = {};
    pendingStopSamples = {};
    memoryTrail = [];
    activeLocalReveals = [];
    nearbyRecordedIds = new Set();
    telemetry = createTelemetryState(Date.now());
    const banner = $('walk-sandbox-banner');
    if (banner) banner.hidden = true;
    const accBanner = $('walk-accuracy-banner');
    if (accBanner) accBanner.hidden = true;

    try {
      stateObj = realSnapshotBeforeSim ? JSON.parse(JSON.stringify(realSnapshotBeforeSim)) : loadState();
      realSnapshotBeforeSim = null;
      progress = {
        version: 1,
        cells: [...(stateObj.cells || [])],
        meters: Number(stateObj.meters) || 0,
        discoveries: [...(stateObj.discoveries || [])],
        walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
        revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
      };
      personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
      currentExpedition = stateObj.activeExpedition;
      walkState = currentExpedition && currentExpedition.state !== 'ended' ? 'paused' : 'idle';
      plannedRoute = stateObj.plannedRoute || plannedRoute;
      confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
    } catch (err) {
      storageError = err.message;
    }

    if (map && player && accuracyRing) {
      setPlayerMarkerVisible(false);
      accuracyRing.setRadius(0);
    }
    plannedRouteRenderKey = null;
    updateMapActionBar();
    renderPersonalMemoriesUi();
    stats();
    renderQuestHud(plannedRoute.origin);
    status('Simulátor ukončen. Obnoven tvůj skutečný nedotčený pas a mapa.');
  }

  function setPlayerMarkerVisible(visible) {
    if (!player) return;
    if (typeof player.setOpacity === 'function') {
      player.setOpacity(visible ? 1 : 0);
    } else if (typeof player.setStyle === 'function') {
      player.setStyle({ opacity: visible ? 1 : 0, fillOpacity: visible ? 1 : 0 });
    }
  }

  function updatePlayerAvatarIcon(isWalking = Boolean(active || demo)) {
    if (!player || !L) return;
    const avatarId = stateObj.profile?.avatarId || 'liska';
    const bearingDeg = Number.isFinite(targetBearing) ? targetBearing : 0;
    const el = typeof player.getElement === 'function' ? player.getElement() : null;
    if (el) {
      const wrap = el.querySelector('.player-avatar-marker');
      const pointer = el.querySelector('.avatar-direction-pointer');
      if (wrap && wrap.dataset.avatarId === avatarId) {
        wrap.classList.toggle('is-walking', Boolean(isWalking));
        if (pointer) {
          const showArrow = appSettings.orbitalArrow !== false;
          pointer.style.display = showArrow ? '' : 'none';
          pointer.style.transform = `rotate(${Math.round(bearingDeg)}deg)`;
        }
        return;
      }
    }
    if (typeof player.setIcon === 'function') {
      player.setIcon(
        L.divIcon({
          className: 'player-avatar-marker-anchor',
          html: renderPlayerAvatarMarkerHtml({ avatarId, bearingDeg, isWalking, orbitalArrow: appSettings.orbitalArrow !== false }),
          iconSize: [54, 54],
          iconAnchor: [27, 27],
        })
      );
    }
  }

  /**
   * ZADÁNÍ #08 (Bod 2): Plynulý LERP pohyb Avatara po mapě pomocí requestAnimationFrame.
   */
  function smoothMovePlayerTo(targetLat, targetLng, durationMs = 1100) {
    if (!map || !player || !Number.isFinite(targetLat) || !Number.isFinite(targetLng)) return;
    if (playerLerpRafId) {
      cancelAnimationFrame(playerLerpRafId);
      playerLerpRafId = null;
    }

    const currentOpacity = typeof player.options?.opacity === 'number' ? player.options.opacity : 1;
    setPlayerMarkerVisible(true);
    updatePlayerAvatarIcon(true);

    const startLatLng = typeof player.getLatLng === 'function' ? player.getLatLng() : null;
    const distM = startLatLng ? (haversineMeters({ lat: startLatLng.lat, lng: startLatLng.lng }, { lat: targetLat, lng: targetLng }) ?? 999) : 999;

    if (!startLatLng || currentOpacity === 0 || distM > 350 || distM < 0.2 || durationMs <= 0) {
      player.setLatLng([targetLat, targetLng]);
      accuracyRing?.setLatLng([targetLat, targetLng]);
      if (follow) {
        centerMapOnPlayer({ lat: targetLat, lng: targetLng }, false);
      }
      return;
    }

    const sLat = startLatLng.lat;
    const sLng = startLatLng.lng;
    const startTime = performance.now();

    const stepLerp = (nowPerf) => {
      if (disposed || !player) {
        playerLerpRafId = null;
        return;
      }
      const elapsed = nowPerf - startTime;
      const t = Math.min(1, Math.max(0, elapsed / durationMs));
      const eased = 1 - Math.pow(1 - t, 3);
      const curLat = sLat + (targetLat - sLat) * eased;
      const curLng = sLng + (targetLng - sLng) * eased;

      player.setLatLng([curLat, curLng]);
      accuracyRing?.setLatLng([curLat, curLng]);

      if (follow) {
        map.panTo([curLat, curLng], { animate: false });
      }

      if (t < 1) {
        playerLerpRafId = requestAnimationFrame(stepLerp);
      } else {
        playerLerpRafId = null;
        updatePlayerAvatarIcon(Boolean(active || demo));
      }
    };

    playerLerpRafId = requestAnimationFrame(stepLerp);
  }

  function metersToPx(lat, meters) {
    if (!map) return 30;
    const p1 = map.latLngToContainerPoint([lat, 0]);
    const p2 = map.latLngToContainerPoint([lat + (meters / 111320), 0]);
    return Math.max(8, Math.abs(p2.y - p1.y));
  }

  /**
   * Vykreslí Mapu objevování (pergamen) se sjednoceným souvislým odkrytým územím (Bod 31)
   * a odkrýváním přírodních objektů podle jejich skutečného tvaru (Bod 32):
   * - Souvislý pás chůze (`progress.walkSegments`) s poloměrem `FOG_REVEAL_RADIUS_M` (65 m) a jedním jemným vnějším okrajem,
   *   bez jakýchkoliv vnitřních předělů mezi buňkami nebo kruhy.
   * - Uzavřený okruh kolem velké neprojité oblasti uprostřed tuto vnitřní oblast samovolně neodkryje.
   * - Malé rybníky v `progress.revealedFeatures` se odkryjí v celém svém přirozeném polygonu břehu.
   * - Aktivní lesy a velké vodní plochy v `activeLocalReveals` odhalí pouze lokální výsek oříznutý polygonem objektu.
   */
  function drawFog() {
    if (!map || disposed || !fog) return;
    const canvas = fog;
    const size = map.getSize();
    if (size.x <= 0 || size.y <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    if (canvas.width !== Math.round(size.x * ratio) || canvas.height !== Math.round(size.y * ratio)) {
      canvas.width = Math.round(size.x * ratio);
      canvas.height = Math.round(size.y * ratio);
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }

    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    if (fogMode === 'none') {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';

    const origin = map.getPixelOrigin ? map.getPixelOrigin() : { x: 0, y: 0 };
    const layerTopLeft = map.containerPointToLayerPoint([0, 0]);
    const ox = origin.x + layerTopLeft.x;
    const oy = origin.y + layerTopLeft.y;
    const mod = (v, m) => ((v % m) + m) % m;

    if (fogMode === 'full') {
      ctx.fillStyle = 'rgba(232, 221, 197, 0.98)';
      ctx.fillRect(0, 0, size.x, size.y);
    } else {
      // 'explore' -> Mapa objevování: teplý pergamen (0.86), pod kterým jemně (~14–18 %) prosvítají značky KČT a vrstevnice
      ctx.fillStyle = 'rgba(224, 210, 178, 0.86)';
      ctx.fillRect(0, 0, size.x, size.y);

      const vignette = ctx.createRadialGradient(
        size.x / 2,
        size.y / 2,
        Math.min(size.x, size.y) * 0.25,
        size.x / 2,
        size.y / 2,
        Math.max(size.x, size.y) * 0.78
      );
      vignette.addColorStop(0, 'rgba(252, 246, 232, 0.08)');
      vignette.addColorStop(1, 'rgba(148, 116, 72, 0.18)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, size.x, size.y);

      ctx.strokeStyle = 'rgba(128, 98, 58, 0.11)';
      ctx.lineWidth = 1;
      const contourGap = 44;
      for (let y = -mod(oy, contourGap) - contourGap; y < size.y + contourGap; y += contourGap) {
        const worldRow = Math.round((y + oy) / contourGap);
        ctx.beginPath();
        for (let x = -12; x <= size.x + 12; x += 14) {
          const wx = x + ox;
          const yy = y + Math.sin(wx / 110 + worldRow * 0.85) * 6.5 + Math.cos(wx / 46 + worldRow) * 2.2;
          if (x === -12) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(136, 104, 62, 0.07)';
      const grainStep = 64;
      for (let gx = -mod(ox, grainStep); gx < size.x; gx += grainStep) {
        for (let gy = -mod(oy, grainStep); gy < size.y; gy += grainStep) {
          const wx = Math.round((gx + ox) / grainStep);
          const wy = Math.round((gy + oy) / grainStep);
          const hash = Math.abs(Math.sin(wx * 12.9898 + wy * 78.233) * 43758.5453) % 1;
          const px = gx + hash * 42;
          const py = gy + ((hash * 17) % 1) * 42;
          ctx.fillRect(px, py, 1.5, 1.5);
        }
      }
    }

    const hasRevealedContent =
      progress.cells.length > 0 ||
      (Array.isArray(progress.walkSegments) && progress.walkSegments.length > 0) ||
      (Array.isArray(progress.revealedFeatures) && progress.revealedFeatures.length > 0) ||
      activeLocalReveals.length > 0;

    if (!hasRevealedContent) return;

    if (!fogMaskCanvas && typeof document !== 'undefined') {
      fogMaskCanvas = document.createElement('canvas');
    }
    if (!fogInnerCanvas && typeof document !== 'undefined') {
      fogInnerCanvas = document.createElement('canvas');
    }

    if (fogMaskCanvas && fogInnerCanvas) {
      if (fogMaskCanvas.width !== canvas.width || fogMaskCanvas.height !== canvas.height) {
        fogMaskCanvas.width = canvas.width;
        fogMaskCanvas.height = canvas.height;
      }
      if (fogInnerCanvas.width !== canvas.width || fogInnerCanvas.height !== canvas.height) {
        fogInnerCanvas.width = canvas.width;
        fogInnerCanvas.height = canvas.height;
      }

      const mctx = fogMaskCanvas.getContext('2d');
      mctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      mctx.clearRect(0, 0, size.x, size.y);

      const ictx = fogInnerCanvas.getContext('2d');
      ictx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ictx.clearRect(0, 0, size.x, size.y);

      const refCenter = map.getCenter() || { lat: 49.6018, lng: 13.8644 };
      const refLat = refCenter.lat || 49.6018;
      const curPos = lastFix || telemetry.lastKnownPosition || refCenter;
      const nearbyPoiCount = getAllAvailablePlaces().filter(p => (haversineMeters(curPos, p) ?? Infinity) <= 1500).length;
      const effectiveRevealRadiusM = nearbyPoiCount <= 2 ? 85 : FOG_REVEAL_RADIUS_M;
      const radPx = metersToPx(refLat, effectiveRevealRadiusM);

      // Pomocná funkce pro vykreslení celé sjednocené geometrie do daného kontextu (pro vnější jemný okraj a vnitřní čistý střed)
      const drawUnifiedShapes = (targetCtx, expandPx = 0) => {
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        targetCtx.fillStyle = '#000000';
        targetCtx.strokeStyle = '#000000';

        // 1. Souvislé pásy chůze (`walkSegments` — Bod 31)
        const segments = Array.isArray(progress.walkSegments) ? progress.walkSegments : [];
        targetCtx.lineWidth = Math.max(8, (radPx + expandPx) * 2);
        for (const seg of segments) {
          if (!Array.isArray(seg) || seg.length === 0) continue;
          if (seg.length === 1) {
            const pt = Array.isArray(seg[0]) ? seg[0] : [seg[0].lat, seg[0].lng];
            const cp = map.latLngToContainerPoint([pt[0], pt[1]]);
            targetCtx.beginPath();
            targetCtx.arc(cp.x, cp.y, Math.max(4, radPx + expandPx), 0, Math.PI * 2);
            targetCtx.fill();
          } else {
            targetCtx.beginPath();
            for (let i = 0; i < seg.length; i++) {
              const pt = Array.isArray(seg[i]) ? seg[i] : [seg[i].lat, seg[i].lng];
              const cp = map.latLngToContainerPoint([pt[0], pt[1]]);
              if (i === 0) targetCtx.moveTo(cp.x, cp.y);
              else targetCtx.lineTo(cp.x, cp.y);
            }
            targetCtx.stroke();
          }
        }

        // 2. Uložené buňky průzkumu (`progress.cells`) — sjednocené do stejné souvislé masky bez vnitřních okrajů
        if (progress.cells.length > 0) {
          targetCtx.beginPath();
          for (const id of progress.cells) {
            const center = cellCenter(id);
            const cp = map.latLngToContainerPoint([center.lat, center.lng]);
            const cellRad = Math.max(4, radPx + expandPx);
            if (cp.x + cellRad < -30 || cp.x - cellRad > size.x + 30 || cp.y + cellRad < -30 || cp.y - cellRad > size.y + 30) {
              continue;
            }
            targetCtx.moveTo(cp.x + cellRad, cp.y);
            targetCtx.arc(cp.x, cp.y, cellRad, 0, Math.PI * 2);
          }
          targetCtx.fill();
        }

        // 3. Odhalené přírodní objekty podle jejich tvaru (`progress.revealedFeatures` — např. celé malé rybníky, Bod 32)
        const revealedIds = Array.isArray(progress.revealedFeatures) ? progress.revealedFeatures : [];
        for (const fid of revealedIds) {
          const feat = BUILTIN_NATURAL_FEATURES.find(f => f.id === fid);
          if (!feat || !Array.isArray(feat.polygon) || feat.polygon.length < 3) continue;
          targetCtx.beginPath();
          for (let i = 0; i < feat.polygon.length; i++) {
            const v = feat.polygon[i];
            const cp = map.latLngToContainerPoint([v[0], v[1]]);
            if (i === 0) targetCtx.moveTo(cp.x, cp.y);
            else targetCtx.lineTo(cp.x, cp.y);
          }
          targetCtx.closePath();
          targetCtx.fill();
          if (expandPx > 0) {
            targetCtx.lineWidth = expandPx * 2;
            targetCtx.stroke();
          }
        }

        // 4. Lokální rozšířené odkrytí v lese nebo u velké vodní plochy oříznuté hranicí objektu (Bod 32)
        for (const locRev of activeLocalReveals) {
          if (!locRev || !Array.isArray(locRev.polygon) || locRev.polygon.length < 3 || !locRev.center) continue;
          targetCtx.save();
          targetCtx.beginPath();
          for (let i = 0; i < locRev.polygon.length; i++) {
            const v = locRev.polygon[i];
            const cp = map.latLngToContainerPoint([v[0], v[1]]);
            if (i === 0) targetCtx.moveTo(cp.x, cp.y);
            else targetCtx.lineTo(cp.x, cp.y);
          }
          targetCtx.closePath();
          targetCtx.clip();

          const centerPx = map.latLngToContainerPoint([locRev.center.lat, locRev.center.lng]);
          const localRadPx = metersToPx(locRev.center.lat, locRev.radiusM || 130) + expandPx;
          targetCtx.beginPath();
          targetCtx.arc(centerPx.x, centerPx.y, Math.max(8, localRadPx), 0, Math.PI * 2);
          targetCtx.fill();
          targetCtx.restore();
        }
      };

      // ZADÁNÍ #08 (Bod 4): Měkké radiální odkrývání (radial gradient fade-in/out) bez ostrých vyříznutých kruhů
      const drawSoftRadialStamp = (targetCtx, x, y, radiusPx) => {
        const softRad = Math.max(8, radiusPx * 1.35);
        if (x + softRad < -40 || x - softRad > size.x + 40 || y + softRad < -40 || y - softRad > size.y + 40) {
          return;
        }
        const grad = targetCtx.createRadialGradient(x, y, 0, x, y, softRad);
        grad.addColorStop(0.0, 'rgba(0, 0, 0, 1)');
        grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.92)');
        grad.addColorStop(0.75, 'rgba(0, 0, 0, 0.45)');
        grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        targetCtx.fillStyle = grad;
        targetCtx.beginPath();
        targetCtx.arc(x, y, softRad, 0, Math.PI * 2);
        targetCtx.fill();
      };

      // Vykreslíme sjednocenou masku s jemným vnějším přechodem (bez jakýchkoliv vnitřních kruhů!)
      ictx.save();
      drawUnifiedShapes(ictx, -Math.min(10, radPx * 0.24));
      ictx.restore();

      // Široký měkký přechod po obvodu celého sjednoceného tvaru + radial gradient fade-in/out
      mctx.save();
      for (const id of progress.cells) {
        const center = cellCenter(id);
        const cp = map.latLngToContainerPoint([center.lat, center.lng]);
        drawSoftRadialStamp(mctx, cp.x, cp.y, radPx);
      }
      if (lastFix && Number.isFinite(lastFix.lat) && Number.isFinite(lastFix.lng)) {
        const cp = map.latLngToContainerPoint([lastFix.lat, lastFix.lng]);
        drawSoftRadialStamp(mctx, cp.x, cp.y, radPx);
      }
      mctx.globalAlpha = 0.22;
      drawUnifiedShapes(mctx, radPx * 0.35);
      mctx.globalAlpha = 0.45;
      drawUnifiedShapes(mctx, radPx * 0.16);
      mctx.globalAlpha = 0.75;
      drawUnifiedShapes(mctx, 0);
      mctx.globalAlpha = 1.0;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.drawImage(fogInnerCanvas, 0, 0);
      mctx.restore();

      // Vyřízneme sjednocené odkryté území z mapy objevování
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(fogMaskCanvas, 0, 0);
      ctx.restore();
    }
  }

  function scheduleFog() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = null; drawFog(); });
  }

  /**
   * Bod 30 & ZADÁNÍ #08 (Bod 3): Vykreslí střídavé levé a pravé otisky podrážky pohorky (.footprint-marker, 18×18 px)
   * natočené ve směru chůze a postupně blednoucí podle stáří (opacity 0.85 -> 0.15).
   */
  function renderTrail() {
    if (!map || !trailLayer) return;
    if (appSettings.footprints === false) {
      trailLayer.clearLayers();
      lastTrailRenderKey = 'disabled';
      if ($('trail-info')) {
        $('trail-info').textContent = 'Stopy pohorek jsou vypnuté v nastavení.';
      }
      return;
    }
    const zoom = Math.round((map.getZoom() || 16.5) * 2) / 2;
    const footprints = computeFootprintPlacements(progress.walkSegments, zoom);
    const totalCount = footprints.length;

    if ($('trail-info')) {
      $('trail-info').textContent = `Stopy pohorek na prošlé cestě: ${totalCount} kroků · Potvrzení zastávky: pod ${STOP_CONFIRM_RADIUS_M} m (opakované měření)`;
    }

    const lastFp = totalCount > 0 ? footprints[totalCount - 1] : null;
    const trailKey = `${zoom}|${totalCount}|${lastFp ? `${lastFp.lat.toFixed(5)},${lastFp.lng.toFixed(5)}` : '0'}`;
    if (trailKey === lastTrailRenderKey) return;
    lastTrailRenderKey = trailKey;

    trailLayer.clearLayers();
    for (let i = 0; i < totalCount; i++) {
      const fp = footprints[i];
      const ageRatio = totalCount <= 1 ? 1 : i / (totalCount - 1);
      const fadeOpacity = Number.isFinite(fp.opacity)
        ? fp.opacity
        : Number((0.22 + 0.63 * ageRatio).toFixed(2));
      L.marker([fp.lat, fp.lng], {
        pane: 'markerPane',
        interactive: false,
        icon: L.divIcon({
          className: 'footprint-marker-anchor',
          html: renderBootFootprintSvg(fp.side, fp.bearingDeg, fadeOpacity),
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).addTo(trailLayer);
    }
  }

  function getAllAvailablePlaces() {
    const mapById = new Map();
    for (const p of catalogue) mapById.set(p.id, p);
    for (const p of nearby) {
      if (!mapById.has(p.id)) {
        const acc = resolveAccessibleStopLocation(p);
        mapById.set(p.id, acc ? { ...p, lat: acc.lat, lng: acc.lng, isShoreAccess: acc.isShoreAccess } : p);
      }
    }
    if (Array.isArray(plannedRoute.embeddedStops)) {
      for (const p of plannedRoute.embeddedStops) {
        if (p && p.id && !mapById.has(p.id)) {
          const acc = resolveAccessibleStopLocation(p);
          mapById.set(p.id, {
            id: p.id,
            title: p.title || p.id,
            lat: acc ? acc.lat : p.lat,
            lng: acc ? acc.lng : p.lng,
            kind: p.kind || 'forest',
            category: p.category || 'nature',
            pointKind: 'place',
            collectible: true,
            url: `#/katalog`,
          });
        }
      }
    }
    return [...mapById.values()];
  }

  function getPlannedPlaces(idsOverride = null) {
    const all = getAllAvailablePlaces();
    const ids = idsOverride || plannedRoute.selectedPlaceIds || [];
    return ids.map(id => all.find(p => p.id === id)).filter(Boolean);
  }

  // Bod 7: Jasné oddělení „navštíveno během této výpravy“ vs. „objeveno dříve v pasu“
  function isStopVisitedInSession(p) {
    if (!p) return false;
    return confirmedStopIds.has(p.id);
  }

  function hasLifetimeStamp(p) {
    if (!p) return false;
    return (
      progress.discoveries.includes(p.id) ||
      progress.discoveries.includes(`catalog:${p.id}`)
    );
  }

  function isStopVisited(p) {
    return isStopVisitedInSession(p);
  }

  /**
   * Vykreslí vrstvu značených turistických tras z OpenStreetMap (Bod 24).
   * Zachovává barvu značení ze zdroje (osmc:symbol) a vizuálně ji odlišuje od plánované výpravy.
   */
  async function loadAndRenderHikingTrails() {
    if (!map || !hikingTrailsLayer) return;
    try {
      loadedHikingTrails = await getHikingTrails({
        overpassUrl: config?.overpassUrl,
        signal: aborter.signal,
        fetchLive: false,
      });
    } catch {
      loadedHikingTrails = [];
    }
    renderHikingTrailsOnMap();
    renderHikingTrailsLegend();
  }

  function renderHikingTrailsOnMap() {
    if (!map || !hikingTrailsLayer) return;
    hikingTrailsLayer.clearLayers();
    if (!showHikingTrails) return;
    if (waymarkedHikingLayer && map.hasLayer(waymarkedHikingLayer)) {
      return;
    }

    for (const trail of loadedHikingTrails) {
      if (!Array.isArray(trail.coordinates) || trail.coordinates.length < 2) continue;
      const parsed = trail.parsedSymbol || parseOsmcSymbol(trail.osmcSymbol, trail.colour);
      const badgeSvg = renderOsmcBadgeSvg(trail.osmcSymbol, trail.colour, { size: 16 });

      L.polyline(trail.coordinates, {
        pane: 'hiking-trails-pane',
        color: '#ffffff',
        weight: 6,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(hikingTrailsLayer);

      const line = L.polyline(trail.coordinates, {
        pane: 'hiking-trails-pane',
        color: parsed.hex,
        weight: 3.2,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(hikingTrailsLayer);

      const popupHtml = `
        <div class="hiking-trail-popup">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            ${badgeSvg}
            <strong>${e(trail.name)}</strong>
          </div>
          <div style="font-size:11px;color:#3d4a3a">
            <span>Značení v datech: <strong>${e(parsed.labelCz)}</strong> (${e(trail.osmcSymbol || 'neuvedeno')})</span><br>
            <span>Správce / síť: ${e(trail.operator || 'KČT')} · ${e(trail.distance || '')}</span><br>
            <small>Zdroj: ${e(trail.sourceLabel || '© přispěvatelé OpenStreetMap (ODbL)')}</small>
          </div>
        </div>
      `;
      line.bindPopup(popupHtml);

      const midIdx = Math.floor(trail.coordinates.length / 2);
      const midPt = trail.coordinates[midIdx];
      if (midPt) {
        L.marker(midPt, {
          pane: 'hiking-trails-pane',
          icon: L.divIcon({
            className: 'czekpoint-trail-blaze-anchor',
            html: `<span class="czekpoint-trail-blaze" title="${e(trail.name)} (${e(parsed.labelCz)})">${badgeSvg}</span>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        })
          .bindPopup(popupHtml)
          .addTo(hikingTrailsLayer);
      }
    }
  }

  function renderHikingTrailsLegend() {
    const listEl = $('hiking-trails-list');
    if (!listEl) return;
    if (!loadedHikingTrails.length) {
      listEl.innerHTML = '<p class="small-note">Žádné turistické trasy v této oblasti nejsou načtené.</p>';
      return;
    }
    listEl.innerHTML = loadedHikingTrails.map(trail => {
      const parsed = trail.parsedSymbol || parseOsmcSymbol(trail.osmcSymbol, trail.colour);
      const badgeSvg = renderOsmcBadgeSvg(trail.osmcSymbol, trail.colour, { size: 16 });
      return `
        <button type="button" class="hiking-trail-chip" data-trail-id="${e(trail.id)}" title="Ukázat trasu na mapě">
          ${badgeSvg}
          <span class="hiking-trail-chip-name">${e(trail.name)}</span>
          <span class="hiking-trail-chip-meta">${e(trail.distance || parsed.labelCz)}</span>
        </button>
      `;
    }).join('');
  }

  let currentDeviceHeading = null;
  let targetBearing = 0;

  function updateCompassRotation(heading) {
    currentDeviceHeading = heading;
    const stab = compassStabilizer.update(heading, Date.now());
    currentDeviceHeading = stab.smoothedHeading;
    const dial = $('compass-dial');
    const targetArrow = $('compass-target-arrow');
    if (dial && stab.updated) {
      dial.style.transition = 'transform 0.25s ease-out';
      dial.style.transform = `rotate(${(-stab.continuousAngle).toFixed(1)}deg)`;
    }
    if (targetArrow && stab.updated) {
      targetArrow.style.transition = 'transform 0.25s ease-out';
      targetArrow.style.transform = `rotate(${(targetBearing - stab.continuousAngle).toFixed(1)}deg)`;
    }
  }

  function handleDeviceOrientation(event) {
    if (disposed) return;
    let heading = null;
    if (event.webkitCompassHeading != null) {
      heading = event.webkitCompassHeading;
    } else if (event.alpha != null) {
      heading = (360 - event.alpha) % 360;
    }
    if (heading != null && Number.isFinite(heading)) {
      updateCompassRotation(heading);
    }
  }

  window.addEventListener('deviceorientationabsolute', handleDeviceOrientation, { capture: true, signal: aborter.signal });
  window.addEventListener('deviceorientation', handleDeviceOrientation, { capture: true, signal: aborter.signal });

  function getCompanionSpeedKmH() {
    // ZADÁNÍ #09 (Bod 1): Výchozí tempo je pohodových 4,0 km/h.
    // Po 10 minutách chůze (>= 600 s) se čas do cíle sám zpřesní podle toho, jak rychle uživatel reálně jde.
    if (
      telemetry &&
      Number(telemetry.activeMovingSeconds) >= 600 &&
      Number.isFinite(telemetry.averageMovingSpeedKmh) &&
      telemetry.averageMovingSpeedKmh >= 1.8 &&
      telemetry.averageMovingSpeedKmh <= 8.0
    ) {
      return telemetry.averageMovingSpeedKmh;
    }
    return 4.0;
  }

  function formatDurationCz(minutes) {
    const mins = Math.max(1, Math.round(Number(minutes) || 0));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `~${m} min`;
    if (m === 0) return `~${h} hod`;
    return `~${h} hod ${m} min`;
  }

  function formatStopsCountCz(count) {
    const n = Number(count) || 0;
    if (n === 1) return '1 zastávka';
    if (n >= 2 && n <= 4) return `${n} zastávky`;
    return `${n} zastávek`;
  }

  function getCategoryIconForPlace(p) {
    if (!p) return '📍';
    if (p.category === 'castles' || p.kind === 'culture' || p.kind === 'castle' || p.kind === 'heritage') return '🏰';
    if (p.category === 'views' || p.kind === 'view' || p.kind === 'peak') return '🔭';
    if (p.category === 'water' || p.kind === 'water' || p.kind === 'spring') return '💧';
    if (p.category === 'nature' || p.kind === 'forest' || p.kind === 'nature') return '🌲';
    return '📍';
  }

  function renderPhase1AndPhase4Ui(origin = lastFix) {
    const topBar = $('phase1-top-bar');
    const topText = $('phase1-top-text');
    const goBtn = $('btn-phase1-go');
    const pauseBtn = $('btn-top-pause');
    const fsBtn = $('btn-top-fullscreen');
    const toggleP1Btn = $('btn-toggle-p1-bar');
    const itineraryStrip = $('top-route-itinerary-strip');
    const bottomBar = $('phase1-bottom-bar');
    const phase4Bar = $('phase4-finish-bar');
    if (!topBar || !topText) return;

    const isWalking = Boolean(active || demo || simSandboxActive);
    const plannedPlaces = getPlannedPlaces();
    const isPaused = Boolean(!isWalking && currentExpedition && currentExpedition.state === 'paused');

    // ZADÁNÍ #10 (Bod 1.1): Souhrn trasy (#phase1-top-bar) se smí ukázat AŽ ve chvíli,
    // kdy má uživatel vybraný alespoň 1 bod v trase (nebo když už běží chůze)!
    const shouldShowTopBar = plannedPlaces.length >= 1 || isWalking || isPaused || pickingStartOnMap || pickingCustomEndOnMap;
    topBar.hidden = !shouldShowTopBar;
    topBar.classList.toggle('is-walking', isWalking);

    if ($('turn-nav-pill')) {
      $('turn-nav-pill').hidden = !(shouldShowTopBar || Boolean(lastRoutedGeometry));
    }

    if (bottomBar) {
      bottomBar.hidden = isWalking || p1PlannerCollapsed;
    }
    if (toggleP1Btn) {
      toggleP1Btn.hidden = isWalking;
      toggleP1Btn.setAttribute('aria-expanded', String(!p1PlannerCollapsed));
      toggleP1Btn.textContent = p1PlannerCollapsed ? '▼ Rozbalit volby trasy' : '▲ Sbalit volby trasy';
    }
    if (phase4Bar) {
      phase4Bar.hidden = !isWalking;
      if (!isWalking) {
        phase4MenuOpen = false;
      }
      const sheet = $('phase4-options-sheet');
      if (sheet) sheet.hidden = !isWalking || !phase4MenuOpen;
      const toggleBtn = $('btn-phase4-toggle');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(Boolean(isWalking && phase4MenuOpen)));
    }
    if (goBtn) goBtn.hidden = isWalking;
    if (pauseBtn) {
      pauseBtn.hidden = !isWalking && !isPaused;
      pauseBtn.textContent = isPaused ? '▶ Pokračovat' : '⏸ Pauza';
    }
    if (fsBtn) {
      fsBtn.setAttribute('aria-pressed', String(zenMode));
      fsBtn.textContent = zenMode ? '× Zmenšit mapu' : '⛶ Celá obrazovka';
    }

    const currentOrigin = getRouteOriginPoint();
    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 1;
    const speedKmH = getCompanionSpeedKmH();

    // Vizuální itinerář zastávek přímo v horní liště (aby turista vždy viděl, jaká je trasa a jaké body v ní jsou)
    if (itineraryStrip) {
      const startLabel = plannedRoute.origin?.label
        ? plannedRoute.origin.label.split('—')[0].trim()
        : 'Start (Moje poloha)';
      if (plannedPlaces.length === 0) {
        itineraryStrip.innerHTML = `
          <span class="itinerary-empty">Žádné vybrané zastávky — klikni na místo v mapě nebo v seznamu pod mapou.</span>
        `;
      } else {
        let firstUnvisitedFound = false;
        let prevPt = currentOrigin;
        const stopPillsHtml = plannedPlaces.map((p, idx) => {
          const visited = isStopVisited(p);
          const isNext = !visited && !firstUnvisitedFound;
          if (isNext) firstUnvisitedFound = true;
          const legM = prevPt ? haversineMeters(prevPt, p) : null;
          prevPt = p;
          const legStr = legM != null ? formatDistanceLabel(legM) : '';
          const catIcon = getCategoryIconForPlace(p);
          const stateBadge = visited ? '✓ ' : (isNext ? '🎯 ' : '');
          const stateCls = visited ? 'is-visited' : (isNext ? 'is-next' : '');
          return `
            <span class="itinerary-arrow" aria-hidden="true">→</span>
            <div class="itinerary-stop-pill ${stateCls}" data-itinerary-stop-id="${e(p.id)}" title="Klikni pro zobrazení místa na mapě a detailu">
              <button type="button" class="itinerary-stop-main" data-itinerary-focus="${e(p.id)}">
                <span class="itinerary-stop-num">${idx + 1}.</span>
                <span class="itinerary-stop-icon">${catIcon}</span>
                <span class="itinerary-stop-title">${stateBadge}${e(p.title)}</span>
                ${legStr ? `<small class="itinerary-stop-dist">(${e(legStr)})</small>` : ''}
              </button>
              <button type="button" class="itinerary-stop-remove" data-itinerary-remove="${idx}" title="Vynechat tuto zastávku z trasy" aria-label="Vynechat zastávku ${e(p.title)}">×</button>
            </div>
          `;
        }).join('');

        const endLabel = isLoop
          ? `<span class="itinerary-arrow" aria-hidden="true">→</span><span class="itinerary-end-pill loop" title="Trasa se vrací jinou cestou zpět na start">🔄 Okruh zpět (${e(startLabel)})</span>`
          : `<span class="itinerary-arrow" aria-hidden="true">→</span><span class="itinerary-end-pill oneway">🏁 Cíl v poslední zastávce</span>`;

        itineraryStrip.innerHTML = `
          <button type="button" class="itinerary-start-pill" data-itinerary-start="1" title="Vycentrovat mapu na start výpravy">
            🚩 Start: <strong>${e(startLabel)}</strong>
          </button>
          ${stopPillsHtml}
          ${endLabel}
        `;
      }
    }

    // Aktualizace aktivních tlačítek ve Fázi 1 (opravuje zaseknuté prostřední tlačítko v Herním režimu!)
    if (bottomBar) {
      const currentMode = appSettings.gameMode || stateObj.gameMode || 'gamified';
      bottomBar.querySelectorAll('[data-p1-gamemode]').forEach(btn => {
        const isAct = btn.dataset.p1Gamemode === currentMode;
        btn.classList.toggle('active', isAct);
        btn.setAttribute('aria-pressed', String(isAct));
      });
      bottomBar.querySelectorAll('[data-p1-theme]').forEach(btn => {
        const isAct = btn.dataset.p1Theme === phase1Theme;
        btn.classList.toggle('active', isAct);
        btn.setAttribute('aria-pressed', String(isAct));
      });
    }

    if (!isWalking) {
      if (pickingCustomEndOnMap) {
        topText.innerHTML = `🏁 <strong>Klikni do mapy nebo na ikonu místa</strong>, kde chceš dnešní trasu zakončit…`;
        return;
      }
      if (pickingStartOnMap) {
        topText.innerHTML = `🗺️ <strong>Klikni kamkoliv do mapy</strong> pro nastavení nového startu výpravy…`;
        return;
      }
      const routedM = lastRoutedGeometry && !lastRoutedGeometry.isFallback ? lastRoutedGeometry.distanceM : null;
      const est = analyzePlannedRoute(currentOrigin, plannedPlaces, 'solo', {
        returnToOrigin: isLoop,
        routedDistanceM: routedM,
        terrainDifficulty: 'medium',
      });
      const distM = est?.estimatedWalkDistanceM || (phase1DurationKm * 1000);
      const kmStr = (distM / 1000).toFixed(1).replace('.', ',');
      const mins = Math.max(5, Math.round((distM / 1000) / speedKmH * 60));
      const timeStr = formatDurationCz(mins);
      const stopsStr = formatStopsCountCz(plannedPlaces.length);
      const modeName = stateObj.gameMode === 'explorer'
        ? '🧭 Objevování'
        : stateObj.gameMode === 'casual'
          ? '🗺️ Turistická mapa'
          : '📜 Výprava s pergamenem';
      topText.innerHTML = `Půjdeš <strong>${e(timeStr)} (${e(kmStr)} km)</strong> · <strong>${e(stopsStr)}</strong> · <span class="p1-mode-badge">${e(modeName)}</span>`;
      return;
    }

    // Aktivní chůze (Fáze 3 & 4): nahoře běží odpočet času a metrů
    const curPos = origin || lastFix || telemetry.lastKnownPosition || currentOrigin;
    const rem = computeRemainingFromSharedRoute({
      sharedRoute: lastRoutedGeometry,
      currentPos: curPos,
      plannedPlaces,
      confirmedStopIds,
      companionMode: 'solo',
      returnToOrigin: isLoop,
      origin: currentOrigin,
    });

    const remDistM = rem.remainingDistanceM != null ? rem.remainingDistanceM : 0;
    const remMins = Math.max(1, Math.round((remDistM / 1000) / speedKmH * 60));
    const remTimeStr = formatDurationCz(remMins);
    const remDistStr = formatDistanceLabel(remDistM);

    if (rem.nextStop) {
      const nextDistStr = rem.nextStopDistanceM != null ? formatDistanceLabel(rem.nextStopDistanceM) : '';
      topText.innerHTML = `Do cíle <strong>${e(remTimeStr)} (${e(remDistStr)})</strong> · 🎯 Další: <strong>${e(rem.nextStop.title)}</strong>${nextDistStr ? ` (${e(nextDistStr)})` : ''}`;
    } else {
      topText.innerHTML = `Do cíle <strong>${e(remTimeStr)} (${e(remDistStr)})</strong> · 🎉 Všechny zastávky navštíveny`;
    }
  }

  function renderCompass(origin) {
    if (!origin) return;
    const plannedPlaces = getPlannedPlaces();

    let targetPlace = null;
    let targetDist = Infinity;
    let targetIndex = 0;

    if (plannedPlaces.length > 0) {
      for (let i = 0; i < plannedPlaces.length; i++) {
        const p = plannedPlaces[i];
        if (!isStopVisited(p)) {
          targetPlace = p;
          targetDist = haversineMeters(origin, p) ?? Infinity;
          targetIndex = i + 1;
          break;
        }
      }
    }

    if (!targetPlace) {
      for (const p of catalogue) {
        if (!p.collectible || isStopVisited(p)) continue;
        const d = haversineMeters(origin, p) ?? Infinity;
        if (d < targetDist) {
          targetDist = d;
          targetPlace = p;
        }
      }
    }

    if (targetPlace && Number.isFinite(targetDist)) {
      const dLng = (targetPlace.lng - origin.lng) * Math.PI / 180;
      const lat1 = origin.lat * Math.PI / 180;
      const lat2 = targetPlace.lat * Math.PI / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      targetBearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

      const directions = [
        { name: 'sever', arrow: '↑' },
        { name: 'severovýchod', arrow: '↗' },
        { name: 'východ', arrow: '→' },
        { name: 'jihovýchod', arrow: '↘' },
        { name: 'jih', arrow: '↓' },
        { name: 'jihozápad', arrow: '↙' },
        { name: 'západ', arrow: '←' },
        { name: 'severozápad', arrow: '↖' },
      ];
      const dir = directions[Math.round(targetBearing / 45) % 8];
      const prefix = plannedPlaces.length > 0
        ? `Další cíl: ${targetIndex} z ${plannedPlaces.length}`
        : 'Nejbližší místo';

      const widget = $('active-compass-widget');
      if (widget) widget.title = `${prefix}: ${Math.round(targetDist)} m vzdušně · ${dir.name} (${dir.arrow}) · ${targetPlace.title}`;
      if ($('compass-dist-badge')) {
        $('compass-dist-badge').textContent = formatDistanceLabel(targetDist);
      }

      if (currentDeviceHeading == null) {
        const targetArrow = $('compass-target-arrow');
        if (targetArrow) targetArrow.style.transform = `rotate(${targetBearing}deg)`;
      } else {
        updateCompassRotation(currentDeviceHeading);
      }
      updatePlayerAvatarIcon(Boolean(active || demo));
    } else {
      const widget = $('active-compass-widget');
      if (widget) widget.title = 'Všechny zastávky navštíveny! Výborně.';
      if ($('compass-dist-badge')) $('compass-dist-badge').textContent = 'Hotovo ✓';
      updatePlayerAvatarIcon(Boolean(active || demo));
    }
    updateTurnNavPill(origin);
  }

  /**
   * ZADÁNÍ #08 (Bod 5) & ZADÁNÍ #10: Hlasová navigace v češtině (Web Speech API, cs-CZ) + zvukový signál rohu
   * fungující i při zhasnutém displeji / v kapesním režimu.
   */
  function speakCzechNav(text, stepKey = '', direction = 'straight') {
    if (!voiceNavEnabled || !text) return;
    if (stepKey && stepKey === lastSpokenNavStepKey) return;
    if (stepKey) lastSpokenNavStepKey = stepKey;

    if (stateObj.soundEnabled !== false) {
      playTurnAudioCue(direction);
    }

    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
        try {
          window.speechSynthesis.resume?.();
        } catch {}
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
        }
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'cs-CZ';
        utter.rate = 1.02;
        utter.volume = 1.0;
        window.speechSynthesis.speak(utter);
      }
    } catch {}
  }

  /**
   * ZADÁNÍ #08 (Bod 5): Aktualizuje kompaktní pilulku odbočovací navigace (.turn-nav-pill) vedle kompasu
   * a hlásí každý roh domu v předstihu i přímo u rohu.
   */
  function updateTurnNavPill(origin = lastFix) {
    const iconEl = $('turn-nav-icon');
    const textEl = $('turn-nav-text');
    if (!iconEl || !textEl) return;

    const plannedPlaces = getPlannedPlaces();
    const currentPos = origin || lastFix || telemetry.lastKnownPosition || plannedRoute.origin;
    if (!currentPos || (plannedPlaces.length === 0 && !lastRoutedGeometry)) {
      iconEl.textContent = '↑';
      textEl.textContent = 'Volná chůze · Vyber body v mapě nebo v seznamu';
      return;
    }

    const instr = computeActiveTurnInstruction(
      lastRoutedGeometry,
      currentPos,
      plannedPlaces,
      confirmedStopIds
    );
    iconEl.textContent = instr.icon || '↑';
    textEl.textContent = instr.text || 'Pokračuj po trase';

    if ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden && $('pocket-mode-stats')) {
      $('pocket-mode-stats').textContent = instr.text || 'GPS zaznamenává trasu na pozadí';
    }

    // Pokud hráč seběhl z trasy (potvrzené vybočení > 45 m), automaticky přepočítáme pěší trasu
    // z jeho nového místa přímo k dalšímu nadcházejícímu cíli v pořadí (nikdy zpět na náměstí!)
    if (instr.isOffRoute && (active || demo || simSandboxActive) && (Date.now() - lastOffRouteRecalcAt > 7000)) {
      lastOffRouteRecalcAt = Date.now();
      plannedRouteRenderKey = null;
      renderPlannedRouteOnMap(true, { offRoute: true });
    }

    // DÁVKA 2 (Bod 3.1): Při výpadku routeru (fallback_direct) nespouštíme hlasovou navigaci odboček!
    const isFallbackRoute = Boolean(!lastRoutedGeometry || lastRoutedGeometry.isFallback || lastRoutedGeometry.routeStatus === 'fallback_direct');
    if (!isFallbackRoute && voiceNavEnabled && (active || demo || simSandboxActive) && instr.voiceText && instr.distanceToTurnM != null && instr.distanceToTurnM <= 85) {
      speakCzechNav(instr.voiceText, instr.stepKey, instr.turnDirection || 'straight');
    }
  }

  /**
   * Bod 28: Aktualizuje hlavní trojici ukazatelů (ušlá vzdálenost, čas chůze, vzdálenost k další zastávce)
   * a rozbalovací přehled turistických údajů ze společné pěší trasy.
   */
  function renderTouristStatsHud(origin = lastFix) {
    const now = Date.now();
    // Kritické pravidlo DÁVKY 1 (Bod 2.1 & 2.3): Dokud se čeká na GPS ('locating') nebo je pauza ('paused'), nepřičítá se aktivní čas chůze!
    const isWalkingNow = Boolean(
      walkState === 'running' &&
      (active || demo || simSandboxActive) &&
      (!currentExpedition || currentExpedition.state === 'active')
    );
    telemetry = updateTelemetryTimers(telemetry, now, isWalkingNow);

    const gainedM = currentExpedition ? Math.max(0, progress.meters - currentExpedition.startMeters) : progress.meters;
    const plannedPlaces = getPlannedPlaces();
    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const currentPos = origin || lastFix || telemetry.lastKnownPosition || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };

    const rem = computeRemainingFromSharedRoute({
      sharedRoute: lastRoutedGeometry,
      currentPos,
      plannedPlaces,
      confirmedStopIds,
      companionMode: stateObj.companionMode || 'solo',
      returnToOrigin: isLoop,
      origin: plannedRoute.origin,
    });

    const summary = computeTouristStatsSummary({
      telemetry,
      walkedMeters: gainedM,
      nextStopDistanceM: rem.nextStopDistanceM,
      nextStopTitle: rem.nextStop?.title || null,
      remainingRouteDistanceM: rem.remainingDistanceM,
      remainingRouteMinutes: rem.remainingMinutes,
      isRouteValid: rem.isRouteValid,
      now,
    });

    if ($('hud-walked-dist')) {
      $('hud-walked-dist').textContent = formatMetersCz(summary.walkedMeters);
    }
    if ($('hud-walk-time')) {
      $('hud-walk-time').textContent = summary.activeWalkFormatted;
    }
    if ($('hud-next-stop')) {
      if (rem.nextStop) {
        const distPart = rem.nextStopDistanceM != null ? formatMetersCz(rem.nextStopDistanceM) : '—';
        $('hud-next-stop').textContent = `${distPart} · ${rem.nextStop.title}`;
      } else if (plannedPlaces.length > 0) {
        $('hud-next-stop').textContent = 'V cíli ✓';
      } else {
        $('hud-next-stop').textContent = 'Volná chůze';
      }
    }

    if ($('stat-current-speed')) $('stat-current-speed').textContent = summary.currentSpeedFormatted;
    if ($('stat-avg-speed')) $('stat-avg-speed').textContent = summary.avgWalkSpeedFormatted;
    if ($('stat-total-time')) $('stat-total-time').textContent = `${summary.activeWalkFormatted} / ${summary.totalElapsedFormatted}`;
    if ($('stat-altitude')) $('stat-altitude').textContent = summary.altitudeLabel;
    if ($('stat-altitude-source')) $('stat-altitude-source').textContent = summary.altitudeSourceLabel;
    if ($('stat-elevation')) $('stat-elevation').textContent = summary.elevationFormatted;
    if ($('stat-remaining')) $('stat-remaining').textContent = summary.remainingFormatted;
    if ($('stat-remaining-note')) {
      $('stat-remaining-note').textContent = rem.isRouteValid
        ? 'Vypočteno ze společné pěší trasy'
        : plannedPlaces.length === 0
        ? 'Žádná naplánovaná trasa'
        : 'Pěší trasa není k dispozici';
    }
  }

  /**
   * Bod 29: Načte a vykreslí stručné počasí pro následujících 60 minut (1 věta + rozbalovací podrobnosti).
   */
  async function refreshWeatherStrip(posOverride = null) {
    const queryPos = posOverride || lastFix || plannedRoute.origin || { lat: 49.6018, lng: 13.8635 };
    const locLabel = plannedRoute.origin?.label || 'Rožmitál pod Třemšínem a okolí';
    try {
      const w = await getWeatherForNext60Min({
        pos: queryPos,
        locationLabel: locLabel,
      });
      if (disposed || !w) return;
      weatherData = w;
      renderWeatherStripUi();
    } catch {}
  }

  function renderWeatherStripUi() {
    const sentenceEl = $('weather-sentence');
    const gridEl = $('weather-detail-grid');
    if (!sentenceEl) return;

    if (!weatherData) {
      sentenceEl.textContent = '🌤️ Předpověď počasí na příštích 60 minut není v tuto chvíli dostupná.';
      return;
    }

    const offlineBadge = weatherData.isOffline
      ? ` · ⚠️ Offline (předpověď stará ${weatherData.ageMinutes} min)`
      : weatherData.ageMinutes > 0
      ? ` · aktualizováno před ${weatherData.ageMinutes} min`
      : ' · právě aktualizováno';

    sentenceEl.innerHTML = `${weatherData.icon} <strong>Počasí (60 min):</strong> ${e(weatherData.sentence)} <span class="weather-age-note">${e(offlineBadge)}</span>`;

    if (gridEl) {
      const updatedTime = new Date(weatherData.fetchedAtMs).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
      const tempStr = weatherData.temperatureC != null ? `${weatherData.temperatureC.toFixed(1).replace('.', ',')} °C` : '—';
      const appTempStr = weatherData.apparentTemperatureC != null ? `${weatherData.apparentTemperatureC.toFixed(1).replace('.', ',')} °C` : '—';
      const precipStr = `${(weatherData.precipNext60Mm || 0).toFixed(1).replace('.', ',')} mm (${weatherData.resolutionLabel || 'odhad na 60 min'})`;
      const windStr = weatherData.windSpeedKmH != null ? `${weatherData.windSpeedKmH} km/h` : '—';

      gridEl.innerHTML = `
        <div class="wd-cell"><span>Teplota / Pocitová</span><strong>${e(tempStr)} / ${e(appTempStr)}</strong></div>
        <div class="wd-cell"><span>Srážky (příštích 60 min)</span><strong>${e(precipStr)}</strong></div>
        <div class="wd-cell"><span>Rychlost větru</span><strong>${e(windStr)}</strong></div>
        <div class="wd-cell"><span>Oblast a aktualizace</span><strong>${e(weatherData.locationLabel)} (${e(updatedTime)}${weatherData.isOffline ? `, stáří ${weatherData.ageMinutes} min` : ''})</strong></div>
        <div class="wd-attribution">Zdroj dat počasí: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (licence CC BY 4.0) · Dotazy omezeny na max. 1× za 15 min se zaokrouhlenou polohou.</div>
      `;
    }
  }

  /**
   * Přepočítá zbývající trasu ze společné pěší trasy (`lastRoutedGeometry`) a aktualizuje plovoucí Quest HUD.
   * Nikdy nemaže již ušlou vzdálenost ani potvrzené zastávky (Bod 19, 26 & 28).
   */
  function renderQuestHud(origin) {
    renderTouristStatsHud(origin);
    renderPhase1AndPhase4Ui(origin);
    const hudPanel = $('quest-hud-panel');
    if (!hudPanel) return;

    const plannedPlaces = getPlannedPlaces();
    if (plannedPlaces.length === 0) {
      hudPanel.hidden = true;
      updatePlayerLead(origin || lastFix);
      return;
    }
    // V režimu celé obrazovky (zenMode) zobrazíme plovoucí Quest HUD přímo na mapě
    hudPanel.hidden = !zenMode;

    const currentPos = origin || lastFix || telemetry.lastKnownPosition || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };
    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const rem = computeRemainingFromSharedRoute({
      sharedRoute: lastRoutedGeometry,
      currentPos,
      plannedPlaces,
      confirmedStopIds,
      companionMode: 'solo',
      returnToOrigin: isLoop,
      origin: plannedRoute.origin,
    });

    const visitedCount = plannedPlaces.filter(p => isStopVisited(p)).length;
    if ($('qhud-progress')) $('qhud-progress').textContent = `${visitedCount}/${plannedPlaces.length}`;

    if (rem.nextStop) {
      const distStr = rem.nextStopDistanceM != null ? formatDistanceLabel(rem.nextStopDistanceM) : '—';
      const speedKmH = getCompanionSpeedKmH();
      const nextTimeMin = rem.nextStopDistanceM != null
        ? Math.max(1, Math.round((rem.nextStopDistanceM / 1000) / speedKmH * 60))
        : null;
      if ($('qhud-next-name')) $('qhud-next-name').textContent = rem.nextStop.title;
      if ($('qhud-next-eta')) $('qhud-next-eta').textContent = nextTimeMin != null ? `za ${distStr} · ~${nextTimeMin} min` : `za ${distStr}`;
    } else {
      if ($('qhud-next-name')) $('qhud-next-name').textContent = 'Všechny zastávky potvrzeny! 🎉';
      if ($('qhud-next-eta')) $('qhud-next-eta').textContent = 'Trasa splněna!';
    }

    updatePlayerLead(origin || lastFix);
    updateTurnNavPill(origin || lastFix);
    renderPhase1AndPhase4Ui(origin || lastFix);
  }

  /**
   * ZADÁNÍ #08 (Bod 2): Odstraněna přímá čárkovaná čára z hráče do cíle.
   * Směr ukazuje zlatá orbitální šipka (.avatar-direction-pointer) kolem Avatara.
   */
  function updatePlayerLead(pos) {
    if (playerLeadLayer) {
      playerLeadLayer.clearLayers();
    }
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return;
    renderCompass(pos);
    updatePlayerAvatarIcon(Boolean(active || demo));
  }

  function getRouteOriginPoint() {
    if (lockedExpeditionOrigin) {
      return lockedExpeditionOrigin;
    }
    if (!userExplicitlyPickedOrigin && lastFix && Number.isFinite(lastFix.lat) && Number.isFinite(lastFix.lng)) {
      return lastFix;
    }
    return plannedRoute.origin || lastFix || { lat: 49.6014, lng: 13.8644 };
  }

  function getRouteGeometryKey(waypoints) {
    return waypoints.map(w => `${Number(w.lat).toFixed(5)},${Number(w.lng).toFixed(5)}`).join('|');
  }

  async function getCachedWalkingGeometry(waypoints, key) {
    if (routeGeometryCache.has(key)) return routeGeometryCache.get(key);
    const routeTaskId = beginMapTask('⏳ Počítám trasu…');
    const pending = fetchWalkingGeometry(waypoints)
      .then(res => {
        if (!res?.coordinates || res.coordinates.length < 2) routeGeometryCache.delete(key);
        return res;
      })
      .catch(() => { routeGeometryCache.delete(key); return null; })
      .finally(() => {
        endMapTask(routeTaskId);
      });
    routeGeometryCache.set(key, pending);
    return pending;
  }

  /**
   * Vykreslí společnou naplánovanou pěší trasu na mapě a předá ji simulátoru i výpočtu zbývající vzdálenosti (Body 5, 6, 26, 27, 28 & DÁVKA 2 Bod 3.1–3.2).
   * - Start okruhu (`lockedExpeditionOrigin`) je při zahájení zamknutý a pohyb hráče jej nikdy nepřepisuje.
   * - Postup po trase se počítá projekcí na existující geometrii (`lastRoutedGeometry`); nový dotaz na router se volá jen při změně zastávek nebo potvrzeném vybočení z trasy (`offRoute === true`).
   */
  async function renderPlannedRouteOnMap(force = false, opts = {}) {
    if (!map) return;

    const plannedPlaces = getPlannedPlaces();
    const currentOrigin = getRouteOriginPoint();
    const unvisitedPlaces = plannedPlaces.filter(p => !isStopVisited(p));
    const isOffRouteRecalc = Boolean(opts?.offRoute && (active || demo || simSandboxActive) && lastFix && Number.isFinite(lastFix.lat));
    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 1;

    // DÁVKA 2 (Bod 3.2): Zamknutý start okruhu a nepřepočítávání na každém kroku!
    // Waypointy ukotvíme k zamknutému startu `currentOrigin` (nebo k `lastFix` pouze při potvrzeném vybočení z trasy > 45 m).
    const allWaypoints = isOffRouteRecalc
      ? (unvisitedPlaces.length > 0
          ? [lastFix, ...unvisitedPlaces, ...(isLoop ? [currentOrigin] : [])]
          : (isLoop ? [lastFix, currentOrigin] : [lastFix]))
      : (isLoop ? [currentOrigin, ...plannedPlaces, currentOrigin] : [currentOrigin, ...plannedPlaces]);

    const geomKey = getRouteGeometryKey(allWaypoints);
    const renderKey = `${geomKey}|r${plannedRoute.radiusKm || 10}|l${isLoop ? 1 : 0}|gm${appSettings.gameMode || 'gamified'}`;
    if (!force && renderKey === plannedRouteRenderKey) return;
    plannedRouteRenderKey = renderKey;
    const token = ++plannedRouteRenderToken;

    let coords = null;
    let isFallbackGeom = true;
    if (plannedPlaces.length > 0) {
      let geomResult = null;
      const calcTaskId = beginMapTask('⏳ Počítám trasu…');
      try {
        geomResult = await getCachedWalkingGeometry(allWaypoints, geomKey);
        if (token !== plannedRouteRenderToken || disposed) return;
        // DÁVKA 2 (Bod 3.1): Při výpadku routeru zachováme isFallback: true (fallback_direct) —
        // nepřepisujeme výpadek sítě fiktivním lokálním routerem!
        if (!geomResult || !geomResult.coordinates || geomResult.coordinates.length < 2) {
          geomResult = buildLocalRoutedGeometry(allWaypoints, { isFallback: true });
        }
      } finally {
        endMapTask(calcTaskId);
      }
      if (token !== plannedRouteRenderToken || disposed) return;
      lastRoutedGeometry = geomResult;
      fakeGpsSim?.setSharedWalkingRoute(lastRoutedGeometry);
      coords = geomResult?.coordinates;
      isFallbackGeom = Boolean(!geomResult || geomResult.isFallback || geomResult.routeStatus === 'fallback_direct');
      if (!coords || coords.length < 2) coords = allWaypoints.map(p => [p.lat, p.lng]);

      const myEleToken = ++elevationProfileToken;
      fetchRouteElevationProfile(coords, { signal: aborter.signal })
        .then(eleProfile => {
          if (disposed || myEleToken !== elevationProfileToken) return;
          currentElevationProfile = eleProfile;
          renderPlannerBasketAndXray();
        })
        .catch(() => {});

      renderPlannerBasketAndXray();
      renderQuestHud(lastFix || plannedRoute.origin);
    } else {
      lastRoutedGeometry = null;
      currentElevationProfile = null;
      fakeGpsSim?.setSharedWalkingRoute(null);
      renderPlannerBasketAndXray();
      renderTouristStatsHud(lastFix || plannedRoute.origin);
      renderPhase1AndPhase4Ui(lastFix || plannedRoute.origin);
    }

    plannedRouteLayer.clearLayers();
    plannedRouteCoords = coords;

    // 1. Kružnice okruhu hledání
    const radiusM = (plannedRoute.radiusKm || 10) * 1000;
    radiusCircle = L.circle([currentOrigin.lat, currentOrigin.lng], {
      radius: radiusM,
      color: '#3c6e47',
      weight: 1.2,
      dashArray: '5, 6',
      fillColor: '#8da949',
      fillOpacity: 0.03,
      interactive: false,
    }).addTo(plannedRouteLayer);

    updatePlayerLead(lastFix);
    if (!coords) return;

    // 2. Plánovaná trasa výpravy (DÁVKA 1 Bod 3.3 & DÁVKA 2 Bod 3.1: čárkovaná ⚠️ Orientační vzdušná spojnice při isFallbackGeom):
    if (appSettings.gameMode !== 'explorer') {
      L.polyline(coords, {
        pane: 'quest-route-pane',
        color: '#2e1065',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(plannedRouteLayer);

      L.polyline(coords, {
        pane: 'quest-route-pane',
        color: '#9333ea',
        weight: 4.5,
        dashArray: isFallbackGeom ? '6, 9' : null,
        opacity: 0.98,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(plannedRouteLayer);

      // ZADÁNÍ #11 (Bod 4.1): Zvýraznění detekovaných rohů ulic a odboček jako navigačních bodů podél trasy
      if (lastRoutedGeometry && Array.isArray(lastRoutedGeometry.steps)) {
        for (const step of lastRoutedGeometry.steps) {
          if (step.maneuverType === 'turn' && Number.isFinite(step.lat) && Number.isFinite(step.lng)) {
            L.marker([step.lat, step.lng], {
              pane: 'quest-route-pane',
              interactive: false,
              icon: L.divIcon({
                className: 'route-corner-dot-marker',
                html: `<span class="route-corner-dot" title="${e(step.actionLabel || 'Roh')}"></span>`,
                iconSize: [8, 8],
                iconAnchor: [4, 4],
              }),
            }).addTo(plannedRouteLayer);
          }
        }
      }

      // 4. Směrové šipky podél plánované trasy
      for (let i = 0; i < coords.length - 1; i += Math.max(1, Math.floor(coords.length / 8))) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        if (!p1 || !p2) continue;
        const angle = (Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180 / Math.PI + 360) % 360;
        L.marker([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], {
          pane: 'quest-route-pane',
          interactive: false,
          icon: L.divIcon({
            className: 'route-dir-marker',
            html: `<span class="route-dir-arrow" style="transform:rotate(${angle}deg)">➤</span>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        }).addTo(plannedRouteLayer);
      }
    }
  }

  /**
   * Přepočítá zbývající trasu po úpravě zastávek (odebrání, nahrazení, posun pořadí)
   * bez smazání ušlé vzdálenosti a získaných návštěv (Bod 19 & 27).
   */
  function recalculateRemainingRoute(reasonMsg = '') {
    plannedRouteRenderKey = null;
    saveAppState();
    renderPlannerBasketAndXray();
    renderPlaces();
    renderQuestHud(lastFix || plannedRoute.origin);
    renderPhase1AndPhase4Ui(lastFix || plannedRoute.origin);
    renderPlannedRouteOnMap(true);
    if (reasonMsg) status(reasonMsg);
  }

  function renderReplaceStopPicker() {
    const pickerEl = $('stop-replace-picker');
    if (!pickerEl) return;
    if (replacingStopIndex == null || replacingStopIndex < 0 || replacingStopIndex >= (plannedRoute.selectedPlaceIds || []).length) {
      pickerEl.hidden = true;
      pickerEl.innerHTML = '';
      return;
    }

    const currentId = plannedRoute.selectedPlaceIds[replacingStopIndex];
    const currentPlace = getAllAvailablePlaces().find(p => p.id === currentId);
    const candidates = getAllAvailablePlaces()
      .filter(p => p.id !== currentId && !(plannedRoute.selectedPlaceIds || []).includes(p.id))
      .slice(0, 12);

    pickerEl.hidden = false;
    pickerEl.innerHTML = `
      <div class="replace-picker-head">
        <strong>⇄ Nahradit zastávku #${replacingStopIndex + 1} (${e(currentPlace?.title || currentId)}) za:</strong>
        <button type="button" class="button small ghost" id="btn-cancel-replace-stop">Zrušit</button>
      </div>
      <div class="replace-picker-grid">
        ${candidates.map(c => `
          <button type="button" class="replace-candidate-btn" data-replace-with-id="${e(c.id)}">
            <span>${e(c.title)}</span>
            <small>Vybrat ⇄</small>
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderPlannerBasketAndXray() {
    const plannedPlaces = getPlannedPlaces();
    if ($('basket-count')) $('basket-count').textContent = String(plannedPlaces.length);

    const nextUnvisited = plannedPlaces.find(p => !isStopVisited(p));
    const currentPos = lastFix || telemetry.lastKnownPosition || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };

    const basketListEl = $('planner-basket-list');
    if (basketListEl) {
      if (plannedPlaces.length === 0) {
        basketListEl.innerHTML = `
          <div class="empty-stops-hint">
            <p class="small-note" style="margin:0">Zatím nemáš vybrané žádné zastávky.</p>
          </div>
        `;
      } else {
        basketListEl.innerHTML = plannedPlaces.map((p, idx) => {
          const visitedToday = isStopVisitedInSession(p);
          const nearbyToday = !visitedToday && nearbyRecordedIds.has(p.id);
          const hasEarlierStamp = !visitedToday && hasLifetimeStamp(p);
          const isNext = nextUnvisited && nextUnvisited.id === p.id;
          const distM = haversineMeters(currentPos, p);
          const distLabel = formatDistanceLabel(distM);
          // DÁVKA 2 (Bod 2.1): Pravdivá terminologie záznamu podle GPS
          const stateBadge = visitedToday
            ? `<span class="stop-state-badge confirmed" title="${e(VISIT_RECORD_TYPES.gps_stop.explanation)}">📍 Potvrzeno podle GPS (≤ ${STOP_CONFIRM_RADIUS_M} m)</span>`
            : nearbyToday
            ? `<span class="stop-state-badge confirmed" title="${e(VISIT_RECORD_TYPES.gps_nearby.explanation)}">📍 Zaznamenáno poblíž (dle GPS)</span>`
            : isNext
            ? `<span class="stop-state-badge next-target">🎯 Další cíl (${distLabel})${hasEarlierStamp ? ' · 📍 Potvrzeno podle GPS dříve' : ''}</span>`
            : `<span class="stop-state-badge pending">Čeká (${distLabel})${hasEarlierStamp ? ' · 📍 Potvrzeno podle GPS dříve' : ''}</span>`;

          return `
            <div class="basket-item ${visitedToday ? 'is-visited' : ''} ${isNext ? 'is-next-target' : ''}" data-stop-index="${idx}" data-stop-id="${e(p.id)}">
              <div class="basket-item-main">
                <span class="basket-index">${idx + 1}.</span>
                <div class="basket-title-wrap">
                  <strong class="basket-title">${e(p.title)}</strong>
                  ${stateBadge}
                </div>
              </div>
              <div class="basket-item-controls" role="group" aria-label="Úprava zastávky ${e(p.title)}">
                <button type="button" class="button small ghost stop-ctrl-btn" data-stop-action="up" data-stop-index="${idx}" ${idx === 0 ? 'disabled' : ''} title="Posunout zastávku nahoru">↑ Nahoru</button>
                <button type="button" class="button small ghost stop-ctrl-btn" data-stop-action="down" data-stop-index="${idx}" ${idx === plannedPlaces.length - 1 ? 'disabled' : ''} title="Posunout zastávku dolů">↓ Dolů</button>
                <button type="button" class="button small ghost stop-ctrl-btn" data-stop-action="replace" data-stop-index="${idx}" title="Nahradit tuto zastávku jiným místem">⇄ Nahradit</button>
                <button type="button" class="button small ghost danger stop-ctrl-btn" data-stop-action="remove" data-stop-index="${idx}" title="Odebrat zastávku z trasy">✕ Odebrat</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    renderReplaceStopPicker();
    renderPersonalMemoriesUi();
    renderMindfulnessPromptUi();

    if ($('btn-optimize-route')) {
      $('btn-optimize-route').disabled = plannedPlaces.length < 2;
    }

    const xrayCardEl = $('route-xray-card');
    if (!xrayCardEl) return;

    const gainedM = currentExpedition ? Math.max(0, progress.meters - currentExpedition.startMeters) : progress.meters;

    if (plannedPlaces.length === 0) {
      xrayCardEl.innerHTML = `
        <div class="xray-header">
          <strong>🧭 Přehled trasy (volná chůze bez pevných zastávek)</strong>
        </div>
        <div class="xray-stats-grid">
          <div class="xray-stat">
            <strong id="xray-walked-dist">${formatMetersCz(gainedM)}</strong>
            <span>Ušlá vzdálenost</span>
          </div>
        </div>
      `;
      return;
    }

    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const isFallbackRoute = Boolean(!lastRoutedGeometry || lastRoutedGeometry.isFallback || lastRoutedGeometry.routeStatus === 'fallback_direct');
    const routedM = !isFallbackRoute && lastRoutedGeometry ? lastRoutedGeometry.distanceM : null;
    const unvisitedPlaces = plannedPlaces.filter(p => !isStopVisited(p));
    const totalAnalysis = analyzePlannedRoute(getRouteOriginPoint(), plannedPlaces, 'solo', {
      returnToOrigin: isLoop,
      routedDistanceM: routedM,
      isFallback: isFallbackRoute,
      hasRoadClassData: Boolean(lastRoutedGeometry?.hasRoadClassData),
      roadTypeSummary: lastRoutedGeometry?.roadTypeSummary || 'Údaje o typu cesty nejsou k dispozici',
    });
    const remShared = computeRemainingFromSharedRoute({
      sharedRoute: lastRoutedGeometry,
      currentPos,
      plannedPlaces,
      confirmedStopIds,
      companionMode: 'solo',
      returnToOrigin: isLoop,
      origin: getRouteOriginPoint(),
    });

    const remDistM = remShared.isRouteValid && remShared.remainingDistanceM != null
      ? remShared.remainingDistanceM
      : totalAnalysis.estimatedWalkDistanceM;
    const remMin = remShared.isRouteValid && remShared.remainingMinutes != null
      ? remShared.remainingMinutes
      : totalAnalysis.estimatedMinutes;

    const totalDistM = Math.max(1, totalAnalysis.estimatedWalkDistanceM || remDistM || 1000);
    const playerProgressRatio = (active || demo)
      ? Math.max(0, Math.min(1, 1 - (remDistM / totalDistM)))
      : 0;
    const elevationHtml = currentElevationProfile
      ? renderElevationProfileCardHtml(currentElevationProfile, plannedPlaces, playerProgressRatio)
      : '';

    const routeStatusLabel = lastRoutedGeometry?.routeStatusLabel || totalAnalysis.routeStatusLabel;
    const roadTypeSummary = lastRoutedGeometry?.roadTypeSummary || totalAnalysis.roadTypeSummary || 'Údaje o typu cesty nejsou k dispozici';

    xrayCardEl.innerHTML = `
      <div class="xray-header">
        <strong>🧭 Přehled trasy (${unvisitedPlaces.length} zbývajících z ${plannedPlaces.length} zastávek${isLoop ? ' · okruh' : ''})</strong>
      </div>
      <div class="xray-route-status-banner ${isFallbackRoute ? 'is-fallback' : 'is-routed'}" id="xray-route-status-banner">
        <strong>${e(routeStatusLabel)}</strong>
        <small style="display:block;margin-top:2px">${e(roadTypeSummary)} · GPS měří přiblížení v terénu (≤ ${STOP_CONFIRM_RADIUS_M} m, opakované vzorky).</small>
      </div>
      <div class="xray-stats-grid">
        <div class="xray-stat">
          <strong id="xray-remaining-dist">${formatDistanceLabel(remDistM)}</strong>
          <span>Zbývá ujít (~${remMin} min)</span>
        </div>
        <div class="xray-stat">
          <strong id="xray-walked-dist">${formatMetersCz(gainedM)}</strong>
          <span>Již ušlá vzdálenost (zachována)</span>
        </div>
      </div>
      ${elevationHtml}
    `;
  }

  /**
   * Vykreslí místa v okolí a mapové značky (Bod 1, 7, 18, 23 & 26).
   */
  function renderPlaces(options = {}) {
    const skipListRebuild = Boolean(options?.skipListRebuild);
    if ($('nearby-origin')) {
      $('nearby-origin').textContent = demo
        ? 'Vzdálenosti od simulovaného bodu.'
        : lastFix && follow
        ? 'Vzdálenosti od tvé aktuální polohy.'
        : map && !follow
        ? 'Zobrazená část mapy ČR (posunem načteš další místa).'
        : lastFix
        ? 'Vzdálenosti od poslední přijaté polohy.'
        : map
        ? 'Vzdálenosti od středu mapy.'
        : 'Poloha není určena.';
    }
    const all = getAllAvailablePlaces();
    const origin = lastFix || telemetry.lastKnownPosition || map?.getCenter();
    const normalized = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
      ? { lat: origin.lat, lng: origin.lng }
      : null;
    renderCompass(normalized);

    const mapCenter = map ? map.getCenter() : null;
    const viewCenter = (!follow && mapCenter)
      ? mapCenter
      : (normalized || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 });

    const plannedPlaces = getPlannedPlaces();
    const plannedPlaceIds = new Set(plannedRoute.selectedPlaceIds || []);

    // 1. Zjistíme viditelné hranice mapy (s mírným paddingem, aby značky nevyskakovaly těsně u okraje)
    const mapBounds = map ? map.getBounds().pad(0.35) : null;

    // 2. Mapové značky (placesLayer):
    //    Zobrazíme všechny body, které:
    //    a) leží ve viditelném výřezu mapy, NEBO
    //    b) jsou v naplánované trase (aby byly vždy vidět se svým číslem zastávky), NEBO
    //    c) jsou do 8 km od uživatele (pokud je poloha známá).
    //    DŮLEŽITÉ: Mapové značky se NIKDY nefiltrují natvrdo rádiusem od startu,
    //    aby uživatel mohl posouvat mapu po celé ČR a vybírat si vzdálenější body!
    const mapPlaces = all.filter(p => {
      if (plannedPlaceIds.has(p.id)) return true;
      if (
        plannedRoute.categories.length > 0 &&
        p.category &&
        !plannedRoute.categories.includes(p.category)
      ) {
        return false;
      }
      if (mapBounds && mapBounds.contains([p.lat, p.lng])) return true;
      if (normalized && (haversineMeters(normalized, p) ?? Infinity) < 8000) return true;
      return false;
    });

    // 3. Seznam míst pod mapou (#walk-places):
    //    ZADÁNÍ #10 (Bod 4.1): Strikně seřazený vzestupně podle vzdálenosti (distanceM od nejbližšího po nejvzdálenější)
    //    vůči aktuálnímu bodu startu / pozici hráče, s fotkou/ilustrací (88x72 px) a velkou vzdáleností.
    const refOrigin = normalized || plannedRoute.origin || viewCenter;
    const sidebarList = all
      .map(p => {
        const distM = haversineMeters(refOrigin, p) ?? Infinity;
        return {
          ...p,
          distanceM: distM,
          distanceFromUser: distM,
          distanceFromView: haversineMeters(viewCenter, p) ?? Infinity,
        };
      })
      .filter(p => {
        if (plannedPlaceIds.has(p.id)) return true;
        if (
          plannedRoute.categories.length > 0 &&
          p.category &&
          !plannedRoute.categories.includes(p.category)
        ) {
          return false;
        }
        if (mapBounds && mapBounds.contains([p.lat, p.lng])) return true;
        if (p.distanceM <= 30000) return true;
        return false;
      })
      .sort((a, b) => a.distanceM - b.distanceM);

    const formatBigDist = (m) => {
      if (!Number.isFinite(m)) return '—';
      if (m < 1000) return `${Math.round(m)} m`;
      return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
    };

    if (!skipListRebuild && $('walk-places')) {
      const extPhotosOn = appSettings.showExternalPhotos !== false;
      $('walk-places').innerHTML = sidebarList.slice(0, 18).map(p => {
        const visitedToday = isStopVisitedInSession(p);
        const nearbyToday = !visitedToday && nearbyRecordedIds.has(p.id);
        const earlierStamp = !visitedToday && hasLifetimeStamp(p);
        const isRouteStart = p.pointKind === 'route-start';
        const isPlanned = plannedPlaceIds.has(p.id);
        const bigDistStr = formatBigDist(p.distanceM);
        const photoInfo = getPlacePhotoSync(p, { showExternalPhotos: extPhotosOn });
        const photoSourceNote = photoInfo.isRealPhoto
          ? `📸 ${formatPhotoSourceLabel(photoInfo)}`
          : '🎨 Vektorová ilustrace kategorie';
        const statusText = visitedToday
          ? '📍 Potvrzeno podle GPS (opakované vzorky v dosahu)'
          : nearbyToday
          ? '📍 Zaznamenáno poblíž (dle GPS)'
          : earlierStamp
          ? '📍 Potvrzeno podle GPS (z dřívější výpravy)'
          : isRouteStart
          ? '🥾 Začátek trasy'
          : '📍 Zajímavé místo v okolí';

        return `<div class="nearby-place" data-distance-m="${Math.round(p.distanceM || 0)}" style="display:flex;gap:12px;align-items:center">
          <img
            class="place-card-thumb"
            src="${e(photoInfo.photoUrl)}"
            alt="${e(p.title)}"
            width="88"
            height="72"
            loading="lazy"
          />
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <strong style="font-size:1.02rem">${e(p.title)}</strong>
              <span class="place-distance-big">${e(bigDistStr)}</span>
            </div>
            <span style="display:block;margin:3px 0;font-size:0.84rem">${e(statusText)}</span>
            <small class="small-note" style="display:block;font-size:0.74rem">${e(photoSourceNote)}</small>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
              <button type="button" class="button small ${isPlanned ? 'ghost' : 'lime'} toggle-plan-place-btn" data-place-id="${e(p.id)}">
                ${isPlanned ? '✓ V trase (odebrat)' : '+ Přidat do trasy'}
              </button>
              <button type="button" class="button ghost small open-map-detail-btn" data-place-id="${e(p.id)}">
                🔍 Ukázat v mapě
              </button>
            </div>
          </div>
        </div>`;
      }).join('') || '<p class="small-note">V této části mapy zatím nejsou žádná místa. Posuň mapu nebo chvíli počkej na automatické načtení.</p>';
    }

    if (!map || !placesLayer) return;

    const nextUnvisitedStop = plannedPlaces.find(p => !isStopVisited(p));
    const activeMapPlaceIds = new Set();

    // Přidáme také vlastní soukromé vzpomínky uživatele jako odlišené značky v mapě
    const memoryMapItems = personalMemories
      .filter(m => m && Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lng)))
      .map(m => ({
        id: m.id,
        title: `${m.symbolTitle}${m.note ? ` — ${m.note}` : ''}`,
        lat: Number(m.lat),
        lng: Number(m.lng),
        kind: 'memory',
        category: 'memory',
        isUserMemory: true,
        memoryObj: m,
      }));

    // Odstraníme markery, které už nejsou v mapPlaces ani v memoryMapItems
    for (const p of mapPlaces) {
      activeMapPlaceIds.add(p.id);
    }
    for (const m of memoryMapItems) {
      activeMapPlaceIds.add(m.id);
    }
    for (const [existingId, entry] of placeMarkersById.entries()) {
      if (!activeMapPlaceIds.has(existingId)) {
        placesLayer.removeLayer(entry.marker);
        placeMarkersById.delete(existingId);
      }
    }

    // Vykreslíme vlastní soukromé vzpomínky uživatele na mapě (zřetelně odlišené od GPS památek)
    for (const mItem of memoryMapItems) {
      const m = mItem.memoryObj;
      const symIcon = m.symbolIcon || '✨';
      const stateSig = `mem|${mItem.lat},${mItem.lng}|${symIcon}|${m.note || ''}`;
      const iconHtml = `
        <span class="czekpoint-marker-badge tier-user-memory" data-kind="user-memory" title="${e(`✨ Vlastnoruční vzpomínka uživatele: ${m.symbolTitle}`)}">
          <span class="czekpoint-marker-glyph kind-memory" style="font-size:18px;line-height:1">${e(symIcon)}</span>
        </span>
      `;
      const existing = placeMarkersById.get(mItem.id);
      if (existing) {
        existing.place = mItem;
        if (existing.stateSig !== stateSig) {
          existing.marker.setIcon(
            L.divIcon({
              className: 'czekpoint-marker-anchor user-memory-anchor',
              html: iconHtml,
              iconSize: [38, 38],
              iconAnchor: [19, 19],
            })
          );
          existing.stateSig = stateSig;
          existing.iconStateKey = stateSig;
        }
      } else {
        const marker = L.marker([mItem.lat, mItem.lng], {
          icon: L.divIcon({
            className: 'czekpoint-marker-anchor user-memory-anchor',
            html: iconHtml,
            iconSize: [38, 38],
            iconAnchor: [19, 19],
          }),
          title: `✨ Vlastnoruční vzpomínka: ${m.symbolTitle}`,
        }).addTo(placesLayer);
        const entry = {
          marker,
          place: mItem,
          lat: mItem.lat,
          lng: mItem.lng,
          stateSig,
          iconStateKey: stateSig,
        };
        placeMarkersById.set(mItem.id, entry);
        marker.on('click', () => {
          openPlaceDetail(entry.place || mItem);
        });
      }
    }

    // Aktualizujeme nebo vytvoříme markery bez blikání (in-place diffing)
    for (const p of mapPlaces) {
      const visited = isStopVisitedInSession(p);
      const isRouteStart = p.pointKind === 'route-start';
      const isPlanned = plannedPlaceIds.has(p.id);
      const isNextTarget = nextUnvisitedStop && nextUnvisitedStop.id === p.id;
      const isJustConfirmed = justConfirmedStopId === p.id;
      const isFirstAppear = !appearedPlaceIds.has(p.id);
      if (isFirstAppear) appearedPlaceIds.add(p.id);

      const categoryKey = isRouteStart ? 'route-start' : (p.kind || 'forest');
      const tierClass = visited
        ? 'tier-visited'
        : isNextTarget
        ? 'tier-next-target'
        : isPlanned
        ? 'tier-planned'
        : 'tier-default';

      const animClass = isJustConfirmed
        ? 'is-just-confirmed'
        : isNextTarget
        ? 'is-next-target'
        : '';

      const stopOrderIdx = plannedPlaces.findIndex(item => item.id === p.id);
      const orderBadgeHtml = stopOrderIdx >= 0
        ? `<span class="czekpoint-marker-order">${stopOrderIdx + 1}</span>`
        : '';

      const glyphHtml = renderCategoryMarkerGlyph(categoryKey, visited ? 'visited' : 'default');
      const extPhotosOn = appSettings.showExternalPhotos !== false;
      const cachedPhoto = extPhotosOn ? getCachedPlacePhoto(p) : null;
      const hasRealPhoto = Boolean(extPhotosOn && cachedPhoto && cachedPhoto.photoUrl);
      const photoInnerHtml = hasRealPhoto
        ? `
            <span class="czekpoint-marker-photo-wrap">
              <img class="czekpoint-marker-photo-img" src="${e(cachedPhoto.photoUrl)}" alt="" onerror="this.parentElement.hidden=true;if(this.parentElement.nextElementSibling)this.parentElement.nextElementSibling.hidden=false;" />
            </span>
            <span class="czekpoint-marker-glyph kind-${e(categoryKey)}" hidden>${glyphHtml}</span>
          `
        : `<span class="czekpoint-marker-glyph kind-${e(categoryKey)}">${glyphHtml}</span>`;

      const stateSig = `${p.lat},${p.lng}|${tierClass}|${animClass}|${stopOrderIdx}|${hasRealPhoto ? cachedPhoto.photoUrl : 'glyph'}`;
      const iconHtml = `
        <span class="czekpoint-marker-badge ${tierClass} ${animClass} ${hasRealPhoto ? 'has-real-photo' : 'has-bitmap-glyph'}" data-kind="${e(categoryKey)}">
          ${photoInnerHtml}
          ${orderBadgeHtml}
        </span>
      `;

      const existing = placeMarkersById.get(p.id);
      if (existing) {
        existing.place = p;
        if (existing.lat !== p.lat || existing.lng !== p.lng) {
          existing.marker.setLatLng([p.lat, p.lng]);
          existing.lat = p.lat;
          existing.lng = p.lng;
        }
        if (existing.stateSig !== stateSig) {
          existing.marker.setIcon(
            L.divIcon({
              className: 'czekpoint-marker-anchor',
              html: iconHtml,
              iconSize: [42, 42],
              iconAnchor: [21, 21],
              popupAnchor: [0, -14],
            })
          );
          existing.stateSig = stateSig;
          existing.iconStateKey = stateSig;
        }
      } else {
        const marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'czekpoint-marker-anchor',
            html: iconHtml,
            iconSize: [42, 42],
            iconAnchor: [21, 21],
            popupAnchor: [0, -14],
          }),
          title: p.title,
        }).addTo(placesLayer);

        const entry = {
          marker,
          place: p,
          lat: p.lat,
          lng: p.lng,
          stateSig,
          iconStateKey: stateSig,
        };
        placeMarkersById.set(p.id, entry);

        marker.on('click', () => {
          const currentPlace = entry.place || p;
          if (pickingCustomEndOnMap) {
            pickingCustomEndOnMap = false;
            phase1EndMode = 'custom';
            plannedRoute.routeType = 'oneway';
            const others = getPlannedPlaces().filter(item => item.id !== currentPlace.id);
            const orderedOthers = others.length >= 2
              ? optimizeRouteOrder(getRouteOriginPoint(), others, {
                  returnToOrigin: false,
                  visitedStopIds: confirmedStopIds,
                  currentPosition: (active || demo) && lastFix ? lastFix : null,
                })
              : others;
            plannedRoute.selectedPlaceIds = [...orderedOthers.map(item => item.id), currentPlace.id];
            recalculateRemainingRoute(`🏁 Nový konec trasy nastaven na: ${currentPlace.title}.`);
            playStampChord(stateObj.soundEnabled);
            return;
          }
          openPlaceDetail(currentPlace);
        });
      }
    }

    renderPlannedRouteOnMap();

    // Asynchronně načteme fotky pouze pokud je zapnuté zobrazování externích fotografií
    if (appSettings.showExternalPhotos !== false) {
      const unprefetchedSidebar = [...plannedPlaces, ...sidebarList.slice(0, 14)].filter(p => p && p.id && !prefetchedPhotoPlaceIds.has(p.id));
      if (unprefetchedSidebar.length > 0) {
        for (const p of unprefetchedSidebar) prefetchedPhotoPlaceIds.add(p.id);
        prefetchPlacePhotos(unprefetchedSidebar, {
          signal: aborter.signal,
          maxCount: 14,
          showExternalPhotos: true,
          onUpdated: () => {
            if (disposed) return;
            renderPlaces();
          },
        });
      }

      const unprefetchedMap = [...plannedPlaces, ...mapPlaces.slice(0, 16)].filter(p => p && p.id && !prefetchedVerifiedPlaceIds.has(p.id));
      if (unprefetchedMap.length > 0) {
        for (const p of unprefetchedMap) prefetchedVerifiedPlaceIds.add(p.id);
        prefetchVerifiedPhotosForPlaces(unprefetchedMap, {
          signal: aborter.signal,
          maxCount: 16,
          onBatchUpdated: () => {
            if (disposed) return;
            renderPlaces();
            renderNextCheckpointHero(lastFix || telemetry.lastKnownPosition);
            if (selectedDetailPlace && !$('place-detail-sheet')?.hidden) {
              openPlaceDetail(selectedDetailPlace);
            }
          },
        });
      }
    }
  }

  function openPlaceDetail(p) {
    if (!p) return;
    selectedDetailPlace = p;
    const sheet = $('place-detail-sheet');
    if (!sheet) return;

    // DÁVKA 2 (Bod 1.1 & 2.1): Pokud uživatel klikl na vlastní soukromou vzpomínku v mapě, jasně ji odlišíme od GPS památky
    if (p.isUserMemory && p.memoryObj) {
      const mem = p.memoryObj;
      sheet.hidden = false;
      sheet.innerHTML = `
        <div class="pds-card phase3-bubble-card">
          <div class="pds-header" style="display:flex;gap:12px;align-items:center">
            <div class="pds-memory-icon-box" style="width:56px;height:56px;border-radius:12px;background:#f4efe1;display:flex;align-items:center;justify-content:center;font-size:28px">
              ${e(mem.symbolIcon || '✨')}
            </div>
            <div class="pds-title-wrap" style="flex:1;min-width:0">
              <span class="pds-kind-badge">✨ Vlastnoruční vzpomínka uživatele</span>
              <h3 class="pds-title">${e(mem.symbolTitle || 'Vlastní vzpomínka')}</h3>
              <span class="pds-photo-source-badge is-bitmap">🔒 Soukromá poznámka v zařízení (nikoliv GPS ověřená památka)</span>
            </div>
            <button type="button" class="button small ghost pds-close-btn" id="btn-close-place-detail" aria-label="Zavřít bublinu">✕</button>
          </div>
          <p class="pds-memory-note" id="pds-memory-note-text" style="margin:8px 0 4px;font-size:0.95rem"></p>
        </div>
      `;
      const noteEl = $('pds-memory-note-text');
      if (noteEl) {
        noteEl.textContent = mem.note ? mem.note : 'Bez textové poznámky.';
      }
      $('btn-close-place-detail')?.addEventListener('click', closePlaceDetail);
      return;
    }

    const visited = isStopVisitedInSession(p);
    const nearbyVisited = !visited && nearbyRecordedIds.has(p.id);
    const earlierStamp = !visited && hasLifetimeStamp(p);
    const isPlanned = (plannedRoute.selectedPlaceIds || []).includes(p.id);
    const curPos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    const distM = curPos ? haversineMeters(curPos, p) : null;
    const distStr = formatDistanceLabel(distM);
    const speedKmH = getCompanionSpeedKmH();
    const mins = distM != null ? Math.max(1, Math.round((distM / 1000) / speedKmH * 60)) : null;

    const kindLabel = p.kind === 'water' ? '💧 Voda a klid' : p.kind === 'view' ? '⛰️ Vyhlídka' : p.kind === 'culture' ? '🏰 Památka' : '🌲 Příroda';

    // DÁVKA 2 (Bod 2.1): Pravdivá terminologie a vysvětlení, že GPS měří přiblížení v terénu
    const statusBadge = visited
      ? `<span class="pds-stamp-badge visited" title="${e(VISIT_RECORD_TYPES.gps_stop.explanation)}">📍 Potvrzeno podle GPS (opakované vzorky ≤ ${STOP_CONFIRM_RADIUS_M} m)</span>`
      : nearbyVisited
      ? `<span class="pds-stamp-badge visited" title="${e(VISIT_RECORD_TYPES.gps_nearby.explanation)}">📍 Zaznamenáno poblíž (dle GPS)</span>`
      : earlierStamp
      ? `<span class="pds-stamp-badge lifetime" title="${e(VISIT_RECORD_TYPES.gps_stop.explanation)}">📍 Potvrzeno podle GPS (z dřívější výpravy)</span>`
      : `<span class="pds-stamp-badge pending">📍 ${distStr}${mins != null ? ` · ~${mins} min` : ''} (GPS měří přiblížení v terénu)</span>`;

    const extPhotosOn = appSettings.showExternalPhotos !== false;
    const placePhoto = getPlacePhotoSync(p, { showExternalPhotos: extPhotosOn });
    const imgSrc = placePhoto.photoUrl;
    const badgeHtml = placePhoto.isRealPhoto
      ? `<span class="pds-photo-source-badge is-verified" id="pds-photo-badge">📸 Fotka · ${e(formatPhotoSourceLabel(placePhoto))}</span>`
      : `<span class="pds-photo-source-badge is-bitmap" id="pds-photo-badge">🎨 Vektorová ilustrace kategorie</span>`;

    const actionsHtml = isPlanned
      ? `
        <div class="pds-actions phase3-bubble-actions">
          <button type="button" class="button danger phase3-action-btn" id="btn-p3-skip-stop" data-place-id="${e(p.id)}">
            ✕ Vynechat tuto zastávku
          </button>
        </div>
      `
      : `
        <div class="pds-actions phase3-bubble-actions">
          <button type="button" class="button lime phase3-action-btn" id="btn-p3-insert-stop" data-place-id="${e(p.id)}">
            + Přidat do trasy
          </button>
          <button type="button" class="button primary phase3-action-btn" id="btn-p3-set-end" data-place-id="${e(p.id)}">
            🏁 Nastavit jako konečný cíl
          </button>
        </div>
      `;

    sheet.hidden = false;
    sheet.innerHTML = `
      <div class="pds-card phase3-bubble-card">
        <div class="pds-header" style="display:flex;gap:12px;align-items:center">
          <img
            id="pds-photo-img"
            class="pds-thumb"
            src="${e(imgSrc)}"
            alt="${e(p.title)}"
            width="88"
            height="72"
            loading="lazy"
          />
          <div class="pds-title-wrap" style="flex:1;min-width:0">
            <span class="pds-kind-badge">${e(kindLabel)}</span>
            <h3 class="pds-title">${e(p.title)}</h3>
            ${badgeHtml}
          </div>
          <button type="button" class="button small ghost pds-close-btn" id="btn-close-place-detail" aria-label="Zavřít bublinu">✕</button>
        </div>
        <div class="pds-meta-row">
          ${statusBadge}
        </div>
        ${actionsHtml}
      </div>
    `;

    if (extPhotosOn && !placePhoto.isRealPhoto) {
      resolvePlacePhoto(p, { signal: aborter.signal, showExternalPhotos: true }).then(res => {
        if (disposed || !selectedDetailPlace || selectedDetailPlace.id !== p.id) return;
        if (res && res.isRealPhoto && res.photoUrl && appSettings.showExternalPhotos !== false) {
          const imgEl = $('pds-photo-img');
          const badgeEl = $('pds-photo-badge');
          if (imgEl) imgEl.src = res.photoUrl;
          if (badgeEl) {
            badgeEl.textContent = `📸 Fotka · ${formatPhotoSourceLabel(res)}`;
            badgeEl.className = 'pds-photo-source-badge is-verified';
          }
          renderPlaces();
        }
      }).catch(() => {});
    }

    $('btn-close-place-detail')?.addEventListener('click', closePlaceDetail);

    // 1. Bod UŽ JE v trase -> [ ✕ Vynechat tuto zastávku ]
    $('btn-p3-skip-stop')?.addEventListener('click', () => {
      const remainingPlaces = getPlannedPlaces().filter(item => item.id !== p.id);
      const isLoop = plannedRoute.routeType === 'loop' && remainingPlaces.length >= 2;
      const ordered = remainingPlaces.length >= 2
        ? optimizeRouteOrder(getRouteOriginPoint(), remainingPlaces, {
            returnToOrigin: isLoop,
            visitedStopIds: confirmedStopIds,
            currentPosition: (active || demo) && lastFix ? lastFix : null,
          })
        : remainingPlaces;
      plannedRoute.selectedPlaceIds = ordered.map(item => item.id);
      lastRoutedGeometry = null;
      closePlaceDetail();
      recalculateRemainingRoute(`Zastávka „${p.title}“ vynechána. Trasa a čas do cíle byly zkráceny.`);
      playTick(stateObj.soundEnabled);
    });

    // 2A. Bod NENÍ v trase -> [ ➕ Přidat jako zastávku po cestě ]
    $('btn-p3-insert-stop')?.addEventListener('click', () => {
      const currentPlaces = getPlannedPlaces();
      if (!plannedRoute.embeddedStops) plannedRoute.embeddedStops = [];
      if (!getAllAvailablePlaces().some(item => item.id === p.id)) {
        plannedRoute.embeddedStops.push(p);
      }
      const isLoop = plannedRoute.routeType === 'loop';
      const inserted = insertStopAtBestPosition(getRouteOriginPoint(), currentPlaces, p, {
        returnToOrigin: isLoop,
        visitedStopIds: confirmedStopIds,
        currentPosition: (active || demo) && lastFix ? lastFix : null,
      });
      plannedRoute.selectedPlaceIds = inserted.map(item => item.id);
      lastRoutedGeometry = null;
      closePlaceDetail();
      recalculateRemainingRoute(`➕ Zastávka „${p.title}“ vložena na nejvhodnější místo po cestě.`);
      playStampChord(stateObj.soundEnabled);
    });

    // 2B. Bod NENÍ v trase -> [ 🏁 Nastavit jako nový konec trasy ]
    $('btn-p3-set-end')?.addEventListener('click', () => {
      if (!plannedRoute.embeddedStops) plannedRoute.embeddedStops = [];
      if (!getAllAvailablePlaces().some(item => item.id === p.id)) {
        plannedRoute.embeddedStops.push(p);
      }
      plannedRoute.routeType = 'oneway';
      phase1EndMode = 'custom';
      const others = getPlannedPlaces().filter(item => item.id !== p.id);
      const orderedOthers = others.length >= 2
        ? optimizeRouteOrder(getRouteOriginPoint(), others, {
            returnToOrigin: false,
            visitedStopIds: confirmedStopIds,
            currentPosition: (active || demo) && lastFix ? lastFix : null,
          })
        : others;
      plannedRoute.selectedPlaceIds = [...orderedOthers.map(item => item.id), p.id];
      lastRoutedGeometry = null;
      closePlaceDetail();
      recalculateRemainingRoute(`🏁 Nový konec trasy nastaven na: ${p.title}.`);
      playStampChord(stateObj.soundEnabled);
    });
  }

  function closePlaceDetail() {
    selectedDetailPlace = null;
    const sheet = $('place-detail-sheet');
    if (sheet) sheet.hidden = true;
  }

  function renderNextCheckpointHero(pos = lastFix || telemetry.lastKnownPosition) {
    const heroCard = $('next-checkpoint-hero-card');
    if (!heroCard) return;

    const plannedPlaces = getPlannedPlaces();
    const curPos = pos || getRouteOriginPoint();

    if (plannedPlaces.length === 0) {
      heroCard.hidden = true;
      heroCard.innerHTML = '';
      return;
    }
    heroCard.hidden = false;

    const unvisited = plannedPlaces.filter(p => !isStopVisited(p));
    if (unvisited.length === 0) {
      heroCard.innerHTML = `
        <div class="hero-card-inner hero-complete">
          <div class="hero-card-main">
            <span class="hero-card-badge completed">🎉 Všechny cíle splněny!</span>
            <strong class="hero-card-title">Úspěšně jsi navštívil všech ${plannedPlaces.length} zastávek na trase!</strong>
            <span class="hero-card-sub">Výborná práce! Můžeš se vrátit na start nebo pokračovat v objevování okolí.</span>
          </div>
          <div class="hero-card-actions">
            <button type="button" class="button small primary" id="btn-hero-return-start">🏠 Navést zpět na start</button>
          </div>
        </div>
      `;
      $('btn-hero-return-start')?.addEventListener('click', () => {
        $('btn-return-to-start')?.click();
      });
      return;
    }

    const nextStop = unvisited[0];
    const stopIdx = plannedPlaces.findIndex(p => p.id === nextStop.id);
    const distM = curPos ? haversineMeters(curPos, nextStop) : null;
    const distStr = formatDistanceLabel(distM);
    const speedKmH = getCompanionSpeedKmH(stateObj.companionMode);
    const mins = distM != null ? Math.max(1, Math.round((distM / 1000) / speedKmH * 60)) : null;

    let dirName = 've směru chůze';
    if (curPos && Number.isFinite(curPos.lat) && Number.isFinite(curPos.lng)) {
      const dLng = (nextStop.lng - curPos.lng) * Math.PI / 180;
      const lat1 = curPos.lat * Math.PI / 180;
      const lat2 = nextStop.lat * Math.PI / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      const brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      const dirs = ['↑ sever', '↗ SV', '→ východ', '↘ JV', '↓ jih', '↙ JZ', '← západ', '↖ SZ'];
      dirName = dirs[Math.round(brg / 45) % 8];
    }

    const kindGlyph = nextStop.kind === 'water' ? '🌊' : nextStop.kind === 'view' ? '⛰️' : nextStop.kind === 'culture' ? '🏰' : '🌲';
    const nextPhoto = getCachedPlacePhoto(nextStop);
    const nextFallback = getFallbackBitmapUrl(nextStop);
    const nextThumbSrc = (nextPhoto && nextPhoto.photoUrl) ? nextPhoto.photoUrl : nextFallback;
    const isNextReal = Boolean(nextPhoto && nextPhoto.photoUrl);

    heroCard.innerHTML = `
      <div class="hero-card-inner hero-active-target">
        <div class="hero-card-thumb-wrap">
          <img
            class="hero-card-thumb-img ${isNextReal ? 'is-real-photo' : 'is-fallback-bitmap'}"
            src="${e(nextThumbSrc)}"
            alt="${e(nextStop.title)}"
            loading="lazy"
            onerror="this.onerror=null;this.src='${e(nextFallback)}';this.classList.remove('is-real-photo');"
          />
        </div>
        <div class="hero-card-target-info">
          <div class="hero-card-step-eyebrow">
            <span>🎯 DALŠÍ CÍL NA TRASE · Zastávka ${stopIdx + 1} z ${plannedPlaces.length}</span>
            <span class="hero-dir-pill">${e(dirName)}</span>
          </div>
          <div class="hero-card-title-row">
            <span class="hero-kind-icon">${kindGlyph}</span>
            <h3 class="hero-checkpoint-name">${e(nextStop.title)}</h3>
          </div>
          <div class="hero-card-stats-chips">
            <span class="hero-stat-chip dist">📏 <strong>${distStr}</strong> od tebe</span>
            ${mins != null ? `<span class="hero-stat-chip time">⏱ ~<strong>${mins} min</strong> pěšky</span>` : ''}
            <span class="hero-stat-chip rule">📍 Potvrdí se pod ${STOP_CONFIRM_RADIUS_M} m</span>
          </div>
        </div>
        <div class="hero-card-actions">
          <button type="button" class="button small lime" id="btn-hero-place-detail" data-place-id="${e(nextStop.id)}">
            ℹ️ Detail místa
          </button>
          <button type="button" class="button small ghost" id="btn-hero-show-map" data-place-id="${e(nextStop.id)}">
            🗺️ Zobrazit na mapě
          </button>
        </div>
      </div>
    `;

    $('btn-hero-place-detail')?.addEventListener('click', () => {
      openPlaceDetail(nextStop);
    });
    $('btn-hero-show-map')?.addEventListener('click', () => {
      if (map) {
        follow = false;
        updateFollowUi();
        map.setView([nextStop.lat, nextStop.lng], Math.max(map.getZoom(), 16));
      }
    });
  }

  function applyGameMode(mode) {
    if (!['explorer', 'gamified', 'casual'].includes(mode)) mode = 'gamified';
    // DÁVKA 1 Bod 3.3: Přepnutím stylu za chůze nikdy nemaž postup a zachovej nezávislá nastavení zvuku a přístupnosti
    appSettings.gameMode = mode;
    stateObj.gameMode = mode;
    if (mode === 'explorer') {
      fogMode = 'full';
      showHikingTrails = appSettings.kctTrails !== false;
      showContourLayer = false;
    } else if (mode === 'casual') {
      fogMode = 'none';
      showHikingTrails = appSettings.kctTrails !== false;
      showContourLayer = appSettings.contours !== false;
    } else {
      // 'gamified'
      fogMode = appSettings.fogParchment === false ? 'none' : 'explore';
      showHikingTrails = appSettings.kctTrails !== false;
      showContourLayer = appSettings.contours !== false;
    }
    root.querySelectorAll('[data-p1-gamemode]').forEach(btn => {
      const isAct = btn.dataset.p1Gamemode === mode;
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
      if (isAct) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      }
    });
    stateObj.appSettings = { ...appSettings };
    saveAppState();
    updateFogToggleLabel();
    scheduleFog();
    syncHikingTrailsLayerState();
    setContourLayer(showContourLayer);
    plannedRouteRenderKey = null;
    renderPlannedRouteOnMap(true);
    renderTripWizardUi();
    renderAppSettingsModalUi();
    renderNextCheckpointHero(lastFix || telemetry.lastKnownPosition);
    playStampChord(stateObj.soundEnabled);
    status(`Herní styl přepnut: ${mode === 'explorer' ? '🧭 Objevování' : mode === 'casual' ? '🗺️ Turistická mapa' : '📜 Výprava s pergamenem'}.`);
  }

  const SETTINGS_ITEMS = [
    { key: 'showExternalPhotos', icon: '🖼️', title: '🖼️ Zobrazovat externí fotografie míst (Wikipedie)', desc: 'Zobrazovat externí fotografie z Wikipedie/Wikimedia Commons se zdrojem a licencí (při vypnutí se používají jen čisté vektorové ilustrace)' },
    { key: 'mindfulnessPrompts', icon: '🍃', title: 'Volitelné výzvy všímavosti na cestě', desc: 'Jemné pozorovací tipy k zastavení v terénu (lze kdykoliv jedním klepnutím přeskočit nebo zde trvale vypnout)' },
    { key: 'fogParchment', icon: '📜', title: 'Tajemný pergamen (odkrývání mlhy)', desc: 'Postupné odkrývání krajiny tam, kudy skutečně projdeš' },
    { key: 'kctTrails', icon: '🥾', title: 'Turistické značky KČT a stezky', desc: 'Červené, modré, zelené a žluté pěší trasy z dat OpenStreetMap' },
    { key: 'contours', icon: '⛰️', title: 'Vrstevnice a terén', desc: 'Zobrazení výškového reliéfu a kopců na mapě' },
    { key: 'footprints', icon: '👣', title: 'Stopy pohorek za mnou', desc: 'Střídavé otisky bot ve směru tvé chůze, které za tebou pomalu blednou' },
    { key: 'orbitalArrow', icon: '🎯', title: 'Zlatá směrová šipka u Avatara', desc: 'Šipka obíhající postavičku ukazující směr k další zastávce' },
    { key: 'voiceNav', icon: '🗣️', title: 'Česká hlasová navigace', desc: 'Hlasové hlášení odboček a cílů v českém jazyce' },
    { key: 'soundFx', icon: '🔊', title: 'Zvukové efekty a fanfáry', desc: 'Zvuky při potvrzení zastávky, razítku a odškrtnutí cíle' },
    { key: 'keepAwake', icon: '📱', title: 'Držet rozsvícený displej', desc: 'Zabrání zhasnutí obrazovky při chůzi v terénu' },
    { key: 'autoSortStops', icon: '🔄', title: 'Chytré řazení zastávek', desc: 'Automatické seřazení cílů podle pěších mostů a stezek' },
  ];

  function renderAppSettingsModalUi() {
    const listEl = $('walk-settings-pills-list');
    if (!listEl) return;

    root.querySelectorAll('[data-modal-game-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.modalGameMode === appSettings.gameMode);
    });

    listEl.innerHTML = SETTINGS_ITEMS.map(item => {
      const isEnabled = appSettings[item.key] !== false;
      return `
        <div class="settings-pill-row">
          <div class="settings-pill-info">
            <span class="settings-pill-icon">${item.icon}</span>
            <div class="settings-pill-texts">
              <strong>${e(item.title)}</strong>
              <small>${e(item.desc)}</small>
            </div>
          </div>
          <div class="settings-pill-buttons" role="group" aria-label="${e(item.title)}">
            <button type="button" class="settings-pill-btn btn-on ${isEnabled ? 'selected' : ''}" data-pill-key="${item.key}" data-pill-val="1">
              ✓ Zapnuto
            </button>
            <button type="button" class="settings-pill-btn btn-off ${!isEnabled ? 'selected' : ''}" data-pill-key="${item.key}" data-pill-val="0">
              Vypnuto
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateGpsTelemetryUi(fix = lastFix, pausedByAccuracy = false) {
    const gpsBadge = $('gps-accuracy-badge');
    const fogBadge = $('fog-radius-badge');
    const accBanner = $('walk-accuracy-banner');

    if (fogBadge) {
      fogBadge.innerHTML = `🗺️ Dosah odkrývání: <strong>${FOG_REVEAL_RADIUS_M} m</strong>`;
    }

    if (!gpsBadge) return;

    if (gpsBrowseOnlyMode) {
      gpsBadge.className = 'telemetry-pill gps-pill is-inaccurate';
      gpsBadge.innerHTML = `🗺️ Režim prohlížení mapy (poloha GPS není povolena)`;
      if (accBanner) {
        accBanner.hidden = false;
        accBanner.innerHTML = `
          <strong>🔒 Přístup k poloze GPS byl zamítnut nebo selhal — jsi v režimu prohlížení mapy.</strong>
          <span>Jak polohu v prohlížeči znovu povolit: klepni na ikonu zámku nebo nastavení webu vlevo u adresního řádku prohlížeče, přepni <strong>Poloha (Location) → Povolit</strong> a poté klikni na tlačítko níže.</span>
          <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="button small primary" id="btn-retry-gps-locate">🔄 Zkusit znovu</button>
          </div>
        `;
        $('btn-retry-gps-locate')?.addEventListener('click', () => {
          gpsBrowseOnlyMode = false;
          if (accBanner) accBanner.hidden = true;
          startUnifiedExpedition();
        });
      }
      return;
    }

    if (walkState === 'locating') {
      gpsBadge.className = 'telemetry-pill gps-pill';
      gpsBadge.innerHTML = `⏳ Hledám polohu GPS (záznam začne po zaměření)…`;
      if (accBanner && (!fix || fix.accuracy <= MAX_GPS_ACCURACY_M)) {
        accBanner.hidden = false;
        accBanner.innerHTML = `
          <strong>⏳ Hledám polohu GPS (záznam začne po zaměření)…</strong>
          <span>Čekáme na platný signál GPS s přesností ≤ ${MAX_GPS_ACCURACY_M} m. Dokud není poloha zaměřena, čas ani ušlé metry se nepřičítají.</span>
        `;
      }
      return;
    }

    if (gpsOutageWarning && telemetry.lastKnownPosition) {
      gpsBadge.className = 'telemetry-pill gps-pill is-inaccurate';
      gpsBadge.innerHTML = `⚠️ Výpadek GPS: zobrazena poslední známá poloha`;
      if (accBanner) {
        accBanner.hidden = false;
        accBanner.innerHTML = `
          <strong>📡 Výpadek signálu GPS — na mapě zůstává zobrazena tvoje poslední známá poloha.</strong>
          <span>Jakmile přijde nové platné měření (≤ ${MAX_GPS_ACCURACY_M} m), sledování a průzkum plynule navážou bez falešné čáry přes neprojité území.</span>
        `;
      }
      return;
    }

    if (!fix || !Number.isFinite(fix.accuracy)) {
      gpsBadge.className = 'telemetry-pill gps-pill';
      gpsBadge.innerHTML = `📡 Nepřesnost GPS: čekám na signál (limit ≤ ${MAX_GPS_ACCURACY_M} m)`;
      if (accBanner) accBanner.hidden = true;
      return;
    }

    const acc = Math.round(fix.accuracy);
    if (acc > MAX_GPS_ACCURACY_M || pausedByAccuracy) {
      gpsBadge.className = 'telemetry-pill gps-pill is-inaccurate';
      gpsBadge.innerHTML = `⚠️ Nepřesnost GPS: <strong>±${acc} m</strong> (limit ${MAX_GPS_ACCURACY_M} m — pozastaveno)`;
      if (accBanner) {
        accBanner.hidden = false;
        accBanner.innerHTML = `
          <strong>⏸ Průzkum je dočasně pozastaven kvůli nepřesné GPS (±${acc} m &gt; ${MAX_GPS_ACCURACY_M} m).</strong>
          <span>Hodnota ±${acc} m vyjadřuje odchylku přijímané polohy, nikoli dosah odkrývání mapy (ten zůstává pevně ${FOG_REVEAL_RADIUS_M} m). Jakmile se signál zpřesní pod ${MAX_GPS_ACCURACY_M} m, odkrývání mapy i potvrzování zastávek automaticky pokračují.</span>
        `;
      }
    } else {
      gpsBadge.className = 'telemetry-pill gps-pill is-accurate';
      gpsBadge.innerHTML = `✓ Přesnost GPS: <strong>±${acc} m</strong> (v normě ≤ ${MAX_GPS_ACCURACY_M} m)`;
      if (accBanner) accBanner.hidden = true;
    }
  }

  function renderCompactTopHud(totalPts, rank) {
    const el = $('compact-top-summary');
    if (!el) return;
    el.innerHTML = `<span>⭐ <strong>${number(totalPts)}</strong> b. · 🗺️ <strong>${number(progress.cells.length)}</strong> dílků · 🏅 Úroveň ${rank.level} · Můj pas →</span>`;
  }

  function goalProgressSuffix() {
    if (!currentExpedition || currentExpedition.state === 'ended' || !currentExpedition.goal) return '';
    const g = currentExpedition.goal;
    if (isGoalAchieved(currentExpedition, progress)) return ` · 🎯 ${g.label}: ✓ splněno`;
    const gainedM = Math.max(0, progress.meters - (currentExpedition.startMeters || 0));
    const gainedC = Math.max(0, progress.cells.length - (currentExpedition.startCells || 0));
    if (g.type === 'meters') return ` · 🎯 ${Math.round(gainedM)} / ${g.target} m`;
    if (g.type === 'cells') return ` · 🎯 ${gainedC} / ${g.target} dílků`;
    return '';
  }

  function stats() {
    const totalPts = totalScore(stateObj);
    const rank = explorerRank(totalPts);

    renderCompactTopHud(totalPts, rank);
    updateGpsTelemetryUi(lastFix);
    renderTouristStatsHud(lastFix);

    const gainedM = currentExpedition ? Math.max(0, progress.meters - currentExpedition.startMeters) : 0;
    const gainedC = currentExpedition ? Math.max(0, progress.cells.length - currentExpedition.startCells) : 0;
    const confirmedCount = getPlannedPlaces().filter(p => isStopVisitedInSession(p)).length;
    const totalStops = getPlannedPlaces().length;

    if ($('walk-session')) {
      const modePrefix = simSandboxActive ? '🧪 Test' : demo ? 'Ukázka' : 'Tato výprava';
      $('walk-session').textContent = `${modePrefix}: ${Math.round(gainedM)} m · ${gainedC} nových dílků · ${confirmedCount}/${totalStops} zastávek${goalProgressSuffix()}`;
    }

    const hasExpedition = Boolean(currentExpedition && currentExpedition.state !== 'ended');
    const isPaused = walkState === 'paused' || (hasExpedition && currentExpedition.state === 'paused');
    const statePill = $('walk-state-pill');

    if (hasExpedition || walkState === 'locating' || walkState === 'running' || walkState === 'paused') {
      if ($('walk-stop')) $('walk-stop').hidden = false;
      if ($('walk-end')) $('walk-end').hidden = false;
      if (walkState === 'locating') {
        const startBtn = $('walk-start');
        if (startBtn) {
          startBtn.textContent = '⏳ Hledám polohu GPS…';
          startBtn.disabled = true;
        }
        if ($('walk-stop')) $('walk-stop').disabled = false;
        if ($('walk-end')) $('walk-end').disabled = false;
        if (statePill) {
          statePill.className = 'telemetry-pill state-running';
          statePill.textContent = '⏳ Hledám polohu GPS (záznam začne po zaměření)…';
        }
      } else if (walkState === 'running' || active) {
        const startBtn = $('walk-start');
        if (startBtn) {
          startBtn.textContent = '▶ Procházka běží';
          startBtn.disabled = true;
        }
        if ($('walk-stop')) $('walk-stop').disabled = false;
        if ($('walk-end')) $('walk-end').disabled = false;
        if (statePill) {
          statePill.className = 'telemetry-pill state-running';
          statePill.textContent = '▶ Procházka běží';
        }
      } else if (isPaused) {
        const startBtn = $('walk-start');
        if (startBtn) {
          startBtn.textContent = '▶ Pokračovat v procházce';
          startBtn.disabled = starting || demo || Boolean(storageError);
        }
        if ($('walk-stop')) $('walk-stop').disabled = true;
        if ($('walk-end')) $('walk-end').disabled = false;
        if (statePill) {
          statePill.className = 'telemetry-pill state-paused';
          statePill.textContent = '⏸ Pozastaveno';
        }
      }
    } else {
      const planned = getPlannedPlaces();
      const startBtn = $('walk-start');
      if (startBtn) {
        if (planned.length > 0) {
          const isLoop = plannedRoute.routeType === 'loop' && planned.length >= 2;
          const routedM = lastRoutedGeometry && !lastRoutedGeometry.isFallback ? lastRoutedGeometry.distanceM : null;
          const est = analyzePlannedRoute(plannedRoute.origin, planned, stateObj.companionMode, {
            returnToOrigin: isLoop,
            routedDistanceM: routedM,
          });
          const km = ((est?.estimatedWalkDistanceM || 0) / 1000).toFixed(1).replace('.', ',');
          startBtn.textContent = `▶ Začít procházku (${planned.length} zastávek · ~${km} km)`;
        } else {
          startBtn.textContent = '▶ Začít procházku';
        }
        startBtn.disabled = active || starting || demo || Boolean(storageError);
      }
      if ($('walk-stop')) {
        $('walk-stop').disabled = true;
        $('walk-stop').hidden = true;
      }
      if ($('walk-end')) {
        $('walk-end').disabled = true;
        $('walk-end').hidden = true;
      }
      if (statePill) {
        statePill.className = 'telemetry-pill state-ready';
        statePill.textContent = storageError ? '⚠️ Uložení se nezdařilo' : (walkState === 'finished' ? '✓ Dokončeno' : '● Připraveno');
      }
    }

    if ($('walk-step')) $('walk-step').hidden = !demo;
    if ($('walk-demo-banner')) $('walk-demo-banner').hidden = !demo;
    if ($('walk-demo')) $('walk-demo').textContent = demo ? 'Ukončit ukázku' : 'Ukázka pohybu';

    renderPlannerBasketAndXray();
    renderPlaces();
    scheduleFog();
    renderTrail();
    renderNextCheckpointHero(lastFix || telemetry.lastKnownPosition);
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
    updateMapActionBar();
  }

  function showPostcardModal(summary) {
    const container = $('session-summary-container');
    if (!container) return;
    const summaryTaskId = beginMapTask('⏳ Připravuji souhrn procházky…');
    let dataUrl = '';
    try {
      dataUrl = generatePostcardDataUrl(summary);
    } finally {
      endMapTask(summaryTaskId);
    }

    container.innerHTML = `
      <div class="session-modal" id="postcard-modal" role="dialog" aria-modal="true" aria-label="Pohlednice z výpravy">
        <div class="session-modal-card" style="max-width:520px;text-align:center;position:relative">
          <button type="button" class="button small ghost" id="btn-close-postcard-x" aria-label="Zavřít pohlednici" style="position:absolute;top:10px;right:10px;padding:4px 10px;min-height:36px;font-weight:800">✕</button>
          <h2 style="padding-right:28px">Výprava úspěšně ukončena! 🎉</h2>
          <p>${simSandboxActive ? 'Testovací výprava v simulátoru byla vyhodnocena (skutečný profil zůstal beze změny).' : 'Tvoje výprava byla zaznamenána do osobního atlasu.'}</p>
          <div class="session-stats-grid" style="margin-bottom:12px">
            <div class="session-stat-box"><strong>${summary.distanceMeters >= 1000 ? (summary.distanceMeters / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(summary.distanceMeters) + ' m'}</strong><span>Ušlá vzdálenost</span></div>
            <div class="session-stat-box"><strong>+${summary.newCellsCount}</strong><span>Nové dílky</span></div>
            <div class="session-stat-box"><strong>+${summary.newStampsCount}</strong><span>Potvrzená místa</span></div>
            <div class="session-stat-box"><strong>${summary.goalAchieved ? '✓ Splněn' : 'Dokončeno'}</strong><span>Stav výpravy</span></div>
          </div>
          <div style="margin:8px 0;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.18);line-height:0">
            <img src="${dataUrl}" alt="Ilustrovaná pohlednice z výpravy" style="width:100%;height:auto;display:block">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px">
            <button type="button" class="button primary" id="btn-download-postcard">Stáhnout pohlednici (PNG)</button>
            <button type="button" class="button" id="btn-share-postcard">Sdílet</button>
            <button type="button" class="button ghost" id="btn-close-postcard">Zavřít</button>
          </div>
        </div>
      </div>
    `;

    const closePostcard = () => {
      container.innerHTML = '';
      playTick(stateObj.soundEnabled);
    };

    $('postcard-modal')?.addEventListener('click', (ev) => {
      if (ev.target === $('postcard-modal') || !ev.target.closest('.session-modal-card')) {
        closePostcard();
      }
    });

    $('btn-download-postcard')?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `pohlednice-${summary.id}.png`;
      a.click();
    });

    $('btn-share-postcard')?.addEventListener('click', async () => {
      try {
        const blob = await generatePostcardBlob(summary);
        const file = new File([blob], `pohlednice-${summary.id}.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'Moje výprava · Czekpoint',
            text: `Moje výprava s Czekpointem.`,
            files: [file],
          });
        } else {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `pohlednice-${summary.id}.png`;
          a.click();
        }
      } catch (err) {
        if (err.name !== 'AbortError') status('Sdílení se nezdařilo.');
      }
    });

    $('btn-close-postcard')?.addEventListener('click', closePostcard);
    $('btn-close-postcard-x')?.addEventListener('click', closePostcard);
  }

  async function releaseWake() {
    if (wake) { const w = wake; wake = null; await w.release().catch(() => {}); }
    if (!disposed && $('wake-status')) $('wake-status').textContent = 'Displej: zámek není aktivní.';
  }

  async function holdWake() {
    if (!active || !$('walk-awake')?.checked) return;
    if (!navigator.wakeLock) {
      if ($('wake-status')) $('wake-status').textContent = 'Telefon neumí držet displej zapnutý.';
      return;
    }
    try {
      const w = await navigator.wakeLock.request('screen');
      if (!active || disposed || !$('walk-awake')?.checked) { await w.release(); return; }
      wake = w;
      if ($('wake-status')) $('wake-status').textContent = 'Displej zůstává zapnutý.';
      w.addEventListener('release', () => {
        if (wake === w) {
          wake = null;
          if (!disposed && $('wake-status')) $('wake-status').textContent = 'Telefon uvolnil zámek displeje.';
        }
      });
    } catch {
      if (!disposed && $('wake-status')) $('wake-status').textContent = 'Zámek displeje nebyl povolen.';
    }
  }

  function pauseSession(message) {
    active = false;
    starting = false;
    walkState = currentExpedition && currentExpedition.state !== 'ended' ? 'paused' : 'idle';
    if (gpsLocatingTaskId !== null) {
      endMapTask(gpsLocatingTaskId);
      gpsLocatingTaskId = null;
    }
    if (watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; }
    fakeGpsSim?.pause?.();
    anchor = null;
    pendingPlaceStamps = {};
    pendingStopSamples = {};
    telemetry = updateTelemetryTimers(telemetry, Date.now(), false);
    telemetry.currentSpeedKmH = 0;
    if (lastFix) {
      memoryTrail = appendTrail(memoryTrail, { lat: lastFix.lat, lng: lastFix.lng, segmentBreak: true }, Date.now());
    }
    releaseWake();
    pauseBackgroundTracking();
    releaseLock?.(); releaseLock = null;

    let saveFailedMsg = '';
    if (currentExpedition && currentExpedition.state === 'active') {
      currentExpedition = pauseExpedition(currentExpedition);
      stateObj.activeExpedition = currentExpedition;
      if (canPersistRealState()) {
        try {
          stateObj = saveState(stateObj);
          storageError = '';
        } catch (err) {
          storageError = err.message;
          saveFailedMsg = `Uložení se nezdařilo: ${err.message}`;
        }
      }
    }

    if (!disposed) {
      updateMapActionBar();
      stats();
      if (saveFailedMsg) status(saveFailedMsg);
      else if (message) status(message);
    }
  }

  function finishUnifiedExpedition() {
    fakeGpsSim?.stopMovement?.();
    phase4MenuOpen = false;
    moreMenuOpen = false;
    if ($('walk-more-menu')) $('walk-more-menu').hidden = true;
    if ($('walk-more-btn')) $('walk-more-btn').setAttribute('aria-expanded', 'false');
    if (gpsLocatingTaskId !== null) {
      endMapTask(gpsLocatingTaskId);
      gpsLocatingTaskId = null;
    }
    if (watch !== null) {
      try { navigator.geolocation?.clearWatch?.(watch); } catch {}
      watch = null;
    }
    stopWatchdog();
    releaseWake();
    stopBackgroundTracking();
    keepAliveCtrl.stop();
    if ($('pocket-mode-overlay')) $('pocket-mode-overlay').hidden = true;
    if ($('arrival-goal-modal')) $('arrival-goal-modal').hidden = true;
    active = false;
    starting = false;
    walkState = 'finished';
    lockedExpeditionOrigin = null;

    if (!currentExpedition) {
      currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
    }

    const gainedM = Math.max(0, progress.meters - (currentExpedition.startMeters || 0));
    const gainedC = Math.max(0, progress.cells.length - (currentExpedition.startCells || 0));
    const gainedS = Math.max(0, progress.discoveries.length - (currentExpedition.startDiscoveries || 0));
    const earnedPoints = expeditionPointsDelta(currentExpedition, progress);

    // 6.1 Uložíme do dat pohlednice pole navštívených míst včetně jejich fotek/obrázků (visitedPlacesWithPhotos)
    const allKnownPlaces = getAllAvailablePlaces();
    const plannedPlaces = getPlannedPlaces();
    const visitedIdsList = [
      ...new Set([
        ...confirmedStopIds,
        ...(currentExpedition.visitedPlaces || []).map(v => v.id || v),
        ...plannedPlaces.filter(p => isStopVisited(p)).map(p => p.id),
      ]),
    ];
    const visitedSourcePlaces = visitedIdsList
      .map(id => allKnownPlaces.find(p => p.id === id) || plannedPlaces.find(p => p.id === id))
      .filter(Boolean);
    const fallbackVisitedPlaces = visitedSourcePlaces.length > 0 ? visitedSourcePlaces : plannedPlaces.slice(0, 4);
    const visitedPlacesWithPhotos = fallbackVisitedPlaces.map(p => {
      const photoInfo = getPlacePhotoSync(p);
      return {
        id: p.id,
        title: p.title,
        kind: p.kind || 'forest',
        category: p.category || 'nature',
        photoUrl: photoInfo.photoUrl,
        isRealPhoto: photoInfo.isRealPhoto,
      };
    });

    let endResult = null;
    try {
      endResult = endExpedition({
        expedition: currentExpedition,
        currentProgress: progress,
        pointsEarned: earnedPoints,
        avatarId: stateObj.profile?.avatarId || 'liska',
      });
    } catch {}

    const baseSummary = endResult?.summary || {
      id: currentExpedition.id,
      date: new Date().toISOString(),
      distanceMeters: gainedM,
      cellsCount: gainedC,
      stampsCount: gainedS,
      newCellsCount: gainedC,
      newStampsCount: gainedS,
      durationMs: Math.max(60000, Date.now() - (currentExpedition.createdAt || Date.now())),
      activeDurationMs: Math.max(60000, Date.now() - (currentExpedition.createdAt || Date.now())),
      pointsEarned: earnedPoints || 10,
      goal: currentExpedition.goal || DEFAULT_GOALS[0],
      avatarId: stateObj.profile?.avatarId || 'liska',
      companionMode: 'solo',
    };

    const summary = {
      ...baseSummary,
      visitedPlacesWithPhotos,
      elevationGainM: currentElevationProfile?.gainM || 0,
      trailCoordinates: memoryTrail.length >= 2
        ? memoryTrail.filter(pt => pt && Number.isFinite(pt.lat)).map(pt => [pt.lat, pt.lng])
        : (plannedRouteCoords || []),
    };

    const prevStateSnapshot = { ...stateObj };
    const prevExpeditionSnapshot = currentExpedition;
    const history = [summary, ...(stateObj.expeditionHistory || [])].slice(0, 100);

    const badge = createStickBadge({
      expId: currentExpedition.id,
      distanceMeters: gainedM,
      stampsCount: gainedS,
      companionMode: 'solo',
      categories: currentExpedition.categories || [],
    });
    stateObj.stickBadges = [badge, ...(stateObj.stickBadges || [])].slice(0, 200);

    stateObj = {
      ...stateObj,
      activeExpedition: null,
      expeditionHistory: history,
      walkSegments: progress.walkSegments,
      revealedFeatures: progress.revealedFeatures,
    };
    currentExpedition = null;

    if (canPersistRealState()) {
      try {
        stateObj = saveState(stateObj);
        storageError = '';
      } catch (err) {
        stateObj = prevStateSnapshot;
        currentExpedition = prevExpeditionSnapshot;
        storageError = err.message;
        stats();
        status('Uložení se nezdařilo: ' + err.message);
        return;
      }
    }

    if (gainedM > 0 || gainedS > 0) {
      playStampChord(stateObj.soundEnabled);
    }
    updateMapActionBar();
    updateTopBarUi();
    stats();
    const statePill = $('walk-state-pill');
    if (statePill) {
      statePill.className = 'telemetry-pill state-ready';
      statePill.textContent = simSandboxActive ? '🧪 Simulace dokončena' : '✓ Výprava uložena';
    }
    status(simSandboxActive ? 'Testovací výprava v simulátoru ukončena.' : 'Výprava byla úspěšně uložena.');
    showPostcardModal(summary);
  }
  const finishExpedition = finishUnifiedExpedition;

  function shortenRouteToStart() {
    moreMenuOpen = false;
    if ($('walk-more-menu')) $('walk-more-menu').hidden = true;
    if ($('walk-more-btn')) $('walk-more-btn').setAttribute('aria-expanded', 'false');
    const curPos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    if (!curPos) return;
    const startOrigin = getRouteOriginPoint();
    const returnStopId = 'return-to-start-stop';
    const returnStopObj = {
      id: returnStopId,
      title: `Cíl: ${startOrigin.label || 'Návrat na start'}`,
      lat: startOrigin.lat,
      lng: startOrigin.lng,
      kind: 'route-start',
      category: 'nature',
      pointKind: 'route-start',
    };
    plannedRoute.embeddedStops = [
      ...(plannedRoute.embeddedStops || []).filter(item => item.id !== returnStopId),
      returnStopObj,
    ];
    const visitedIds = (plannedRoute.selectedPlaceIds || []).filter(id => confirmedStopIds.has(id));
    plannedRoute.selectedPlaceIds = [...visitedIds, returnStopId];
    plannedRoute.routeType = 'oneway';
    lastRoutedGeometry = null;
    recalculateRemainingRoute('🏠 Trasa zkrácena: zbývající zastávky vyškrtnuty, navádím rovnou na start.');
    playStampChord(stateObj.soundEnabled);
  }

  function togglePauseUnified() {
    if (walkState === 'locating') {
      // Pokud jsme čekali na polohu a uživatel dal Pauzu, přejdeme do paused
      walkState = 'paused';
      starting = false;
      active = false;
      if (gpsLocatingTaskId !== null) {
        endMapTask(gpsLocatingTaskId);
        gpsLocatingTaskId = null;
      }
      if (watch !== null) {
        try { navigator.geolocation?.clearWatch?.(watch); } catch {}
        watch = null;
      }
      fakeGpsSim?.pause?.();
      if (currentExpedition && currentExpedition.state === 'active') {
        currentExpedition = pauseExpedition(currentExpedition);
        stateObj.activeExpedition = currentExpedition;
      }
      updateMapActionBar();
      updateTopBarUi();
      stats();
      status('⏸ Výprava pozastavena.');
      playTick(stateObj.soundEnabled);
      return;
    }

    if (!currentExpedition) return;
    if (walkState === 'paused' || currentExpedition.state === 'paused') {
      currentExpedition = resumeExpedition(currentExpedition);
      stateObj.activeExpedition = currentExpedition;
      telemetry.lastTickMs = Date.now();
      anchor = null;
      if (simSandboxActive || demo || lastAcceptedFix) {
        walkState = 'running';
        active = true;
        starting = false;
      } else {
        walkState = 'locating';
        starting = true;
        active = false;
        if (gpsLocatingTaskId === null) {
          gpsLocatingTaskId = beginMapTask('⏳ Čekám na polohu GPS…');
        }
      }
      if (simSandboxActive) {
        fakeGpsSim?.resume?.();
      } else {
        restartGpsWatch();
      }
      startBackgroundTracking({
        title: 'Výprava pokračuje · Czekpoint',
        artist: 'Czekpoint · Objevování a mapa',
        album: 'Záznam chůze i při zhasnutém displeji',
        onPause: () => { togglePauseUnified(); },
        onResume: () => { togglePauseUnified(); },
        onStop: () => { finishUnifiedExpedition(); },
      });
      status(walkState === 'locating'
        ? '⏳ Hledám polohu GPS (záznam začne po zaměření)…'
        : '▶ Výprava pokračuje (záznam běží i při zhasnutém displeji).');
    } else {
      walkState = 'paused';
      active = false;
      starting = false;
      anchor = null;
      pendingPlaceStamps = {};
      pendingStopSamples = {};
      if (gpsLocatingTaskId !== null) {
        endMapTask(gpsLocatingTaskId);
        gpsLocatingTaskId = null;
      }
      if (watch !== null) {
        try { navigator.geolocation?.clearWatch?.(watch); } catch {}
        watch = null;
      }
      telemetry = updateTelemetryTimers(telemetry, Date.now(), false);
      telemetry.currentSpeedKmH = 0;
      currentExpedition = pauseExpedition(currentExpedition);
      stateObj.activeExpedition = currentExpedition;
      fakeGpsSim?.pause?.();
      pauseBackgroundTracking();
      status('⏸ Výprava pozastavena. Průzkum je uložený.');
    }
    if (canPersistRealState()) {
      try { stateObj = saveState(stateObj); } catch {}
    }
    updateMapActionBar();
    updateTopBarUi();
    stats();
    playTick(stateObj.soundEnabled);
  }

  let watchdogTimer = null;
  let lastFixReceivedAt = 0;

  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function startWatchdog() {
    stopWatchdog();
    watchdogTimer = setInterval(() => {
      if ((walkState !== 'running' && walkState !== 'locating') || disposed || demo || simSandboxActive) return;
      if (Date.now() - lastFixReceivedAt > GPS_OUTAGE_WARNING_MS) {
        gpsOutageWarning = true;
        anchor = null; // přerušíme úsek po výpadku, aby se nespojila místa čarou
        updateGpsTelemetryUi(lastFix);
        restartGpsWatch();
      }
    }, 10000);
  }

  function handleGpsFix(coords) {
    if (disposed) return;

    // DÁVKA 1 (Bod 2.3): Nepropustná Pauza — ve stavu 'paused' nesmí příchod reálného ani simulovaného vzorku
    // obnovit procházku ani přičíst metry, aktivní čas, buňky mlhy či místa!
    if (walkState === 'paused' || (currentExpedition && currentExpedition.state === 'paused')) {
      return;
    }

    lastFixReceivedAt = Date.now();
    gpsOutageWarning = false;
    gpsBrowseOnlyMode = false;

    if (!coords || !Number.isFinite(Number(coords.lat)) || !Number.isFinite(Number(coords.lng)) || coords.accuracy > 500) {
      return;
    }

    const now = Date.now();
    const fixTime = Number.isFinite(Number(coords.timestamp)) && Number(coords.timestamp) > 0
      ? Number(coords.timestamp)
      : now;

    const cleanFix = {
      lat: Number(coords.lat),
      lng: Number(coords.lng),
      accuracy: Math.max(1, Number(coords.accuracy) || 10),
      altitude: Number.isFinite(coords.altitude) ? Number(coords.altitude) : null,
      timestamp: fixTime,
      speed: Number.isFinite(coords.speed) ? Number(coords.speed) : null,
      simulated: Boolean(coords.simulated),
    };

    // DÁVKA 1 (Bod 3.2): Kompletní validace vzorku GPS podle 4 kritérií před přijetím do lastAcceptedFix:
    // (a) platné číselné souřadnice, (b) časová následnost (timestamp), (c) přesnost <= 40 m, (d) přiměřená rychlost posunu vůči času.
    const validation = validateGpsSample(cleanFix, lastAcceptedFix, coords.simulated ? fixTime : now);

    if (!validation.valid) {
      // Nepřesný vzorek (> 40 m, např. ±55 m) pouze upraví poloměr kruhu nejistoty accuracyRing,
      // ale nemění start, nepotvrzuje místa a nepřičítá metry!
      if (validation.failedCriterion === 'accuracy') {
        if (accuracyRing) {
          if (lastAcceptedFix) {
            accuracyRing.setLatLng([lastAcceptedFix.lat, lastAcceptedFix.lng]);
          } else {
            accuracyRing.setLatLng([cleanFix.lat, cleanFix.lng]);
          }
          accuracyRing.setRadius(cleanFix.accuracy);
        }
        updateGpsTelemetryUi(cleanFix, true);
        status(validation.reason);
      } else if (validation.failedCriterion === 'speed') {
        // Nereálný GPS teleport odfiltrujeme a přerušíme anchor
        anchor = null;
        status(validation.reason);
      }
      return;
    }

    // Vzorek prošel všemi 4 kritérii -> uložíme do lastAcceptedFix
    lastAcceptedFix = cleanFix;
    lastFix = cleanFix;

    // Pokud jsme byli ve stavu 'locating' (čekání na první platnou GPS polohu),
    // TEPRVE NYNÍ přecházíme do stavu 'running' a spouštíme záznam času a metrů!
    if (walkState === 'locating') {
      if (gpsLocatingTaskId !== null) {
        endMapTask(gpsLocatingTaskId);
        gpsLocatingTaskId = null;
      }
      walkState = 'running';
      starting = false;
      active = true;
      telemetry.lastTickMs = Date.now();
      if (!lockedExpeditionOrigin) {
        lockedExpeditionOrigin = plannedRoute.origin
          ? { ...plannedRoute.origin }
          : { id: 'start-gps', label: 'Místo startu', lat: cleanFix.lat, lng: cleanFix.lng };
      }
      updateMapActionBar();
      updateTopBarUi();
    }

    if (!active && walkState === 'idle' && !lockedExpeditionOrigin && !userExplicitlyPickedOrigin) {
      const prev = plannedRoute.origin;
      const isUnset = !prev || prev.id === 'namesti' || prev.id === 'my-gps';
      if (isUnset || (haversineMeters(prev, cleanFix) ?? 0) > 40) {
        plannedRoute.origin = {
          id: 'my-gps',
          label: 'Moje aktuální GPS poloha',
          lat: cleanFix.lat,
          lng: cleanFix.lng,
        };
        const origLabel = $('wiz-active-origin-label');
        if (origLabel) origLabel.textContent = 'Moje aktuální GPS poloha';
      }
    }

    if (map && player && accuracyRing) {
      const isHiddenOrPocket = (typeof document !== 'undefined' && document.hidden) || ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden);
      if (isHiddenOrPocket) {
        setPlayerMarkerVisible(true);
        updatePlayerAvatarIcon(walkState === 'running');
        player.setLatLng([cleanFix.lat, cleanFix.lng]);
        accuracyRing.setLatLng([cleanFix.lat, cleanFix.lng]);
        if (follow) {
          centerMapOnPlayer(cleanFix, false);
        }
      } else {
        smoothMovePlayerTo(cleanFix.lat, cleanFix.lng, coords.simulated ? 420 : 1100);
      }
      accuracyRing.setRadius(cleanFix.accuracy);
    }

    updateGpsTelemetryUi(cleanFix);
    renderCompass(cleanFix);
    refreshWeatherStrip(cleanFix);
    updateTurnNavPill(cleanFix);

    if (walkState === 'running' || demo) {
      sample(cleanFix, coords.simulated ? fixTime : now);
      if (walkState === 'running' && !coords.simulated) {
        const gainedM = currentExpedition ? Math.max(0, progress.meters - (currentExpedition.startMeters || 0)) : progress.meters;
        const durMin = Math.max(1, Math.round((Date.now() - (currentExpedition?.createdAt || Date.now())) / 60000));
        const plannedPlaces = getPlannedPlaces();
        const nextTarget = plannedPlaces.find(p => !isStopVisited(p));
        const nextTitle = nextTarget ? ` · Cíl: ${nextTarget.title}` : '';
        updateBackgroundTracking({
          title: `👣 ${Math.round(gainedM)} m (${durMin} min)${nextTitle}`,
          album: 'Czekpoint · Záznam běží i při zhasnutém displeji',
        });
      }
    } else {
      renderQuestHud(cleanFix);
    }
  }

  function onGeolocationError(error) {
    if (disposed) return;
    if (gpsLocatingTaskId !== null) {
      endMapTask(gpsLocatingTaskId);
      gpsLocatingTaskId = null;
    }
    if (error && error.code === 1) {
      // PERMISSION_DENIED -> přepnout do režimu pouhého prohlížení mapy a zobrazit návod + tlačítko Zkusit znovu
      gpsBrowseOnlyMode = true;
      walkState = 'idle';
      active = false;
      starting = false;
      if (watch !== null) {
        try { navigator.geolocation?.clearWatch?.(watch); } catch {}
        watch = null;
      }
      stopWatchdog();
      releaseWake();
      pauseBackgroundTracking();
      updateGpsTelemetryUi(lastFix);
      updateMapActionBar();
      updateTopBarUi();
      stats();
      status('🔒 Přístup k poloze GPS byl zamítnut. Jsi v režimu prohlížení mapy — povol polohu v prohlížeči a klikni na „Zkusit znovu“.');
    } else if (walkState === 'locating') {
      // Pokud selhalo prvotní zaměření polohy (timeout / nedostupnost), přepneme do režimu prohlížení mapy s možností Zkusit znovu
      gpsBrowseOnlyMode = true;
      walkState = 'idle';
      active = false;
      starting = false;
      updateGpsTelemetryUi(lastFix);
      updateMapActionBar();
      updateTopBarUi();
      stats();
      status('⚠️ Polohu GPS se nepodařilo zaměřit. Jsi v režimu prohlížení mapy — můžeš to zkusit znovu nebo použít simulátor.');
    } else {
      anchor = null;
      pendingPlaceStamps = {};
      pendingStopSamples = {};
      gpsOutageWarning = true;
      updateGpsTelemetryUi(lastFix);
      status('Hledám polohu… GPS signál má výpadek (zobrazena poslední známá poloha).');
    }
  }

  function restartGpsWatch() {
    if (watch !== null) {
      navigator.geolocation.clearWatch(watch);
      watch = null;
    }
    if (!navigator.geolocation || disposed || (walkState !== 'running' && walkState !== 'locating') || simSandboxActive) return;

    navigator.geolocation.getCurrentPosition(
      p => handleGpsFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        altitude: p.coords.altitude,
        speed: p.coords.speed,
        timestamp: p.timestamp,
        simulated: false,
      }),
      error => onGeolocationError(error),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    watch = navigator.geolocation.watchPosition(
      p => handleGpsFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        altitude: p.coords.altitude,
        speed: p.coords.speed,
        timestamp: p.timestamp,
        simulated: false,
      }),
      error => onGeolocationError(error),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
  }

  /**
   * Jednotný průběh průzkumu pro skutečnou chůzi i autopilota (Body 7, 8, 16, 19, 28, 30, 31, 32):
   * přijatá poloha -> odkrytí území a přírodních objektů -> potvrzení zastávek (< 20 m) -> překreslení mapy -> uložení.
   */
  function showArrivalGoalModal() {
    const modal = $('arrival-goal-modal');
    if (!modal) return;
    modal.hidden = false;
    triggerPocketProximityAlert('stamp');
  }

  function sample(fix, now = Date.now()) {
    if (disposed || (walkState !== 'running' && !demo)) return;
    if (walkState === 'paused' || (currentExpedition && currentExpedition.state === 'paused')) return;

    // 8.3 Background Gap Recovery: Pokud v kapse vznikla mezera > 12 s (do 3 km rychlostí <= 3.5 m/s),
    // dopočítáme body podél naplánované trasy, odkryjeme mlhu, přičteme metry a uznáme zastávky!
    if (lastSampledFix && !fix.interpolated && (now - lastSampledFix.ts) > 12000 && fix.accuracy <= MAX_GPS_ACCURACY_M) {
      const gapRes = interpolateBackgroundGap({
        prevFix: lastSampledFix,
        nextFix: { lat: fix.lat, lng: fix.lng, ts: now },
        plannedCoords: plannedRouteCoords || [],
      });
      if (gapRes.recovered && gapRes.points.length > 1) {
        for (let i = 0; i < gapRes.points.length - 1; i++) {
          const pt = gapRes.points[i];
          const stepRes = acceptFix(progress, anchor, { lat: pt.lat, lng: pt.lng, accuracy: 12, simulated: fix.simulated, interpolated: true }, pt.ts);
          anchor = stepRes.anchor;
          if (stepRes.accepted) {
            progress = {
              ...progress,
              cells: stepRes.progress.cells,
              meters: stepRes.progress.meters,
              walkSegments: stepRes.progress.walkSegments || progress.walkSegments,
            };
          }
          const plannedForGap = getPlannedPlaces();
          if (plannedForGap.length > 0) {
            for (const sp of plannedForGap) {
              if (!confirmedStopIds.has(sp.id) && (haversineMeters(pt, sp) ?? Infinity) <= 35) {
                confirmedStopIds.add(sp.id);
                if (currentExpedition) {
                  currentExpedition = recordExpeditionVisit(currentExpedition, sp);
                  stateObj.activeExpedition = currentExpedition;
                }
              }
            }
          }
        }
      }
    }
    if (fix.accuracy <= MAX_GPS_ACCURACY_M) {
      lastSampledFix = { lat: fix.lat, lng: fix.lng, ts: now };
    }

    const result = acceptFix(progress, anchor, fix, now);
    anchor = result.anchor;

    telemetry = updateTelemetryFromFix(telemetry, fix, result, now);
    updateGpsTelemetryUi(fix, Boolean(result.pausedByAccuracy));

    if (!result.eligibleForVisit) {
      pendingPlaceStamps = {};
      pendingStopSamples = {};
    }

    const validFix = result.eligibleForVisit ? (result.anchor?.lastValidFix || fix) : null;
    let stateChanged = false;

    if (validFix && fix.accuracy <= MAX_GPS_ACCURACY_M) {
      memoryTrail = appendTrail(memoryTrail, validFix, now);

      const natEval = evaluateNaturalFeatureReveals(validFix, progress.revealedFeatures, BUILTIN_NATURAL_FEATURES);
      activeLocalReveals = natEval.activeLocalReveals || [];
      if (natEval.newlyRevealedFeatures.length > 0) {
        stateChanged = true;
        progress = {
          ...progress,
          revealedFeatures: natEval.revealedFeatureIds,
        };
        stateObj.revealedFeatures = progress.revealedFeatures;
        const pondNames = natEval.newlyRevealedFeatures.map(f => f.title).join(', ');
        status(`💧 Odhalena celá vodní plocha: ${pondNames}.`);
      }

      // 8.4 Vibrace v kapse, zaznamenání poblíž (dle GPS) a zvuk při přiblížení k zastávce (< 35 m)
      const plannedPlaces = getPlannedPlaces();
      if (plannedPlaces.length > 0) {
        for (const sp of plannedPlaces) {
          const dToStop = haversineMeters(validFix, sp) ?? Infinity;
          if (!confirmedStopIds.has(sp.id) && dToStop <= NEARBY_RECORD_RADIUS_M) {
            nearbyRecordedIds.add(sp.id);
          }
          if (!confirmedStopIds.has(sp.id) && !alertedProximityStopIds.has(sp.id)) {
            if (dToStop < 35) {
              alertedProximityStopIds.add(sp.id);
              triggerPocketProximityAlert('proximity');
            }
          }
        }

        const stopEval = evaluateStopConfirmation(validFix, plannedPlaces, pendingStopSamples, confirmedStopIds, now);
        if (stopEval.newlyConfirmedIds.length > 0) {
          stateChanged = true;
          for (const stopId of stopEval.newlyConfirmedIds) {
            confirmedStopIds.add(stopId);
            justConfirmedStopId = stopId;
            const stopPlace = plannedPlaces.find(p => p.id === stopId);
            if (stopPlace) {
              if (currentExpedition) {
                currentExpedition = recordExpeditionVisit(currentExpedition, stopPlace);
                stateObj.activeExpedition = currentExpedition;
              }
              if (stopPlace.collectible !== false && !hasLifetimeStamp(stopPlace)) {
                progress = {
                  ...progress,
                  discoveries: [...progress.discoveries, stopId],
                };
                stateObj = recordSummitEntry(stateObj, stopId);
              }
            }
          }
          stateObj.confirmedStopIds = [...confirmedStopIds];
          stateObj.discoveries = progress.discoveries;

          playStampChord(stateObj.soundEnabled);
          triggerPocketProximityAlert('stamp');

          const confirmedNames = stopEval.newlyConfirmedStops.map(s => s.title).join(', ');
          const nextStop = getPlannedPlaces().find(p => !isStopVisitedInSession(p));
          speakCzechNav(
            nextStop
              ? `Potvrzeno podle GPS: ${confirmedNames}. Další zastávka: ${nextStop.title}.`
              : `Potvrzeno podle GPS: ${confirmedNames}. Jsi v cíli své trasy!`,
            `stamp:${stopEval.newlyConfirmedIds.join(',')}`
          );
          status(
            nextStop
              ? `📍 Potvrzeno podle GPS (≤ ${STOP_CONFIRM_RADIUS_M} m): ${confirmedNames}. Další cíl: ${nextStop.title}.`
              : `🎉 Jsi v cíli své trasy — 📍 Potvrzeno podle GPS (${confirmedNames})!`
          );

          // 1.2 Krok 4: Jakmile uživatel během výpravy projde posledním vybraným bodem trasy (dosažen cíl),
          // automaticky zobrazíme velké, přehledné dialogové okno!
          if (!nextStop) {
            const routeFinishKey = plannedPlaces.map(p => p.id).join(',');
            if (arrivalGoalPromptShownForKey !== routeFinishKey) {
              arrivalGoalPromptShownForKey = routeFinishKey;
              showArrivalGoalModal();
            }
          }
        }
      }

      // 3. Kontrola GPS razítek pro všechna místa v katalogu/okolí
      const allPlaces = getAllAvailablePlaces();
      const stampedProgress = discoverNearby(progress, validFix, allPlaces, pendingPlaceStamps);

      if (stampedProgress.discoveries.length > progress.discoveries.length) {
        stateChanged = true;
        const addedCount = stampedProgress.discoveries.length - progress.discoveries.length;
        const newStampIds = stampedProgress.discoveries.filter(id => !progress.discoveries.includes(id));
        for (const newId of newStampIds) {
          stateObj = recordSummitEntry(stateObj, newId);
          confirmedStopIds.add(newId);
          const foundPlace = allPlaces.find(p => p.id === newId);
          if (foundPlace && currentExpedition) {
            currentExpedition = recordExpeditionVisit(currentExpedition, foundPlace);
            stateObj.activeExpedition = currentExpedition;
          }
        }
        playStampChord(stateObj.soundEnabled);
        progress = { ...progress, discoveries: stampedProgress.discoveries };
        stateObj = { ...stateObj, discoveries: progress.discoveries, confirmedStopIds: [...confirmedStopIds] };
        status(`🏆 Získáno GPS razítko ověřeného místa! +${addedCount * 30} bodů.`);
      }

      // 4. Radar upozornění
      if (stateObj.explorationMode === 'radar') {
        const plannedIds = plannedRoute.selectedPlaceIds || [];
        const nearbyUnplanned = allPlaces.find(p => {
          if (!p.collectible || plannedIds.includes(p.id) || isStopVisitedInSession(p)) return false;
          const d = haversineMeters(validFix, p);
          return d != null && d <= 150;
        });

        if (nearbyUnplanned && nearbyUnplanned.id !== lastRadarAlertId) {
          lastRadarAlertId = nearbyUnplanned.id;
          playRadar(stateObj.soundEnabled);
          const banner = $('walk-radar-banner');
          if (banner) {
            banner.hidden = false;
            banner.innerHTML = `
              <span>📡 <strong>Radar poblíž:</strong> ${e(nearbyUnplanned.title)} je v dosahu cca ${Math.round(haversineMeters(validFix, nearbyUnplanned))} m!</span>
              <button type="button" class="button small lime add-radar-place-btn" data-place-id="${e(nearbyUnplanned.id)}">+ Přidat do trasy</button>
            `;
          }
        }
      }
    }

    if (result.accepted) {
      stateChanged = true;
      progress = {
        ...progress,
        cells: result.progress.cells,
        meters: result.progress.meters,
        walkSegments: result.progress.walkSegments || progress.walkSegments,
        revealedFeatures: progress.revealedFeatures,
      };
      stateObj = {
        ...stateObj,
        cells: progress.cells,
        meters: progress.meters,
        discoveries: progress.discoveries,
        walkSegments: progress.walkSegments,
        revealedFeatures: progress.revealedFeatures,
        confirmedStopIds: [...confirmedStopIds],
      };
    }

    if (stateChanged && canPersistRealState(fix)) {
      try {
        stateObj = saveState(stateObj);
        storageError = '';
      } catch (error) {
        storageError = error.message;
        pauseSession('Uložení se nezdařilo: ' + error.message);
        return;
      }
    }

    stats();
    renderQuestHud(validFix || fix);

    if (!result.accepted) {
      status(result.reason);
      return;
    }

    if (!justConfirmedStopId) {
      status(`Procházka běží · ${result.reason} Přesnost GPS ±${Math.round(fix.accuracy)} m · Dosah odkrývání ${FOG_REVEAL_RADIUS_M} m.`);
    }
    justConfirmedStopId = null;
  }

  function updateTopBarUi() {
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
  }

  function updateMapActionBar() {
    const isStarted = walkState === 'locating' || walkState === 'running' || walkState === 'paused' || Boolean(demo);
    const inactiveGrp = $('mab-inactive-group');
    const activeGrp = $('mab-active-group');
    if (inactiveGrp) inactiveGrp.hidden = isStarted;
    if (activeGrp) activeGrp.hidden = !isStarted;

    const pauseBtn = $('walk-pause');
    if (pauseBtn) {
      const isPaused = walkState === 'paused' || currentExpedition?.state === 'paused';
      pauseBtn.textContent = isPaused ? '▶ Pokračovat' : '⏸ Pauza';
      pauseBtn.setAttribute('aria-label', isPaused ? 'Pokračovat v procházce' : 'Pozastavit procházku');
    }
    const topPauseBtn = $('btn-top-pause');
    if (topPauseBtn) {
      topPauseBtn.hidden = !isStarted;
      const isPaused = walkState === 'paused' || currentExpedition?.state === 'paused';
      topPauseBtn.textContent = isPaused ? '▶ Pokračovat' : '⏸ Pauza';
    }
  }

  async function startUnifiedExpedition(source = 'button') {
    if (disposed) return;
    if (walkState === 'running' && active && currentExpedition && currentExpedition.state === 'active') {
      return;
    }

    gpsBrowseOnlyMode = false;
    if ($('walk-accuracy-banner')) $('walk-accuracy-banner').hidden = true;
    follow = true;
    updateFollowUi();

    if (simSandboxActive) {
      if (!currentExpedition || currentExpedition.state === 'ended') {
        confirmedStopIds = new Set();
        stateObj.confirmedStopIds = [];
        telemetry = createTelemetryState(Date.now());
        currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
      } else if (currentExpedition.state === 'paused') {
        currentExpedition = resumeExpedition(currentExpedition);
        telemetry.lastTickMs = Date.now();
      }
      stateObj.activeExpedition = currentExpedition;
      walkState = 'running';
      active = true;
      starting = false;
      anchor = null;
      lockedExpeditionOrigin = plannedRoute.origin
        ? { ...plannedRoute.origin }
        : (lastFix ? { id: 'start-gps', label: 'Místo startu', lat: lastFix.lat, lng: lastFix.lng } : null);
      if (lastFix) centerMapOnPlayer(lastFix, false);
      updateMapActionBar();
      updateTopBarUi();
      stats();
      status('Výprava běží (testovací simulátor GPS v izolovaném paměťovém prostoru).');
      return;
    }

    stateObj = loadState();
    progress = {
      version: 1,
      cells: [...(stateObj.cells || [])],
      meters: Number(stateObj.meters) || 0,
      discoveries: [...(stateObj.discoveries || [])],
      walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
      revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
    };

    if (!currentExpedition || currentExpedition.state === 'ended') {
      confirmedStopIds = new Set();
      stateObj.confirmedStopIds = [];
      telemetry = createTelemetryState(Date.now());
      currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
    } else if (currentExpedition.state === 'paused') {
      confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
      currentExpedition = resumeExpedition(currentExpedition);
      telemetry.lastTickMs = Date.now();
    }

    stateObj.activeExpedition = currentExpedition;
    if (canPersistRealState()) {
      try {
        stateObj = saveState(stateObj);
        storageError = '';
      } catch (err) {
        starting = false;
        walkState = 'idle';
        storageError = err.message;
        stats();
        status('Uložení se nezdařilo: ' + err.message);
        return;
      }
    }

    anchor = null;
    follow = true;
    updateFollowUi();

    // DÁVKA 2 (Bod 3.2): Zamknutý start okruhu při zahájení — pohyb hráče v handleGpsFix nikdy nesmí přepsat start okruhu!
    if (!lockedExpeditionOrigin) {
      const fallbackStart = lastAcceptedFix && !lastAcceptedFix.simulated
        ? { id: 'start-gps', label: 'Místo startu', lat: lastAcceptedFix.lat, lng: lastAcceptedFix.lng }
        : (plannedRoute.origin ? { ...plannedRoute.origin } : { ...START_PRESETS[0] });
      lockedExpeditionOrigin = plannedRoute.origin ? { ...plannedRoute.origin } : fallbackStart;
    }

    // DÁVKA 1 (Bod 2.1): Kritické pravidlo — dokud prohlížeč nevrátí platnou GPS polohu,
    // jsme ve stavu 'locating' (nepřičítáme čas ani metry) a zobrazujeme indikátor v mapě.
    if (lastAcceptedFix && !lastAcceptedFix.simulated && (Date.now() - (lastAcceptedFix.timestamp || 0)) < 15000) {
      walkState = 'running';
      starting = false;
      active = true;
      telemetry.lastTickMs = Date.now();
      centerMapOnPlayer(lastAcceptedFix, false);
    } else {
      walkState = 'locating';
      starting = true;
      active = false;
      if (gpsLocatingTaskId === null) {
        gpsLocatingTaskId = beginMapTask('⏳ Čekám na polohu GPS…');
      }
    }

    updateMapActionBar();
    updateTopBarUi();
    stats();
    playStampChord(stateObj.soundEnabled);

    if (source !== 'sim') {
      keepAliveCtrl.start('Czekpoint GPS aktivní');
      startBackgroundTracking({
        title: walkState === 'locating' ? 'Hledám polohu GPS…' : 'Výprava běží',
        artist: 'Czekpoint GPS aktivní',
        album: 'Záznam chůze i při zhasnutém displeji',
        onPause: () => { togglePauseUnified(); },
        onResume: () => { togglePauseUnified(); },
        onStop: () => { finishUnifiedExpedition(); },
        onTick: () => { keepAliveCtrl.triggerManualTick?.(); },
      });
      if (isSecureContext && navigator.geolocation) {
        status(walkState === 'locating'
          ? '⏳ Hledám polohu GPS (záznam začne po zaměření)…'
          : `▶ Procházka běží (GPS ≤ ${MAX_GPS_ACCURACY_M} m, dosah ${FOG_REVEAL_RADIUS_M} m)…`);
        lastFixReceivedAt = Date.now();
        restartGpsWatch();
        startWatchdog();
        holdWake();
      } else {
        if (gpsLocatingTaskId !== null) {
          endMapTask(gpsLocatingTaskId);
          gpsLocatingTaskId = null;
        }
        status('⏳ Hledám polohu GPS (záznam začne po zaměření)… Na PC můžeš zapnout 🧪 Testovací simulátor GPS.');
      }
    }
  }
  const start = startUnifiedExpedition;

  // Tik na pozadí (z Web Workeru / Audio smyčky) udržuje pohyb postavičky i hlasovou navigaci při zhasnutém displeji
  keepAliveCtrl.onTick((now) => {
    if (disposed) return;
    if (simSandboxActive && fakeGpsSim && fakeGpsSim.isOpen && walkState !== 'paused') {
      fakeGpsSim.triggerLoopTick?.(now);
    }
    if (walkState === 'running' || demo) {
      renderTouristStatsHud(lastFix);
      updateTurnNavPill(lastFix);
    }
  });

  // Inicializace mapy Leaflet s bližším výchozím přiblížením (16.5) a jedním párem tlačítek ➕/➖ v pravém sloupci
  if (L) {
    const center = progress.cells.length ? cellCenter(progress.cells.at(-1)) : { lat: 49.6014, lng: 13.8644 };
    map = L.map($('walk-map'), { zoomControl: false, minZoom: 3, maxZoom: 19, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 }).setView([center.lat, center.lng], 16.5);
    tileLayer = L.tileLayer(config.mapTileUrl, {
      maxZoom: 19,
      maxNativeZoom: 19,
      noWrap: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (ODbL)',
    }).addTo(map);
    tileLayer.on('tileerror', () => {
      if ($('tile-status')) $('tile-status').textContent = 'Mapový podklad se nenačetl. Průzkum funguje dál.';
    });

    const pane = map.createPane('walk-fog');
    pane.style.zIndex = '450';
    pane.style.pointerEvents = 'none';
    fog = L.DomUtil.create('canvas', 'walk-fog', pane);
    fog.setAttribute('aria-hidden', 'true');

    const hikingPane = map.createPane('hiking-trails-pane');
    hikingPane.style.zIndex = '430';
    hikingPane.style.pointerEvents = 'none';

    const routePane = map.createPane('quest-route-pane');
    routePane.style.zIndex = '520';
    routePane.style.pointerEvents = 'none';

    // ZADÁNÍ #08 (Bod 4): Oficiální vrstva turistických tras KČT (Waymarked Trails Hiking)
    waymarkedHikingLayer = L.tileLayer('https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', {
      maxZoom: 18,
      opacity: 0.92,
      pane: 'hiking-trails-pane',
      attribution: '&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>',
    });
    let waymarkedFallbackTriggered = false;
    waymarkedHikingLayer.on('tileerror', () => {
      if (waymarkedFallbackTriggered || !map) return;
      waymarkedFallbackTriggered = true;
      if (waymarkedHikingLayer && map.hasLayer(waymarkedHikingLayer)) {
        map.removeLayer(waymarkedHikingLayer);
      }
    });
    if (showHikingTrails) {
      waymarkedHikingLayer.addTo(map);
    }

    hikingTrailsLayer.addTo(map);
    placesLayer.addTo(map);
    trailLayer.addTo(map);
    plannedRouteLayer.addTo(map);
    playerLeadLayer.addTo(map);

    accuracyRing = L.circle([center.lat, center.lng], { radius: 0, color: '#218bea', weight: 1.5, fillOpacity: 0.12, pane: 'markerPane' }).addTo(map);
    // ZADÁNÍ #08 (Bod 2): Živý animovaný Avatar hráče na mapě (L.marker + L.divIcon 54×54 px, zIndexOffset: 1000)
    player = L.marker([center.lat, center.lng], {
      pane: 'markerPane',
      zIndexOffset: 1000,
      opacity: 0,
      interactive: false,
      icon: L.divIcon({
        className: 'player-avatar-marker-anchor',
        html: renderPlayerAvatarMarkerHtml({
          avatarId: stateObj.profile?.avatarId || 'liska',
          bearingDeg: targetBearing || 0,
          isWalking: false,
        }),
        iconSize: [54, 54],
        iconAnchor: [27, 27],
      }),
    }).addTo(map);

    function scheduleMapPanAutoFetch() {
      if (!map) return;
      if (autoPanFetchTimer) clearTimeout(autoPanFetchTimer);
      autoPanFetchTimer = setTimeout(async () => {
        if (disposed || !map) return;
        const c = map.getCenter();
        if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
        const currentCenter = { lat: Number(c.lat.toFixed(4)), lng: Number(c.lng.toFixed(4)) };
        const distFromLast = lastAutoPanCenter
          ? (haversineMeters(lastAutoPanCenter, currentCenter) ?? Infinity)
          : Infinity;

        // ZADÁNÍ #10 (Bod 1.1): 100% automatické načítání míst z Overpass API na pozadí při posunu mapy
        // s debounce 700 ms, pokud se střed posunul o > 1,2 km (1200 m).
        if (distFromLast >= 1200) {
          if (autoPlacesLoading) {
            pendingAutoPanCenter = currentCenter;
            return;
          }
          lastAutoPanCenter = currentCenter;
          await refreshAutoPlaces(currentCenter, {
            silent: true,
            autoPlan: false,
            forceRefresh: false,
          });
        }
      }, 700);
    }

    map.on('move zoom viewreset resize', scheduleFog);
    map.on('zoomstart', () => {
      userZoomLocked = true;
      lastUserZoomAt = Date.now();
    });
    map.on('zoomend', () => {
      lastUserZoomAt = Date.now();
      renderTrail();
      renderPlaces({ skipListRebuild: true });
    });
    // Bod 25: Ruční posun mapy dočasně přepne do prohlížení a zobrazí výrazné „Zpět na mou polohu“
    map.on('dragstart', () => {
      follow = false;
      updateFollowUi();
    });
    map.on('moveend', () => {
      renderPlaces({ skipListRebuild: true });
      updateScanMapAreaButtonState();
      scheduleMapPanAutoFetch();
    });

    map.on('click', ev => {
      if ($('place-detail-sheet') && !$('place-detail-sheet').hidden) {
        closePlaceDetail();
      }
      if ($('map-lupa-search-results') && !$('map-lupa-search-results').hidden) {
        $('map-lupa-search-results').hidden = true;
      }
      if (pickingCustomEndOnMap) {
        pickingCustomEndOnMap = false;
        phase1EndMode = 'custom';
        plannedRoute.routeType = 'oneway';
        const customEndId = 'custom-end-stop';
        const customEndStop = {
          id: customEndId,
          title: `Cíl v mapě [${ev.latlng.lat.toFixed(4)}, ${ev.latlng.lng.toFixed(4)}]`,
          lat: ev.latlng.lat,
          lng: ev.latlng.lng,
          kind: 'view',
          category: 'views',
        };
        plannedRoute.embeddedStops = [
          ...(plannedRoute.embeddedStops || []).filter(s => s.id !== customEndId),
          customEndStop,
        ];
        const others = getPlannedPlaces().filter(s => s.id !== customEndId);
        const orderedOthers = others.length >= 2
          ? optimizeRouteOrder(getRouteOriginPoint(), others, {
              returnToOrigin: false,
              visitedStopIds: confirmedStopIds,
              currentPosition: (active || demo) && lastFix ? lastFix : null,
            })
          : others;
        plannedRoute.selectedPlaceIds = [...orderedOthers.map(s => s.id), customEndId];
        recalculateRemainingRoute('🏁 Jiný cíl nastaven kliknutím do mapy.');
        playStampChord(stateObj.soundEnabled);
        return;
      }
      if (pickingStartOnMap) {
        pickingStartOnMap = false;
        userExplicitlyPickedOrigin = true;
        const customOrigin = {
          id: 'custom-map',
          label: `Bod v mapě [${ev.latlng.lat.toFixed(3)}, ${ev.latlng.lng.toFixed(3)}]`,
          lat: ev.latlng.lat,
          lng: ev.latlng.lng,
          custom: true,
        };
        if (editModalOpen && editDraft) {
          editDraft.origin = customOrigin;
          $('edit-walk-modal').hidden = false;
          renderEditWalkModal();
        } else {
          plannedRoute.origin = customOrigin;
          wizardScenario = 'from-home';
          renderTripWizardUi();
          refreshWeatherStrip(customOrigin);
          applyPhase1QuickSelection(true);
          refreshAutoPlaces(customOrigin, { autoPlan: true, forceRefresh: true });
          status('📍 Start nastaven v mapě — načítám zajímavá místa v okolí a stavím trasu…');
        }
        playTick(stateObj.soundEnabled);
      }
    });

    const simStartPos = lastFix || plannedRoute?.origin || (progress.cells.length ? cellCenter(progress.cells.at(-1)) : ROZMITAL_CENTER);
    fakeGpsSim = initGpsSimulator({
      map,
      container: $('simulator-test-zone'),
      initialPosition: simStartPos,
      onOpen: () => {
        if ($('simulator-test-zone')) $('simulator-test-zone').hidden = false;
        enterSimulatorSandbox();
      },
      onClose: () => {
        if ($('simulator-test-zone')) $('simulator-test-zone').hidden = true;
        exitSimulatorSandbox();
      },
      onAutopilotPause: (reason) => {
        status(reason);
      },
      onFix: (fix, heading) => {
        if (disposed) return;
        enterSimulatorSandbox();
        // DÁVKA 1 (Bod 2.3): Ve stavu 'paused' nesmí ani simulovaný vzorek polohy obnovit chůzi ani přičíst metry!
        if (walkState === 'paused' || (currentExpedition && currentExpedition.state === 'paused')) {
          return;
        }
        const simMoved = !lastFix || (haversineMeters(lastFix, fix) ?? 1) > 0.5;
        if (walkState !== 'running' && walkState !== 'paused' && simMoved) {
          startUnifiedExpedition('sim');
        }
        handleGpsFix({ ...fix, simulated: true });
        if (heading != null && Number.isFinite(heading)) {
          updateCompassRotation(heading);
        }
      },
      onHeadingChange: (heading) => {
        if (heading != null && Number.isFinite(heading)) {
          updateCompassRotation(heading);
        }
      },
      onResetAnchor: () => {
        anchor = null;
      },
      onStopRealGps: () => {
        stopWatchdog();
        if (watch !== null) {
          navigator.geolocation?.clearWatch?.(watch);
          watch = null;
        }
      },
      getPlannedWaypoints: () => {
        return getPlannedPlaces();
      },
      getSharedWalkingRoute: () => {
        return lastRoutedGeometry;
      },
      getCollectiblePlaces: () => {
        return getAllAvailablePlaces().filter(p => p.collectible !== false);
      },
    });

    loadAndRenderHikingTrails();
  } else {
    $('walk-map').innerHTML = `
      <div class="map-missing-fallback" role="alert" style="padding:24px;text-align:center">
        <strong>Mapová knihovna chybí nebo se nenačetla.</strong>
        <p style="margin:8px 0 0">Zobrazení interaktivní mapy a mapových vrstev není v tuto chvíli dostupné. Plánování zastávek, seznam míst a záznam GPS procházky zůstávají funkční.</p>
      </div>
    `;
    ['walk-center', 'walk-fog-toggle', 'walk-trails-toggle', 'walk-zen-toggle', 'draft-btn-origin-map', 'walk-fake-gps-toggle'].forEach(btnId => {
      const btn = $(btnId);
      if (btn) {
        btn.disabled = true;
        btn.title = 'Nedostupné — mapová knihovna se nenačetla';
      }
    });
  }

  // Ovládání rozbalovacího přehledu turistických údajů a počasí (Body 28 & 29)
  $('btn-toggle-tourist-stats')?.addEventListener('click', () => {
    statsDrawerOpen = !statsDrawerOpen;
    const drawer = $('tourist-stats-drawer');
    const btn = $('btn-toggle-tourist-stats');
    if (drawer) drawer.hidden = !statsDrawerOpen;
    if (btn) {
      btn.setAttribute('aria-expanded', String(statsDrawerOpen));
      btn.textContent = statsDrawerOpen ? '📊 Skrýt podrobnosti ▲' : '📊 Podrobné údaje ▼';
    }
    renderTouristStatsHud(lastFix);
    playTick(stateObj.soundEnabled);
  });

  $('btn-toggle-weather-detail')?.addEventListener('click', () => {
    weatherExpanded = !weatherExpanded;
    const panel = $('weather-detail-panel');
    const btn = $('btn-toggle-weather-detail');
    if (panel) panel.hidden = !weatherExpanded;
    if (btn) {
      btn.setAttribute('aria-expanded', String(weatherExpanded));
      btn.textContent = weatherExpanded ? 'Skrýt počasí ▲' : 'Počasí podrobně ▼';
    }
    renderWeatherStripUi();
    playTick(stateObj.soundEnabled);
  });

  // Ovládání sjednoceného dialogu „Upravit procházku“ (Bod 20: Potvrdit změny / Zrušit)
  function openEditWalkModal() {
    editDraft = {
      origin: plannedRoute.origin ? { ...plannedRoute.origin } : { ...START_PRESETS[0] },
      radiusKm: plannedRoute.radiusKm || 10,
      categories: [...(plannedRoute.categories || PLANNER_CATEGORIES.map(c => c.id))],
      selectedPlaceIds: [...(plannedRoute.selectedPlaceIds || [])],
      companionMode: stateObj.companionMode || plannedRoute.companionMode || 'solo',
      explorationMode: stateObj.explorationMode || plannedRoute.explorationMode || 'focus',
      routeType: plannedRoute.routeType || 'oneway',
    };
    editModalOpen = true;
    if ($('draft-auto-feedback')) $('draft-auto-feedback').hidden = true;
    $('edit-walk-modal').hidden = false;
    renderEditWalkModal();
    playTick(stateObj.soundEnabled);
  }

  function cancelEditWalkModal() {
    editDraft = null;
    editModalOpen = false;
    pickingStartOnMap = false;
    $('edit-walk-modal').hidden = true;
    status('Úpravy procházky zrušeny. Původní plán i rozchozená výprava zůstaly beze změny.');
    playTick(stateObj.soundEnabled);
  }

  function confirmEditWalkModal() {
    if (!editDraft) return;
    plannedRoute = {
      ...plannedRoute,
      origin: editDraft.origin,
      radiusKm: editDraft.radiusKm,
      categories: [...editDraft.categories],
      selectedPlaceIds: [...editDraft.selectedPlaceIds],
      companionMode: editDraft.companionMode,
      explorationMode: editDraft.explorationMode,
      routeType: editDraft.routeType || 'oneway',
    };
    stateObj.companionMode = editDraft.companionMode;
    stateObj.explorationMode = editDraft.explorationMode;
    stateObj.plannedRoute = plannedRoute;

    editDraft = null;
    editModalOpen = false;
    $('edit-walk-modal').hidden = true;

    recalculateRemainingRoute('Změny procházky potvrzeny. Zbývající trasa byla přepočítána.');
    refreshAutoPlaces();
    refreshWeatherStrip();
    playStampChord(stateObj.soundEnabled);
  }

  function renderEditWalkModal() {
    if (!editDraft || !editModalOpen) return;

    root.querySelectorAll('[data-draft-origin]').forEach(btn => {
      btn.classList.toggle('primary', editDraft.origin?.id === btn.dataset.draftOrigin);
    });
    if ($('draft-origin-desc')) {
      $('draft-origin-desc').textContent = `Zvolený start: ${editDraft.origin?.label || 'Vlastní bod'}`;
    }

    root.querySelectorAll('[data-draft-companion]').forEach(btn => {
      btn.classList.toggle('primary', editDraft.companionMode === btn.dataset.draftCompanion);
    });

    root.querySelectorAll('[data-draft-mode]').forEach(btn => {
      btn.classList.toggle('primary', editDraft.explorationMode === btn.dataset.draftMode);
    });

    root.querySelectorAll('[data-draft-radius]').forEach(btn => {
      btn.classList.toggle('primary', Number(btn.dataset.draftRadius) === editDraft.radiusKm);
    });

    root.querySelectorAll('[data-draft-cat]').forEach(chip => {
      chip.classList.toggle('selected', editDraft.categories.includes(chip.dataset.draftCat));
    });

    const draftPlaces = getPlannedPlaces(editDraft.selectedPlaceIds);
    if ($('draft-basket-count')) $('draft-basket-count').textContent = String(draftPlaces.length);
    if ($('draft-btn-optimize')) $('draft-btn-optimize').disabled = draftPlaces.length < 2;

    const draftStopsEl = $('draft-stops-list');
    if (draftStopsEl) {
      if (draftPlaces.length === 0) {
        draftStopsEl.innerHTML = '<p class="small-note">Žádné pevné zastávky (volná procházka). Přidej zastávky níže nebo zvol automatický okruh.</p>';
      } else {
        draftStopsEl.innerHTML = draftPlaces.map((p, idx) => `
          <div class="basket-item" data-draft-stop-index="${idx}">
            <div class="basket-item-main">
              <span class="basket-index">${idx + 1}.</span>
              <strong class="basket-title">${e(p.title)}</strong>
              ${isStopVisitedInSession(p) ? '<span class="stop-state-badge confirmed">✓ Navštíveno dnes</span>' : hasLifetimeStamp(p) ? '<span class="stop-state-badge pending">📜 V pasu z dřívějška</span>' : ''}
            </div>
            <div class="basket-item-controls">
              <button type="button" class="button small ghost" data-draft-stop-action="up" data-draft-stop-index="${idx}" ${idx === 0 ? 'disabled' : ''}>↑ Nahoru</button>
              <button type="button" class="button small ghost" data-draft-stop-action="down" data-draft-stop-index="${idx}" ${idx === draftPlaces.length - 1 ? 'disabled' : ''}>↓ Dolů</button>
              <button type="button" class="button small ghost" data-draft-stop-action="replace" data-draft-stop-index="${idx}">⇄ Nahradit</button>
              <button type="button" class="button small ghost danger" data-draft-stop-action="remove" data-draft-stop-index="${idx}">✕ Odebrat</button>
            </div>
          </div>
        `).join('');
      }
    }

    const availEl = $('draft-available-places');
    if (availEl) {
      const candidates = getAllAvailablePlaces()
        .filter(p => !editDraft.selectedPlaceIds.includes(p.id))
        .slice(0, 12);
      availEl.innerHTML = candidates.map(p => `
        <button type="button" class="draft-add-place-chip" data-draft-add-id="${e(p.id)}">
          + ${e(p.title)}
        </button>
      `).join('');
    }
  }

  $('btn-open-edit-walk')?.addEventListener('click', openEditWalkModal);
  $('btn-sheet-edit-walk')?.addEventListener('click', openEditWalkModal);
  $('btn-close-edit-walk-x')?.addEventListener('click', cancelEditWalkModal);
  $('btn-cancel-walk-edit')?.addEventListener('click', cancelEditWalkModal);
  $('btn-confirm-walk-edit')?.addEventListener('click', confirmEditWalkModal);

  // Události uvnitř modálu „Upravit procházku“
  $('edit-walk-modal')?.addEventListener('click', ev => {
    if (ev.target === $('edit-walk-modal') || !ev.target.closest('.edit-walk-modal-card')) {
      cancelEditWalkModal();
      return;
    }
    if (!editDraft) return;

    const originBtn = ev.target.closest('[data-draft-origin]');
    if (originBtn) {
      const originId = originBtn.dataset.draftOrigin;
      if (originId === 'my-gps') {
        if (lastFix) {
          editDraft.origin = { id: 'my-gps', label: 'Moje GPS poloha', lat: lastFix.lat, lng: lastFix.lng };
        } else {
          status('Pro start od tvé GPS polohy nejprve spusť GPS.');
        }
      } else {
        const preset = START_PRESETS.find(s => s.id === originId);
        if (preset) editDraft.origin = { ...preset };
      }
      renderEditWalkModal();
      return;
    }

    if (ev.target.closest('#draft-btn-origin-map')) {
      if (!map) return;
      pickingStartOnMap = true;
      $('edit-walk-modal').hidden = true;
      status('Klikni do mapy pro výběr startovního bodu návrhu…');
      return;
    }

    const compBtn = ev.target.closest('[data-draft-companion]');
    if (compBtn) {
      editDraft.companionMode = compBtn.dataset.draftCompanion;
      renderEditWalkModal();
      return;
    }

    const modeBtn = ev.target.closest('[data-draft-mode]');
    if (modeBtn) {
      editDraft.explorationMode = modeBtn.dataset.draftMode;
      renderEditWalkModal();
      return;
    }

    const radBtn = ev.target.closest('[data-draft-radius]');
    if (radBtn) {
      editDraft.radiusKm = Number(radBtn.dataset.draftRadius);
      renderEditWalkModal();
      return;
    }

    const catBtn = ev.target.closest('[data-draft-cat]');
    if (catBtn) {
      const catId = catBtn.dataset.draftCat;
      if (editDraft.categories.includes(catId)) {
        editDraft.categories = editDraft.categories.filter(c => c !== catId);
      } else {
        editDraft.categories = [...editDraft.categories, catId];
      }
      renderEditWalkModal();
      return;
    }

    if (ev.target.closest('#draft-btn-free')) {
      editDraft.explorationMode = 'radar';
      editDraft.selectedPlaceIds = [];
      editDraft.routeType = 'oneway';
      if ($('draft-auto-feedback')) $('draft-auto-feedback').hidden = true;
      renderEditWalkModal();
      return;
    }

    const autoBtn = ev.target.closest('#draft-btn-auto-2, #draft-btn-auto-5, #draft-btn-auto-10');
    if (autoBtn) {
      const targetKm = autoBtn.id.endsWith('-2') ? 2 : autoBtn.id.endsWith('-10') ? 10 : 5;
      const trip = autoSuggestTrip({
        origin: editDraft.origin,
        targetKm,
        companionMode: editDraft.companionMode,
        availablePlaces: getAllAvailablePlaces(),
        discoveries: progress.discoveries,
      });
      const fbEl = $('draft-auto-feedback');
      if (!trip.found) {
        if (fbEl) {
          fbEl.hidden = false;
          fbEl.textContent = `⚠️ ${trip.reason}`;
        }
        status(trip.reason);
        return;
      }
      editDraft.selectedPlaceIds = trip.selectedPlaceIds;
      editDraft.explorationMode = 'focus';
      editDraft.routeType = 'loop';
      if (fbEl) {
        const kmStr = (trip.analysis.estimatedWalkDistanceM / 1000).toFixed(1).replace('.', ',');
        fbEl.hidden = false;
        fbEl.textContent = `✓ Sestaven uzavřený okruh zpět na start: ${trip.selectedPlaceIds.length} zastávek, celková délka ~${kmStr} km (~${trip.analysis.estimatedMinutes} min).`;
      }
      renderEditWalkModal();
      return;
    }

    // Bod 27: Uspořádat zastávky podle skutečné pěší vzdálenosti (zachová již navštívené zastávky při běžící chůzi)
    if (ev.target.closest('#draft-btn-optimize')) {
      const draftPlaces = getPlannedPlaces(editDraft.selectedPlaceIds);
      if (draftPlaces.length >= 2) {
        const ordered = optimizeRouteOrder(editDraft.origin, draftPlaces, {
          returnToOrigin: editDraft.routeType === 'loop',
          visitedStopIds: confirmedStopIds,
          currentPosition: active && lastFix ? lastFix : null,
        });
        editDraft.selectedPlaceIds = ordered.map(p => p.id);
        renderEditWalkModal();
      }
      return;
    }

    const stopActBtn = ev.target.closest('[data-draft-stop-action]');
    if (stopActBtn) {
      const action = stopActBtn.dataset.draftStopAction;
      const idx = Number(stopActBtn.dataset.draftStopIndex);
      if (action === 'up') {
        editDraft.selectedPlaceIds = reorderPlannedStops(editDraft.selectedPlaceIds, idx, idx - 1);
      } else if (action === 'down') {
        editDraft.selectedPlaceIds = reorderPlannedStops(editDraft.selectedPlaceIds, idx, idx + 1);
      } else if (action === 'remove') {
        editDraft.selectedPlaceIds = removePlannedStop(editDraft.selectedPlaceIds, idx);
      } else if (action === 'replace') {
        const replacement = getAllAvailablePlaces().find(p => !editDraft.selectedPlaceIds.includes(p.id));
        if (replacement) {
          editDraft.selectedPlaceIds = replacePlannedStop(editDraft.selectedPlaceIds, idx, replacement.id);
        }
      }
      renderEditWalkModal();
      return;
    }

    const addChip = ev.target.closest('[data-draft-add-id]');
    if (addChip) {
      const id = addChip.dataset.draftAddId;
      if (editDraft.selectedPlaceIds.length < 10 && !editDraft.selectedPlaceIds.includes(id)) {
        editDraft.selectedPlaceIds = [...editDraft.selectedPlaceIds, id];
        renderEditWalkModal();
      }
    }
  });

  $('walk-fake-gps-toggle')?.addEventListener('click', () => {
    if (fakeGpsSim) {
      fakeGpsSim.toggle();
      const zone = $('simulator-test-zone');
      if (zone) {
        zone.hidden = !fakeGpsSim.isOpen;
        if (fakeGpsSim.isOpen) {
          zone.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }
    playTick(stateObj.soundEnabled);
  });

  if (location.hash.includes('sim=1') || location.search.includes('sim=1')) {
    setTimeout(() => {
      if (!disposed && fakeGpsSim && !fakeGpsSim.isOpen) {
        fakeGpsSim.open();
        const zone = $('simulator-test-zone');
        if (zone) {
          zone.hidden = false;
          zone.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }, 400);
  }

  $('walk-start')?.addEventListener('click', start);
  $('walk-stop')?.addEventListener('click', () => pauseSession('Pozastaveno. Průzkum je uložený.'));
  $('walk-end')?.addEventListener('click', finishExpedition);
  $('walk-awake')?.addEventListener('change', () => { $('walk-awake')?.checked ? holdWake() : releaseWake(); });
  $('walk-sound')?.addEventListener('change', (ev) => {
    stateObj.soundEnabled = ev.target.checked;
    saveAppState();
  });

  // Bod 25: Při sbalení/rozbalení spodního panelu nebo otočení telefonu znovu vycentrujeme hráče do viditelné části mapy
  $('sheet-toggle-btn')?.addEventListener('click', () => {
    sheetCollapsed = !sheetCollapsed;
    $('walk-bottom-sheet')?.classList.toggle('collapsed', sheetCollapsed);
    $('sheet-toggle-btn')?.setAttribute('aria-expanded', String(!sheetCollapsed));
    if ($('sheet-toggle-btn')) {
      $('sheet-toggle-btn').textContent = sheetCollapsed ? '⬆ Rozbalit panel' : '⬇ Sbalit panel';
    }
    if (follow && (lastFix || telemetry.lastKnownPosition)) {
      centerMapOnPlayer(lastFix || telemetry.lastKnownPosition, false);
    }
    playTick(stateObj.soundEnabled);
  });

  const handleViewportChange = () => {
    if (!map || disposed) return;
    map.invalidateSize();
    if (follow && (lastFix || telemetry.lastKnownPosition)) {
      centerMapOnPlayer(lastFix || telemetry.lastKnownPosition, false);
    }
  };
  window.addEventListener('resize', handleViewportChange, { signal: aborter.signal });
  window.addEventListener('orientationchange', handleViewportChange, { signal: aborter.signal });

  function updateZenMode() {
    $('walk-map-wrap').classList.toggle('zen-mode', zenMode);
    document.body?.classList.toggle('has-zen-mode', zenMode);
    $('zen-close-btn').hidden = !zenMode;
    if ($('zen-follow-btn')) $('zen-follow-btn').hidden = !zenMode;
    if ($('quest-hud-panel')) $('quest-hud-panel').hidden = !zenMode || getPlannedPlaces().length === 0;
    const zenToggleBtn = $('walk-zen-toggle');
    if (zenToggleBtn) {
      zenToggleBtn.setAttribute('aria-pressed', String(zenMode));
      zenToggleBtn.setAttribute('aria-label', zenMode ? 'Ukončit celou obrazovku' : 'Celá obrazovka');
      zenToggleBtn.title = zenMode ? 'Ukončit celou obrazovku' : 'Celá obrazovka';
      zenToggleBtn.textContent = zenMode ? '✕' : '⛶';
    }
    if ($('btn-top-fullscreen')) {
      $('btn-top-fullscreen').setAttribute('aria-pressed', String(zenMode));
      $('btn-top-fullscreen').setAttribute('aria-label', zenMode ? 'Ukončit celou obrazovku' : 'Celá obrazovka');
      $('btn-top-fullscreen').textContent = zenMode ? '✕ Zmenšit mapu' : '⛶ Celá obrazovka';
    }
    $('map-command-bar').hidden = zenMode;
    $('walk-bottom-sheet').hidden = zenMode;
    if (zenMode) {
      follow = true;
      userZoomLocked = false;
    }
    updateFollowUi();
    if (map) {
      map.invalidateSize();
      const pos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
      if (pos) centerMapOnPlayer(pos, false);
      setTimeout(() => {
        if (!disposed && map) {
          map.invalidateSize();
          if (follow && (lastFix || telemetry.lastKnownPosition)) {
            centerMapOnPlayer(lastFix || telemetry.lastKnownPosition, false);
          }
        }
      }, 60);
      setTimeout(() => {
        if (!disposed && map) {
          map.invalidateSize();
          if (follow && (lastFix || telemetry.lastKnownPosition)) {
            centerMapOnPlayer(lastFix || telemetry.lastKnownPosition, false);
          }
        }
      }, 240);
    }
  }

  $('zen-follow-btn')?.addEventListener('click', () => {
    follow = true;
    userZoomLocked = false;
    updateFollowUi();
    const pos = lastFix || telemetry.lastKnownPosition || getRouteOriginPoint();
    if (pos && map) {
      centerMapOnPlayer(pos, true);
    }
    playTick(stateObj.soundEnabled);
  });

  $('walk-zen-toggle')?.addEventListener('click', () => {
    zenMode = !zenMode;
    updateZenMode();
    playTick(stateObj.soundEnabled);
  });

  $('zen-close-btn')?.addEventListener('click', () => {
    zenMode = false;
    updateZenMode();
    playTick(stateObj.soundEnabled);
  });

  const onEscapeKey = (ev) => {
    if (ev.key === 'Escape') {
      if ($('postcard-modal')) {
        if ($('session-summary-container')) $('session-summary-container').innerHTML = '';
        playTick(stateObj.soundEnabled);
        return;
      }
      if ($('arrival-goal-modal') && !$('arrival-goal-modal').hidden) {
        $('arrival-goal-modal').hidden = true;
        playTick(stateObj.soundEnabled);
        return;
      }
      if ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden) {
        setPocketModeUi(false);
        playTick(stateObj.soundEnabled);
        return;
      }
      if (appSettingsModalOpen || ($('app-settings-modal') && !$('app-settings-modal').hidden)) {
        appSettingsModalOpen = false;
        if ($('app-settings-modal')) $('app-settings-modal').hidden = true;
        playTick(stateObj.soundEnabled);
        return;
      }
      if (saveMemoryModalOpen || ($('save-memory-modal') && !$('save-memory-modal').hidden)) {
        closeSaveMemoryModal();
        playTick(stateObj.soundEnabled);
        return;
      }
      if (editModalOpen || ($('edit-walk-modal') && !$('edit-walk-modal').hidden)) {
        cancelEditWalkModal();
        return;
      }
      if ($('place-detail-sheet') && !$('place-detail-sheet').hidden) {
        closePlaceDetail();
        playTick(stateObj.soundEnabled);
        return;
      }
      if ($('map-lupa-search-results') && !$('map-lupa-search-results').hidden) {
        $('map-lupa-search-results').hidden = true;
        return;
      }
      if (replacingStopIndex !== null) {
        replacingStopIndex = null;
        renderReplaceStopPicker();
        return;
      }
      if (zenMode) {
        zenMode = false;
        updateZenMode();
        playTick(stateObj.soundEnabled);
      }
    }
  };
  window.addEventListener('keydown', onEscapeKey, { signal: aborter.signal });

  // Rychlé navržení automatického okruhu (Bod 5 & 27)
  $('btn-quick-auto-trip')?.addEventListener('click', () => {
    let trip = autoSuggestTrip({
      origin: plannedRoute.origin,
      targetKm: 5,
      companionMode: stateObj.companionMode || 'solo',
      availablePlaces: getAllAvailablePlaces(),
      discoveries: progress.discoveries,
    });
    if (!trip.found) {
      trip = autoSuggestTrip({
        origin: plannedRoute.origin,
        targetKm: 10,
        companionMode: stateObj.companionMode || 'solo',
        availablePlaces: getAllAvailablePlaces(),
        discoveries: progress.discoveries,
      });
    }
    if (!trip.found) {
      status(trip.reason);
      return;
    }
    plannedRoute.selectedPlaceIds = trip.selectedPlaceIds;
    plannedRoute.routeType = 'loop';
    const kmStr = (trip.analysis.estimatedWalkDistanceM / 1000).toFixed(1).replace('.', ',');
    recalculateRemainingRoute(`Navržen uzavřený okruh zpět na start: ${trip.selectedPlaceIds.length} zastávek (~${kmStr} km).`);
    playStampChord(stateObj.soundEnabled);
    if (map && !active) {
      const pts = [plannedRoute.origin, ...getPlannedPlaces()]
        .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map(p => [p.lat, p.lng]);
      if (pts.length >= 2) {
        follow = false;
        updateFollowUi();
        setTimeout(() => {
          map.invalidateSize();
          map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
        }, 80);
      }
    }
  });

  let autoPlacesQueued = false;
  let queuedAutoPlacesTarget = null;
  let queuedAutoPlacesOpts = {};

  function getVisibleMapSearchRadiusM(centerPos) {
    if (!map) return 6000;
    try {
      const bounds = map.getBounds();
      const ne = bounds?.getNorthEast?.();
      if (ne && centerPos) {
        const dist = haversineMeters(centerPos, { lat: ne.lat, lng: ne.lng });
        if (Number.isFinite(dist) && dist > 1000) {
          return Math.max(4500, Math.min(12000, Math.round(dist * 0.9)));
        }
      }
    } catch {}
    return 6000;
  }

  function updateScanMapAreaButtonState() {
    const scanBtn = $('btn-scan-map-area');
    if (!scanBtn || !map) return;
    const c = map.getCenter();
    const curOrigin = getRouteOriginPoint();
    const distFromOriginM = curOrigin ? (haversineMeters(curOrigin, { lat: c.lat, lng: c.lng }) ?? 0) : 0;
    const pannedAway = distFromOriginM > 450;
    scanBtn.classList.toggle('is-panned-away', pannedAway);
    if (active || demo) {
      scanBtn.hidden = !pannedAway;
      scanBtn.textContent = '✨ Načíst zajímavá místa v této části mapy';
    } else {
      scanBtn.hidden = false;
      scanBtn.textContent = pannedAway
        ? '✨ Načíst zajímavá místa v této oblasti mapy a navrhnout trasu'
        : '✨ Načíst další zajímavá místa z mapy v okolí';
    }
  }

  let autoPlacesReqId = 0;

  async function refreshAutoPlaces(targetPos = null, opts = {}) {
    if (autoPlacesLoading && !opts.autoPlan && !opts.forceRefresh) {
      return;
    }
    const myReqId = ++autoPlacesReqId;
    autoPlacesLoading = true;
    const originPos = targetPos || plannedRoute.origin || lastFix || { lat: 49.6014, lng: 13.8644 };
    const radiusM = opts.radiusM || getVisibleMapSearchRadiusM(originPos);
    const scanBtn = $('btn-scan-map-area');
    const p1ScanBtn = $('btn-p1-scan-map');
    if (scanBtn) scanBtn.classList.add('is-loading');
    if (p1ScanBtn) p1ScanBtn.classList.add('is-loading');
    const placesTaskId = beginMapTask('⏳ Načítám místa v okolí…');

    try {
      const autoPlaces = await loadAutoPlacesForArea(
        originPos,
        routes,
        config,
        aborter.signal,
        fetch,
        null,
        { radiusM, forceRefresh: Boolean(opts.forceRefresh) }
      );
      const loadStatus = getLastAutoPlacesStatus();
      if (!disposed && $('nearby-status')) {
        if (loadStatus.loadFailed) {
          $('nearby-status').textContent = 'Místa v okolí se nepodařilo načíst';
        } else if (Array.isArray(autoPlaces) && autoPlaces.length > 0) {
          $('nearby-status').textContent = '';
        }
      }
      if (!disposed && Array.isArray(autoPlaces) && autoPlaces.length > 0) {
        const mergedById = new Map();
        for (const p of autoPlaces) {
          if (p && p.id) mergedById.set(p.id, p);
        }
        for (const p of nearby) {
          if (p && p.id && !mergedById.has(p.id)) mergedById.set(p.id, p);
        }
        nearby = [...mergedById.values()].slice(0, 800);
        renderPlaces();
        if (myReqId === autoPlacesReqId && opts.autoPlan && !active && !demo) {
          applyPhase1QuickSelection(Boolean(opts.silent));
          status(`✨ V oblasti „${plannedRoute.origin?.label || 'mapa'}“ nalezeno ${autoPlaces.length} zajímavých míst — trasa byla navržena!`);
        } else if (myReqId === autoPlacesReqId) {
          renderQuestHud(lastFix || plannedRoute.origin);
        }
      } else if (!disposed && myReqId === autoPlacesReqId && opts.autoPlan && !active && !demo) {
        applyPhase1QuickSelection(Boolean(opts.silent));
      }
    } catch {
      if (!disposed && $('nearby-status')) {
        $('nearby-status').textContent = 'Místa v okolí se nepodařilo načíst';
      }
    }
    finally {
      endMapTask(placesTaskId);
      if (myReqId === autoPlacesReqId) {
        autoPlacesLoading = false;
        if (scanBtn) scanBtn.classList.remove('is-loading');
        if (p1ScanBtn) p1ScanBtn.classList.remove('is-loading');
        updateScanMapAreaButtonState();
        if (pendingAutoPanCenter && !disposed) {
          const nextCenter = pendingAutoPanCenter;
          pendingAutoPanCenter = null;
          refreshAutoPlaces(nextCenter, { silent: true, autoPlan: false, forceRefresh: false });
        }
      }
    }
  }
  refreshAutoPlaces();
  refreshWeatherStrip();

  async function scanCurrentMapViewAndPlan() {
    if (!map) return;
    const c = map.getCenter();
    const mapCenterPt = { lat: Number(c.lat.toFixed(5)), lng: Number(c.lng.toFixed(5)) };

    // Pokud je blízko některého pojmenovaného presetu nebo místa v katalogu, převezmeme jeho pěkný název
    let areaLabel = `Oblast v mapě [${mapCenterPt.lat.toFixed(3)}, ${mapCenterPt.lng.toFixed(3)}]`;
    let areaId = 'map-view-origin';
    for (const preset of CZECH_PLACE_PRESETS) {
      if ((haversineMeters(mapCenterPt, preset) ?? Infinity) < 1800) {
        areaLabel = preset.label.split('(')[0].trim();
        areaId = preset.id;
        break;
      }
    }
    if (areaId === 'map-view-origin') {
      const closestKnown = getAllAvailablePlaces()
        .map(p => ({ p, d: haversineMeters(mapCenterPt, p) ?? Infinity }))
        .sort((a, b) => a.d - b.d)[0];
      if (closestKnown && closestKnown.d < 1600) {
        areaLabel = `Okolí: ${closestKnown.p.title}`;
      }
    }

    if (!active && !demo) {
      pickingStartOnMap = false;
      pickingCustomEndOnMap = false;
      userExplicitlyPickedOrigin = true;
      plannedRoute.origin = {
        id: areaId,
        label: areaLabel,
        lat: mapCenterPt.lat,
        lng: mapCenterPt.lng,
        custom: true,
      };
      status(`🔍 Hledám zajímavá místa v této části mapy (${areaLabel}) a sestavuji trasu…`);
      playTick(stateObj.soundEnabled);
      refreshWeatherStrip(mapCenterPt);
      await refreshAutoPlaces(mapCenterPt, { autoPlan: true, forceRefresh: true });
    } else {
      status(`🔍 Načítám zajímavá místa v zobrazené části mapy…`);
      playTick(stateObj.soundEnabled);
      await refreshAutoPlaces(mapCenterPt, { autoPlan: false, forceRefresh: true });
    }
  }

  async function searchCzechPlaceAndPlan(rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) {
      status('Zadej název města nebo místa v ČR (např. Příbram, Brdy, Karlštejn, Tábor)…');
      return;
    }
    const qNorm = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 1. Zkontrolujeme nejdříve rychlé presety a vestavěný katalog (okamžitá odezva 0 ms)
    const matchedPreset = CZECH_PLACE_PRESETS.find(p =>
      p.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(qNorm) ||
      p.id.toLowerCase().includes(qNorm)
    );
    if (matchedPreset) {
      userExplicitlyPickedOrigin = true;
      plannedRoute.origin = { id: matchedPreset.id, label: matchedPreset.label, lat: matchedPreset.lat, lng: matchedPreset.lng };
      if (map) {
        follow = false;
        updateFollowUi();
        map.setView([matchedPreset.lat, matchedPreset.lng], 13);
      }
      refreshWeatherStrip(matchedPreset);
      applyPhase1QuickSelection(true);
      await refreshAutoPlaces(matchedPreset, { autoPlan: true, forceRefresh: true });
      playStampChord(stateObj.soundEnabled);
      return;
    }

    status(`🔍 Hledám „${query}“ na mapě ČR…`);
    const results = await searchPlaceNominatim(query, aborter.signal);
    if (Array.isArray(results) && results.length > 0) {
      const best = results[0];
      const targetOrigin = {
        id: best.id || `cz-${Date.now()}`,
        label: best.shortLabel || best.label || query,
        lat: best.lat,
        lng: best.lng,
        custom: true,
      };
      userExplicitlyPickedOrigin = true;
      plannedRoute.origin = targetOrigin;
      if (map) {
        follow = false;
        updateFollowUi();
        map.setView([targetOrigin.lat, targetOrigin.lng], 13);
      }
      refreshWeatherStrip(targetOrigin);
      await refreshAutoPlaces(targetOrigin, { autoPlan: true, forceRefresh: true });
      playStampChord(stateObj.soundEnabled);
    } else {
      status(`Místo „${query}“ se nepodařilo najít. Zkus jiný název obce nebo posuň mapu ručně.`);
    }
  }

  $('btn-scan-map-area')?.addEventListener('click', () => {
    scanCurrentMapViewAndPlan();
  });

  // Bod 27: Uspořádat zastávky podle skutečné pěší vzdálenosti (zachová již navštívené zastávky a počítá od současné polohy při chůzi)
  $('btn-optimize-route')?.addEventListener('click', () => {
    const plannedPlaces = getPlannedPlaces();
    if (plannedPlaces.length < 2) return;
    const isLoop = plannedRoute.routeType === 'loop';
    const ordered = optimizeRouteOrder(plannedRoute.origin, plannedPlaces, {
      returnToOrigin: isLoop,
      visitedStopIds: confirmedStopIds,
      currentPosition: (active && lastFix) ? lastFix : null,
    });
    plannedRoute.selectedPlaceIds = ordered.map(p => p.id);
    playHammer(stateObj.soundEnabled);
    recalculateRemainingRoute('Zastávky byly uspořádány podle skutečné pěší vzdálenosti (se zachováním již navštívených míst).');
  });

  // Sdílení a import kódu trasy
  $('btn-share-route-code')?.addEventListener('click', async () => {
    try {
      const code = encodeRouteShareCode(plannedRoute, getAllAvailablePlaces());
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        status(`Kód trasy ${code} byl zkopírován do schránky!`);
      } else {
        status(`Kód trasy: ${code}`);
      }
      playTick(stateObj.soundEnabled);
    } catch (err) {
      status('Chyba při kódování trasy: ' + err.message);
    }
  });

  $('btn-import-route-code')?.addEventListener('click', () => {
    const input = window.prompt('Vlož sdílený kód trasy (např. CZK1-...):');
    if (!input) return;
    try {
      const available = getAllAvailablePlaces();
      const plan = decodeRouteShareCode(input.trim(), available);
      const check = validateDecodedRoutePlan(plan, available);
      if (!check.valid) {
        throw new Error(check.reason);
      }
      plannedRoute = {
        ...plannedRoute,
        ...plan,
        embeddedStops: Array.isArray(plan.embeddedStops) ? plan.embeddedStops : [],
      };
      stateObj.companionMode = plan.companionMode;
      stateObj.explorationMode = plan.explorationMode;
      recalculateRemainingRoute(`Sdílená trasa (${plan.selectedPlaceIds.length} zastávek) byla ověřena a načtena!`);
      playStampChord(stateObj.soundEnabled);
    } catch (err) {
      status('Kód trasy nebyl načten (původní plán zachován): ' + err.message);
    }
  });

  // Přepínač mapového stylu / mlhy (Pergamen / Čistá mapa / Plná mlha)
  const FOG_MODE_ORDER = ['explore', 'none', 'full'];
  function updateFogToggleLabel() {
    const btn = $('walk-fog-toggle');
    if (!btn) return;
    if (fogMode === 'none') {
      btn.textContent = '🗺️';
      btn.title = 'Přepnout pergamen / běžnou mapu (nyní: Čistá mapa)';
      btn.setAttribute('aria-label', 'Přepnout pergamen nebo běžnou mapu');
    } else if (fogMode === 'full') {
      btn.textContent = '🌑';
      btn.title = 'Přepnout pergamen / běžnou mapu (nyní: Plná mlha)';
      btn.setAttribute('aria-label', 'Přepnout pergamen nebo běžnou mapu');
    } else {
      btn.textContent = '📜';
      btn.title = 'Přepnout pergamen / běžnou mapu (nyní: Pergamen)';
      btn.setAttribute('aria-label', 'Přepnout pergamen nebo běžnou mapu');
    }
    btn.dataset.fogMode = fogMode;
    btn.classList.toggle('active', fogMode !== 'none');
  }
  $('walk-fog-toggle')?.addEventListener('click', () => {
    const idx = FOG_MODE_ORDER.indexOf(fogMode);
    fogMode = FOG_MODE_ORDER[(idx + 1) % FOG_MODE_ORDER.length];
    updateFogToggleLabel();
    playTick(stateObj.soundEnabled);
    scheduleFog();
  });
  updateFogToggleLabel();

  // ZADÁNÍ #09 (Fáze 1): Okamžitý výpočet trasy podle 3 rychlých voleb (Co chci vidět / Délka / Kde končím)
  function getCategoriesForPhase1Theme(theme) {
    if (theme === 'castles') return ['castles', 'town'];
    if (theme === 'nature') return ['nature', 'views'];
    if (theme === 'water') return ['water', 'nature'];
    return PLANNER_CATEGORIES.map(c => c.id);
  }

  function applyPhase1QuickSelection(silent = false) {
    const cats = getCategoriesForPhase1Theme(phase1Theme);
    plannedRoute.categories = cats;
    plannedRoute.targetKm = phase1DurationKm;
    plannedRoute.companionMode = 'solo';
    plannedRoute.terrainDifficulty = 'medium';
    wizardCategories = [...cats];
    wizardDistanceMode = String(phase1DurationKm);

    const originPt = getRouteOriginPoint();
    const rawAllPlaces = getAllAvailablePlaces();
    const localPlaces = rawAllPlaces.filter(p => (haversineMeters(originPt, p) ?? Infinity) <= 15000);
    const allPlaces = localPlaces.length > 0 ? localPlaces : rawAllPlaces;
    let pool = allPlaces.filter(p => {
      if (phase1Theme === 'all') return true;
      if (phase1Theme === 'castles') return p.category === 'castles' || p.kind === 'culture' || p.kind === 'heritage' || p.kind === 'castle';
      if (phase1Theme === 'nature') return p.category === 'nature' || p.category === 'views' || p.kind === 'view' || p.kind === 'nature' || p.kind === 'peak';
      if (phase1Theme === 'water') return p.category === 'water' || p.kind === 'water' || p.kind === 'spring';
      return true;
    });
    if (pool.length < 2) pool = allPlaces;

    let trip = autoSuggestTrip({
      origin: originPt,
      targetKm: phase1DurationKm,
      companionMode: 'solo',
      terrainDifficulty: 'medium',
      availablePlaces: pool,
      discoveries: progress.discoveries,
    });
    if (!trip.found) {
      trip = autoSuggestTrip({
        origin: originPt,
        targetKm: phase1DurationKm,
        companionMode: 'solo',
        terrainDifficulty: 'medium',
        availablePlaces: allPlaces,
        discoveries: progress.discoveries,
      });
    }

    if (trip.found && trip.selectedPlaceIds.length > 0) {
      if (phase1EndMode === 'custom') {
        plannedRoute.routeType = 'oneway';
        const existingCustomEnd = (plannedRoute.embeddedStops || []).find(s => s.id === 'custom-end-stop');
        const baseIds = trip.selectedPlaceIds.filter(id => id !== 'custom-end-stop');
        plannedRoute.selectedPlaceIds = existingCustomEnd ? [...baseIds, 'custom-end-stop'] : baseIds;
      } else {
        plannedRoute.routeType = 'loop';
        plannedRoute.selectedPlaceIds = trip.selectedPlaceIds;
      }

      // Uložíme dynamicky načtené body (OSM / Wikipedia) do embeddedStops, aby trasa kdekoliv v ČR zůstala trvale uložená
      const catalogueIds = new Set(catalogue.map(c => c.id));
      const existingEmbedded = (plannedRoute.embeddedStops || []).filter(s => s && s.id === 'custom-end-stop');
      const dynamicSelected = plannedRoute.selectedPlaceIds
        .filter(id => !catalogueIds.has(id) && id !== 'custom-end-stop')
        .map(id => allPlaces.find(p => p.id === id))
        .filter(Boolean)
        .map(p => ({
          id: p.id,
          title: p.title,
          lat: p.lat,
          lng: p.lng,
          kind: p.kind || 'nature',
          category: p.category || 'nature',
        }));
      plannedRoute.embeddedStops = [...existingEmbedded, ...dynamicSelected];
    }

    lastRoutedGeometry = null;
    recalculateRemainingRoute(
      silent ? '' : `Trasa upravena: ~${phase1DurationKm} km · ${plannedRoute.selectedPlaceIds.length} zastávky.`
    );
  }

  // Události Fáze 1: Panel voleb herního režimu a filtrů (#phase1-bottom-bar)
  $('phase1-bottom-bar')?.addEventListener('click', (ev) => {
    const gmBtn = ev.target.closest('[data-p1-gamemode]');
    if (gmBtn) {
      const parent = gmBtn.parentElement;
      if (parent) {
        parent.querySelectorAll('[data-p1-gamemode]').forEach(btn => {
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
        });
      }
      gmBtn.classList.add('active');
      gmBtn.setAttribute('aria-pressed', 'true');
      applyGameMode(gmBtn.dataset.p1Gamemode);
      renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
      return;
    }

    const themeBtn = ev.target.closest('[data-p1-theme]');
    if (themeBtn) {
      const parent = themeBtn.parentElement;
      if (parent) {
        parent.querySelectorAll('[data-p1-theme]').forEach(btn => {
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
        });
      }
      themeBtn.classList.add('active');
      themeBtn.setAttribute('aria-pressed', 'true');
      phase1Theme = themeBtn.dataset.p1Theme || 'all';
      const cats = phase1Theme === 'castles'
        ? ['castles']
        : phase1Theme === 'nature'
          ? ['nature', 'views']
          : phase1Theme === 'water'
            ? ['water']
            : PLANNER_CATEGORIES.map(c => c.id);
      plannedRoute.categories = [...cats];
      wizardCategories = [...cats];
      renderPlaces();
      renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
      playTick(stateObj.soundEnabled);
      return;
    }
  });

  // 2.2 Lupa vyhledávání přímo v mapě (#map-lupa-search-input)
  async function performInMapLupaSearch(rawQuery) {
    const resultsBox = $('map-lupa-search-results');
    const clearBtn = $('map-lupa-search-clear');
    const q = String(rawQuery || '').trim();
    if (clearBtn) clearBtn.hidden = q.length === 0;
    if (!resultsBox) return;
    if (q.length < 2) {
      resultsBox.hidden = true;
      resultsBox.innerHTML = '';
      return;
    }

    const qNorm = normalizeSearchQuery(q);
    const localCandidates = [
      ...CZECH_PLACE_PRESETS.map(p => ({ id: p.id, title: p.label, lat: p.lat, lng: p.lng, sub: 'Město / oblast v ČR' })),
      ...getAllAvailablePlaces().map(p => ({ id: p.id, title: p.title, lat: p.lat, lng: p.lng, sub: 'Zajímavé místo v okolí', kind: p.kind, category: p.category })),
    ].filter(item => normalizeSearchQuery(item.title).includes(qNorm));

    let nominatimItems = [];
    if (localCandidates.length < 5) {
      try {
        const nom = await searchPlaceNominatim(q, aborter.signal);
        nominatimItems = (nom || []).map((n, i) => ({
          id: `nom-${Date.now()}-${i}`,
          title: n.label.split(',')[0].trim(),
          sub: n.label,
          lat: n.lat,
          lng: n.lng,
          kind: 'culture',
          category: 'views',
        }));
      } catch {}
    }

    const combined = [...localCandidates, ...nominatimItems].slice(0, 8);
    lastLupaResults = combined;

    if (combined.length === 0) {
      resultsBox.hidden = false;
      resultsBox.innerHTML = `<div class="map-search-item"><span class="map-search-item-sub">Nic nenalezeno pro „${e(q)}“. Zkus jiný název města nebo památky.</span></div>`;
      return;
    }

    resultsBox.hidden = false;
    resultsBox.innerHTML = combined.map((item, idx) => `
      <div class="map-search-item" role="option" data-lupa-idx="${idx}">
        <div class="map-search-item-head">
          <strong class="map-search-item-title">${e(item.title)}</strong>
          <span class="map-search-item-sub">${e(item.sub || '')}</span>
        </div>
        <div class="map-search-item-actions">
          <button type="button" class="button small map-search-action-btn start-here" data-lupa-action="start" data-lupa-idx="${idx}">
            📍 Začít výpravu zde
          </button>
          <button type="button" class="button small map-search-action-btn add-stop" data-lupa-action="add" data-lupa-idx="${idx}">
            + Přidat do trasy
          </button>
        </div>
      </div>
    `).join('');
  }

  $('map-lupa-search-input')?.addEventListener('input', (ev) => {
    const val = ev.target.value;
    if (lupaSearchTimer) clearTimeout(lupaSearchTimer);
    lupaSearchTimer = setTimeout(() => {
      performInMapLupaSearch(val);
    }, 240);
  });

  $('map-lupa-search-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (lupaSearchTimer) clearTimeout(lupaSearchTimer);
      performInMapLupaSearch(ev.currentTarget.value);
    }
  });

  $('map-lupa-search-clear')?.addEventListener('click', () => {
    const inp = $('map-lupa-search-input');
    if (inp) inp.value = '';
    if ($('map-lupa-search-clear')) $('map-lupa-search-clear').hidden = true;
    if ($('map-lupa-search-results')) {
      $('map-lupa-search-results').hidden = true;
      $('map-lupa-search-results').innerHTML = '';
    }
  });

  $('map-lupa-search-results')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-lupa-action]');
    if (!btn) return;
    const action = btn.dataset.lupaAction;
    const idx = Number(btn.dataset.lupaIdx);
    const item = lastLupaResults[idx];
    if (!item) return;

    if ($('map-lupa-search-results')) $('map-lupa-search-results').hidden = true;

    if (action === 'start') {
      userExplicitlyPickedOrigin = true;
      plannedRoute.origin = {
        id: item.id || `lupa-${Date.now()}`,
        label: item.title,
        lat: item.lat,
        lng: item.lng,
        custom: true,
      };
      if (map) {
        follow = false;
        updateFollowUi();
        map.setView([item.lat, item.lng], 14);
      }
      refreshWeatherStrip(plannedRoute.origin);
      refreshAutoPlaces(plannedRoute.origin, { autoPlan: false, forceRefresh: true });
      recalculateRemainingRoute(`📍 Start výpravy nastaven na: ${item.title}.`);
      playStampChord(stateObj.soundEnabled);
    } else if (action === 'add') {
      const stopObj = {
        id: item.id || `stop-${Date.now()}`,
        title: item.title,
        lat: item.lat,
        lng: item.lng,
        kind: item.kind || 'culture',
        category: item.category || 'views',
      };
      if (!plannedRoute.embeddedStops) plannedRoute.embeddedStops = [];
      if (!getAllAvailablePlaces().some(p => p.id === stopObj.id)) {
        plannedRoute.embeddedStops.push(stopObj);
      }
      const curStops = getPlannedPlaces();
      const inserted = insertStopAtBestPosition(getRouteOriginPoint(), curStops, stopObj, {
        returnToOrigin: plannedRoute.routeType === 'loop',
        visitedStopIds: confirmedStopIds,
        currentPosition: (active || demo) && lastFix ? lastFix : null,
      });
      plannedRoute.selectedPlaceIds = inserted.map(p => p.id);
      if (map) {
        follow = false;
        updateFollowUi();
        map.setView([item.lat, item.lng], Math.max(map.getZoom(), 14));
      }
      recalculateRemainingRoute(`+ Místo „${item.title}“ přidáno do trasy.`);
      playStampChord(stateObj.soundEnabled);
    }
  });

  // 7.2 Tlačítko „📥 Stáhnout tuto oblast offline“ (#btn-download-offline-map)
  $('btn-download-offline-map')?.addEventListener('click', async () => {
    const banner = $('offline-download-banner');
    const bounds = map ? map.getBounds() : { south: 49.56, west: 13.80, north: 49.64, east: 13.92 };
    const center = map ? map.getCenter() : getRouteOriginPoint();
    if (banner) {
      banner.hidden = false;
      banner.textContent = 'Stahuji mapu do paměti: 0 %...';
    }
    playTick(stateObj.soundEnabled);
    await downloadOfflineArea({
      bounds,
      center: { lat: center.lat, lng: center.lng },
      places: getAllAvailablePlaces(),
      plannedRoute,
      onProgress: (info) => {
        if (banner) {
          banner.hidden = false;
          banner.textContent = info.text;
        }
        status(info.text);
      },
    });
    playStampChord(stateObj.soundEnabled);
    setTimeout(() => {
      if (banner && !disposed) banner.hidden = true;
    }, 4500);
  });

  // 8.2 Kapesní režim (#btn-pocket-mode a #pocket-mode-overlay)
  function setPocketModeUi(enabled) {
    keepAliveCtrl.setPocketMode(enabled);
    const overlay = $('pocket-mode-overlay');
    if (!overlay) return;
    overlay.hidden = !enabled;
    if (enabled) {
      const plannedPlaces = getPlannedPlaces();
      const rem = computeRemainingFromSharedRoute({
        sharedRoute: lastRoutedGeometry,
        currentPos: lastFix || getRouteOriginPoint(),
        plannedPlaces,
        confirmedStopIds,
        companionMode: 'solo',
        returnToOrigin: plannedRoute.routeType === 'loop',
        origin: getRouteOriginPoint(),
      });
      const statsEl = $('pocket-mode-stats');
      if (statsEl) {
        if (rem.nextStop) {
          statsEl.textContent = `Další cíl: ${rem.nextStop.title} (${formatDistanceLabel(rem.nextStopDistanceM)})`;
        } else if (plannedPlaces.length > 0) {
          statsEl.textContent = `Zbývá do cíle: ${formatDistanceLabel(rem.remainingDistanceM)}`;
        } else {
          const gainedM = currentExpedition ? Math.max(0, progress.meters - (currentExpedition.startMeters || 0)) : progress.meters;
          statsEl.textContent = `Ušlá vzdálenost: ${formatMetersCz(gainedM)}`;
        }
      }
    }
  }

  $('btn-pocket-mode')?.addEventListener('click', () => {
    setPocketModeUi(true);
    playTick(stateObj.soundEnabled);
  });

  $('btn-pocket-unlock')?.addEventListener('click', () => {
    setPocketModeUi(false);
    playTick(stateObj.soundEnabled);
  });

  $('pocket-mode-overlay')?.addEventListener('dblclick', () => {
    setPocketModeUi(false);
    playTick(stateObj.soundEnabled);
  });

  $('pocket-mode-overlay')?.addEventListener('click', (ev) => {
    if (ev.target === $('pocket-mode-overlay') || !ev.target.closest('.pocket-mode-box')) {
      setPocketModeUi(false);
      playTick(stateObj.soundEnabled);
    }
  });

  // 1.2 Krok 4: Obsluha tlačítek v dialogu „🎉 Jsi v cíli své trasy! Co chceš udělat dál?“
  $('arrival-goal-modal')?.addEventListener('click', (ev) => {
    if (ev.target === $('arrival-goal-modal') || !ev.target.closest('.arrival-goal-dialog')) {
      $('arrival-goal-modal').hidden = true;
      playTick(stateObj.soundEnabled);
    }
  });

  $('btn-arrival-close-x')?.addEventListener('click', () => {
    if ($('arrival-goal-modal')) $('arrival-goal-modal').hidden = true;
    playTick(stateObj.soundEnabled);
  });

  $('btn-arrival-return-start')?.addEventListener('click', () => {
    if ($('arrival-goal-modal')) $('arrival-goal-modal').hidden = true;
    shortenRouteToStart();
  });

  $('btn-arrival-finish-postcard')?.addEventListener('click', () => {
    if ($('arrival-goal-modal')) $('arrival-goal-modal').hidden = true;
    finishUnifiedExpedition();
  });

  // Interaktivní itinerář zastávek v horní liště (#top-route-itinerary-strip)
  $('top-route-itinerary-strip')?.addEventListener('click', (ev) => {
    const removeBtn = ev.target.closest('[data-itinerary-remove]');
    if (removeBtn) {
      ev.stopPropagation();
      const idx = Number(removeBtn.dataset.itineraryRemove);
      const ids = plannedRoute.selectedPlaceIds || [];
      const removedPlace = getAllAvailablePlaces().find(p => p.id === ids[idx]);
      plannedRoute.selectedPlaceIds = removePlannedStop(ids, idx);
      playTick(stateObj.soundEnabled);
      recalculateRemainingRoute(`✕ Zastávka „${removedPlace?.title || ''}“ byla vynechána z trasy.`);
      return;
    }

    const focusBtn = ev.target.closest('[data-itinerary-focus]');
    if (focusBtn) {
      const placeId = focusBtn.dataset.itineraryFocus;
      const place = getAllAvailablePlaces().find(p => p.id === placeId);
      if (place) {
        if (map) {
          follow = false;
          updateFollowUi();
          map.setView([place.lat, place.lng], Math.max(map.getZoom(), 15), { animate: true });
        }
        renderSelectedPlaceDetail(place);
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    if (ev.target.closest('[data-itinerary-start]')) {
      const orig = getRouteOriginPoint();
      if (map && orig) {
        follow = false;
        updateFollowUi();
        map.setView([orig.lat, orig.lng], Math.max(map.getZoom(), 14), { animate: true });
        playTick(stateObj.soundEnabled);
      }
    }
  });

  // Tlačítka v horní liště (#phase1-top-bar): Celá obrazovka, Upravit zastávky, Nastavení, Pauza, Sbalit volby
  $('btn-top-fullscreen')?.addEventListener('click', () => {
    zenMode = !zenMode;
    updateZenMode();
    playTick(stateObj.soundEnabled);
  });

  $('btn-top-edit-walk')?.addEventListener('click', () => {
    openEditWalkModal();
    playTick(stateObj.soundEnabled);
  });

  $('btn-top-settings')?.addEventListener('click', () => {
    appSettingsModalOpen = true;
    const modal = $('app-settings-modal');
    if (modal) modal.hidden = false;
    renderAppSettingsModalUi();
    playTick(stateObj.soundEnabled);
  });

  $('btn-top-pause')?.addEventListener('click', () => {
    togglePauseUnified();
  });

  $('btn-toggle-p1-bar')?.addEventListener('click', () => {
    p1PlannerCollapsed = !p1PlannerCollapsed;
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
    playTick(stateObj.soundEnabled);
  });

  // DÁVKA 1 (Bod 2.1): Kliknutí na „▶ Vyrazit“ okamžitě zahájí proces startu (locating),
  // i když uživatel nemá naklikanou žádnou trasu (volná procházka).
  $('btn-phase1-go')?.addEventListener('click', () => {
    pickingCustomEndOnMap = false;
    pickingStartOnMap = false;
    phase4MenuOpen = false;
    follow = true;
    updateFollowUi();
    startUnifiedExpedition('top-bar');
  });

  // Události Fáze 4: [ 🏁 Dokončit / Zkrátit ] -> 2 možnosti
  $('btn-phase4-toggle')?.addEventListener('click', () => {
    phase4MenuOpen = !phase4MenuOpen;
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);
    playTick(stateObj.soundEnabled);
  });

  // 1) 🏠 Už chci do cíle (Zkrátit trasu)
  $('btn-phase4-shorten')?.addEventListener('click', async () => {
    phase4MenuOpen = false;
    renderPhase1AndPhase4Ui(lastFix || telemetry.lastKnownPosition);

    const startOrigin = getRouteOriginPoint();
    const planned = getPlannedPlaces();
    const finalTarget = (plannedRoute.routeType === 'oneway' && planned.length > 0)
      ? planned[planned.length - 1]
      : startOrigin;

    const fromPos = lastFix || telemetry.lastKnownPosition || map?.getCenter() || startOrigin;
    const curPoint = { lat: Number(fromPos.lat), lng: Number(fromPos.lng) };
    playStampChord(stateObj.soundEnabled);
    status('🏠 Zkracuji trasu — počítám nejkratší pěší cestu rovnou do cíle…');

    let retRoute = null;
    const shortenTaskId = beginMapTask('⏳ Počítám trasu…');
    try {
      retRoute = await buildReturnToOriginRoute(curPoint, finalTarget);
    } finally {
      endMapTask(shortenTaskId);
    }
    if (disposed || !retRoute) return;

    const returnStopId = 'return-origin-stop';
    const returnStopObj = {
      id: returnStopId,
      title: finalTarget.title || finalTarget.label || 'Cíl výpravy',
      lat: finalTarget.lat,
      lng: finalTarget.lng,
      kind: 'town',
      category: 'views',
    };
    plannedRoute.embeddedStops = [
      ...(plannedRoute.embeddedStops || []).filter(s => s.id !== returnStopId),
      returnStopObj,
    ];
    const visitedIds = (plannedRoute.selectedPlaceIds || []).filter(id => confirmedStopIds.has(id));
    plannedRoute.selectedPlaceIds = [...visitedIds, returnStopId];
    plannedRoute.routeType = 'oneway';
    lastRoutedGeometry = retRoute;
    fakeGpsSim?.setSharedWalkingRoute(lastRoutedGeometry);

    recalculateRemainingRoute(
      `🏠 Trasa zkrácena — naviguji nejkratší pěší cestou rovnou do cíle (${formatDistanceLabel(retRoute.distanceM)}).`
    );
  });

  // 2) ⏹ Ukončit výpravu hned tady (bez penalizace, se štítkem na hůl a pohlednicí)
  $('btn-phase4-finish-now')?.addEventListener('click', () => {
    phase4MenuOpen = false;
    finishExpedition();
  });

  // DÁVKA 1 (Bod 2.1 & 2.3): Přímé akce z trvale viditelné lišty u mapy (.map-action-bar)
  $('walk-start-unified')?.addEventListener('click', () => {
    pickingCustomEndOnMap = false;
    pickingStartOnMap = false;
    startUnifiedExpedition('bar');
  });

  $('btn-toggle-quick-planner')?.addEventListener('click', () => {
    p1PlannerCollapsed = !p1PlannerCollapsed;
    renderPhase1AndPhase4Ui(lastFix || plannedRoute.origin);
    playTick(stateObj.soundEnabled);
  });

  $('walk-finish')?.addEventListener('click', () => {
    finishUnifiedExpedition();
  });

  $('walk-shorten-to-start')?.addEventListener('click', () => {
    shortenRouteToStart();
  });

  $('walk-pause')?.addEventListener('click', () => {
    togglePauseUnified();
  });

  $('walk-more-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    moreMenuOpen = !moreMenuOpen;
    const menu = $('walk-more-menu');
    if (menu) menu.hidden = !moreMenuOpen;
    $('walk-more-btn')?.setAttribute('aria-expanded', String(moreMenuOpen));
    playTick(stateObj.soundEnabled);
  });

  $('walk-more-settings')?.addEventListener('click', () => {
    moreMenuOpen = false;
    if ($('walk-more-menu')) $('walk-more-menu').hidden = true;
    $('walk-more-btn')?.setAttribute('aria-expanded', 'false');
    appSettingsModalOpen = true;
    const modal = $('app-settings-modal');
    if (modal) modal.hidden = false;
    renderAppSettingsModalUi();
    playTick(stateObj.soundEnabled);
  });

  $('walk-search-toggle')?.addEventListener('click', () => {
    const searchInput = $('map-lupa-search-input');
    if (searchInput) {
      searchInput.focus();
      searchInput.select?.();
    }
    playTick(stateObj.soundEnabled);
  });

  // Přepínač vrstvy turistických tras KČT (Waymarked Trails + lokální trasy OSM)
  function syncHikingTrailsLayerState() {
    const btn = $('walk-trails-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(showHikingTrails));
      btn.classList.toggle('active', showHikingTrails);
      btn.textContent = showHikingTrails ? '🥾 Turistické značky KČT: ZAP' : '🥾 Turistické značky KČT: VYP';
    }
    if ($('wiz-chk-trails')) $('wiz-chk-trails').checked = showHikingTrails;
    if (map && waymarkedHikingLayer) {
      if (showHikingTrails && !map.hasLayer(waymarkedHikingLayer)) {
        waymarkedHikingLayer.addTo(map);
      } else if (!showHikingTrails && map.hasLayer(waymarkedHikingLayer)) {
        map.removeLayer(waymarkedHikingLayer);
      }
    }
    renderHikingTrailsOnMap();
  }

  async function switchMapBase() {
    if (!map || disposed) return;
    const button = $('walk-map-base');
    const token = ++mapBaseSwitchToken;
    if (mapBase === 'maplibre') {
      mapBase = 'original';
      if (mapLibreLayer && map.hasLayer(mapLibreLayer)) map.removeLayer(mapLibreLayer);
      mapLibreLayer = null;
      if (!map.hasLayer(tileLayer)) tileLayer.addTo(map);
      setContourLayer(showContourLayer);
      button?.setAttribute('aria-pressed', 'false');
      button?.setAttribute('aria-label', 'Mapa: původní. Přepnout na moderní mapu');
      if ($('walk-map-base-label')) $('walk-map-base-label').textContent = 'Původní';
      status('Zobrazena původní mapa. Průzkum a trasa zůstávají zachované.');
      scheduleFog();
      return;
    }
    if (button) button.disabled = true;
    status('Načítám moderní mapu…');
    let layer = null;
    try {
      layer = await makeMapLibreLayer(L);
      if (disposed || token !== mapBaseSwitchToken) return;
      layer.addTo(map);
      const glMap = layer.getMaplibreMap();
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Podklad mapy se nepodařilo načíst.')); }, 15000);
        function cleanup() { clearTimeout(timeout); glMap.off('load', onLoad); glMap.off('error', onError); }
        function onLoad() { cleanup(); resolve(); }
        function onError(event) { if (!glMap.isStyleLoaded()) { cleanup(); reject(event.error || new Error('Mapa není dostupná.')); } }
        if (glMap.loaded()) { cleanup(); resolve(); return; }
        glMap.on('load', onLoad);
        glMap.on('error', onError);
      });
      if (disposed || token !== mapBaseSwitchToken) { if (map?.hasLayer(layer)) map.removeLayer(layer); return; }
      mapLibreLayer = layer;
      mapBase = 'maplibre';
      if (map.hasLayer(tileLayer)) map.removeLayer(tileLayer);
      setContourLayer(showContourLayer);
      button?.setAttribute('aria-pressed', 'true');
      button?.setAttribute('aria-label', 'Mapa: moderní. Přepnout na původní mapu');
      if ($('walk-map-base-label')) $('walk-map-base-label').textContent = 'Moderní';
      status('Zobrazena moderní mapa MapLibre ve 2D. Průzkum a trasa zůstávají zachované.');
      scheduleFog();
    } catch (error) {
      if (layer && map?.hasLayer(layer)) {
        try { map.removeLayer(layer); } catch { /* MapLibre se nemusel inicializovat. */ }
      }
      if (!disposed) status('Moderní mapa není dostupná. Zůstává původní mapa; zkus to později.');
    } finally {
      if (button && !disposed) button.disabled = false;
    }
  }

  $('walk-map-base')?.addEventListener('click', switchMapBase, { signal: aborter.signal });

  $('walk-trails-toggle')?.addEventListener('click', () => {
    showHikingTrails = !showHikingTrails;
    syncHikingTrailsLayerState();
    playTick(stateObj.soundEnabled);
  });

  // ZADÁNÍ #08 (Bod 4): Přepínač vrstevnic a terénu (OpenTopoMap s automatickým fallbackem na OSM při chybě dlaždic)
  function setContourLayer(enabled) {
    showContourLayer = Boolean(enabled);
    const btn = $('walk-contours-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(showContourLayer));
      btn.classList.toggle('active', showContourLayer);
      btn.textContent = showContourLayer ? '⛰️ Vrstevnice: ZAP' : '⛰️ Vrstevnice: VYP';
    }
    if ($('wiz-chk-contours')) $('wiz-chk-contours').checked = showContourLayer;
    if (!map || !L) return;

    // OpenTopoMap je téměř neprůhledný podklad. Při MapLibre jej dočasně
    // nevrstvíme, aby zvolená mapa zůstala vidět; preference se neztrácí.
    if (mapBase === 'maplibre') {
      if (contourTileLayer && map.hasLayer(contourTileLayer)) map.removeLayer(contourTileLayer);
      return;
    }

    if (showContourLayer) {
      if (!contourTileLayer) {
        let fallbackTriggered = false;
        contourTileLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
          maxZoom: 17,
          opacity: 0.85,
          attribution: 'Map data: &copy; OpenStreetMap, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)',
        });
        contourTileLayer.on('tileerror', () => {
          if (fallbackTriggered || !map) return;
          fallbackTriggered = true;
          if (contourTileLayer && map.hasLayer(contourTileLayer)) {
            map.removeLayer(contourTileLayer);
          }
          status('Podklad vrstevnic (OpenTopoMap) není dostupný — zachován standardní mapový podklad OSM.');
        });
      }
      if (!map.hasLayer(contourTileLayer)) {
        contourTileLayer.addTo(map);
      }
    } else if (contourTileLayer && map.hasLayer(contourTileLayer)) {
      map.removeLayer(contourTileLayer);
    }
  }

  $('walk-contours-toggle')?.addEventListener('click', () => {
    setContourLayer(!showContourLayer);
    playTick(stateObj.soundEnabled);
  });

  // ZADÁNÍ #08 (Bod 5): Přepínač hlasové navigace v češtině (Web Speech API)
  function setVoiceNavigation(enabled) {
    voiceNavEnabled = Boolean(enabled);
    stateObj.voiceNavEnabled = voiceNavEnabled;
    if ($('walk-voice-nav')) $('walk-voice-nav').checked = voiceNavEnabled;
    const pillBtn = $('btn-voice-nav-pill');
    if (pillBtn) {
      pillBtn.setAttribute('aria-pressed', String(voiceNavEnabled));
      pillBtn.classList.toggle('active', voiceNavEnabled);
      pillBtn.textContent = voiceNavEnabled ? '🔊 Hlas ZAP' : '🔈 Hlas';
    }
    saveAppState();
    if (voiceNavEnabled) {
      lastSpokenNavStepKey = '';
      speakCzechNav('Hlasová navigace v češtině je zapnutá.', 'voice-init');
      status('🔊 Hlasová navigace v češtině zapnuta.');
    } else {
      try { window.speechSynthesis?.cancel?.(); } catch {}
      status('🔈 Hlasová navigace vypnuta.');
    }
  }

  $('walk-voice-nav')?.addEventListener('change', (ev) => {
    setVoiceNavigation(ev.target.checked);
  });
  $('btn-voice-nav-pill')?.addEventListener('click', () => {
    setVoiceNavigation(!voiceNavEnabled);
    playTick(stateObj.soundEnabled);
  });

  // ZADÁNÍ #08 (Bod 5): Tlačítko „🏠 Navést zpět na start“ (1 klik z jakéhokoliv místa)
  $('btn-return-to-start')?.addEventListener('click', async () => {
    const startOrigin = plannedRoute.origin || START_PRESETS[0];
    const fromPos = lastFix || telemetry.lastKnownPosition || map?.getCenter() || startOrigin;
    const curPoint = { lat: Number(fromPos.lat), lng: Number(fromPos.lng) };
    playStampChord(stateObj.soundEnabled);
    status(`🏠 Počítám nejkratší pěší trasu zpět na start (${startOrigin.label || 'Start'})…`);

    let retRoute = null;
    const returnTaskId = beginMapTask('⏳ Počítám trasu…');
    try {
      retRoute = await buildReturnToOriginRoute(curPoint, startOrigin);
    } finally {
      endMapTask(returnTaskId);
    }
    if (disposed || !retRoute) return;

    const returnStopId = 'return-origin-stop';
    const returnStopObj = {
      id: returnStopId,
      title: `Návrat: ${startOrigin.label || 'Startovní bod'}`,
      lat: startOrigin.lat,
      lng: startOrigin.lng,
      kind: 'town',
      category: 'views',
    };
    plannedRoute.embeddedStops = [
      ...(plannedRoute.embeddedStops || []).filter(s => s.id !== returnStopId),
      returnStopObj,
    ];
    plannedRoute.selectedPlaceIds = [returnStopId];
    plannedRoute.routeType = 'oneway';
    lastRoutedGeometry = retRoute;
    fakeGpsSim?.setSharedWalkingRoute(lastRoutedGeometry);

    recalculateRemainingRoute(
      `🏠 Naviguji nejkratší pěší cestou zpět na start (${startOrigin.label || 'Start'}, ${formatDistanceLabel(retRoute.distanceM)}).`
    );
    speakCzechNav(`Naviguji zpět na start ${startOrigin.label || ''}. Vzdálenost ${Math.round(retRoute.distanceM)} metrů.`, 'return-home');
  });

  // ZADÁNÍ #08 (Bod 1): Logika jednoduchého Průvodce před výpravou (.trip-wizard-sheet)
  function renderTripWizardUi() {
    const sheetEl = $('trip-wizard-sheet');
    if (!sheetEl) return;

    const bodyEl = $('trip-wizard-body');
    const toggleBtn = $('btn-toggle-trip-wizard');
    sheetEl.classList.toggle('collapsed', wizardCollapsed);
    if (bodyEl) bodyEl.hidden = wizardCollapsed;
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', String(!wizardCollapsed));
      toggleBtn.textContent = wizardCollapsed ? '▼ Rozbalit průvodce' : '▲ Sbalit průvodce';
    }

    if ($('wiz-scenario-onsite')) {
      $('wiz-scenario-onsite').classList.toggle('active', wizardScenario === 'on-site');
      $('wiz-scenario-onsite').setAttribute('aria-pressed', String(wizardScenario === 'on-site'));
    }
    if ($('wiz-scenario-home')) {
      $('wiz-scenario-home').classList.toggle('active', wizardScenario === 'from-home');
      $('wiz-scenario-home').setAttribute('aria-pressed', String(wizardScenario === 'from-home'));
    }
    if ($('wiz-home-panel')) {
      $('wiz-home-panel').hidden = wizardScenario !== 'from-home';
    }
    if ($('wiz-active-origin-label')) {
      $('wiz-active-origin-label').textContent = plannedRoute.origin?.label || 'Rožmitál pod Třemšínem — náměstí';
    }

    root.querySelectorAll('[data-wiz-cat]').forEach(chip => {
      const catId = chip.dataset.wizCat;
      const sel = wizardCategories.includes(catId);
      chip.classList.toggle('selected', sel);
      chip.setAttribute('aria-pressed', String(sel));
    });

    root.querySelectorAll('[data-wiz-dist]').forEach(btn => {
      const activeDist = btn.dataset.wizDist === wizardDistanceMode;
      btn.classList.toggle('primary', activeDist);
    });

    root.querySelectorAll('[data-wiz-diff]').forEach(btn => {
      const activeDiff = btn.dataset.wizDiff === wizardDifficulty;
      btn.classList.toggle('active', activeDiff);
      btn.setAttribute('aria-pressed', String(activeDiff));
    });

    if ($('wiz-chk-fog')) $('wiz-chk-fog').checked = fogMode !== 'none';
    if ($('wiz-chk-trails')) $('wiz-chk-trails').checked = showHikingTrails;
    if ($('wiz-chk-contours')) $('wiz-chk-contours').checked = showContourLayer;

    const savedWrap = $('wiz-saved-trips-wrap');
    const savedList = $('wiz-saved-trips-list');
    const savedTrips = Array.isArray(stateObj.savedTrips) ? stateObj.savedTrips : [];
    if (savedWrap && savedList) {
      savedWrap.hidden = savedTrips.length === 0;
      savedList.innerHTML = savedTrips.map(t => `
        <button type="button" class="wiz-preset-chip saved-trip-chip" data-load-saved-trip="${e(t.id)}" title="Načíst uložený výlet">
          📂 ${e(t.title)} (${(t.selectedPlaceIds || []).length} zast.)
        </button>
      `).join('');
    }
  }

  function updateWizardRoutePreviewBox() {
    const previewBox = $('wiz-route-preview-box');
    const summaryLine = $('wiz-route-summary-line');
    if (!previewBox || !summaryLine) return;

    const plannedPlaces = getPlannedPlaces();
    if (plannedPlaces.length === 0 && wizardDistanceMode !== 'manual') {
      previewBox.hidden = true;
      return;
    }

    const isLoop = plannedRoute.routeType === 'loop' && plannedPlaces.length >= 2;
    const routedM = lastRoutedGeometry && !lastRoutedGeometry.isFallback ? lastRoutedGeometry.distanceM : null;
    const analysis = analyzePlannedRoute(plannedRoute.origin, plannedPlaces, stateObj.companionMode || 'solo', {
      returnToOrigin: isLoop,
      routedDistanceM: routedM,
      terrainDifficulty: wizardDifficulty,
    });
    const distKm = ((analysis?.estimatedWalkDistanceM || 0) / 1000).toFixed(1).replace('.', ',');
    const elevM = analysis?.estimatedElevationGainM ?? 85;
    const mins = analysis?.estimatedMinutes ?? 40;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const timeFormatted = h > 0 ? `${h} h ${m} min` : `${m} min`;

    summaryLine.textContent = `Délka: ${distKm} km · Převýšení: +${elevM} m · Čas: ~${timeFormatted} · ${plannedPlaces.length} zastávky`;
    previewBox.hidden = false;
  }

  $('btn-toggle-trip-wizard')?.addEventListener('click', () => {
    wizardCollapsed = !wizardCollapsed;
    renderTripWizardUi();
    playTick(stateObj.soundEnabled);
  });

  $('trip-wizard-sheet')?.addEventListener('click', async (ev) => {
    const modeBtn = ev.target.closest('[data-select-game-mode]');
    if (modeBtn) {
      applyGameMode(modeBtn.dataset.selectGameMode);
      return;
    }

    if (ev.target.closest('#wiz-scenario-onsite')) {
      wizardScenario = 'on-site';
      userExplicitlyPickedOrigin = false;
      if (lastFix) {
        plannedRoute.origin = { id: 'my-gps', label: 'Moje aktuální GPS poloha', lat: lastFix.lat, lng: lastFix.lng };
        if (map) centerMapOnPlayer(lastFix, false);
      } else {
        plannedRoute.origin = null;
      }
      renderTripWizardUi();
      recalculateRemainingRoute('Zvolen scénář: 📍 Jsem na místě (Vyrazit od mé GPS).');
      playTick(stateObj.soundEnabled);
      return;
    }

    if (ev.target.closest('#wiz-scenario-home')) {
      wizardScenario = 'from-home';
      renderTripWizardUi();
      playTick(stateObj.soundEnabled);
      return;
    }

    const presetBtn = ev.target.closest('[data-wiz-preset]');
    if (presetBtn) {
      const presetId = presetBtn.dataset.wizPreset;
      const preset = CZECH_PLACE_PRESETS.find(p => p.id === presetId);
      if (preset) {
        plannedRoute.origin = { id: preset.id, label: preset.label, lat: preset.lat, lng: preset.lng };
        if (map) {
          follow = false;
          updateFollowUi();
          map.setView([preset.lat, preset.lng], 14);
        }
        renderTripWizardUi();
        recalculateRemainingRoute(`Start výpravy přesunut na: ${preset.label}.`);
        refreshAutoPlaces();
        refreshWeatherStrip(preset);
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    if (ev.target.closest('#btn-wiz-search-place')) {
      const inputEl = $('wiz-place-search-input');
      const resultsEl = $('wiz-place-search-results');
      const query = inputEl?.value?.trim() || '';
      if (!query) {
        status('Zadej název města, obce nebo místa v ČR (např. Písek, Beroun, Březnice).');
        return;
      }
      const results = await searchPlaceNominatim(query, aborter.signal);
      if (!resultsEl) return;
      if (!results.length) {
        resultsEl.hidden = false;
        resultsEl.innerHTML = `<span class="small-note">Místo „${e(query)}“ nebylo nalezeno. Zkus jiný název nebo klikni do mapy.</span>`;
        return;
      }
      resultsEl.hidden = false;
      resultsEl.innerHTML = results.map((r, idx) => `
        <button type="button" class="wiz-preset-chip" data-wiz-nominatim-idx="${idx}" data-lat="${r.lat}" data-lng="${r.lng}" data-label="${e(r.label)}">
          📍 ${e(r.label)}
        </button>
      `).join('');
      return;
    }

    const nomChip = ev.target.closest('[data-wiz-nominatim-idx]');
    if (nomChip) {
      const lat = Number(nomChip.dataset.lat);
      const lng = Number(nomChip.dataset.lng);
      const label = nomChip.dataset.label || 'Vyhledané místo';
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        plannedRoute.origin = { id: `place-${Date.now()}`, label, lat, lng };
        if ($('wiz-place-search-results')) $('wiz-place-search-results').hidden = true;
        if (map) {
          follow = false;
          updateFollowUi();
          map.setView([lat, lng], 14);
        }
        renderTripWizardUi();
        recalculateRemainingRoute(`Start výpravy přesunut na: ${label}.`);
        refreshAutoPlaces();
        refreshWeatherStrip({ lat, lng });
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    if (ev.target.closest('#btn-wiz-pick-map')) {
      if (!map) return;
      pickingStartOnMap = true;
      status('🗺️ Klikni kamkoliv do mapy pro nastavení startu plánovaného výletu…');
      playTick(stateObj.soundEnabled);
      return;
    }

    if (ev.target.closest('#btn-wiz-save-trip')) {
      const tripTitle = `${plannedRoute.origin?.label || 'Výlet'} (${new Date().toLocaleDateString('cs-CZ')})`;
      const newTrip = {
        id: `trip-${Date.now()}`,
        title: tripTitle,
        origin: { ...(plannedRoute.origin || START_PRESETS[0]) },
        selectedPlaceIds: [...(plannedRoute.selectedPlaceIds || [])],
        categories: [...wizardCategories],
        terrainDifficulty: wizardDifficulty,
        routeType: plannedRoute.routeType || 'loop',
        createdAt: Date.now(),
      };
      stateObj.savedTrips = [newTrip, ...(stateObj.savedTrips || [])].slice(0, 20);
      saveAppState();
      renderTripWizardUi();
      playStampChord(stateObj.soundEnabled);
      status(`💾 Výlet „${tripTitle}“ byl uložen na později.`);
      return;
    }

    const loadSavedBtn = ev.target.closest('[data-load-saved-trip]');
    if (loadSavedBtn) {
      const tripId = loadSavedBtn.dataset.loadSavedTrip;
      const found = (stateObj.savedTrips || []).find(t => t.id === tripId);
      if (found) {
        plannedRoute.origin = { ...found.origin };
        plannedRoute.selectedPlaceIds = [...(found.selectedPlaceIds || [])];
        plannedRoute.categories = [...(found.categories || PLANNER_CATEGORIES.map(c => c.id))];
        plannedRoute.terrainDifficulty = found.terrainDifficulty || 'medium';
        plannedRoute.routeType = found.routeType || 'loop';
        wizardCategories = [...plannedRoute.categories];
        wizardDifficulty = plannedRoute.terrainDifficulty;
        if (map && found.origin) {
          follow = false;
          updateFollowUi();
          map.setView([found.origin.lat, found.origin.lng], 14);
        }
        renderTripWizardUi();
        recalculateRemainingRoute(`📂 Načten uložený výlet: ${found.title}.`);
        updateWizardRoutePreviewBox();
        playStampChord(stateObj.soundEnabled);
      }
      return;
    }

    const catChip = ev.target.closest('[data-wiz-cat]');
    if (catChip) {
      const catId = catChip.dataset.wizCat;
      if (wizardCategories.includes(catId)) {
        if (wizardCategories.length > 1) {
          wizardCategories = wizardCategories.filter(c => c !== catId);
        }
      } else {
        wizardCategories = [...wizardCategories, catId];
      }
      plannedRoute.categories = [...wizardCategories];
      renderTripWizardUi();
      renderPlaces();
      playTick(stateObj.soundEnabled);
      return;
    }

    const distBtn = ev.target.closest('[data-wiz-dist]');
    if (distBtn) {
      wizardDistanceMode = distBtn.dataset.wizDist;
      renderTripWizardUi();
      playTick(stateObj.soundEnabled);
      return;
    }

    const diffBtn = ev.target.closest('[data-wiz-diff]');
    if (diffBtn) {
      wizardDifficulty = diffBtn.dataset.wizDiff;
      plannedRoute.terrainDifficulty = wizardDifficulty;
      renderTripWizardUi();
      updateWizardRoutePreviewBox();
      playTick(stateObj.soundEnabled);
      return;
    }

    if (ev.target.closest('#btn-wiz-calc-route')) {
      plannedRoute.categories = [...wizardCategories];
      plannedRoute.terrainDifficulty = wizardDifficulty;

      if (wizardDistanceMode === 'manual') {
        const currentPlaces = getPlannedPlaces();
        if (currentPlaces.length >= 2) {
          const ordered = optimizeRouteOrder(plannedRoute.origin, currentPlaces, {
            returnToOrigin: plannedRoute.routeType === 'loop',
            visitedStopIds: confirmedStopIds,
            currentPosition: active && lastFix ? lastFix : null,
          });
          plannedRoute.selectedPlaceIds = ordered.map(p => p.id);
        }
        recalculateRemainingRoute('Trasa přepočítána podle ručně vybraných bodů.');
        updateWizardRoutePreviewBox();
        playStampChord(stateObj.soundEnabled);
        return;
      }

      const targetKm = Number(wizardDistanceMode) || 5;
      const available = getAllAvailablePlaces().filter(p =>
        !wizardCategories.length || !p.category || wizardCategories.includes(p.category)
      );
      let trip = autoSuggestTrip({
        origin: plannedRoute.origin,
        targetKm,
        companionMode: stateObj.companionMode || 'solo',
        terrainDifficulty: wizardDifficulty,
        availablePlaces: available.length >= 2 ? available : getAllAvailablePlaces(),
        discoveries: progress.discoveries,
      });
      if (!trip.found) {
        trip = autoSuggestTrip({
          origin: plannedRoute.origin,
          targetKm: 10,
          companionMode: stateObj.companionMode || 'solo',
          terrainDifficulty: wizardDifficulty,
          availablePlaces: getAllAvailablePlaces(),
          discoveries: progress.discoveries,
        });
      }
      if (!trip.found) {
        status(trip.reason);
        return;
      }
      plannedRoute.selectedPlaceIds = trip.selectedPlaceIds;
      plannedRoute.routeType = 'loop';
      plannedRoute.explorationMode = 'focus';
      recalculateRemainingRoute(`✨ Vypočítána nejlepší trasa (${trip.selectedPlaceIds.length} zastávek, obtížnost: ${wizardDifficulty}).`);
      updateWizardRoutePreviewBox();
      playStampChord(stateObj.soundEnabled);
      return;
    }

    // KROK 3: „▶ POTVRDIT A VYRAZIT NA TRASU“ -> sbalí průvodce do čisté mapy, vycentruje kameru na Avatara a spustí chůzi
    if (ev.target.closest('#btn-wiz-confirm-go')) {
      wizardCollapsed = true;
      renderTripWizardUi();
      sheetCollapsed = true;
      $('walk-bottom-sheet')?.classList.add('collapsed');
      if ($('sheet-toggle-btn')) {
        $('sheet-toggle-btn').setAttribute('aria-expanded', 'false');
        $('sheet-toggle-btn').textContent = '⬆ Rozbalit panel';
      }
      const hudPanel = $('quest-hud-panel');
      if (hudPanel) {
        hudPanel.classList.add('collapsed');
        $('quest-hud-toggle-btn')?.setAttribute('aria-expanded', 'false');
        if ($('qhud-toggle-icon')) $('qhud-toggle-icon').textContent = '▼ Detail';
      }
      follow = true;
      updateFollowUi();
      const startPos = lastFix || plannedRoute.origin || ROZMITAL_CENTER;
      if (map && player) {
        smoothMovePlayerTo(startPos.lat, startPos.lng, 450);
        centerMapOnPlayer(startPos, false);
      }
      playStampChord(stateObj.soundEnabled);
      start();
      return;
    }
  });

  $('wiz-place-search-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      $('btn-wiz-search-place')?.click();
    }
  });

  $('wiz-chk-fog')?.addEventListener('change', (ev) => {
    fogMode = ev.target.checked ? 'explore' : 'none';
    updateFogToggleLabel();
    scheduleFog();
    playTick(stateObj.soundEnabled);
  });

  $('wiz-chk-trails')?.addEventListener('change', (ev) => {
    showHikingTrails = Boolean(ev.target.checked);
    syncHikingTrailsLayerState();
    playTick(stateObj.soundEnabled);
  });

  $('wiz-chk-contours')?.addEventListener('change', (ev) => {
    setContourLayer(Boolean(ev.target.checked));
    playTick(stateObj.soundEnabled);
  });

  $('active-compass-widget')?.addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm === 'granted') {
          status('Kompas: Senzor natočení byl povolen.');
        } else {
          status('Kompas: Přístup k senzoru nebyl udělen.');
        }
      } catch (err) {
        status('Kompas: ' + err.message);
      }
    }
  });

  $('quest-hud-toggle-btn')?.addEventListener('click', () => {
    const panel = $('quest-hud-panel');
    if (!panel) return;
    const collapsed = panel.classList.toggle('collapsed');
    $('quest-hud-toggle-btn').setAttribute('aria-expanded', String(!collapsed));
    $('qhud-toggle-icon').textContent = collapsed ? '▼ Detail' : '▲ Sbalit';
    playTick(stateObj.soundEnabled);
  });

  $('qhud-stops-list')?.addEventListener('click', ev => {
    const row = ev.target.closest('[data-qhud-stop]');
    if (!row || !map) return;
    const p = getPlannedPlaces()[Number(row.dataset.qhudStop)];
    if (!p) return;
    follow = false;
    updateFollowUi();
    map.panTo([p.lat, p.lng]);
    playTick(stateObj.soundEnabled);
  });

  // Bod 25: Tlačítka „Zpět na mou polohu“ a „◎ Moje poloha“ obnoví sledování a zachovají uživatelem zvolený zoom
  const restoreFollowOnPlayer = () => {
    follow = true;
    updateFollowUi();
    const targetPos = lastFix || telemetry.lastKnownPosition;
    if (targetPos && map) {
      centerMapOnPlayer(targetPos, false);
      status('Sledování tvé polohy bylo obnoveno (zvolené přiblížení zachováno).');
    } else if (map && plannedRoute.origin) {
      centerMapOnPlayer(plannedRoute.origin, false);
      status('Mapa vycentrována na výchozí bod (čekám na GPS signál).');
    } else {
      status('Nejdřív spusť GPS nebo simulátor.');
    }
    playTick(stateObj.soundEnabled);
  };

  $('walk-zoom-in')?.addEventListener('click', () => {
    if (!map) return;
    userZoomLocked = true;
    lastUserZoomAt = Date.now();
    map.zoomIn(1);
    playTick(stateObj.soundEnabled);
  });

  $('walk-zoom-out')?.addEventListener('click', () => {
    if (!map) return;
    userZoomLocked = true;
    lastUserZoomAt = Date.now();
    map.zoomOut(1);
    playTick(stateObj.soundEnabled);
  });

  $('walk-center')?.addEventListener('click', restoreFollowOnPlayer);
  $('btn-return-to-gps')?.addEventListener('click', restoreFollowOnPlayer);

  $('walk-demo')?.addEventListener('click', () => {
    pauseSession();
    demo = !demo;
    lastFix = null; anchor = null;
    memoryTrail = [];
    pendingPlaceStamps = {};
    pendingStopSamples = {};
    if (demo) {
      progress = emptyWalk();
      stateObj = emptyState();
      telemetry = createTelemetryState(Date.now());
      currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
      demoIndex = 0;
      stats();
      stepDemo();
    } else {
      try {
        stateObj = loadState();
        progress = {
          version: 1,
          cells: [...stateObj.cells],
          meters: stateObj.meters,
          discoveries: [...stateObj.discoveries],
          walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
          revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
        };
        currentExpedition = stateObj.activeExpedition;
        confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
      } catch (error) {
        storageError = error.message;
        progress = emptyWalk();
        currentExpedition = null;
      }
      stats();
      status(storageError || 'Ukázka skončila.');
      if (map) {
        setPlayerMarkerVisible(false);
        accuracyRing.setRadius(0);
        const c = progress.cells.length ? cellCenter(progress.cells.at(-1)) : { lat: 49.6014, lng: 13.8644 };
        map.setView([c.lat, c.lng], map.getZoom());
      }
    }
  });

  function stepDemo() {
    const fix = {
      lat: 49.6014 + demoIndex * 0.00045,
      lng: 13.8644 + Math.sin(demoIndex * 0.7) * 0.00025,
      accuracy: 6,
      timestamp: Date.now() + demoIndex * 40000,
      simulated: true,
    };
    demoIndex++;
    handleGpsFix(fix);
  }
  $('walk-step')?.addEventListener('click', stepDemo);

  // Globální delegace pro správu zastávek (Nahoru, Dolů, Nahradit, Odebrat), přidávání míst, turistické trasy a zavírání vyskakovacích oken kliknutím mimo ně
  const handleDocumentOutsideClick = (event) => {
    if (disposed) return;
    const t = event.target;
    if (!t || typeof t.closest !== 'function') return;

    // 1. Zavření modálu s pohlednicí (#postcard-modal) při kliknutí kamkoliv mimo .session-modal-card
    if ($('postcard-modal')) {
      const clickedInsidePostcard = t.closest('.session-modal-card');
      const clickedFinishTrigger =
        t.closest('#walk-finish') ||
        t.closest('#walk-end') ||
        t.closest('#btn-phase4-finish-now') ||
        t.closest('#btn-arrival-finish-postcard');
      if (!clickedInsidePostcard && !clickedFinishTrigger) {
        if ($('session-summary-container')) $('session-summary-container').innerHTML = '';
        playTick(stateObj.soundEnabled);
        return;
      }
    }

    // 2. Zavření cílového okna (#arrival-goal-modal) při kliknutí kamkoliv mimo .arrival-goal-dialog
    if ($('arrival-goal-modal') && !$('arrival-goal-modal').hidden) {
      if (!t.closest('.arrival-goal-dialog')) {
        $('arrival-goal-modal').hidden = true;
        playTick(stateObj.soundEnabled);
        return;
      }
    }

    // 3. Zavření kapesního režimu (#pocket-mode-overlay) při kliknutí mimo .pocket-mode-box
    if ($('pocket-mode-overlay') && !$('pocket-mode-overlay').hidden) {
      if (!t.closest('.pocket-mode-box') && !t.closest('#btn-pocket-mode')) {
        setPocketModeUi(false);
        playTick(stateObj.soundEnabled);
        return;
      }
    }

    // 4. Zavření modálu „Upravit procházku“ (#edit-walk-modal) při kliknutí mimo .edit-walk-modal-card
    if ($('edit-walk-modal') && !$('edit-walk-modal').hidden) {
      const clickedOpenEdit =
        t.closest('#btn-open-edit-walk') ||
        t.closest('#btn-sheet-edit-walk') ||
        t.closest('#btn-top-edit-walk');
      if (!t.closest('.edit-walk-modal-card') && !clickedOpenEdit) {
        cancelEditWalkModal();
        return;
      }
    }

    // 5. Zavření modálu „Nastavení aplikace“ (#app-settings-modal) při kliknutí mimo .edit-walk-modal-card
    if ($('app-settings-modal') && !$('app-settings-modal').hidden) {
      const clickedOpenSettings =
        t.closest('#btn-open-settings-modal') ||
        t.closest('#btn-top-settings');
      if (!t.closest('.edit-walk-modal-card') && !clickedOpenSettings) {
        appSettingsModalOpen = false;
        $('app-settings-modal').hidden = true;
        playTick(stateObj.soundEnabled);
        return;
      }
    }

    // 6. Zavření výsledků lupy vyhledávání při kliknutí mimo vyhledávací lištu
    if ($('map-lupa-search-results') && !$('map-lupa-search-results').hidden) {
      if (!t.closest('#map-search-overlay')) {
        $('map-lupa-search-results').hidden = true;
      }
    }

    // 7. Zavření bubliny detailu místa (#place-detail-sheet) při kliknutí mimo ni
    if ($('place-detail-sheet') && !$('place-detail-sheet').hidden) {
      const clickedInsideSheet = t.closest('#place-detail-sheet');
      const clickedTrigger =
        t.closest('.czekpoint-marker-anchor') ||
        t.closest('.open-map-detail-btn') ||
        t.closest('#btn-hero-place-detail') ||
        t.closest('[data-itinerary-focus]');
      if (!clickedInsideSheet && !clickedTrigger) {
        closePlaceDetail();
      }
    }

    // 8. Zavření výběru náhradní zastávky (#stop-replace-picker) při kliknutí mimo něj
    if (replacingStopIndex !== null && $('stop-replace-picker') && !$('stop-replace-picker').hidden) {
      if (!t.closest('#stop-replace-picker') && !t.closest('[data-stop-action="replace"]')) {
        replacingStopIndex = null;
        renderReplaceStopPicker();
      }
    }
  };
  document.addEventListener('click', handleDocumentOutsideClick, { signal: aborter.signal });

  root.addEventListener('click', async event => {
    const stopActionBtn = event.target.closest('[data-stop-action]');
    if (stopActionBtn) {
      const action = stopActionBtn.dataset.stopAction;
      const idx = Number(stopActionBtn.dataset.stopIndex);
      const ids = plannedRoute.selectedPlaceIds || [];

      if (action === 'up') {
        plannedRoute.selectedPlaceIds = reorderPlannedStops(ids, idx, idx - 1);
        replacingStopIndex = null;
        playTick(stateObj.soundEnabled);
        recalculateRemainingRoute(`Zastávka #${idx + 1} posunuta v pořadí nahoru (ruční pořadí zachováno). Zbývající trasa přepočítána.`);
      } else if (action === 'down') {
        plannedRoute.selectedPlaceIds = reorderPlannedStops(ids, idx, idx + 1);
        replacingStopIndex = null;
        playTick(stateObj.soundEnabled);
        recalculateRemainingRoute(`Zastávka #${idx + 1} posunuta v pořadí dolů (ruční pořadí zachováno). Zbývající trasa přepočítána.`);
      } else if (action === 'remove') {
        const removedPlace = getAllAvailablePlaces().find(p => p.id === ids[idx]);
        plannedRoute.selectedPlaceIds = removePlannedStop(ids, idx);
        replacingStopIndex = null;
        playTick(stateObj.soundEnabled);
        recalculateRemainingRoute(`Zastávka „${removedPlace?.title || ''}“ odebrána. Zbývající trasa přepočítána.`);
      } else if (action === 'replace') {
        replacingStopIndex = replacingStopIndex === idx ? null : idx;
        renderReplaceStopPicker();
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    const replaceCandidateBtn = event.target.closest('[data-replace-with-id]');
    if (replaceCandidateBtn && replacingStopIndex != null) {
      const newId = replaceCandidateBtn.dataset.replaceWithId;
      const newPlace = getAllAvailablePlaces().find(p => p.id === newId);
      plannedRoute.selectedPlaceIds = replacePlannedStop(plannedRoute.selectedPlaceIds || [], replacingStopIndex, newId);
      const replacedIdx = replacingStopIndex + 1;
      replacingStopIndex = null;
      playTick(stateObj.soundEnabled);
      recalculateRemainingRoute(`Zastávka #${replacedIdx} nahrazena místem „${newPlace?.title || newId}“. Zbývající trasa přepočítána.`);
      return;
    }

    if (event.target.closest('#btn-cancel-replace-stop')) {
      replacingStopIndex = null;
      renderReplaceStopPicker();
      return;
    }

    const planBtn = event.target.closest('.toggle-plan-place-btn');
    if (planBtn) {
      const placeId = planBtn.dataset.placeId;
      const ids = plannedRoute.selectedPlaceIds || [];
      if (ids.includes(placeId)) {
        plannedRoute.selectedPlaceIds = ids.filter(id => id !== placeId);
        recalculateRemainingRoute('Zastávka odebrána z plánu. Zbývající trasa přepočítána.');
      } else {
        if (ids.length >= 10) {
          status('Plán výpravy může obsahovat nejvýše 10 zastávek.');
          return;
        }
        plannedRoute.selectedPlaceIds = [...ids, placeId];
        recalculateRemainingRoute('Zastávka přidána do plánu. Zbývající trasa přepočítána.');
      }
      playTick(stateObj.soundEnabled);
      return;
    }

    const openMapDetailBtn = event.target.closest('.open-map-detail-btn');
    if (openMapDetailBtn) {
      const placeId = openMapDetailBtn.dataset.placeId;
      const targetPlace = getAllAvailablePlaces().find(item => item.id === placeId);
      if (targetPlace) {
        if (map) {
          follow = false;
          updateFollowUi();
          map.setView([targetPlace.lat, targetPlace.lng], Math.max(map.getZoom(), 14));
        }
        openPlaceDetail(targetPlace);
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    const addRadarBtn = event.target.closest('.add-radar-place-btn');
    if (addRadarBtn) {
      const placeId = addRadarBtn.dataset.placeId;
      const ids = plannedRoute.selectedPlaceIds || [];
      if (!ids.includes(placeId)) {
        plannedRoute.selectedPlaceIds = [...ids, placeId].slice(0, 10);
        $('walk-radar-banner').hidden = true;
        playTick(stateObj.soundEnabled);
        recalculateRemainingRoute('Místo z radaru přidáno mezi zastávky.');
      }
      return;
    }

    const trailChip = event.target.closest('[data-trail-id]');
    if (trailChip && map) {
      const trailId = trailChip.dataset.trailId;
      const trail = loadedHikingTrails.find(t => t.id === trailId);
      if (trail && trail.coordinates?.length >= 2) {
        if (!showHikingTrails) {
          showHikingTrails = true;
          const btn = $('walk-trails-toggle');
          if (btn) {
            btn.setAttribute('aria-pressed', 'true');
            btn.classList.add('active');
            btn.textContent = '🥾 Turistické trasy: ZAP';
          }
          renderHikingTrailsOnMap();
        }
        follow = false;
        updateFollowUi();
        map.fitBounds(L.latLngBounds(trail.coordinates), { padding: [36, 36], maxZoom: 15 });
        status(`Zobrazena turistická trasa: ${trail.name}.`);
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    const visitBtn = event.target.closest('[data-walk-action="visit"]');
    if (visitBtn) {
      const routeId = visitBtn.dataset.route;
      const targetRoute = routes.find(r => r.id === routeId);
      if (!targetRoute) return;
      visitBtn.disabled = true;
      if (onAddVisit) await onAddVisit(routeId);
      stats();
      status(`Návštěva ${targetRoute.title} byla zaznamenána do tvého pasu.`);
      return;
    }

    if (event.target.closest('#btn-open-settings-modal')) {
      appSettingsModalOpen = true;
      const modal = $('app-settings-modal');
      if (modal) modal.hidden = false;
      renderAppSettingsModalUi();
      playTick(stateObj.soundEnabled);
      return;
    }

    if (
      event.target.closest('#btn-close-app-settings') ||
      event.target.closest('#btn-close-app-settings-x') ||
      (event.target.closest('#app-settings-modal') && !event.target.closest('.edit-walk-modal-card'))
    ) {
      appSettingsModalOpen = false;
      const modal = $('app-settings-modal');
      if (modal) modal.hidden = true;
      playTick(stateObj.soundEnabled);
      return;
    }

    const modalGameModeBtn = event.target.closest('[data-modal-game-mode]');
    if (modalGameModeBtn) {
      applyGameMode(modalGameModeBtn.dataset.modalGameMode);
      return;
    }

    const pillBtn = event.target.closest('[data-pill-key]');
    if (pillBtn) {
      const key = pillBtn.dataset.pillKey;
      const val = pillBtn.dataset.pillVal === '1';
      appSettings[key] = val;
      stateObj.appSettings = { ...appSettings };
      saveAppState();
      if (key === 'kctTrails') syncHikingTrailsLayerState();
      if (key === 'contours') setContourLayer(val);
      if (key === 'fogParchment') {
        fogMode = val ? 'explore' : 'none';
        updateFogToggleLabel();
        scheduleFog();
      }
      if (key === 'voiceNav') setVoiceNavigation(val);
      if (key === 'keepAwake') {
        val ? holdWake() : releaseWake();
      }
      if (key === 'soundFx') {
        stateObj.soundEnabled = val;
      }
      if (key === 'showExternalPhotos') {
        renderPlaces();
        renderNextCheckpointHero(lastFix || telemetry.lastKnownPosition);
        if (selectedDetailPlace && !$('place-detail-sheet')?.hidden) {
          openPlaceDetail(selectedDetailPlace);
        }
      }
      if (key === 'mindfulnessPrompts') {
        if (val) mindfulnessSkippedSession = false;
        renderMindfulnessPromptUi();
      }
      renderAppSettingsModalUi();
      playTick(stateObj.soundEnabled);
      return;
    }
  }, { signal: aborter.signal });

  // DÁVKA 2 (Bod 1.1 & 1.2): Osobní atlas malých objevů (✨ Uložit vzpomínku) a bezpečné výzvy všímavosti
  function renderMindfulnessPromptUi() {
    const cardEl = $('mindfulness-prompt-card');
    const textEl = $('mindfulness-prompt-text');
    if (!cardEl || !textEl) return;

    if (appSettings.mindfulnessPrompts === false || mindfulnessSkippedSession) {
      cardEl.hidden = true;
      return;
    }
    cardEl.hidden = false;
    const promptItem = MINDFULNESS_PROMPTS[mindfulnessPromptIndex % MINDFULNESS_PROMPTS.length] || MINDFULNESS_PROMPTS[0];
    textEl.textContent = promptItem.text;
  }

  function renderPersonalMemoriesUi() {
    const countEl = $('personal-memories-count');
    const listEl = $('personal-memories-list');
    if (countEl) countEl.textContent = String(personalMemories.length);
    if (!listEl) return;

    listEl.innerHTML = '';
    if (personalMemories.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.className = 'small-note';
      emptyP.style.margin = '0';
      emptyP.textContent = 'Zatím nemáš uloženou žádnou vlastní vzpomínku. Klepni na „✨ Uložit vzpomínku“ a zaznamenej si svůj objev v terénu.';
      listEl.appendChild(emptyP);
      return;
    }

    for (const mem of personalMemories.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'personal-memory-item';
      row.dataset.memoryId = mem.id;

      const head = document.createElement('div');
      head.className = 'personal-memory-head';

      const titleStrong = document.createElement('strong');
      titleStrong.className = 'personal-memory-title';
      titleStrong.textContent = `${mem.symbolIcon || '✨'} ${mem.symbolTitle || 'Vlastní vzpomínka'}`;

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'personal-memory-badge';
      badgeSpan.textContent = '✨ Vlastnoruční vzpomínka uživatele (soukromě v zařízení)';

      head.appendChild(titleStrong);
      head.appendChild(badgeSpan);
      row.appendChild(head);

      if (mem.note) {
        const noteP = document.createElement('p');
        noteP.className = 'personal-memory-note';
        // DÁVKA 2 (Bod 1.1): Bezpečné vykreslení vlastní poznámky výhradně přes textContent proti XSS!
        noteP.textContent = mem.note;
        row.appendChild(noteP);
      }

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'personal-memory-actions';

      if (Number.isFinite(Number(mem.lat)) && Number.isFinite(Number(mem.lng))) {
        const showBtn = document.createElement('button');
        showBtn.type = 'button';
        showBtn.className = 'button small ghost';
        showBtn.textContent = '🔍 Ukázat v mapě';
        showBtn.addEventListener('click', () => {
          if (map) {
            follow = false;
            updateFollowUi();
            map.setView([Number(mem.lat), Number(mem.lng)], Math.max(map.getZoom(), 16));
          }
          playTick(stateObj.soundEnabled);
        });
        actionsDiv.appendChild(showBtn);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'button small ghost danger';
      delBtn.textContent = '✕ Smazat';
      delBtn.addEventListener('click', () => {
        personalMemories = personalMemories.filter(item => item.id !== mem.id);
        stateObj.personalMemories = personalMemories;
        saveAppState();
        renderPersonalMemoriesUi();
        renderPlaces({ skipListRebuild: true });
        status('Vlastní vzpomínka byla odstraněna z osobního atlasu.');
        playTick(stateObj.soundEnabled);
      });
      actionsDiv.appendChild(delBtn);

      row.appendChild(actionsDiv);
      listEl.appendChild(row);
    }
  }

  function openSaveMemoryModal() {
    saveMemoryModalOpen = true;
    selectedMemorySymbolId = PERSONAL_MEMORY_SYMBOLS[0].id;
    const modal = $('save-memory-modal');
    if (modal) modal.hidden = false;
    const noteInp = $('memory-note-input');
    if (noteInp) noteInp.value = '';
    root.querySelectorAll('[data-memory-symbol]').forEach(btn => {
      const isSel = btn.dataset.memorySymbol === selectedMemorySymbolId;
      btn.classList.toggle('selected', isSel);
      btn.setAttribute('aria-checked', String(isSel));
    });
    playTick(stateObj.soundEnabled);
  }

  function closeSaveMemoryModal() {
    saveMemoryModalOpen = false;
    const modal = $('save-memory-modal');
    if (modal) modal.hidden = true;
  }

  function confirmSaveMemoryModal() {
    const noteInp = $('memory-note-input');
    const cleanNote = sanitizeMemoryNoteText(noteInp ? noteInp.value : '');
    const refPos = lastFix || telemetry.lastKnownPosition || (map ? map.getCenter() : null) || getRouteOriginPoint();
    const entry = createPersonalMemoryEntry({
      symbolId: selectedMemorySymbolId,
      note: cleanNote,
      lat: refPos?.lat ?? null,
      lng: refPos?.lng ?? null,
      now: Date.now(),
    });
    personalMemories = [entry, ...personalMemories].slice(0, 200);
    stateObj.personalMemories = personalMemories;
    saveAppState();
    closeSaveMemoryModal();
    renderPersonalMemoriesUi();
    renderPlaces({ skipListRebuild: true });
    playStampChord(stateObj.soundEnabled);
    status(`✨ Uložena vlastnoruční vzpomínka do osobního atlasu: ${entry.symbolIcon} ${entry.symbolTitle} (soukromě v zařízení).`);
  }

  $('walk-save-memory')?.addEventListener('click', openSaveMemoryModal);
  $('btn-sheet-save-memory')?.addEventListener('click', openSaveMemoryModal);
  $('btn-mindfulness-save-memory')?.addEventListener('click', openSaveMemoryModal);
  $('btn-close-save-memory-x')?.addEventListener('click', closeSaveMemoryModal);
  $('btn-cancel-save-memory')?.addEventListener('click', closeSaveMemoryModal);
  $('btn-confirm-save-memory')?.addEventListener('click', confirmSaveMemoryModal);

  $('memory-symbols-grid')?.addEventListener('click', (ev) => {
    const symBtn = ev.target.closest('[data-memory-symbol]');
    if (!symBtn) return;
    selectedMemorySymbolId = symBtn.dataset.memorySymbol || PERSONAL_MEMORY_SYMBOLS[0].id;
    root.querySelectorAll('[data-memory-symbol]').forEach(btn => {
      const isSel = btn.dataset.memorySymbol === selectedMemorySymbolId;
      btn.classList.toggle('selected', isSel);
      btn.setAttribute('aria-checked', String(isSel));
    });
    playTick(stateObj.soundEnabled);
  });

  $('save-memory-modal')?.addEventListener('click', (ev) => {
    if (ev.target === $('save-memory-modal') || !ev.target.closest('.edit-walk-modal-card')) {
      closeSaveMemoryModal();
      playTick(stateObj.soundEnabled);
    }
  });

  $('btn-skip-mindfulness')?.addEventListener('click', () => {
    mindfulnessSkippedSession = true;
    renderMindfulnessPromptUi();
    status('Výzva všímavosti byla přeskočena (můžeš je také trvale vypnout v Nastavení).');
    playTick(stateObj.soundEnabled);
  });

  $('btn-next-mindfulness')?.addEventListener('click', () => {
    mindfulnessPromptIndex = (mindfulnessPromptIndex + 1) % MINDFULNESS_PROMPTS.length;
    renderMindfulnessPromptUi();
    playTick(stateObj.soundEnabled);
  });

  renderMindfulnessPromptUi();
  renderPersonalMemoriesUi();

  $('walk-nearby')?.addEventListener('click', async () => {
    if (demo) { if ($('nearby-status')) $('nearby-status').textContent = 'Ukázka používá připravený katalog.'; return; }
    const queryOrigin = lastFix || plannedRoute.origin || { lat: 49.6014, lng: 13.8644 };
    if ($('walk-nearby')) $('walk-nearby').disabled = true;
    if ($('nearby-status')) $('nearby-status').textContent = 'Hledám místa v okolí…';
    const nearbyTaskId = beginMapTask('⏳ Načítám místa v okolí…');
    try {
      const found = await fetchNearby(queryOrigin, config.overpassUrl, aborter.signal, routes, {
        radiusM: (plannedRoute.radiusKm || 10) * 1000,
        categories: plannedRoute.categories,
      });
      if (disposed || demo) return;
      nearby = found;
      renderPlaces();
      if ($('nearby-status')) $('nearby-status').textContent = found.length ? `Načteno ${found.length} míst v okolí.` : 'V okolí nejsou další známá místa.';
    } catch (error) {
      if (!disposed && $('nearby-status')) $('nearby-status').textContent = error.name === 'AbortError' ? 'Hledání trvalo příliš dlouho.' : error.message;
    } finally {
      endMapTask(nearbyTaskId);
      if (!disposed && $('walk-nearby')) $('walk-nearby').disabled = false;
    }
  });

  // Export a obnova ze zálohy JSON
  $('walk-export')?.addEventListener('click', () => {
    try {
      const jsonStr = exportStateJson();
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(new Blob([jsonStr], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `czekpoint-pruzkum-${today}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Průzkum byl úspěšně exportován.');
    } catch (error) { status(error.message); }
  });

  $('walk-import-btn')?.addEventListener('click', () => {
    $('walk-import-file')?.click();
  });

  $('walk-import-file')?.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const preview = previewImportState(text);
      pauseSession();
      stateObj = importStateJson(text);
      progress = {
        version: 1,
        cells: [...stateObj.cells],
        meters: stateObj.meters,
        discoveries: [...stateObj.discoveries],
        walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
        revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
      };
      currentExpedition = stateObj.activeExpedition;
      plannedRoute = stateObj.plannedRoute || plannedRoute;
      confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
      personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
      storageError = '';
      renderPersonalMemoriesUi();
      stats();
      status(`Průzkum obnoven ze zálohy (${preview.cellsCount} dílků, ${preview.stampsCount} razítek).`);
    } catch (err) {
      status('Chyba při obnově zálohy (původní data zachována): ' + err.message);
    } finally {
      ev.target.value = '';
    }
  });

  const visibility = () => {
    if (!document.hidden && active && !disposed && !simSandboxActive) {
      restartGpsWatch();
      holdWake();
      if (map) {
        map.invalidateSize();
        if (lastFix) {
          smoothMovePlayerTo(lastFix.lat, lastFix.lng, 350);
          if (follow) centerMapOnPlayer(lastFix, false);
        }
      }
      stats();
      scheduleFog();
      renderTrail();
    }
  };
  document.addEventListener('visibilitychange', visibility, { signal: aborter.signal });

  const pagehide = () => {
    // ZADÁNÍ: Při zhasnutí obrazovky nebo uspání telefonu v kapse NIKDY nepozastavovat výpravu!
    // Pouze bezpečně zaznamenáme aktuální stav do úložiště.
    if (canPersistRealState()) {
      try { saveState(stateObj); } catch {}
    }
  };
  window.addEventListener('pagehide', pagehide, { signal: aborter.signal });

  const storageChanged = event => {
    if (event.key === STATE_KEY && !demo && !simSandboxActive) {
      if (!active) {
        pauseSession();
      }
      try {
        stateObj = loadState();
        progress = {
          version: 1,
          cells: [...stateObj.cells],
          meters: stateObj.meters,
          discoveries: [...stateObj.discoveries],
          walkSegments: Array.isArray(stateObj.walkSegments) ? stateObj.walkSegments.map(s => [...s]) : [],
          revealedFeatures: Array.isArray(stateObj.revealedFeatures) ? [...stateObj.revealedFeatures] : [],
        };
        currentExpedition = stateObj.activeExpedition;
        plannedRoute = stateObj.plannedRoute || plannedRoute;
        confirmedStopIds = new Set(Array.isArray(stateObj.confirmedStopIds) ? stateObj.confirmedStopIds : []);
        personalMemories = Array.isArray(stateObj.personalMemories) ? [...stateObj.personalMemories] : [];
        storageError = '';
      } catch (err) { storageError = err.message; }
      renderPersonalMemoriesUi();
      stats();
      status(storageError || 'Průzkum se změnil v jiné kartě.');
    }
  };
  window.addEventListener('storage', storageChanged, { signal: aborter.signal });

  // ZADÁNÍ #10 (Bod 1.1): Při prvním otevření mapy NEVYBÍRÁME automaticky zastávky,
  // aby horní lišta „Půjdeš ~X hod...“ nesvítila bez kontextu hned po otevření!
  renderTripWizardUi();
  stats();
  renderQuestHud(plannedRoute.origin);
  renderPhase1AndPhase4Ui(lastFix || plannedRoute.origin);

  return () => {
    disposed = true;
    clearAllMapTasks();
    keepAliveCtrl.stop();
    stopBackgroundTracking();
    if (playerLerpRafId) {
      cancelAnimationFrame(playerLerpRafId);
      playerLerpRafId = null;
    }
    try { window.speechSynthesis?.cancel?.(); } catch {}
    stopWatchdog();
    pauseSession();
    aborter.abort();
    window.removeEventListener('keydown', onEscapeKey);
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('orientationchange', handleViewportChange);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('deviceorientationabsolute', handleDeviceOrientation, true);
    window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('storage', storageChanged);
    if (frame) cancelAnimationFrame(frame);
    placesLayer?.clearLayers();
    placeMarkersById.clear();
    fakeGpsSim?.destroy();
    map?.remove();
  };
}
