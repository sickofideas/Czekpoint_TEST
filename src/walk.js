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
import { loadState, saveState, STATE_KEY } from './walk-store.js';
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
  let sessionMeters = 0, sessionCells = 0, sessionStamps = 0, follow = true, reveal = true, nearby = [];
  let memoryTrail = [];
  let pendingPlaceStamps = {};
  const aborter = new AbortController();

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
        <p>Neprozkoumaná mlha, GPS razítka ověřených míst a mizející stopa na Rožmitálsku.</p>
      </div>
      <span class="walk-tag">PILOT · v0.4</span>
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

    <div class="daily-challenge-card" id="daily-card">
      <div>
        <div class="eyebrow" style="margin-bottom:4px">Dnešní výprava</div>
        <div class="daily-title" id="daily-title">Načítám výzvu…</div>
      </div>
      <div id="daily-action"></div>
    </div>

    <div id="walk-demo-banner" class="notice" hidden>UKÁZKA · Simulovaný pohyb v Rožmitále. Žádná GPS, žádné ukládání bodů.</div>

    <div class="walk-compass-bar" id="walk-compass" role="status">🧭 Čekám na polohu pro určení směru k nejbližšímu místu…</div>

    <div class="walk-map-wrap">
      <div id="walk-map" aria-label="Interaktivní mapa průzkumu"></div>
      <div class="walk-map-toolbar">
        <button class="button small" id="walk-center">◎ Moje poloha</button>
        <button class="button small" id="walk-fog" aria-pressed="true">Mlha: zapnutá</button>
      </div>
    </div>
    <div class="trail-note" id="trail-info">Stopa za poslední hodinu: 0 bodů (automaticky mizí po 60 min, pouze v paměti)</div>
    <p id="tile-status" class="small-note" role="status"></p>

    <div class="walk-controls">
      <button id="walk-start" class="button primary">▶ Vyrazit s GPS</button>
      <button id="walk-stop" class="button" disabled>Ⅱ Pozastavit</button>
      <button id="walk-demo" class="button">Ukázka bez GPS</button>
      <button id="walk-step" class="button lime" hidden>Další krok ukázky</button>
    </div>

    <div class="walk-status-panel">
      <strong id="walk-status" role="status" aria-live="polite">${e(storageError || 'Připraveno. Venku spusť GPS a povol přístup k poloze.')}</strong>
      <span id="walk-session">Dnes v této relaci: 0 m · 0 nových dílků</span>
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
      <summary>Pravidla průzkumu, mlhy a GPS razítek v0.4</summary>
      <p>Neprůhledná mlha zakrývá terén, dokud jím osobně neprojdeš. Hodnost je čistě kosmetický milník a dosah mlhy je pevný standardní rozměr buňky (65 m).</p>
      <p>Pravidlo jednoho GPS razítka (+30 b. jednou za život): vyžaduje 2 validní GPS polohy v okruhu 60 m od ověřeného místa, s odstupem 10–60 sekund. Začátky tras (okruhy) ani neověřené body razítko neudělují.</p>
      <p>Mizející stopa: pracovní trasa se drží pouze v paměti této otevřené relace (max 600 bodů za 60 minut). Při pauze se stopa přeruší a po ukončení či reloadu se vymaže.</p>
      <button id="walk-export" class="button small">Exportovat průzkum do JSON</button>
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

    if (!reveal) return;

    // 100% Opaque Fog layer
    ctx.fillStyle = '#163329';
    ctx.fillRect(0, 0, size.x, size.y);

    // Subtle texture grid
    ctx.strokeStyle = 'rgba(216, 233, 158, 0.035)';
    ctx.lineWidth = 1;
    for (let x = 0; x < size.x; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.y); ctx.stroke();
    }
    for (let y = 0; y < size.y; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.x, y); ctx.stroke();
    }

    ctx.globalCompositeOperation = 'destination-out';
    const standardRadius = 65; // Fixed fog radius in v0.4

    // Visited cells cutout with soft radial gradient
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
    $('trail-info').textContent = `Stopa za poslední hodinu: ${activeTrail.length} bodů (automaticky mizí po 60 min, pouze v paměti)`;
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
      const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
      const arrow = arrows[Math.round(((angle + 360) % 360) / 45) % 8];
      const kindLabel = { culture: 'Kultura', view: 'Vyhlídka', forest: 'Les', water: 'Voda' }[nearestStamp.kind] || 'Místo';
      $('walk-compass').innerHTML = `🧭 <strong>Nejbližší razítko:</strong> ${Math.round(nearestDist)} m ${arrow} · ${e(nearestStamp.title)} (${kindLabel})`;
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

  function stats() {
    const totalPts = totalScore(stateObj);
    const rank = explorerRank(totalPts);

    $('walk-points').textContent = totalPts;
    $('walk-cells').textContent = progress.cells.length;
    $('walk-distance').textContent = number(progress.meters / 1000);
    $('walk-relics').textContent = progress.discoveries.length;

    $('walk-session').textContent = `${demo ? 'Ukázka' : 'Tato relace'}: ${Math.round(sessionMeters)} m · ${sessionCells} nových dílků · ${sessionStamps} razítek`;

    $('rank-title').textContent = `Hodnost: Úroveň ${rank.level} · ${rank.title}`;
    $('rank-fog').textContent = `Dosah odkrývání v mlze: ${rank.fogRadiusM} m · Dosah odhalení: ${rank.revealDistanceM} m${rank.nextAt ? ` · Do další úrovně zbývá ${rank.nextAt - totalPts} b.` : ' · Nejvyšší úroveň dosažena!'}`;
    $('rank-badge').textContent = `Lvl ${rank.level}`;

    const today = new Date().toISOString().slice(0, 10);
    const challenge = dailyChallenge(today, progress, { cells: sessionCells, meters: sessionMeters, stamps: sessionStamps }, stateObj.legacyRewards);
    $('daily-title').textContent = `${challenge.title} — postup: ${challenge.progress}/${challenge.target}`;
    $('daily-action').innerHTML = challenge.completed
      ? '<span class="status-dot"></span> <small style="color:#4a6828;font-weight:700">Splněno</small>'
      : '<small class="small-note">Milník dne</small>';

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

    $('walk-start').disabled = active || starting || demo || Boolean(storageError);
    $('walk-stop').disabled = !active && !starting;
    $('walk-step').hidden = !demo;
    $('walk-demo-banner').hidden = !demo;
    $('walk-demo').textContent = demo ? 'Ukončit ukázku' : 'Ukázka bez GPS';

    scheduleFog();
    renderTrail();
    renderPlaces();
  }

  function showSessionSummary() {
    if (sessionMeters <= 0 && sessionCells <= 0 && sessionStamps <= 0) return;
    const earnedSessionPoints = sessionCells * 10 + Math.floor(sessionMeters / 50) + sessionStamps * 30;
    const container = $('session-summary-container');
    container.innerHTML = `
      <div class="session-modal" id="session-summary-modal">
        <div class="session-modal-card">
          <h2>Výprava pozastavena</h2>
          <p>Shrnutí tvého postupu v této vycházce:</p>
          <div class="session-stats-grid">
            <div class="session-stat-box"><strong>${Math.round(sessionMeters)} m</strong><span>Ušlá vzdálenost</span></div>
            <div class="session-stat-box"><strong>+${sessionCells}</strong><span>Nové dílky v mlze</span></div>
            <div class="session-stat-box"><strong>+${sessionStamps}</strong><span>Nová GPS razítka</span></div>
            <div class="session-stat-box"><strong>+${earnedSessionPoints}</strong><span>Získané body</span></div>
          </div>
          <button type="button" class="button primary full" id="close-summary-btn">Zavřít a pokračovat</button>
        </div>
      </div>
    `;
    $('close-summary-btn')?.addEventListener('click', () => { container.innerHTML = ''; });
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

  function stop(message) {
    const wasActive = active;
    active = false; starting = false;
    if (watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; }
    anchor = null;
    pendingPlaceStamps = {};
    if (lastFix) {
      memoryTrail = appendTrail(memoryTrail, { lat: lastFix.lat, lng: lastFix.lng, segmentBreak: true }, Date.now());
    }
    releaseWake();
    releaseLock?.(); releaseLock = null;
    if (!disposed) {
      stats();
      if (message) status(message);
      if (wasActive && (sessionMeters > 0 || sessionCells > 0 || sessionStamps > 0)) showSessionSummary();
    }
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
      const stampedProgress = discoverNearby(progress, validFix, [...catalogue, ...nearby], pendingPlaceStamps);
      if (stampedProgress.discoveries.length > progress.discoveries.length) {
        const addedCount = stampedProgress.discoveries.length - progress.discoveries.length;
        sessionStamps += addedCount;
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
    sessionMeters += result.metersAdded || (result.progress.meters - progress.meters);
    if (result.fresh) sessionCells++;
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
        stop(error.message);
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
        starting = false; active = true; anchor = null; follow = true; stats();
        status('Čekám na GPS. Povol polohu a vyjdi na otevřené místo.');
        const held = new Promise(resolve => { releaseLock = resolve; });
        watch = navigator.geolocation.watchPosition(
          p => sample({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, timestamp: p.timestamp }),
          error => {
            if (error.code === 1) stop('Poloha není povolená. Povol ji v nastavení.');
            else { anchor = null; status('GPS zatím není dostupná.'); }
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
        holdWake();
        await held;
      });
    } catch (error) { stop(error.message || 'GPS nelze spustit.'); }
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
  $('walk-stop').addEventListener('click', () => stop('Pozastaveno. Průzkum je uložený.'));
  $('walk-awake').addEventListener('change', () => { $('walk-awake').checked ? holdWake() : releaseWake(); });
  $('walk-fog').addEventListener('click', () => {
    reveal = !reveal;
    $('walk-fog').textContent = `Mlha: ${reveal ? 'zapnutá' : 'vypnutá'}`;
    $('walk-fog').setAttribute('aria-pressed', String(reveal));
    scheduleFog();
  });
  $('walk-center').addEventListener('click', () => {
    follow = true;
    if (lastFix && map) map.setView([lastFix.lat, lastFix.lng], 16);
    else status('Nejdřív spusť GPS nebo ukázku.');
  });
  $('walk-demo').addEventListener('click', () => {
    stop();
    demo = !demo;
    lastFix = null; nearby = []; anchor = null; sessionCells = 0; sessionMeters = 0; sessionStamps = 0;
    memoryTrail = [];
    pendingPlaceStamps = {};
    if (demo) {
      progress = emptyWalk();
      stateObj = emptyState();
      demoIndex = 0;
      stats();
      stepDemo();
    } else {
      try {
        stateObj = loadState();
        progress = { version: 1, cells: stateObj.cells, meters: stateObj.meters, discoveries: stateObj.discoveries };
      } catch (error) {
        storageError = error.message;
        progress = emptyWalk();
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
      const exportData = {
        state: loadState(),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'czekpoint-pruzkum-v0.4.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { status(error.message); }
  });

  const visibility = () => { if (document.hidden && (active || starting)) stop('Záznam byl pozastaven při skrytí aplikace.'); };
  document.addEventListener('visibilitychange', visibility);
  const pagehide = () => stop();
  window.addEventListener('pagehide', pagehide);

  const storageChanged = event => {
    if (event.key === STATE_KEY && !demo) {
      stop();
      try {
        stateObj = loadState();
        progress = { version: 1, cells: stateObj.cells, meters: stateObj.meters, discoveries: stateObj.discoveries };
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
    stop();
    aborter.abort();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pagehide);
    window.removeEventListener('storage', storageChanged);
    if (frame) cancelAnimationFrame(frame);
    map?.remove();
  };
}
