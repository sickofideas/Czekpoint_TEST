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
} from './walk-engine.js';
import {
  loadState,
  saveState,
  exportStateJson,
  previewImportState,
  importStateJson,
  STATE_KEY,
  COMPANION_MODES,
  EXPLORATION_MODES,
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
import { fetchNearby } from './nearby.js';
import { haversineMeters } from './domain.js';
import { escapeHtml as e, number } from './ui.js';
import { CHAPTERS, COLLECTIONS, RELICS } from './data.js';
import {
  START_PRESETS,
  PLANNER_RADII,
  PLANNER_CATEGORIES,
  COMPANION_STYLES,
  optimizeRouteOrder,
  analyzePlannedRoute,
  fetchElevationProfile,
  encodeRouteShareCode,
  decodeRouteShareCode,
} from './planner.js';
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
} from './fx.js';

export function mountWalk(root, routes, config, actions = {}) {
  const L = window.L;
  const { onAddVisit } = actions;
  let stateObj = loadState();
  let progress = {
    version: 1,
    cells: stateObj.cells,
    meters: stateObj.meters,
    discoveries: stateObj.discoveries,
  };
  let storageError = '';

  let map, fog, tileLayer, trailLayer, player, accuracyRing;
  let plannedRouteLayer = L?.layerGroup();
  let radiusCircle = null;
  let focusPolyline = null;
  let beaconMarker = null;

  let anchor = null, lastFix = null, watch = null;
  let active = false, disposed = false, demo = false, demoIndex = 0;
  let releaseLock = null, wake = null, frame = null, starting = false;
  let follow = true, nearby = [];
  let memoryTrail = [];
  let pendingPlaceStamps = {};
  const aborter = new AbortController();

  // Map fog mode: 'explore' (alpha 0.65, default) | 'full' (alpha 1.0) | 'none' (Běžná mapa)
  let fogMode = 'explore';
  let previousFogMode = 'explore';

  // UI modes & state
  let activeTab = 'planner';
  let sheetCollapsed = false;
  let zenMode = false;
  let pickingStartOnMap = false;
  let lastRadarAlertId = null;

  // Active expedition from persisted state
  let currentExpedition = stateObj.activeExpedition;
  if (currentExpedition && currentExpedition.state === 'active') {
    currentExpedition = pauseExpedition(currentExpedition);
    stateObj.activeExpedition = currentExpedition;
    try { saveState(stateObj); } catch {}
  }

  // Active planned route
  let plannedRoute = stateObj.plannedRoute || {
    origin: START_PRESETS[0],
    radiusKm: 3,
    categories: PLANNER_CATEGORIES.map(c => c.id),
    selectedPlaceIds: [],
    companionMode: stateObj.companionMode || 'solo',
    explorationMode: stateObj.explorationMode || 'focus',
  };

  const catalogue = routes
    .filter(r => r.location)
    .map(r => ({
      id: r.id,
      routeId: r.id,
      title: r.pointKind === 'place' ? r.title : `Start trasy: ${r.title}`,
      lat: r.location.lat,
      lng: r.location.lng,
      kind: r.kind,
      category: r.kind === 'culture' ? 'castles' : r.kind === 'view' ? 'views' : r.kind === 'water' ? 'water' : 'nature',
      chapter: r.chapter || r.sector,
      hintAnchor: Boolean(r.hintAnchor || r.watchtower),
      url: `#/trasa/${r.id}`,
      pointKind: r.pointKind || 'place',
      collectible: r.collectible !== false && r.pointKind === 'place',
      access: r.access || {},
    }));

  root.innerHTML = `
    <section class="walk-heading">
      <div>
        <div class="eyebrow">Malé kroky. Skutečný průzkum.</div>
        <h1 tabindex="-1">Tvoje mapa dobrodružství.</h1>
        <p>Osobní atlas, chytrý plánovač výprav, virtuální hůl se štítky a poutníci v revíru.</p>
      </div>
      <span class="walk-tag">PILOT · v0.6</span>
    </section>

    <div class="walk-stats" id="walk-stats-panel" aria-label="Celkový průzkum">
      <div><strong id="walk-points">0</strong><span>bodů celkem</span></div>
      <div><strong id="walk-cells">0</strong><span>odkrytých dílků</span></div>
      <div><strong id="walk-distance">0</strong><span>km chůze celkem</span></div>
      <div><strong id="walk-relics">0</strong><span>GPS razítek</span></div>
    </div>

    <div class="rank-card" id="rank-card">
      <div class="rank-info">
        <span class="rank-title" id="rank-title">Hodnost: Sváteční chodec</span>
        <span class="rank-fog" id="rank-fog">Dosah odkrývání mlhy: 65 m · Do další úrovně zbývá 200 b.</span>
      </div>
      <div class="rank-progress" id="rank-badge">Úroveň 1</div>
    </div>

    <div class="daily-challenge-card" id="expedition-goal-card">
      <div>
        <div class="eyebrow" style="margin-bottom:4px">Cíl výpravy</div>
        <div class="daily-title" id="expedition-goal-title">Zvol cíl pro novou výpravu…</div>
      </div>
      <div id="expedition-goal-action"></div>
    </div>

    <div id="walk-demo-banner" class="notice" hidden>UKÁZKA · Simulovaný pohyb v Rožmitále. Žádná GPS, žádné ukládání bodů.</div>
    <div id="walk-radar-banner" class="walk-radar-banner" hidden></div>

    <div class="walk-compass-bar" id="walk-compass" role="status">🧭 Čekám na polohu pro určení směru k cíli…</div>

    <div class="walk-map-wrap" id="walk-map-wrap">
      <div id="walk-map" aria-label="Interaktivní mapa průzkumu"></div>
      <div id="zen-mini-compass" class="zen-mini-compass" hidden>🧭 <span id="zen-compass-text">-- m</span></div>
      <div class="walk-map-toolbar">
        <button class="button small" id="walk-center" title="Vycentrovat na moji polohu">◎ Moje poloha</button>
        <button class="button small" id="walk-fog-toggle" aria-pressed="true" title="Přepnout krytí mlhy">Mlha: Průzkumná (65 %)</button>
        <button class="button small" id="walk-plain-map" aria-pressed="false" title="Zobrazit běžný mapový podklad">Běžná mapa</button>
        <button class="button small" id="walk-zen-toggle" aria-pressed="false" title="Čistá mapa bez okolních panelů">⛶ Čistá mapa</button>
      </div>
    </div>
    <div class="trail-note" id="trail-info">Stopa za poslední hodinu: 0 bodů (automaticky mizí po 60 min, pouze v paměti relace)</div>
    <p id="tile-status" class="small-note" role="status"></p>

    <!-- Bottom Sheet -->
    <div class="bottom-sheet" id="walk-bottom-sheet">
      <div class="bottom-sheet-bar">
        <div class="sheet-tabs" role="tablist">
          <button class="sheet-tab active" data-sheet-tab="planner" role="tab" id="sheet-tab-btn-planner">🧭 Plánovač a filtry</button>
          <button class="sheet-tab" data-tab="expedition" data-sheet-tab="expedition" role="tab" id="sheet-tab-btn-expedition">🎒 Aktivní výprava</button>
          <button class="sheet-tab" data-sheet-tab="stick" role="tab" id="sheet-tab-btn-stick">🦯 Moje hůl a okolí</button>
        </div>
        <button class="button small ghost sheet-toggle-btn" id="sheet-toggle-btn" title="Sbalit / rozbalit šuplík">⬇ Sbalit</button>
      </div>

      <div class="sheet-body" id="sheet-body">
        <!-- Tab 1: Plánovač a filtry -->
        <div class="sheet-tab-panel active" id="sheet-panel-planner">
          <div class="planner-controls-grid">
            <div class="planner-box">
              <span class="eyebrow">1. Startovní bod výpravy</span>
              <div class="planner-origin-buttons">
                <button class="button small ${plannedRoute.origin?.id === 'my-gps' ? 'primary' : ''}" id="btn-origin-gps">📍 Moje GPS</button>
                <button class="button small ${pickingStartOnMap ? 'primary' : ''}" id="btn-origin-map">🗺️ Kliknout do mapy</button>
                <button class="button small ${plannedRoute.origin?.id === 'namesti' ? 'primary' : ''}" id="btn-origin-namesti">Náměstí</button>
                <button class="button small ${plannedRoute.origin?.id === 'nadrazi' ? 'primary' : ''}" id="btn-origin-nadrazi">Nádraží</button>
                <button class="button small ${plannedRoute.origin?.id === 'stary-rozmital' ? 'primary' : ''}" id="btn-origin-stary">Starý Rožmitál</button>
              </div>
              <p class="small-note" id="planner-origin-desc">Start: ${e(plannedRoute.origin?.label || 'Zvoleno v mapě')}</p>
            </div>

            <div class="planner-box">
              <span class="eyebrow">2. Okruh hledání</span>
              <div class="radius-selector">
                ${PLANNER_RADII.map(r => `
                  <button class="button small ${plannedRoute.radiusKm === r ? 'primary' : ''}" data-radius="${r}">
                    ${r} km
                  </button>
                `).join('')}
              </div>
              <p class="small-note">Okruh dosahu zobrazen zelenou kružnicí na mapě.</p>
            </div>
          </div>

          <div class="planner-box" style="margin-top:10px">
            <span class="eyebrow">3. Kategorie zajímavostí</span>
            <div class="planner-categories-chips" id="planner-category-chips">
              ${PLANNER_CATEGORIES.map(cat => {
                const isSelected = plannedRoute.categories.includes(cat.id);
                return `
                  <button class="cat-chip ${isSelected ? 'selected' : ''}" data-cat-id="${cat.id}">
                    <span>${cat.icon}</span> ${e(cat.label)}
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div class="planner-box" style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <span class="eyebrow">4. Košík výpravy (<span id="basket-count">${plannedRoute.selectedPlaceIds.length}</span> / 10 míst)</span>
              <button class="button small lime" id="btn-optimize-route" ${plannedRoute.selectedPlaceIds.length < 2 ? 'disabled' : ''}>
                🔄 Seřadit trasu (nejbližší soused)
              </button>
            </div>
            <div id="planner-basket-list" class="planner-basket-list"></div>
          </div>

          <!-- X-Ray Trasy -->
          <div class="route-xray-card" id="route-xray-card"></div>

          <!-- Share & Import Route -->
          <div class="planner-share-row">
            <button class="button small" id="btn-share-route-code">📤 Sdílet kód trasy</button>
            <button class="button small" id="btn-import-route-code">📥 Načíst kód trasy</button>
          </div>
        </div>

        <!-- Tab 2: Aktivní výprava -->
        <div class="sheet-tab-panel" id="sheet-panel-expedition" hidden>
          <div class="expedition-tab-content">
            <div class="companion-selector-box">
              <span class="eyebrow">Styl parťáka</span>
              <div class="companion-button-row">
                ${COMPANION_STYLES.map(comp => `
                  <button class="button small companion-btn ${stateObj.companionMode === comp.id ? 'primary' : ''}" data-companion="${comp.id}">
                    <span>${comp.icon}</span> ${e(comp.label)}
                  </button>
                `).join('')}
              </div>
            </div>

            <div class="exploration-mode-box">
              <span class="eyebrow">Herní režim průzkumu</span>
              <div class="exploration-button-row">
                <button class="button small ${stateObj.explorationMode === 'compass' ? 'primary' : ''}" data-mode="compass">🧭 Kompas</button>
                <button class="button small ${stateObj.explorationMode === 'focus' ? 'primary' : ''}" data-mode="focus">🎯 Trasa</button>
                <button class="button small ${stateObj.explorationMode === 'radar' ? 'primary' : ''}" data-mode="radar">📡 Radar</button>
              </div>
              <p class="small-note" id="exploration-mode-desc">
                ${stateObj.explorationMode === 'compass'
                  ? 'Kompas ukazuje vzdušný směr a vzdálenost pouze k dalšímu cíli.'
                  : stateObj.explorationMode === 'radar'
                  ? 'Radar tě upozorní zvukem/haptikou při přiblížení pod 150 m k neplánovanému místu.'
                  : 'Trasa zobrazuje vybraná místa spojená linkou na mapě.'}
              </p>
            </div>

            <div class="walk-controls">
              <div id="expedition-buttons" style="display:flex;flex-wrap:wrap;gap:9px;width:100%">
                <button id="walk-start" class="button primary">▶ Vyrazit s GPS</button>
                <button id="walk-stop" class="button" disabled>Ⅱ Pozastavit</button>
                <button id="walk-end" class="button danger" disabled>⏹ Ukončit výpravu</button>
                <button id="walk-demo" class="button">Ukázka bez GPS</button>
                <button id="walk-step" class="button lime" hidden>Další krok ukázky</button>
              </div>
            </div>

            <div class="walk-status-panel">
              <strong id="walk-status" role="status" aria-live="polite">${e(storageError || 'Připraveno. Zvol cíl a vyraž s GPS.')}</strong>
              <span id="walk-session">V této výpravě: 0 m · 0 nových dílků · 0 razítek</span>
              <div style="display:flex;gap:16px;flex-wrap:wrap">
                <label><input type="checkbox" id="walk-awake" checked> Držet displej zapnutý</label>
                <label><input type="checkbox" id="walk-sound" ${stateObj.soundEnabled !== false ? 'checked' : ''}> 🔊 Zvukové efekty</label>
              </div>
              <span id="wake-status" class="small-note">Displej: zámek není aktivní.</span>
            </div>
          </div>
        </div>

        <!-- Tab 3: Moje hůl a okolí -->
        <div class="sheet-tab-panel" id="sheet-panel-stick" hidden>
          <div id="sheet-stick-container"></div>
          <div id="sheet-pilgrims-container" style="margin-top:14px"></div>
        </div>
      </div>
    </div>

    <!-- Kapitoly a relikvie -->
    <div class="sectors-overview">
      <div class="section-heading">
        <div>
          <h2>Kapitoly Rožmitálska</h2>
          <p>Sbírej GPS razítka ověřených zastávek. Získáním všech zastávek splníš celou kapitolu.</p>
        </div>
      </div>
      <div class="sector-list" id="sector-list"></div>
    </div>

    <div class="walk-columns">
      <section class="panel">
        <h2>Rožmitálské relikvie a mystery nálezy</h2>
        <p id="walk-mystery"></p>
        <div id="walk-collection" class="mystery-collection"></div>
        <div id="walk-trophies" class="trophy-grid"></div>
        <p class="small-note">Relikvie se odemykají za každých 6 nově odkrytých dílků mapy. Zrcadlí bohatou historii Rožmitálska.</p>
      </section>

      <section class="panel">
        <h2>Místa a orientační body v dosahu</h2>
        <p>Přiblížením do 60 m na 10–60 s získáš jedno trvalé GPS razítko místa (+30 b.).</p>
        <button class="button" id="walk-nearby">Najít místa v okolí (OSM)</button>
        <div id="nearby-status" role="status"></div>
        <p id="nearby-origin" class="small-note"></p>
        <div id="walk-places"></div>
        <p class="small-note">Zdroj: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> a ověřené body Rožmitálu.</p>
      </section>
    </div>

    <div id="session-summary-container"></div>

    <details class="walk-help">
      <summary>Pravidla průzkumu, 3 režimy mapy a záloha dat v0.6</summary>
      <p><strong>3 režimy mapy:</strong> Průzkumná mlha (výchozí, alpha 0.65) zachovává orientaci a rozlišuje navštívená místa. Plná mlha (alpha 1.0) zakrývá terén neprozkoumaných oblastí. Běžná mapa okamžitě ukáže celý mapový podklad bez vlivu na body.</p>
      <p><strong>3 herní režimy:</strong> Kompas (čistý směr k dalšímu cíli), Trasa (zvýrazněná naplánovaná linka) a Radar (akustické/haptické varování na místa do 150 m).</p>
      <p><strong>Virtuální turistická hůl:</strong> Každá dokončená výprava vytvoří unikátní plechový štítek, který si můžeš přibít na hůl.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button id="walk-export" class="button small">Exportovat průzkum (JSON)</button>
        <button id="walk-import-btn" class="button small">Obnovit průzkum z JSON</button>
        <input type="file" id="walk-import-file" accept=".json,application/json" hidden>
      </div>
    </details>
  `;

  const $ = id => root.querySelector(`#${id}`);
  const status = text => { if (!disposed) $('walk-status').textContent = text; };
  const placesLayer = L?.layerGroup();
  trailLayer = L?.layerGroup();

  function saveAppState() {
    if (demo) return;
    stateObj.plannedRoute = plannedRoute;
    try {
      saveState(stateObj);
    } catch (e) {
      status(e.message);
    }
  }

  function metersToPx(lat, meters) {
    if (!map) return 30;
    const p1 = map.latLngToContainerPoint([lat, 0]);
    const p2 = map.latLngToContainerPoint([lat + (meters / 111320), 0]);
    return Math.max(12, Math.abs(p2.y - p1.y));
  }

  function drawFog() {
    if (!map || disposed) return;
    const canvas = fog, size = map.getSize(), ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = size.x * ratio; canvas.height = size.y * ratio;
    canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);

    if (fogMode === 'none') {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';

    const alpha = fogMode === 'full' ? 1.0 : 0.65;
    ctx.fillStyle = `rgba(22, 51, 41, ${alpha})`;
    ctx.fillRect(0, 0, size.x, size.y);

    ctx.strokeStyle = `rgba(216, 233, 158, ${fogMode === 'full' ? 0.04 : 0.025})`;
    ctx.lineWidth = 1;
    for (let x = 0; x < size.x; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.y); ctx.stroke();
    }
    for (let y = 0; y < size.y; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.x, y); ctx.stroke();
    }

    ctx.globalCompositeOperation = 'destination-out';
    const standardRadius = 65;

    for (const id of progress.cells) {
      const center = cellCenter(id);
      const cp = map.latLngToContainerPoint([center.lat, center.lng]);
      const radPx = metersToPx(center.lat, standardRadius);
      if (cp.x + radPx < 0 || cp.x - radPx > size.x || cp.y + radPx < 0 || cp.y - radPx > size.y) continue;
      const g = ctx.createRadialGradient(cp.x, cp.y, radPx * 0.4, cp.x, cp.y, radPx);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, radPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function scheduleFog() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { frame = null; drawFog(); });
  }

  function renderTrail() {
    trailLayer?.clearLayers();
    if (!map) return;
    const now = Date.now();
    const activeTrail = pruneTrail(memoryTrail, now);
    $('trail-info').textContent = `Stopa za poslední hodinu: ${activeTrail.length} bodů (automaticky mizí po 60 min, pouze v paměti relace)`;
    for (const pt of activeTrail) {
      if (pt.segmentBreak) continue;
      L.circleMarker([pt.lat, pt.lng], {
        radius: 3,
        color: '#d8e99e',
        weight: 1,
        fillColor: '#d8e99e',
        fillOpacity: pt.opacity,
        opacity: pt.opacity,
        pane: 'markerPane',
      }).addTo(trailLayer);
    }
  }

  function getAllAvailablePlaces() {
    return [...catalogue, ...nearby];
  }

  function getPlannedPlaces() {
    const all = getAllAvailablePlaces();
    const ids = plannedRoute.selectedPlaceIds || [];
    return ids.map(id => all.find(p => p.id === id)).filter(Boolean);
  }

  function renderCompass(origin) {
    if (!origin) return;
    const isCompassMode = stateObj.explorationMode === 'compass';
    const plannedPlaces = getPlannedPlaces();

    let targetPlace = null;
    let targetDist = Infinity;
    let targetIndex = 0;

    if (plannedPlaces.length > 0) {
      // Find first unvisited planned place
      for (let i = 0; i < plannedPlaces.length; i++) {
        const p = plannedPlaces[i];
        if (!progress.discoveries.includes(p.id) && !progress.discoveries.includes(`catalog:${p.id}`)) {
          targetPlace = p;
          targetDist = haversineMeters(origin, p) ?? Infinity;
          targetIndex = i + 1;
          break;
        }
      }
    }

    if (!targetPlace) {
      // Fallback to nearest unvisited catalog stamp
      for (const p of catalogue) {
        if (!p.collectible || progress.discoveries.includes(p.id) || progress.discoveries.includes(`catalog:${p.id}`)) continue;
        const d = haversineMeters(origin, p) ?? Infinity;
        if (d < targetDist) {
          targetDist = d;
          targetPlace = p;
        }
      }
    }

    if (targetPlace && Number.isFinite(targetDist)) {
      const angle = Math.atan2(targetPlace.lng - origin.lng, targetPlace.lat - origin.lat) * 180 / Math.PI;
      const normalizedAngle = (angle + 360) % 360;
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
      const dir = directions[Math.round(normalizedAngle / 45) % 8];
      const prefix = plannedPlaces.length > 0
        ? `Další cíl: ${targetIndex} z ${plannedPlaces.length}`
        : 'Nejbližší razítko';

      $('walk-compass').innerHTML = `🧭 <strong>${prefix}:</strong> ${Math.round(targetDist)} m vzdušně · ${dir.name} (${dir.arrow}) · ${e(targetPlace.title)}`;
      if ($('zen-compass-text')) {
        $('zen-compass-text').textContent = `${dir.arrow} ${Math.round(targetDist)} m (${targetPlace.title.slice(0, 20)})`;
      }
    } else {
      $('walk-compass').innerHTML = '🧭 <strong>Všechny cíle navštíveny!</strong> Výborně.';
      if ($('zen-compass-text')) $('zen-compass-text').textContent = '✓ Hotovo';
    }
  }

  function renderPlannedRouteOnMap() {
    if (!map) return;
    plannedRouteLayer.clearLayers();

    // 1. Radius Circle
    const center = plannedRoute.origin || lastFix || { lat: 49.6033, lng: 13.8633 };
    const radiusM = (plannedRoute.radiusKm || 3) * 1000;

    radiusCircle = L.circle([center.lat, center.lng], {
      radius: radiusM,
      color: '#467253',
      weight: 1.5,
      dashArray: '5, 5',
      fillColor: '#8da949',
      fillOpacity: 0.05,
    }).addTo(plannedRouteLayer);

    // 2. Focus Polyline
    const plannedPlaces = getPlannedPlaces();
    if (plannedPlaces.length > 0) {
      const latlngs = [];
      if (plannedRoute.origin) latlngs.push([plannedRoute.origin.lat, plannedRoute.origin.lng]);
      for (const p of plannedPlaces) latlngs.push([p.lat, p.lng]);

      focusPolyline = L.polyline(latlngs, {
        color: '#193e32',
        weight: 3.5,
        dashArray: '6, 8',
        opacity: 0.85,
      }).addTo(plannedRouteLayer);

      // Beacon on next unvisited planned place
      const nextTarget = plannedPlaces.find(p => !progress.discoveries.includes(p.id));
      if (nextTarget) {
        beaconMarker = L.marker([nextTarget.lat, nextTarget.lng], {
          icon: L.divIcon({
            className: 'beacon-pulse-icon',
            html: '<div class="beacon-pulse"></div>',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
        }).addTo(plannedRouteLayer);
      }
    }
  }

  function renderPlannerBasketAndXray() {
    const plannedPlaces = getPlannedPlaces();
    $('basket-count').textContent = plannedPlaces.length;

    // Render basket items
    const basketListEl = $('planner-basket-list');
    if (plannedPlaces.length === 0) {
      basketListEl.innerHTML = '<p class="small-note">V košíku zatím nemáš žádné místo. Klikni na místo na mapě nebo níže a přidej ho do výpravy (max 10).</p>';
    } else {
      basketListEl.innerHTML = plannedPlaces.map((p, idx) => `
        <div class="basket-item">
          <span class="basket-index">${idx + 1}.</span>
          <strong class="basket-title">${e(p.title)}</strong>
          <button class="button small ghost basket-remove-btn" data-remove-id="${e(p.id)}" title="Odebrat z košíku">✕</button>
        </div>
      `).join('');
    }

    $('btn-optimize-route').disabled = plannedPlaces.length < 2;

    // Render X-Ray
    const xrayCardEl = $('route-xray-card');
    const analysis = analyzePlannedRoute(plannedRoute.origin, plannedPlaces, stateObj.companionMode);

    xrayCardEl.innerHTML = `
      <div class="xray-header">
        <strong>🔬 Rentgen plánované výpravy</strong>
        <span class="small-note">${analysis.surfaceSummary}</span>
      </div>
      <div class="xray-stats-grid">
        <div class="xray-stat">
          <strong>${analysis.estimatedWalkDistanceM >= 1000 ? (analysis.estimatedWalkDistanceM / 1000).toFixed(1).replace('.', ',') + ' km' : analysis.estimatedWalkDistanceM + ' m'}</strong>
          <span>Odhad chůze (vzdušně ${analysis.airDistanceM} m)</span>
        </div>
        <div class="xray-stat">
          <strong>~${analysis.estimatedMinutes} min</strong>
          <span>Čas chůze (${COMPANION_STYLES.find(c => c.id === stateObj.companionMode)?.label || 'Sólo'})</span>
        </div>
        <div class="xray-stat">
          <strong id="xray-elevation-val">-- m</strong>
          <span>Stoupání <button class="small-link-btn" id="btn-fetch-elevation">Načíst převýšení</button></span>
        </div>
      </div>
      ${analysis.warnings.length > 0 ? `
        <div class="xray-warnings">
          ${analysis.warnings.map(w => `<div class="xray-warning-item">⚠️ ${e(w)}</div>`).join('')}
        </div>
      ` : ''}
    `;

    $('btn-fetch-elevation')?.addEventListener('click', async () => {
      const btn = $('btn-fetch-elevation');
      btn.textContent = 'Měřím…';
      btn.disabled = true;
      const points = [];
      if (plannedRoute.origin) points.push(plannedRoute.origin);
      for (const p of plannedPlaces) points.push(p);

      const res = await fetchElevationProfile(points);
      if (res.elevationGainM != null) {
        $('xray-elevation-val').textContent = `+${res.elevationGainM} m`;
        btn.textContent = 'Aktualizováno';
      } else {
        $('xray-elevation-val').textContent = 'Nedostupné';
        btn.textContent = 'Offline';
      }
    });
  }

  const kindIcons = { culture: '🏰', view: '⛰️', forest: '🌲', water: '💧' };

  function renderPlaces() {
    $('nearby-origin').textContent = demo ? 'Vzdálenosti od simulovaného bodu.' : lastFix ? 'Vzdálenosti od poslední GPS polohy.' : 'Vzdálenosti od středu mapy, nikoli od tebe.';
    placesLayer?.clearLayers();
    const all = getAllAvailablePlaces();
    const origin = lastFix || map?.getCenter();
    const normalized = origin ? { lat: origin.lat, lng: origin.lng } : null;
    renderCompass(normalized);

    const radiusM = (plannedRoute.radiusKm || 3) * 1000;
    const centerPoint = plannedRoute.origin || normalized || { lat: 49.6033, lng: 13.8633 };

    // Filter places by categories and radius
    const list = all
      .map(p => ({
        ...p,
        distanceFromUser: normalized ? (haversineMeters(normalized, p) ?? Infinity) : Infinity,
        distanceFromOrigin: haversineMeters(centerPoint, p) ?? Infinity,
      }))
      .filter(p => {
        if (p.distanceFromOrigin > radiusM) return false;
        if (plannedRoute.categories.length > 0 && p.category && !plannedRoute.categories.includes(p.category)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.distanceFromUser - b.distanceFromUser);

    $('walk-places').innerHTML = list.slice(0, 15).map(p => {
      const hasStamp = progress.discoveries.includes(p.id) || progress.discoveries.includes(`catalog:${p.id}`);
      const isRouteStart = p.pointKind === 'route-start';
      const isPlanned = (plannedRoute.selectedPlaceIds || []).includes(p.id);
      const statusText = hasStamp
        ? '✓ GPS razítko získáno (+30 b.)'
        : isRouteStart
        ? 'Začátek okruhu (nesbírá se razítko)'
        : p.collectible
        ? 'GPS razítko: přibliž se na 60 m'
        : 'Orientační bod';

      return `<div class="nearby-place">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <strong>${e(p.title)}</strong>
          <button class="button small ${isPlanned ? 'ghost' : 'lime'} toggle-plan-place-btn" data-place-id="${e(p.id)}" style="font-size:10px;padding:3px 8px">
            ${isPlanned ? '✓ V košíku' : '+ Přidat'}
          </button>
        </div>
        <span>${Math.round(p.distanceFromUser)} m od tebe · ${statusText}</span>
        <a href="${e(p.url)}" ${p.url?.startsWith('#') ? '' : 'target="_blank" rel="noopener"'}>Detail místa ↗</a>
      </div>`;
    }).join('') || '<p class="small-note">V zadaném okruhu a filtrech zatím není žádné místo. Uprav posuvník okruhu nebo kategorie.</p>';

    if (!map) return;

    for (const p of list) {
      const hasStamp = progress.discoveries.includes(p.id) || progress.discoveries.includes(`catalog:${p.id}`);
      const isRouteStart = p.pointKind === 'route-start';
      const isPlanned = (plannedRoute.selectedPlaceIds || []).includes(p.id);
      const kindIcon = isRouteStart ? '🏁' : kindIcons[p.kind] || '📍';
      const pinClass = isPlanned
        ? 'tier-gold beacon-glow'
        : hasStamp
        ? 'tier-silver'
        : 'tier-none';
      const pinContent = isPlanned ? '★' : hasStamp ? '✓' : kindIcon;

      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: `mystery-pin ${pinClass}`,
          html: pinContent,
          iconSize: [32, 32],
        }),
        title: p.title,
      });

      const popupHtml = `
        <div style="min-width:190px">
          <strong>${e(p.title)}</strong><br>
          <small>${Math.round(p.distanceFromUser)} m od tebe · ${hasStamp ? '✓ GPS razítko získáno' : 'GPS razítko: do 60 m'}</small>
          <div class="popup-actions" style="margin-top:8px">
            <button type="button" class="button small ${isPlanned ? 'danger' : 'lime'} toggle-plan-place-btn" data-place-id="${e(p.id)}">
              ${isPlanned ? 'Odebrat z plánu' : '+ Přidat do plánu'}
            </button>
            <a href="${e(p.url)}" class="button small">Detail místa</a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml).addTo(placesLayer);
    }

    renderPlannedRouteOnMap();
  }

  function renderExpeditionGoalUI() {
    const cardTitle = $('expedition-goal-title');
    const cardAction = $('expedition-goal-action');

    if (!currentExpedition || currentExpedition.state === 'ended') {
      cardTitle.innerHTML = 'Výchozí cíl: <strong>Projdi dnes 500 metrů</strong>';
      cardAction.innerHTML = `
        <select id="select-goal" class="button small" style="background:#fff;border:1px solid #b8c6af">
          <option value="meters-500">Projdi dnes 500 metrů</option>
          <option value="cells-3">Odkryj 3 nové dílky</option>
          <option value="none">Bez cíle</option>
        </select>
      `;
      $('select-goal')?.addEventListener('change', (ev) => {
        const val = ev.target.value;
        let chosen = DEFAULT_GOALS[0];
        if (val === 'cells-3') chosen = DEFAULT_GOALS[1];
        else if (val === 'none') chosen = DEFAULT_GOALS[2];
        cardTitle.innerHTML = `Vybraný cíl: <strong>${e(chosen.label)}</strong>`;
      });
      return;
    }

    const g = currentExpedition.goal;
    const gainedM = Math.max(0, progress.meters - (currentExpedition.startMeters || 0));
    const gainedC = Math.max(0, progress.cells.length - (currentExpedition.startCells || 0));
    const done = isGoalAchieved(currentExpedition, progress);

    let goalProgressText = '';
    if (g.type === 'meters') goalProgressText = `${gainedM} / ${g.target} m`;
    else if (g.type === 'cells') goalProgressText = `${gainedC} / ${g.target} dílků`;
    else if (g.type === 'place') goalProgressText = done ? 'Navštíveno!' : 'Čeká na přiblížení';
    else goalProgressText = 'Volná chůze';

    cardTitle.innerHTML = `${e(g.label)} — <strong>${done ? '✓ Splněno!' : goalProgressText}</strong>`;
    cardAction.innerHTML = done
      ? '<span class="status-dot"></span> <small style="color:#4a6828;font-weight:700">Cíl splněn</small>'
      : '<small class="small-note">Probíhá výprava</small>';
  }

  function stats() {
    const totalPts = totalScore(stateObj);
    const rank = explorerRank(totalPts);

    // Smooth counter transitions
    animateValue($('walk-points'), totalPts);
    animateValue($('walk-cells'), progress.cells.length);
    animateValue($('walk-distance'), progress.meters / 1000, 380, n => number(n));
    animateValue($('walk-relics'), progress.discoveries.length);
    const gainedM = currentExpedition ? Math.max(0, progress.meters - currentExpedition.startMeters) : 0;
    const gainedC = currentExpedition ? Math.max(0, progress.cells.length - currentExpedition.startCells) : 0;
    const gainedS = currentExpedition ? Math.max(0, progress.discoveries.length - currentExpedition.startDiscoveries) : 0;

    $('walk-session').textContent = `${demo ? 'Ukázka' : 'Tato výprava'}: ${Math.round(gainedM)} m · ${gainedC} nových dílků · ${gainedS} nových razítek`;

    $('rank-title').textContent = `Hodnost: Úroveň ${rank.level} · ${rank.title}`;
    $('rank-fog').textContent = `Dosah odkrývání v mlze: ${rank.fogRadiusM} m · Dosah odhalení: ${rank.revealDistanceM} m${rank.nextAt ? ` · Do další úrovně zbývá ${rank.nextAt - totalPts} b.` : ' · Nejvyšší úroveň dosažena!'}`;
    $('rank-badge').textContent = `Lvl ${rank.level}`;

    renderExpeditionGoalUI();

    const cStatus = chapterStatus(CHAPTERS, routes, progress.discoveries);
    $('sector-list').innerHTML = Object.values(cStatus).map(c => `
      <div class="sector-card ${c.unlocked ? 'unlocked' : ''}">
        <strong>${e(c.title)}</strong>
        <span>Razítka: ${c.completed}/${c.total} zastávek</span>
        <span class="sector-seal">${c.unlocked ? `🏆 ${e(c.sealTitle)} splněna!` : `📖 ${e(c.sealTitle)}`}</span>
      </div>
    `).join('');

    const remaining = 6 - (progress.cells.length % 6);
    $('walk-mystery').textContent = `Ještě ${remaining} nových dílků do dalšího fragmentu atlasu.`;
    const relicsFound = Math.floor(progress.cells.length / 6);
    $('walk-collection').innerHTML = RELICS.map((relic, i) => `
      <span class="fragment ${relicsFound > i ? 'found' : ''}" title="${relicsFound > i ? e(relic.lore) : 'Zatím neobjeveno'}">
        ${relicsFound > i ? `✧ ${e(relic.title)}` : '? Neznámá relikvie'}
      </span>
    `).join('');

    $('walk-trophies').innerHTML = trophies(progress).map(t => `
      <div class="trophy ${t.earned ? 'earned' : ''}">
        <span>${t.earned ? '✦' : '◇'}</span>
        <strong>${e(t.title)}</strong>
        <small>${t.earned ? 'Získáno' : e(t.goal)}</small>
      </div>
    `).join('');

    // Button states
    const hasExpedition = Boolean(currentExpedition && currentExpedition.state !== 'ended');
    const isPaused = hasExpedition && currentExpedition.state === 'paused';

    if (hasExpedition) {
      if (active) {
        $('walk-start').textContent = '▶ Běží záznam';
        $('walk-start').disabled = true;
        $('walk-stop').disabled = false;
        $('walk-end').disabled = false;
      } else if (isPaused) {
        $('walk-start').textContent = '▶ Pokračovat ve výpravě';
        $('walk-start').disabled = starting || demo || Boolean(storageError);
        $('walk-stop').disabled = true;
        $('walk-end').disabled = false;
      }
    } else {
      $('walk-start').textContent = '▶ Vyrazit s GPS';
      $('walk-start').disabled = active || starting || demo || Boolean(storageError);
      $('walk-stop').disabled = true;
      $('walk-end').disabled = true;
    }

    $('walk-step').hidden = !demo;
    $('walk-demo-banner').hidden = !demo;
    $('walk-demo').textContent = demo ? 'Ukončit ukázku' : 'Ukázka bez GPS';

    // Update Tab 3 (Stick & Pilgrims)
    const stickContainer = $('sheet-stick-container');
    if (stickContainer) {
      stickContainer.innerHTML = renderWalkingStickHtml(stateObj);
    }
    const pilgrimsContainer = $('sheet-pilgrims-container');
    if (pilgrimsContainer) {
      pilgrimsContainer.innerHTML = renderPilgrimsSection(stateObj, lastFix || plannedRoute.origin);
    }

    renderPlannerBasketAndXray();
    scheduleFog();
    renderTrail();
    renderPlaces();
  }

  function showPostcardModal(summary) {
    const container = $('session-summary-container');
    const dataUrl = generatePostcardDataUrl(summary);

    container.innerHTML = `
      <div class="session-modal" id="postcard-modal">
        <div class="session-modal-card" style="max-width:520px;text-align:center">
          <h2>Výprava úspěšně ukončena! 🎉</h2>
          <p>Tvoje malá výprava byla zaznamenána do osobního atlasu.</p>
          <div class="session-stats-grid" style="margin-bottom:12px">
            <div class="session-stat-box"><strong>${summary.distanceMeters >= 1000 ? (summary.distanceMeters / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(summary.distanceMeters) + ' m'}</strong><span>Ušlá vzdálenost</span></div>
            <div class="session-stat-box"><strong>+${summary.newCellsCount}</strong><span>Nové dílky</span></div>
            <div class="session-stat-box"><strong>+${summary.newStampsCount}</strong><span>Nová razítka</span></div>
            <div class="session-stat-box"><strong>${summary.goalAchieved ? '✓ Splněn' : 'Nesplněn'}</strong><span>Cíl výpravy</span></div>
          </div>
          <div style="margin:8px 0;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.18);line-height:0">
            <img src="${dataUrl}" alt="Ilustrovaná pohlednice z výpravy" style="width:100%;height:auto;display:block">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px">
            <button type="button" class="button primary" id="btn-download-postcard">Stáhnout pohlednici (PNG)</button>
            <button type="button" class="button" id="btn-share-postcard">Sdílet</button>
            <button type="button" class="button ghost" id="btn-close-postcard">Zavřít deník</button>
          </div>
        </div>
      </div>
    `;

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
            title: 'Moje malá výprava · Czekpoint',
            text: `Moje malá výprava s Czekpointem. Ujeto ${summary.distanceMeters >= 1000 ? (summary.distanceMeters / 1000).toFixed(1) + ' km' : Math.round(summary.distanceMeters) + ' m'}, ${summary.newCellsCount} nových dílků.`,
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

    $('btn-close-postcard')?.addEventListener('click', () => { container.innerHTML = ''; });
  }

  async function releaseWake() {
    if (wake) { const w = wake; wake = null; await w.release().catch(() => {}); }
    if (!disposed) $('wake-status').textContent = 'Displej: zámek není aktivní.';
  }

  async function holdWake() {
    if (!active || !$('walk-awake').checked) return;
    if (!navigator.wakeLock) { $('wake-status').textContent = 'Telefon neumí držet displej zapnutý.'; return; }
    try {
      const w = await navigator.wakeLock.request('screen');
      if (!active || disposed || !$('walk-awake').checked) { await w.release(); return; }
      wake = w;
      $('wake-status').textContent = 'Displej zůstává zapnutý.';
      w.addEventListener('release', () => {
        if (wake === w) { wake = null; if (!disposed) $('wake-status').textContent = 'Telefon uvolnil zámek displeje.'; }
      });
    } catch {
      if (!disposed) $('wake-status').textContent = 'Zámek displeje nebyl povolen.';
    }
  }

  function pauseSession(message) {
    active = false; starting = false;
    if (watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; }
    anchor = null;
    pendingPlaceStamps = {};
    if (lastFix) {
      memoryTrail = appendTrail(memoryTrail, { lat: lastFix.lat, lng: lastFix.lng, segmentBreak: true }, Date.now());
    }
    releaseWake();
    releaseLock?.(); releaseLock = null;

    if (currentExpedition && currentExpedition.state === 'active') {
      currentExpedition = pauseExpedition(currentExpedition);
      stateObj.activeExpedition = currentExpedition;
      if (!demo) {
        try { saveState(stateObj); } catch {}
      }
    }

    if (!disposed) {
      stats();
      if (message) status(message);
    }
  }

  function finishExpedition() {
    pauseSession();
    if (!currentExpedition) return;

    const gainedM = Math.max(0, progress.meters - (currentExpedition.startMeters || 0));
    const gainedC = Math.max(0, progress.cells.length - (currentExpedition.startCells || 0));
    const gainedS = Math.max(0, progress.discoveries.length - (currentExpedition.startDiscoveries || 0));
    const earnedPoints = gainedC * 10 + Math.floor(gainedM / 50) + gainedS * 30;

    const endResult = endExpedition({
      expedition: currentExpedition,
      currentProgress: progress,
      pointsEarned: earnedPoints,
      avatarId: stateObj.profile?.avatarId || 'liska',
    });

    if (!endResult) return;

    const { summary } = endResult;
    const history = [summary, ...(stateObj.expeditionHistory || [])].slice(0, 100);

    // Create unique tin badge for walking stick
    if (gainedM > 0 || gainedS > 0) {
      const badge = createStickBadge({
        expId: currentExpedition.id,
        distanceMeters: gainedM,
        stampsCount: gainedS,
        companionMode: stateObj.companionMode || 'solo',
        categories: currentExpedition.categories || [],
      });
      stateObj.stickBadges = [badge, ...(stateObj.stickBadges || [])].slice(0, 200);
      playStampChord(stateObj.soundEnabled);
    }

    stateObj = {
      ...stateObj,
      activeExpedition: null,
      expeditionHistory: history,
    };
    currentExpedition = null;

    if (!demo) {
      try {
        saveState(stateObj);
      } catch (err) {
        status('Chyba při ukládání ukončené výpravy: ' + err.message);
        return;
      }
    }

    stats();
    status('Výprava byla úspěšně ukončena a uložena.');
    showPostcardModal(summary);
  }

  function sample(fix, now = Date.now()) {
    if (disposed || (!active && !demo)) return;
    const result = acceptFix(progress, anchor, fix, now);
    anchor = result.anchor;

    const validFix = result.anchor?.lastValidFix || (result.accepted ? fix : null);
    if (validFix) {
      lastFix = validFix;
      memoryTrail = appendTrail(memoryTrail, validFix, now);

      if (map) {
        player.setLatLng([validFix.lat, validFix.lng]).setStyle({ opacity: 1, fillOpacity: 1 });
        accuracyRing.setLatLng([validFix.lat, validFix.lng]).setRadius(validFix.accuracy);
        if (follow) map.setView([validFix.lat, validFix.lng], Math.max(16, map.getZoom()), { animate: false });
      }

      // Proximity check for GPS stamps using 2-sample rule (10s - 60s)
      const allPlaces = getAllAvailablePlaces();
      const stampedProgress = discoverNearby(progress, validFix, allPlaces, pendingPlaceStamps);

      for (const p of allPlaces) {
        if (!p.collectible && p.pointKind !== 'place') continue;
        const d = haversineMeters(validFix, p);
        if (d != null && d <= 60 && pendingPlaceStamps[p.id]?.count >= 2) {
          if (currentExpedition) {
            currentExpedition = recordExpeditionVisit(currentExpedition, p);
            stateObj.activeExpedition = currentExpedition;
          }
        }
      }

      // Radar check: alert on collectible places within 150m not in plan
      if (stateObj.explorationMode === 'radar') {
        const plannedIds = plannedRoute.selectedPlaceIds || [];
        const nearbyUnplanned = allPlaces.find(p => {
          if (!p.collectible || plannedIds.includes(p.id) || progress.discoveries.includes(p.id)) return false;
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
              <button class="button small lime add-radar-place-btn" data-place-id="${e(nearbyUnplanned.id)}">+ Přidat do trasy</button>
            `;
          }
        }
      }

      if (stampedProgress.discoveries.length > progress.discoveries.length) {
        const addedCount = stampedProgress.discoveries.length - progress.discoveries.length;
        const newStampIds = stampedProgress.discoveries.filter(id => !progress.discoveries.includes(id));
        for (const newId of newStampIds) {
          stateObj = recordSummitEntry(stateObj, newId);
        }
        playStampChord(stateObj.soundEnabled);
        progress = { ...progress, discoveries: stampedProgress.discoveries };
        stateObj = { ...stateObj, discoveries: progress.discoveries };
        if (!demo) {
          try { saveState(stateObj); } catch (e) { status(e.message); }
        }
        status(`🏆 Získáno GPS razítko ověřeného místa! +${addedCount * 30} bodů.`);
      }
    }

    if (!result.accepted) {
      status(result.reason);
      stats();
      return;
    }

    progress = {
      ...progress,
      cells: result.progress.cells,
      meters: result.progress.meters,
    };
    stateObj = {
      ...stateObj,
      cells: progress.cells,
      meters: progress.meters,
    };

    if (!demo) {
      try {
        saveState(stateObj);
      } catch (error) {
        pauseSession(error.message);
        return;
      }
    }

    stats();
    status(`${result.reason} GPS ±${Math.round(fix.accuracy)} m.`);
  }

  async function start() {
    if (active || starting || demo || disposed) return;
    if (!isSecureContext || !navigator.geolocation) { status('GPS vyžaduje HTTPS a podporovaný prohlížeč.'); return; }
    if (!navigator.locks) { status('Prohlížeč nepodporuje bezpečný souběh. Použij aktuální Chrome nebo Safari.'); return; }

    starting = true; stats(); status('Spouštím GPS…');
    try {
      await navigator.locks.request('czekpoint-walk', { ifAvailable: true }, async lock => {
        if (disposed || !starting) return;
        if (!lock) { starting = false; stats(); status('Procházka už běží v jiné kartě.'); return; }

        stateObj = loadState();
        progress = { version: 1, cells: stateObj.cells, meters: stateObj.meters, discoveries: stateObj.discoveries };

        if (!currentExpedition || currentExpedition.state === 'ended') {
          const select = $('select-goal');
          let goal = DEFAULT_GOALS[0];
          if (select?.value === 'cells-3') goal = DEFAULT_GOALS[1];
          else if (select?.value === 'none') goal = DEFAULT_GOALS[2];

          currentExpedition = createExpedition({ progress, goal });
        } else if (currentExpedition.state === 'paused') {
          currentExpedition = resumeExpedition(currentExpedition);
        }

        stateObj.activeExpedition = currentExpedition;
        if (!demo) {
          try { saveState(stateObj); } catch {}
        }

        starting = false; active = true; anchor = null; follow = true; stats();
        status('Čekám na GPS. Povol polohu a vyjdi na otevřené místo.');
        const held = new Promise(resolve => { releaseLock = resolve; });
        watch = navigator.geolocation.watchPosition(
          p => sample({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, timestamp: p.timestamp }),
          error => {
            if (error.code === 1) pauseSession('Poloha není povolená. Povol ji v nastavení.');
            else { anchor = null; status('GPS zatím není dostupná.'); }
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
        holdWake();
        await held;
      });
    } catch (error) { pauseSession(error.message || 'GPS nelze spustit.'); }
  }

  if (L) {
    const center = progress.cells.length ? cellCenter(progress.cells.at(-1)) : { lat: 49.6018, lng: 13.8635 };
    map = L.map($('walk-map'), { zoomControl: true, minZoom: 3, maxZoom: 18, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 }).setView([center.lat, center.lng], 16);
    tileLayer = L.tileLayer(config.mapTileUrl, { maxZoom: 19, noWrap: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    tileLayer.on('tileerror', () => { $('tile-status').textContent = 'Mapový podklad se nenačetl. Průzkum funguje dál.'; });

    const pane = map.createPane('walk-fog');
    pane.style.zIndex = '450';
    pane.style.pointerEvents = 'none';
    fog = L.DomUtil.create('canvas', 'walk-fog', pane);
    fog.setAttribute('aria-hidden', 'true');

    placesLayer.addTo(map);
    trailLayer.addTo(map);
    plannedRouteLayer.addTo(map);

    accuracyRing = L.circle([center.lat, center.lng], { radius: 0, color: '#68c8ff', weight: 1, fillOpacity: .12, pane: 'markerPane' }).addTo(map);
    player = L.circleMarker([center.lat, center.lng], { radius: 8, color: 'white', weight: 3, fillColor: '#218bea', opacity: 0, fillOpacity: 0, pane: 'markerPane' }).addTo(map);

    map.on('move zoom resize', scheduleFog);
    map.on('dragstart', () => { follow = false; });
    map.on('moveend', () => { if (!lastFix) renderPlaces(); });

    // Map click handler for selecting start origin
    map.on('click', ev => {
      if (pickingStartOnMap) {
        pickingStartOnMap = false;
        $('btn-origin-map').classList.remove('primary');
        plannedRoute.origin = {
          id: 'custom-map',
          label: `Bod v mapě [${ev.latlng.lat.toFixed(3)}, ${ev.latlng.lng.toFixed(3)}]`,
          lat: ev.latlng.lat,
          lng: ev.latlng.lng,
        };
        $('planner-origin-desc').textContent = `Start: ${plannedRoute.origin.label}`;
        playTick(stateObj.soundEnabled);
        saveAppState();
        renderPlaces();
        status('Startovní bod nastaven kliknutím do mapy.');
      }
    });
  } else {
    $('walk-map').textContent = 'Mapová knihovna chybí.';
  }

  // Hook basic controls
  $('walk-start').addEventListener('click', start);
  $('walk-stop').addEventListener('click', () => pauseSession('Výprava pozastavena. Průzkum je uložený.'));
  $('walk-end').addEventListener('click', finishExpedition);
  $('walk-awake').addEventListener('change', () => { $('walk-awake').checked ? holdWake() : releaseWake(); });
  $('walk-sound').addEventListener('change', (ev) => {
    stateObj.soundEnabled = ev.target.checked;
    saveAppState();
  });

  // Bottom Sheet Tabs & Toggle
  const sheetTabs = root.querySelectorAll('.sheet-tab');
  sheetTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.sheetTab;
      activeTab = target;
      sheetTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      $('sheet-panel-planner').hidden = target !== 'planner';
      $('sheet-panel-expedition').hidden = target !== 'expedition';
      $('sheet-panel-stick').hidden = target !== 'stick';
      playTick(stateObj.soundEnabled);
    });
  });

  $('sheet-toggle-btn').addEventListener('click', () => {
    sheetCollapsed = !sheetCollapsed;
    $('walk-bottom-sheet').classList.toggle('collapsed', sheetCollapsed);
    $('sheet-toggle-btn').textContent = sheetCollapsed ? '⬆ Rozbalit' : '⬇ Sbalit';
    playTick(stateObj.soundEnabled);
  });

  // Zen mode toggle
  $('walk-zen-toggle').addEventListener('click', () => {
    zenMode = !zenMode;
    $('walk-map-wrap').classList.toggle('zen-mode', zenMode);
    $('zen-mini-compass').hidden = !zenMode;
    $('walk-zen-toggle').setAttribute('aria-pressed', String(zenMode));
    $('walk-zen-toggle').textContent = zenMode ? '⛶ Ukončit čistou mapu' : '⛶ Čistá mapa';
    $('walk-stats-panel').hidden = zenMode;
    $('walk-bottom-sheet').hidden = zenMode;
    if (map) setTimeout(() => map.invalidateSize(), 200);
    playTick(stateObj.soundEnabled);
  });

  // Start point selection
  $('btn-origin-gps').addEventListener('click', () => {
    if (lastFix) {
      plannedRoute.origin = { id: 'my-gps', label: 'Moje GPS poloha', lat: lastFix.lat, lng: lastFix.lng };
      $('planner-origin-desc').textContent = 'Start: Moje GPS poloha';
      playTick(stateObj.soundEnabled);
      saveAppState();
      renderPlaces();
    } else {
      status('Nejdříve spusť GPS nebo ukázku.');
    }
  });

  $('btn-origin-map').addEventListener('click', () => {
    pickingStartOnMap = !pickingStartOnMap;
    $('btn-origin-map').classList.toggle('primary', pickingStartOnMap);
    if (pickingStartOnMap) {
      status('Klikni kamkoliv do mapy pro nastavení startu výpravy.');
    }
    playTick(stateObj.soundEnabled);
  });

  $('btn-origin-namesti').addEventListener('click', () => {
    plannedRoute.origin = START_PRESETS[0];
    $('planner-origin-desc').textContent = `Start: ${START_PRESETS[0].label}`;
    playTick(stateObj.soundEnabled);
    saveAppState();
    renderPlaces();
  });

  $('btn-origin-nadrazi').addEventListener('click', () => {
    plannedRoute.origin = START_PRESETS[1];
    $('planner-origin-desc').textContent = `Start: ${START_PRESETS[1].label}`;
    playTick(stateObj.soundEnabled);
    saveAppState();
    renderPlaces();
  });

  $('btn-origin-stary').addEventListener('click', () => {
    plannedRoute.origin = START_PRESETS[2];
    $('planner-origin-desc').textContent = `Start: ${START_PRESETS[2].label}`;
    playTick(stateObj.soundEnabled);
    saveAppState();
    renderPlaces();
  });

  // Radius buttons
  root.querySelectorAll('[data-radius]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = Number(btn.dataset.radius);
      plannedRoute.radiusKm = r;
      root.querySelectorAll('[data-radius]').forEach(b => b.classList.remove('primary'));
      btn.classList.add('primary');
      playTick(stateObj.soundEnabled);
      saveAppState();
      renderPlaces();
    });
  });

  // Category filter chips
  root.querySelectorAll('.cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const catId = chip.dataset.catId;
      if (plannedRoute.categories.includes(catId)) {
        plannedRoute.categories = plannedRoute.categories.filter(c => c !== catId);
        chip.classList.remove('selected');
      } else {
        plannedRoute.categories.push(catId);
        chip.classList.add('selected');
      }
      playTick(stateObj.soundEnabled);
      saveAppState();
      renderPlaces();
    });
  });

  // Optimize route order
  $('btn-optimize-route').addEventListener('click', () => {
    const plannedPlaces = getPlannedPlaces();
    if (plannedPlaces.length < 2) return;
    const ordered = optimizeRouteOrder(plannedRoute.origin, plannedPlaces);
    plannedRoute.selectedPlaceIds = ordered.map(p => p.id);
    playHammer(stateObj.soundEnabled);
    saveAppState();
    renderPlannerBasketAndXray();
    renderPlaces();
    status('Trasa byla seřazena od startu metodou nejbližšího souseda.');
  });

  // Companion mode buttons
  root.querySelectorAll('.companion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.companion;
      stateObj.companionMode = mode;
      plannedRoute.companionMode = mode;
      root.querySelectorAll('.companion-btn').forEach(b => b.classList.remove('primary'));
      btn.classList.add('primary');
      playTick(stateObj.soundEnabled);
      saveAppState();
      renderPlannerBasketAndXray();
    });
  });

  // Exploration mode buttons
  root.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      stateObj.explorationMode = mode;
      plannedRoute.explorationMode = mode;
      root.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('primary'));
      btn.classList.add('primary');
      $('exploration-mode-desc').textContent = mode === 'compass'
        ? 'Kompas ukazuje vzdušný směr a vzdálenost pouze k dalšímu cíli.'
        : mode === 'radar'
        ? 'Radar tě upozorní zvukem/haptikou při přiblížení pod 150 m k neplánovanému místu.'
        : 'Trasa zobrazuje vybraná místa spojená linkou na mapě.';
      playTick(stateObj.soundEnabled);
      saveAppState();
      renderPlaces();
    });
  });

  // Route share code
  $('btn-share-route-code').addEventListener('click', async () => {
    try {
      const code = encodeRouteShareCode(plannedRoute);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        status(`Kód trasy ${code} byl zkopírován do schránky!`);
      } else {
        window.prompt('Zkopíruj si kód trasy:', code);
      }
      playTick(stateObj.soundEnabled);
    } catch (err) {
      status('Chyba při kódování trasy: ' + err.message);
    }
  });

  // Route import code
  $('btn-import-route-code').addEventListener('click', () => {
    const input = window.prompt('Vlož sdílený kód trasy (např. CZK1-...):');
    if (!input) return;
    try {
      const plan = decodeRouteShareCode(input.trim());
      plannedRoute = {
        ...plannedRoute,
        ...plan,
      };
      stateObj.companionMode = plan.companionMode;
      stateObj.explorationMode = plan.explorationMode;
      saveAppState();
      stats();
      playStampChord(stateObj.soundEnabled);
      status('Sdílená trasa byla úspěšně načtena!');
    } catch (err) {
      alert('Neplatný kód trasy: ' + err.message);
    }
  });

  // Fog toggles
  $('walk-fog-toggle').addEventListener('click', () => {
    if (fogMode === 'none') {
      fogMode = previousFogMode || 'explore';
    } else if (fogMode === 'explore') {
      fogMode = 'full';
    } else {
      fogMode = 'explore';
    }
    previousFogMode = fogMode;
    $('walk-fog-toggle').textContent = fogMode === 'full' ? 'Mlha: Plná (100 %)' : 'Mlha: Průzkumná (65 %)';
    $('walk-plain-map').setAttribute('aria-pressed', 'false');
    scheduleFog();
  });

  $('walk-plain-map').addEventListener('click', () => {
    if (fogMode !== 'none') {
      previousFogMode = fogMode;
      fogMode = 'none';
      $('walk-plain-map').setAttribute('aria-pressed', 'true');
      $('walk-fog-toggle').textContent = 'Mlha: Vypnutá';
    } else {
      fogMode = previousFogMode || 'explore';
      $('walk-plain-map').setAttribute('aria-pressed', 'false');
      $('walk-fog-toggle').textContent = fogMode === 'full' ? 'Mlha: Plná (100 %)' : 'Mlha: Průzkumná (65 %)';
    }
    scheduleFog();
  });

  $('walk-center').addEventListener('click', () => {
    follow = true;
    if (lastFix && map) map.setView([lastFix.lat, lastFix.lng], 16);
    else status('Nejdřív spusť GPS nebo ukázku.');
  });

  $('walk-demo').addEventListener('click', () => {
    pauseSession();
    demo = !demo;
    lastFix = null; nearby = []; anchor = null;
    memoryTrail = [];
    pendingPlaceStamps = {};
    if (demo) {
      progress = emptyWalk();
      stateObj = emptyState();
      currentExpedition = createExpedition({ progress, goal: DEFAULT_GOALS[0] });
      demoIndex = 0;
      stats();
      stepDemo();
    } else {
      try {
        stateObj = loadState();
        progress = { version: 1, cells: stateObj.cells, meters: stateObj.meters, discoveries: stateObj.discoveries };
        currentExpedition = stateObj.activeExpedition;
      } catch (error) {
        storageError = error.message;
        progress = emptyWalk();
        currentExpedition = null;
      }
      stats();
      status(storageError || 'Ukázka skončila.');
      if (map) {
        player.setStyle({ opacity: 0, fillOpacity: 0 });
        accuracyRing.setRadius(0);
        const c = progress.cells.length ? cellCenter(progress.cells.at(-1)) : { lat: 49.6018, lng: 13.8635 };
        map.setView([c.lat, c.lng], 16);
      }
    }
  });

  function stepDemo() {
    const fix = {
      lat: 49.6018 + demoIndex * .00045,
      lng: 13.8635 + Math.sin(demoIndex * .7) * .00025,
      accuracy: 5,
      timestamp: Date.now() + demoIndex * 40000,
    };
    demoIndex++;
    sample(fix, fix.timestamp);
  }
  $('walk-step').addEventListener('click', stepDemo);

  // Global event delegation for place buttons, basket removal, hammering badges, pilgrims
  root.addEventListener('click', async event => {
    // 1. Toggle place in plan
    const planBtn = event.target.closest('.toggle-plan-place-btn');
    if (planBtn) {
      const placeId = planBtn.dataset.placeId;
      const ids = plannedRoute.selectedPlaceIds || [];
      if (ids.includes(placeId)) {
        plannedRoute.selectedPlaceIds = ids.filter(id => id !== placeId);
      } else {
        if (ids.length >= 10) {
          alert('Košík výpravy může obsahovat nejvýše 10 míst.');
          return;
        }
        plannedRoute.selectedPlaceIds = [...ids, placeId];
      }
      playTick(stateObj.soundEnabled);
      saveAppState();
      renderPlannerBasketAndXray();
      renderPlaces();
      return;
    }

    // 2. Remove place from basket
    const removeBtn = event.target.closest('.basket-remove-btn');
    if (removeBtn) {
      const removeId = removeBtn.dataset.removeId;
      plannedRoute.selectedPlaceIds = (plannedRoute.selectedPlaceIds || []).filter(id => id !== removeId);
      playTick(stateObj.soundEnabled);
      saveAppState();
      renderPlannerBasketAndXray();
      renderPlaces();
      return;
    }

    // 3. Add place from radar banner
    const addRadarBtn = event.target.closest('.add-radar-place-btn');
    if (addRadarBtn) {
      const placeId = addRadarBtn.dataset.placeId;
      const ids = plannedRoute.selectedPlaceIds || [];
      if (!ids.includes(placeId)) {
        plannedRoute.selectedPlaceIds = [...ids, placeId].slice(0, 10);
        saveAppState();
        renderPlannerBasketAndXray();
        renderPlaces();
        $('walk-radar-banner').hidden = true;
        playTick(stateObj.soundEnabled);
      }
      return;
    }

    // 4. Hammer badge onto stick
    const hammerBtn = event.target.closest('.hammer-badge-btn');
    if (hammerBtn) {
      const badgeId = hammerBtn.dataset.badgeId;
      const badge = (stateObj.stickBadges || []).find(b => b.id === badgeId);
      if (badge) {
        badge.pinned = true;
        hammerBtn.classList.add('hammering');
        playHammer(stateObj.soundEnabled);
        triggerHaptic([40, 50, 40]);
        setTimeout(() => {
          saveAppState();
          stats();
          status('Štítek byl úspěšně přibit na tvoji turistickou hůl!');
        }, 320);
      }
      return;
    }

    // 5. Pilgrim clink greeting
    const clinkBtn = event.target.closest('.clink-btn');
    if (clinkBtn) {
      clinkBtn.classList.add('clinking');
      playHammer(stateObj.soundEnabled);
      triggerHaptic(50);
      stateObj.clinksCount = (Number(stateObj.clinksCount) || 0) + 1;
      saveAppState();
      setTimeout(() => {
        stats();
        status('Cinknul jsi holí na pozdrav poutníkovi v revíru!');
      }, 300);
      return;
    }

    // 6. Toggle pilgrims opt-in
    const pilgrimsToggleBtn = event.target.closest('#toggle-pilgrims-optin-btn');
    if (pilgrimsToggleBtn) {
      stateObj.pilgrimsOptIn = !stateObj.pilgrimsOptIn;
      playTick(stateObj.soundEnabled);
      saveAppState();
      stats();
      return;
    }

    // 7. Note visit
    const visitBtn = event.target.closest('[data-walk-action="visit"]');
    if (visitBtn) {
      const routeId = visitBtn.dataset.route;
      const targetRoute = routes.find(r => r.id === routeId);
      if (!targetRoute) return;
      visitBtn.disabled = true;
      if (onAddVisit) await onAddVisit(routeId);
      stats();
      status(`Návštěva ${targetRoute.title} byla zaznamenána do tvého pasu.`);
    }
  });

  // Nearby OSM fetch
  $('walk-nearby').addEventListener('click', async () => {
    if (demo) { $('nearby-status').textContent = 'Ukázka používá připravený katalog.'; return; }
    if (!lastFix || Date.now() - lastFix.timestamp > 60000) { $('nearby-status').textContent = 'Nejdřív spusť GPS a získej polohu.'; return; }
    $('walk-nearby').disabled = true;
    $('nearby-status').textContent = 'Hledám místa v okolí…';
    try {
      const found = await fetchNearby(lastFix, config.overpassUrl, aborter.signal, routes, {
        radiusM: (plannedRoute.radiusKm || 3) * 1000,
        categories: plannedRoute.categories,
      });
      if (disposed || demo) return;
      nearby = found;
      renderPlaces();
      $('nearby-status').textContent = found.length ? `Načteno ${found.length} míst.` : 'V okolí nejsou další známá místa.';
    } catch (error) {
      if (!disposed) $('nearby-status').textContent = error.name === 'AbortError' ? 'Hledání trvalo příliš dlouho.' : error.message;
    } finally {
      if (!disposed) $('walk-nearby').disabled = false;
    }
  });

  // Export & Import
  $('walk-export').addEventListener('click', () => {
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
      const confirmed = window.confirm(
        `Obnovit průzkum ze zálohy?\n\n` +
        `• Avatar: ${preview.avatarId}\n` +
        `• Odkryté dílky: ${preview.cellsCount}\n` +
        `• Ušlá vzdálenost: ${preview.metersKm} km\n` +
        `• GPS razítka: ${preview.stampsCount}\n` +
        `• Štítky na holi: ${preview.badgesCount || 0}\n` +
        `• Uložené výpravy: ${preview.historyCount}\n\n` +
        `Pozor: Současný postup v tomto prohlížeči bude nahrazen touto zálohou.`
      );
      if (confirmed) {
        pauseSession();
        stateObj = importStateJson(text);
        progress = { version: 1, cells: stateObj.cells, meters: stateObj.meters, discoveries: stateObj.discoveries };
        currentExpedition = stateObj.activeExpedition;
        plannedRoute = stateObj.plannedRoute || plannedRoute;
        stats();
        status('Průzkum byl úspěšně obnoven ze zálohy.');
      }
    } catch (err) {
      alert('Chyba při obnově zálohy: ' + err.message);
    } finally {
      ev.target.value = '';
    }
  });

  const visibility = () => { if (document.hidden && (active || starting)) pauseSession('Záznam byl pozastaven při skrytí aplikace.'); };
  document.addEventListener('visibilitychange', visibility);
  const pagehide = () => pauseSession();
  window.addEventListener('pagehide', pagehide);

  const storageChanged = event => {
    if (event.key === STATE_KEY && !demo) {
      pauseSession();
      try {
        stateObj = loadState();
        progress = { version: 1, cells: stateObj.cells, meters: stateObj.meters, discoveries: stateObj.discoveries };
        currentExpedition = stateObj.activeExpedition;
        plannedRoute = stateObj.plannedRoute || plannedRoute;
        storageError = '';
      } catch (err) { storageError = err.message; }
      stats();
      status(storageError || 'Průzkum se změnil v jiné kartě.');
    }
  };
  window.addEventListener('storage', storageChanged);

  stats();

  return () => {
    disposed = true;
    pauseSession();
    aborter.abort();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('storage', storageChanged);
    if (frame) cancelAnimationFrame(frame);
    map?.remove();
  };
}
