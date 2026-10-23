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

  // Active expedition from persisted state
  let currentExpedition = stateObj.activeExpedition;
  if (currentExpedition && currentExpedition.state === 'active') {
    // If loaded from reload/storage, keep paused until user explicitly clicks continue
    currentExpedition = pauseExpedition(currentExpedition);
    stateObj.activeExpedition = currentExpedition;
    try { saveState(stateObj); } catch {}
  }

  const catalogue = routes
    .filter(r => r.location)
    .map(r => ({
      id: r.id,
      routeId: r.id,
      title: r.pointKind === 'place' ? r.title : `Start trasy: ${r.title}`,
      lat: r.location.lat,
      lng: r.location.lng,
      kind: r.kind,
      chapter: r.chapter || r.sector,
      hintAnchor: Boolean(r.hintAnchor || r.watchtower),
      url: `#/trasa/${r.id}`,
      pointKind: r.pointKind || 'place',
      collectible: r.collectible !== false && r.pointKind === 'place',
    }));

  root.innerHTML = `
    <section class="walk-heading">
      <div>
        <div class="eyebrow">Malé kroky. Skutečný průzkum.</div>
        <h1 tabindex="-1">Tvoje mapa dobrodružství.</h1>
        <p>Osobní atlas, 12 avatarů, GPS razítka a ilustrovaná pohlednice z každé výpravy.</p>
      </div>
      <span class="walk-tag">PILOT · v0.5</span>
    </section>

    <div class="walk-stats" aria-label="Celkový průzkum">
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

    <div class="walk-compass-bar" id="walk-compass" role="status">🧭 Čekám na polohu pro určení směru k nejbližšímu místu…</div>

    <div class="walk-map-wrap">
      <div id="walk-map" aria-label="Interaktivní mapa průzkumu"></div>
      <div class="walk-map-toolbar">
        <button class="button small" id="walk-center" title="Vycentrovat na moji polohu">◎ Moje poloha</button>
        <button class="button small" id="walk-fog-toggle" aria-pressed="true" title="Přepnout krytí mlhy">Mlha: Průzkumná (65 %)</button>
        <button class="button small" id="walk-plain-map" aria-pressed="false" title="Zobrazit běžný mapový podklad">Běžná mapa</button>
      </div>
    </div>
    <div class="trail-note" id="trail-info">Stopa za poslední hodinu: 0 bodů (automaticky mizí po 60 min, pouze v paměti relace)</div>
    <p id="tile-status" class="small-note" role="status"></p>

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
      <label><input type="checkbox" id="walk-awake" checked> Při chůzi držet displej zapnutý</label>
      <span id="wake-status" class="small-note">Displej: zámek není aktivní.</span>
    </div>

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
      <summary>Pravidla průzkumu, 3 režimy mapy a záloha dat v0.5</summary>
      <p><strong>3 režimy mapy:</strong> Průzkumná mlha (výchozí, alpha 0.65) zachovává orientaci a rozlišuje navštívená místa. Plná mlha (alpha 1.0) zakrývá terén neprozkoumaných oblastí. Běžná mapa okamžitě ukáže celý mapový podklad bez vlivu na body.</p>
      <p><strong>Životní cyklus výpravy:</strong> Výprava má stav aktivní, pozastavená nebo ukončená. Pozastavení přeruší stopu a zastaví GPS. Tlačítko Ukončit výpravu atomicky uloží konečný stav a vytvoří pohlednici.</p>
      <p><strong>Pravidlo GPS razítka:</strong> Vyžaduje 2 validní GPS polohy v okruhu 60 m od ověřeného místa, s odstupem 10–60 sekund. Opakovaná návštěva ve stejné výpravě se započte do motivu pohlednice, ale nepřidává dalších 30 bodů.</p>
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

    // Alpha level according to fog mode:
    // 'explore' -> 0.65 | 'full' -> 1.0
    const alpha = fogMode === 'full' ? 1.0 : 0.65;
    ctx.fillStyle = `rgba(22, 51, 41, ${alpha})`;
    ctx.fillRect(0, 0, size.x, size.y);

    // Subtle texture grid
    ctx.strokeStyle = `rgba(216, 233, 158, ${fogMode === 'full' ? 0.04 : 0.025})`;
    ctx.lineWidth = 1;
    for (let x = 0; x < size.x; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.y); ctx.stroke();
    }
    for (let y = 0; y < size.y; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.x, y); ctx.stroke();
    }

    ctx.globalCompositeOperation = 'destination-out';
    const standardRadius = 65; // Fixed fog cutout radius

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

  function renderCompass(origin) {
    if (!origin) return;
    let nearestStamp = null;
    let nearestDist = Infinity;
    for (const p of catalogue) {
      if (!p.collectible || progress.discoveries.includes(p.id) || progress.discoveries.includes(`catalog:${p.id}`)) continue;
      const d = haversineMeters(origin, p) ?? Infinity;
      if (d < nearestDist) {
        nearestDist = d;
        nearestStamp = p;
      }
    }
    if (nearestStamp && Number.isFinite(nearestDist)) {
      const angle = Math.atan2(nearestStamp.lng - origin.lng, nearestStamp.lat - origin.lat) * 180 / Math.PI;
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
      const kindLabel = { culture: 'Kultura', view: 'Vyhlídka', forest: 'Les', water: 'Voda' }[nearestStamp.kind] || 'Místo';
      $('walk-compass').innerHTML = `🧭 <strong>Nejbližší razítko:</strong> ${Math.round(nearestDist)} m vzdušně · ${dir.name} (${dir.arrow}) · ${e(nearestStamp.title)} (${kindLabel})`;
    } else {
      $('walk-compass').innerHTML = '🧭 <strong>Všechna dostupná razítka získána!</strong> Skvělá práce.';
    }
  }

  const kindIcons = { culture: '🏰', view: '⛰️', forest: '🌲', water: '💧' };

  function renderPlaces() {
    $('nearby-origin').textContent = demo ? 'Vzdálenosti od simulovaného bodu.' : lastFix ? 'Vzdálenosti od poslední GPS polohy.' : 'Vzdálenosti od středu mapy, nikoli od tebe.';
    placesLayer?.clearLayers();
    const all = [...catalogue, ...nearby];
    const origin = lastFix || map?.getCenter();
    const normalized = origin ? { lat: origin.lat, lng: origin.lng } : null;
    renderCompass(normalized);

    const list = all
      .map(p => ({ ...p, distance: haversineMeters(normalized, p) ?? Infinity }))
      .filter(p => p.distance <= 3500)
      .sort((a, b) => a.distance - b.distance);

    $('walk-places').innerHTML = list.slice(0, 10).map(p => {
      const hasStamp = progress.discoveries.includes(p.id) || progress.discoveries.includes(`catalog:${p.id}`);
      const isRouteStart = p.pointKind === 'route-start';
      const statusText = hasStamp
        ? '✓ GPS razítko získáno (+30 b.)'
        : isRouteStart
        ? 'Začátek okruhu (nesbírá se razítko)'
        : p.collectible
        ? 'GPS razítko: přibliž se na 60 m'
        : 'Orientační bod';

      return `<div class="nearby-place">
        <strong>${e(p.title)}</strong>
        <span>${Math.round(p.distance)} m vzdušně · ${statusText}</span>
        <a href="${e(p.url)}" ${p.url?.startsWith('#') ? '' : 'target="_blank" rel="noopener"'}>Detail místa ↗</a>
      </div>`;
    }).join('') || '<p class="small-note">V dosahu zatím není žádné místo. Vydej se na cestu!</p>';

    if (!map) return;

    for (const p of list) {
      const hasStamp = progress.discoveries.includes(p.id) || progress.discoveries.includes(`catalog:${p.id}`);
      const isRouteStart = p.pointKind === 'route-start';
      const kindIcon = isRouteStart ? '🏁' : kindIcons[p.kind] || '📍';
      const pinClass = hasStamp ? 'tier-gold' : isRouteStart ? 'tier-silver' : 'tier-none';
      const pinContent = hasStamp ? '✓' : kindIcon;

      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: `mystery-pin ${pinClass}`,
          html: pinContent,
          iconSize: [32, 32],
        }),
        title: p.title,
      });

      const popupHtml = `
        <div style="min-width:180px">
          <strong>${e(p.title)}</strong><br>
          <small>${Math.round(p.distance)} m vzdušně · ${hasStamp ? '✓ GPS razítko získáno (+30 b.)' : isRouteStart ? 'Začátek trasy' : 'GPS razítko nezískáno'}</small>
          <div class="popup-actions">
            <a href="${e(p.url)}" class="button small">Detail místa</a>
            ${p.routeId ? `<button type="button" class="button small lime" data-walk-action="visit" data-route="${e(p.routeId)}">✓ Zapsat do pasu (poznámka)</button>` : ''}
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml).addTo(placesLayer);
    }
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

    $('walk-points').textContent = totalPts;
    $('walk-cells').textContent = progress.cells.length;
    $('walk-distance').textContent = number(progress.meters / 1000);
    $('walk-relics').textContent = progress.discoveries.length;

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
        } else if (navigator.share) {
          await navigator.share({
            title: 'Moje malá výprava · Czekpoint',
            text: `Moje malá výprava s Czekpointem. Ujeto ${summary.distanceMeters >= 1000 ? (summary.distanceMeters / 1000).toFixed(1) + ' km' : Math.round(summary.distanceMeters) + ' m'}.`,
          });
        } else {
          // Fallback to download
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

    // A valid fix updates lastFix and player position even when displacement is sub-threshold
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
      const allPlaces = [...catalogue, ...nearby];
      const stampedProgress = discoverNearby(progress, validFix, allPlaces, pendingPlaceStamps);

      // Check for places within qualified proximity in this expedition
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

      if (stampedProgress.discoveries.length > progress.discoveries.length) {
        const addedCount = stampedProgress.discoveries.length - progress.discoveries.length;
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

    // Advance progress when threshold reached
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
          // Initialize new expedition
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

    accuracyRing = L.circle([center.lat, center.lng], { radius: 0, color: '#68c8ff', weight: 1, fillOpacity: .12, pane: 'markerPane' }).addTo(map);
    player = L.circleMarker([center.lat, center.lng], { radius: 8, color: 'white', weight: 3, fillColor: '#218bea', opacity: 0, fillOpacity: 0, pane: 'markerPane' }).addTo(map);

    map.on('move zoom resize', scheduleFog);
    map.on('dragstart', () => { follow = false; });
    map.on('moveend', () => { if (!lastFix) renderPlaces(); });
  } else {
    $('walk-map').textContent = 'Mapová knihovna chybí.';
  }

  $('walk-start').addEventListener('click', start);
  $('walk-stop').addEventListener('click', () => pauseSession('Výprava pozastavena. Průzkum je uložený.'));
  $('walk-end').addEventListener('click', finishExpedition);
  $('walk-awake').addEventListener('change', () => { $('walk-awake').checked ? holdWake() : releaseWake(); });

  // Fog toggle: switches between explore (0.65) and full (1.0)
  $('walk-fog-toggle').addEventListener('click', () => {
    if (fogMode === 'none') {
      fogMode = previousFogMode || 'explore';
    } else if (fogMode === 'explore') {
      fogMode = 'full';
    } else {
      fogMode = 'explore';
    }
    previousFogMode = fogMode;
    const label = fogMode === 'full' ? 'Mlha: Plná (100 %)' : 'Mlha: Průzkumná (65 %)';
    $('walk-fog-toggle').textContent = label;
    $('walk-plain-map').setAttribute('aria-pressed', 'false');
    scheduleFog();
  });

  // Plain map toggle: shows map with 0% fog without affecting points or progress
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

  root.addEventListener('click', async event => {
    const btn = event.target.closest('[data-walk-action]');
    if (!btn) return;
    const actionType = btn.dataset.walkAction;
    const routeId = btn.dataset.route;
    const targetRoute = routes.find(r => r.id === routeId);
    if (!targetRoute) return;

    if (actionType === 'visit') {
      btn.disabled = true;
      if (onAddVisit) await onAddVisit(routeId);
      stats();
      status(`Návštěva ${targetRoute.title} byla zaznamenána do tvého pasu.`);
    }
  });

  $('walk-nearby').addEventListener('click', async () => {
    if (demo) { $('nearby-status').textContent = 'Ukázka používá připravený katalog.'; return; }
    if (!lastFix || Date.now() - lastFix.timestamp > 60000) { $('nearby-status').textContent = 'Nejdřív spusť GPS a získej polohu.'; return; }
    $('walk-nearby').disabled = true;
    $('nearby-status').textContent = 'Hledám místa v okolí…';
    try {
      const found = await fetchNearby(lastFix, config.overpassUrl, aborter.signal, routes);
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
        `• Uložené výpravy: ${preview.historyCount}\n\n` +
        `Pozor: Současný postup v tomto prohlížeči bude nahrazen touto zálohou.`
      );
      if (confirmed) {
        pauseSession();
        stateObj = importStateJson(text);
        progress = { version: 1, cells: stateObj.cells, meters: stateObj.meters, discoveries: stateObj.discoveries };
        currentExpedition = stateObj.activeExpedition;
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
