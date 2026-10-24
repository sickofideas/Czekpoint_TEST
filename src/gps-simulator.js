/**
 * Czekpoint — Testovací Fake GPS Simulátor chůze (v0.8)
 * Umožňuje testovat chůzi, odkrývání KCD2 mapy, azimut kompasu,
 * boční legendu i udělování GPS razítek přímo od stolu.
 */

import { haversineMeters } from './domain.js';

export const ROZMITAL_CENTER = Object.freeze({ lat: 49.6018, lng: 13.8635 });
export const EARTH_RADIUS_M = 6378137;

export const SPEED_PRESETS = Object.freeze([
  { id: 'slow', label: '🐢 Pomalá (0,8 m/s)', speed: 0.8 },
  { id: 'normal', label: '🥾 Běžná (1,4 m/s)', speed: 1.4 },
  { id: 'fast', label: '🏃 Rychlá (2,9 m/s)', speed: 2.9 },
  { id: 'car', label: '🚗 Auto (6,0 m/s — test >3,5)', speed: 6.0 },
]);

export const ACCURACY_PRESETS = Object.freeze([
  { id: 'ideal', label: '±6 m (Ideální)', accuracy: 6 },
  { id: 'forest', label: '±28 m (Les)', accuracy: 28 },
  { id: 'poor', label: '±55 m (>40 m test)', accuracy: 55 },
]);

export const DIRECTIONS = Object.freeze([
  { id: 'NW', label: '↖ SZ', deg: 315 },
  { id: 'N', label: '↑ S', deg: 0 },
  { id: 'NE', label: '↗ SV', deg: 45 },
  { id: 'W', label: '← Z', deg: 270 },
  { id: 'STOP', label: '⏹ STOP', deg: null },
  { id: 'E', label: '→ V', deg: 90 },
  { id: 'SW', label: '↙ JZ', deg: 225 },
  { id: 'S', label: '↓ J', deg: 180 },
  { id: 'SE', label: '↘ JV', deg: 135 },
]);

/**
 * Vypočítá azimut (bearing) z bodu A do bodu B ve stupních [0, 360).
 * @param {{lat: number, lng: number}} from
 * @param {{lat: number, lng: number}} to
 * @returns {number} azimut ve stupních
 */
export function calculateBearing(from, to) {
  if (!from || !to) return 0;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Posune souřadnice o danou vzdálenost v metrech a daný azimut ve stupních.
 * @param {{lat: number, lng: number}} origin
 * @param {number} distanceMeters
 * @param {number} bearingDeg
 * @returns {{lat: number, lng: number}}
 */
export function moveCoordinates(origin, distanceMeters, bearingDeg) {
  if (!origin || !distanceMeters) return { lat: origin?.lat || 0, lng: origin?.lng || 0 };
  const d = distanceMeters / EARTH_RADIUS_M;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  };
}

/**
 * Udělá krok směrem k cílovému bodu o max distanceMeters.
 * @param {{lat: number, lng: number}} current
 * @param {{lat: number, lng: number}} target
 * @param {number} distanceMeters
 * @returns {{lat: number, lng: number, arrived: boolean, distanceRemaining: number, heading: number}}
 */
export function stepTowards(current, target, distanceMeters) {
  const dist = haversineMeters(current, target) ?? 0;
  const heading = calculateBearing(current, target);
  if (dist <= distanceMeters || dist < 0.5) {
    return {
      lat: target.lat,
      lng: target.lng,
      arrived: true,
      distanceRemaining: 0,
      heading,
    };
  }
  const nextPos = moveCoordinates(current, distanceMeters, heading);
  const remaining = Math.max(0, dist - distanceMeters);
  return {
    lat: nextPos.lat,
    lng: nextPos.lng,
    arrived: false,
    distanceRemaining: remaining,
    heading,
  };
}

/**
 * Vytvoří čistý syntetický GPS fix splňující rozhraní aplikace Czekpoint.
 * @param {{lat: number, lng: number}} coords
 * @param {Object} options
 * @returns {{lat: number, lng: number, accuracy: number, speed: number, timestamp: number}}
 */
export function createSyntheticFix(coords, options = {}) {
  const {
    accuracy = 6,
    speed = 1.4,
    timestamp = Date.now(),
  } = options;

  return {
    lat: coords.lat,
    lng: coords.lng,
    accuracy: Math.max(1, Number(accuracy) || 6),
    speed: Number(speed) || 0,
    timestamp,
  };
}

/**
 * Simulátor chůze pro plovoucí UI a mapu.
 */
export class GpsSimulator {
  constructor(options = {}) {
    this.map = options.map || null;
    this.container = options.container || document.body;
    this.onFix = options.onFix || (() => {});
    this.onResetAnchor = options.onResetAnchor || (() => {});
    this.onStopRealGps = options.onStopRealGps || (() => {});
    this.getPlannedWaypoints = options.getPlannedWaypoints || (() => []);
    this.getCollectiblePlaces = options.getCollectiblePlaces || (() => []);
    this.onHeadingChange = options.onHeadingChange || (() => {});

    const startPos = options.initialPosition || ROZMITAL_CENTER;
    this.position = { lat: startPos.lat, lng: startPos.lng };
    this.heading = 0;
    this.speed = 1.4; // m/s (běžná chůze)
    this.accuracy = 6; // ±6 m (ideální)

    this.mode = 'idle'; // 'idle' | 'direction' | 'walkTo' | 'autopilot'
    this.clickMode = 'walk'; // 'walk' | 'teleport'
    this.currentDirectionDeg = null;

    this.targetPoint = null;
    this.targetPolyline = null;

    this.autopilotWaypoints = [];
    this.autopilotIndex = 0;
    this.waitingAtPlace = null;
    this.stampWaitElapsed = 0;
    this.stampedPlaces = new Set();

    this.timer = null;
    this.isOpen = false;
    this.isCollapsed = false;
    this.panelEl = null;

    this.boundOnMapClick = this.handleMapClick.bind(this);
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.onStopRealGps();
    this.render();
    this.startLoop();
    this.bindEvents();
    // Ihned pošleme první vzorek
    this.sendCurrentFix();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.stopLoop();
    this.unbindEvents();
    this.clearDottedLine();
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  startLoop() {
    this.stopLoop();
    this.timer = setInterval(() => {
      this.tick(Date.now(), 2);
    }, 2000);
  }

  stopLoop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  bindEvents() {
    if (this.map) {
      this.map.on('click', this.boundOnMapClick);
    }
    window.addEventListener('keydown', this.boundOnKeyDown);
  }

  unbindEvents() {
    if (this.map) {
      this.map.off('click', this.boundOnMapClick);
    }
    window.removeEventListener('keydown', this.boundOnKeyDown);
  }

  handleMapClick(ev) {
    if (!this.isOpen || !ev?.latlng) return;
    const clicked = { lat: ev.latlng.lat, lng: ev.latlng.lng };

    if (this.clickMode === 'teleport') {
      this.teleportTo(clicked);
    } else {
      this.walkTo(clicked);
    }
  }

  handleKeyDown(ev) {
    if (!this.isOpen) return;
    const key = ev.key.toLowerCase();
    const tag = ev.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (key === 'w' || key === 'arrowup') {
      ev.preventDefault();
      this.setDirection(0);
    } else if (key === 's' || key === 'arrowdown') {
      ev.preventDefault();
      this.setDirection(180);
    } else if (key === 'a' || key === 'arrowleft') {
      ev.preventDefault();
      this.setDirection(270);
    } else if (key === 'd' || key === 'arrowright') {
      ev.preventDefault();
      this.setDirection(90);
    } else if (key === ' ' || key === 'escape') {
      ev.preventDefault();
      this.stopMovement();
    }
  }

  teleportTo(coords) {
    this.mode = 'idle';
    this.currentDirectionDeg = null;
    this.targetPoint = null;
    this.clearDottedLine();

    this.position = { lat: coords.lat, lng: coords.lng };
    this.onResetAnchor();
    this.sendCurrentFix();
    this.updateStatusUi();
  }

  walkTo(coords) {
    this.mode = 'walkTo';
    this.currentDirectionDeg = null;
    this.targetPoint = { lat: coords.lat, lng: coords.lng };
    this.heading = calculateBearing(this.position, this.targetPoint);
    this.onHeadingChange(this.heading);

    this.drawDottedLine(this.position, this.targetPoint);
    this.updateStatusUi();
  }

  setDirection(deg) {
    if (deg === null) {
      this.stopMovement();
      return;
    }
    this.mode = 'direction';
    this.currentDirectionDeg = deg;
    this.heading = deg;
    this.targetPoint = null;
    this.clearDottedLine();
    this.onHeadingChange(this.heading);
    this.updateStatusUi();
  }

  stopMovement() {
    this.mode = 'idle';
    this.currentDirectionDeg = null;
    this.targetPoint = null;
    this.clearDottedLine();
    this.waitingAtPlace = null;
    this.stampWaitElapsed = 0;
    this.updateStatusUi();
  }

  stepOnce(distanceMeters = 15) {
    const bearing = this.currentDirectionDeg != null ? this.currentDirectionDeg : this.heading;
    const nextPos = moveCoordinates(this.position, distanceMeters, bearing);
    this.position = nextPos;
    this.heading = bearing;
    this.onHeadingChange(this.heading);
    this.sendCurrentFix();
    this.updateStatusUi();
  }

  startAutopilot(waypoints, collectiblePlaces) {
    const wp = Array.isArray(waypoints) && waypoints.length > 0
      ? waypoints
      : this.getPlannedWaypoints();

    if (!wp || wp.length === 0) {
      // Pokud není naplánovaná žádná trasa, vezmeme ověřená místa
      const places = (collectiblePlaces || this.getCollectiblePlaces()).slice(0, 5);
      if (places.length > 0) {
        this.autopilotWaypoints = places.map(p => ({ lat: p.lat, lng: p.lng, id: p.id, title: p.title }));
      } else {
        return;
      }
    } else {
      this.autopilotWaypoints = wp.map(p => ({ lat: p.lat, lng: p.lng, id: p.id, title: p.title || p.label || 'Zastávka' }));
    }

    this.mode = 'autopilot';
    this.autopilotIndex = 0;
    this.waitingAtPlace = null;
    this.stampWaitElapsed = 0;
    this.currentDirectionDeg = null;
    this.clearDottedLine();

    if (this.autopilotWaypoints.length > 0) {
      const target = this.autopilotWaypoints[0];
      this.heading = calculateBearing(this.position, target);
      this.onHeadingChange(this.heading);
      this.drawDottedLine(this.position, target);
    }

    this.updateStatusUi();
  }

  tick(now = Date.now(), dtSeconds = 2) {
    if (!this.isOpen) return;

    if (this.mode === 'direction' && this.currentDirectionDeg != null) {
      const dist = this.speed * dtSeconds;
      this.position = moveCoordinates(this.position, dist, this.currentDirectionDeg);
      this.heading = this.currentDirectionDeg;
      this.onHeadingChange(this.heading);
      this.sendCurrentFix(now);
    } else if (this.mode === 'walkTo' && this.targetPoint) {
      const dist = this.speed * dtSeconds;
      const step = stepTowards(this.position, this.targetPoint, dist);
      this.position = { lat: step.lat, lng: step.lng };
      this.heading = step.heading;
      this.onHeadingChange(this.heading);
      this.drawDottedLine(this.position, this.targetPoint);
      this.sendCurrentFix(now);

      if (step.arrived) {
        this.mode = 'idle';
        this.targetPoint = null;
        this.clearDottedLine();
      }
    } else if (this.mode === 'autopilot') {
      const currentTarget = this.autopilotWaypoints[this.autopilotIndex];

      if (!currentTarget) {
        this.stopMovement();
        return;
      }

      // Režim čekání na razítko u místa (<25 m)
      if (this.waitingAtPlace) {
        this.stampWaitElapsed += dtSeconds;
        this.sendCurrentFix(now);
        this.updateStatusUi();

        if (this.stampWaitElapsed >= 12) {
          // Po 12 s (dvou platných vzorcích s odstupem > 10 s) pokračujeme k dalšímu bodu
          this.waitingAtPlace = null;
          this.stampWaitElapsed = 0;
          this.autopilotIndex++;

          if (this.autopilotIndex >= this.autopilotWaypoints.length) {
            this.stopMovement();
            return;
          }

          const nextTarget = this.autopilotWaypoints[this.autopilotIndex];
          this.heading = calculateBearing(this.position, nextTarget);
          this.onHeadingChange(this.heading);
          this.drawDottedLine(this.position, nextTarget);
        }
        return;
      }

      // Kontrola, zda jsme dorazili do sběratelského místa (< 25 m)
      const distToTarget = haversineMeters(this.position, currentTarget);
      if (distToTarget != null && distToTarget < 25 && !this.stampedPlaces.has(currentTarget.id || `${currentTarget.lat},${currentTarget.lng}`)) {
        this.waitingAtPlace = currentTarget;
        this.stampWaitElapsed = 0;
        this.stampedPlaces.add(currentTarget.id || `${currentTarget.lat},${currentTarget.lng}`);
        this.position = { lat: currentTarget.lat, lng: currentTarget.lng };
        this.sendCurrentFix(now);
        this.updateStatusUi();
        return;
      }

      // Běžná chůze směrem k bodu trasy
      const dist = this.speed * dtSeconds;
      const step = stepTowards(this.position, currentTarget, dist);
      this.position = { lat: step.lat, lng: step.lng };
      this.heading = step.heading;
      this.onHeadingChange(this.heading);
      this.drawDottedLine(this.position, currentTarget);
      this.sendCurrentFix(now);

      if (step.arrived) {
        this.autopilotIndex++;
        if (this.autopilotIndex >= this.autopilotWaypoints.length) {
          this.stopMovement();
          return;
        }
        const nextTarget = this.autopilotWaypoints[this.autopilotIndex];
        this.heading = calculateBearing(this.position, nextTarget);
        this.onHeadingChange(this.heading);
        this.drawDottedLine(this.position, nextTarget);
      }
    } else {
      // V klidovém režimu posíláme pravidelný heartbeat fix
      this.sendCurrentFix(now);
    }

    this.updateStatusUi();
  }

  sendCurrentFix(timestamp = Date.now()) {
    const fix = createSyntheticFix(this.position, {
      accuracy: this.accuracy,
      speed: this.mode === 'idle' ? 0 : this.speed,
      timestamp,
    });
    this.onFix(fix, this.heading);
  }

  drawDottedLine(from, to) {
    if (!this.map || typeof window.L === 'undefined') return;
    const L = window.L;
    this.clearDottedLine();
    this.targetPolyline = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
      color: '#f27a24',
      weight: 3.5,
      dashArray: '6, 8',
      opacity: 0.85,
      lineCap: 'round',
    }).addTo(this.map);
  }

  clearDottedLine() {
    if (this.targetPolyline) {
      this.targetPolyline.remove();
      this.targetPolyline = null;
    }
  }

  render() {
    if (this.panelEl) this.panelEl.remove();

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'fake-gps-panel';
    this.panelEl.id = 'fake-gps-panel';
    this.panelEl.innerHTML = `
      <div class="fake-gps-header">
        <div class="fake-gps-title">
          <span class="fake-gps-badge">🧪 Fake GPS</span>
          <strong>Simulátor chůze</strong>
        </div>
        <div class="fake-gps-actions">
          <button type="button" class="fake-gps-btn small" id="sim-btn-collapse" title="Sbalit / rozbalit ovladač">
            ${this.isCollapsed ? '⬇ Rozbalit' : '⬆ Sbalit'}
          </button>
          <button type="button" class="fake-gps-btn small danger" id="sim-btn-close" title="Zavřít simulátor">✕</button>
        </div>
      </div>

      <div class="fake-gps-body" id="fake-gps-body" ${this.isCollapsed ? 'hidden' : ''}>
        <!-- 1. Směrový kříž a tlačítko 1 krok -->
        <div class="fake-gps-section">
          <div class="fake-gps-section-label">1. Pohyb (WASD / Šipky)</div>
          <div class="dpad-grid">
            ${DIRECTIONS.map(d => `
              <button type="button" class="dpad-btn ${d.id === 'STOP' ? 'dpad-stop' : ''}" data-dir="${d.id}" data-deg="${d.deg ?? ''}">
                ${d.label}
              </button>
            `).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button type="button" class="fake-gps-btn full lime" id="sim-btn-step">👣 1 krok (+15 m)</button>
          </div>
        </div>

        <!-- 2. Režim kliknutí do mapy a Autopilot -->
        <div class="fake-gps-section">
          <div class="fake-gps-section-label">2. Klik do mapy & Autopilot</div>
          <div class="fake-gps-row">
            <button type="button" class="fake-gps-btn ${this.clickMode === 'walk' ? 'active' : ''}" id="sim-btn-click-walk">🎯 Jít sem chůzí</button>
            <button type="button" class="fake-gps-btn ${this.clickMode === 'teleport' ? 'active' : ''}" id="sim-btn-click-teleport">⚡ Teleport</button>
          </div>
          <button type="button" class="fake-gps-btn full gold" id="sim-btn-autopilot" style="margin-top:6px">
            🤖 Autopilot po trase
          </button>
        </div>

        <!-- 3. Rychlost a přesnost -->
        <div class="fake-gps-section">
          <div class="fake-gps-section-label">3. Rychlost chůze</div>
          <div class="speed-presets-row">
            ${SPEED_PRESETS.map(sp => `
              <button type="button" class="fake-gps-btn mini ${this.speed === sp.speed ? 'active' : ''}" data-speed="${sp.speed}">
                ${sp.label}
              </button>
            `).join('')}
          </div>
          <div class="slider-row">
            <input type="range" id="sim-speed-slider" min="0.5" max="8.0" step="0.1" value="${this.speed}">
            <span id="sim-speed-val">${this.speed.toFixed(1)} m/s (${(this.speed * 3.6).toFixed(1)} km/h)</span>
          </div>

          <div class="fake-gps-section-label" style="margin-top:8px">Přesnost GPS (Accuracy)</div>
          <div class="accuracy-presets-row">
            ${ACCURACY_PRESETS.map(ap => `
              <button type="button" class="fake-gps-btn mini ${this.accuracy === ap.accuracy ? 'active' : ''}" data-accuracy="${ap.accuracy}">
                ${ap.label}
              </button>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- 4. Stavový řádek -->
      <div class="fake-gps-status-bar" id="fake-gps-status-bar">
        <div class="status-col">
          <div><strong>Souřadnice:</strong> <span id="sim-stat-coords">${this.position.lat.toFixed(4)}, ${this.position.lng.toFixed(4)}</span></div>
          <div><strong>Azimut:</strong> <span id="sim-stat-heading">${Math.round(this.heading)}°</span> · <strong>Rychlost:</strong> <span id="sim-stat-speed">${this.speed.toFixed(1)} m/s</span></div>
        </div>
        <div class="status-stamp" id="sim-stat-stamp">Čekání na razítko: --</div>
      </div>
    `;

    // Vložíme do kontejneru mapy
    const mapWrap = document.querySelector('.walk-map-wrap') || this.container;
    mapWrap.appendChild(this.panelEl);

    this.wirePanelEvents();
  }

  wirePanelEvents() {
    if (!this.panelEl) return;

    this.panelEl.querySelector('#sim-btn-close')?.addEventListener('click', () => this.close());
    this.panelEl.querySelector('#sim-btn-collapse')?.addEventListener('click', () => {
      this.isCollapsed = !this.isCollapsed;
      const body = this.panelEl.querySelector('#fake-gps-body');
      const btn = this.panelEl.querySelector('#sim-btn-collapse');
      if (body) body.hidden = this.isCollapsed;
      if (btn) btn.textContent = this.isCollapsed ? '⬇ Rozbalit' : '⬆ Sbalit';
    });

    // D-Pad
    this.panelEl.querySelectorAll('.dpad-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const degStr = btn.dataset.deg;
        if (!degStr) {
          this.stopMovement();
        } else {
          this.setDirection(Number(degStr));
        }
      });
    });

    // 1 krok
    this.panelEl.querySelector('#sim-btn-step')?.addEventListener('click', () => {
      this.stepOnce(15);
    });

    // Click modes
    const btnWalk = this.panelEl.querySelector('#sim-btn-click-walk');
    const btnTeleport = this.panelEl.querySelector('#sim-btn-click-teleport');
    btnWalk?.addEventListener('click', () => {
      this.clickMode = 'walk';
      btnWalk.classList.add('active');
      btnTeleport?.classList.remove('active');
    });
    btnTeleport?.addEventListener('click', () => {
      this.clickMode = 'teleport';
      btnTeleport.classList.add('active');
      btnWalk?.classList.remove('active');
    });

    // Autopilot
    this.panelEl.querySelector('#sim-btn-autopilot')?.addEventListener('click', () => {
      this.startAutopilot();
    });

    // Speed presets & slider
    this.panelEl.querySelectorAll('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.speed);
        this.speed = val;
        const slider = this.panelEl.querySelector('#sim-speed-slider');
        if (slider) slider.value = val;
        this.panelEl.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', b === btn));
        this.updateSpeedDisplay();
      });
    });

    const speedSlider = this.panelEl.querySelector('#sim-speed-slider');
    speedSlider?.addEventListener('input', (ev) => {
      this.speed = Number(ev.target.value);
      this.panelEl.querySelectorAll('[data-speed]').forEach(b => {
        b.classList.toggle('active', Math.abs(Number(b.dataset.speed) - this.speed) < 0.05);
      });
      this.updateSpeedDisplay();
    });

    // Accuracy presets
    this.panelEl.querySelectorAll('[data-accuracy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.accuracy);
        this.accuracy = val;
        this.panelEl.querySelectorAll('[data-accuracy]').forEach(b => b.classList.toggle('active', b === btn));
      });
    });
  }

  updateSpeedDisplay() {
    const valEl = this.panelEl?.querySelector('#sim-speed-val');
    if (valEl) {
      valEl.textContent = `${this.speed.toFixed(1)} m/s (${(this.speed * 3.6).toFixed(1)} km/h)`;
    }
  }

  updateStatusUi() {
    if (!this.panelEl) return;
    const coordsEl = this.panelEl.querySelector('#sim-stat-coords');
    const headingEl = this.panelEl.querySelector('#sim-stat-heading');
    const speedEl = this.panelEl.querySelector('#sim-stat-speed');
    const stampEl = this.panelEl.querySelector('#sim-stat-stamp');

    if (coordsEl) coordsEl.textContent = `${this.position.lat.toFixed(4)}, ${this.position.lng.toFixed(4)}`;
    if (headingEl) headingEl.textContent = `${Math.round(this.heading)}°`;
    if (speedEl) speedEl.textContent = `${this.speed.toFixed(1)} m/s`;

    if (stampEl) {
      if (this.waitingAtPlace) {
        stampEl.textContent = `🎯 Čekání na razítko: ${this.stampWaitElapsed} / 10 s (zbývá ${Math.max(0, 12 - this.stampWaitElapsed)} s)`;
        stampEl.classList.add('waiting');
      } else if (this.mode === 'autopilot') {
        stampEl.textContent = `🤖 Autopilot: cíl ${this.autopilotIndex + 1}/${this.autopilotWaypoints.length}`;
        stampEl.classList.remove('waiting');
      } else {
        stampEl.textContent = `Čekání na razítko: --`;
        stampEl.classList.remove('waiting');
      }
    }
  }

  destroy() {
    this.close();
  }
}

/**
 * Inicializuje simulátor pro modul walk.
 * @param {Object} options
 * @returns {GpsSimulator}
 */
export function initGpsSimulator(options = {}) {
  return new GpsSimulator(options);
}