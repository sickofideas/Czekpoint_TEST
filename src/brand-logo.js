/**
 * Czekpoint — Animované logo č. 100 (styl Seznam.cz) a živé pozadí
 * Vektorová samolepka v čistém SVG + CSS + JS se 7 klidnými animacemi.
 */

export const LOGO_ANIM_STATES = Object.freeze([
  { id: 'wind', cls: 'state-wind', label: '1. Lesní vánek ve smrcích' },
  { id: 'hiker', cls: 'state-hiker', label: '2. Pozdrav turisty s holí' },
  { id: 'target', cls: 'state-target', label: '3. Impulz v terči' },
  { id: 'signpost', cls: 'state-signpost', label: '4. Pohyb dřevěného rozcestníku' },
  { id: 'pin', cls: 'state-pin', label: '5. Ťuknutí oranžového špendlíku' },
  { id: 'fireflies', cls: 'state-fireflies', label: '6. Lesní světlušky' },
  { id: 'breathe', cls: 'state-breathe', label: '7. Klidný nádech odznaku' },
]);

export const DEFAULT_CYCLE_MS = 6500;
export const DEFAULT_DURATION_MS = 3600;

/**
 * Vygeneruje čisté SVG vítězného loga č. 100.
 * @param {Object} options
 * @returns {string} SVG markup
 */
export function renderBrandLogoSvg(options = {}) {
  const {
    id = 'czekpoint-logo',
    className = 'czekpoint-logo-svg',
    clipId = 'brand-banner-clip',
    ariaLabel = 'Czekpoint — osobní atlas procházek',
    role = 'img',
    width = 400,
    height = 390,
  } = options;

  return `<svg id="${id}" class="${className}" viewBox="0 0 400 390" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="${role}" aria-label="${ariaLabel}">
  <defs>
    <clipPath id="${clipId}">
      <rect x="44" y="294" width="312" height="58" rx="14"/>
    </clipPath>
  </defs>

  <!-- Bílý samolepkový lem (Die-cut sticker outline) -->
  <path d="M 198 18
           C 225 18, 244 42, 256 76
           C 272 64, 296 64, 310 82
           L 354 82 C 370 82, 380 94, 380 110
           L 380 184 C 380 198, 370 208, 356 210
           L 368 258 C 374 274, 370 292, 368 308
           L 368 340 C 368 360, 352 372, 332 372
           L 68 372 C 48 372, 32 360, 32 340
           L 32 308 C 30 292, 36 274, 46 260
           C 26 238, 22 204, 36 174
           C 44 156, 56 142, 68 134
           C 62 110, 74 84, 96 78
           C 110 52, 136 48, 154 66
           C 168 34, 182 18, 198 18 Z"
        fill="#ffffff" stroke="#e2e7dc" stroke-width="2" />

  <!-- Pozadí lesní scény -->
  <path d="M 60 286 C 58 190, 110 110, 200 110 C 290 110, 342 190, 340 286 Z" fill="#e9f0e1"/>

  <!-- Levá skupina smrků -->
  <g class="anim-trees-left">
    <!-- Smrk 1 (vlevo) -->
    <polygon points="88,92 58,150 72,150 50,198 68,198 46,252 130,252 108,198 126,198 104,150 118,150" fill="#2e6f3e"/>
    <!-- Smrk 2 -->
    <polygon points="138,68 104,132 120,132 96,188 114,188 92,248 184,248 162,188 180,188 156,132 172,132" fill="#235c32"/>
  </g>

  <!-- Středový hlavní smrk -->
  <g class="anim-tree-center">
    <polygon points="198,34 156,112 176,112 146,178 168,178 142,248 254,248 228,178 250,178 220,112 240,112" fill="#1b4d2b"/>
  </g>

  <!-- Pravá skupina smrků -->
  <g class="anim-trees-right">
    <polygon points="256,82 224,144 238,144 216,196 232,196 212,252 298,252 278,196 294,196 272,144 286,144" fill="#2e6f3e"/>
    <polygon points="334,192 312,242 322,242 306,282 362,282 346,242 356,242" fill="#235c32"/>
  </g>

  <!-- Lesní světlušky (animace 6) -->
  <circle class="anim-firefly-1" cx="152" cy="86" r="5" fill="#f7d147" opacity="0"/>
  <circle class="anim-firefly-2" cx="242" cy="74" r="4.5" fill="#d8e99e" opacity="0"/>

  <!-- Zelené návrší / kopec dole -->
  <path d="M 48 296 Q 150 238 352 296 Z" fill="#3a7d44"/>
  <path d="M 64 296 Q 210 254 352 296 Z" fill="#245530"/>

  <!-- Skála uprostřed -->
  <polygon points="154,292 176,226 248,246 272,292" fill="#5e6b64"/>
  <polygon points="176,226 212,236 196,292 154,292" fill="#77857d"/>

  <!-- Dřevěný rozcestník vpravo (3 směrovky) -->
  <g class="signpost-group">
    <!-- Sloupek -->
    <rect x="308" y="96" width="14" height="196" rx="4" fill="#6e4726" stroke="#193e32" stroke-width="3.5"/>
    <circle cx="315" cy="94" r="6" fill="#8c5c32" stroke="#193e32" stroke-width="3"/>

    <!-- Horní šipka (doprava) — červená -->
    <g class="anim-sign-1">
      <polygon points="282,108 352,108 366,121 352,134 282,134" fill="#d7995b" stroke="#193e32" stroke-width="3.5" stroke-linejoin="round"/>
      <rect x="292" y="116" width="18" height="10" fill="#ffffff"/>
      <rect x="292" y="119" width="18" height="4" fill="#d63629"/>
    </g>

    <!-- Střední šipka (doleva) — žlutá -->
    <g class="anim-sign-2">
      <polygon points="344,140 274,140 260,153 274,166 344,166" fill="#c58344" stroke="#193e32" stroke-width="3.5" stroke-linejoin="round"/>
      <rect x="316" y="148" width="18" height="10" fill="#ffffff"/>
      <rect x="316" y="151" width="18" height="4" fill="#f0b429"/>
    </g>

    <!-- Dolní šipka (doprava) — modrá -->
    <g class="anim-sign-3">
      <polygon points="282,172 350,172 364,185 350,198 282,198" fill="#b47134" stroke="#193e32" stroke-width="3.5" stroke-linejoin="round"/>
      <rect x="292" y="180" width="18" height="10" fill="#ffffff"/>
      <rect x="292" y="183" width="18" height="4" fill="#2a7de1"/>
    </g>
  </g>

  <!-- Postava turisty na skále -->
  <g class="anim-hiker-body">
    <!-- Batoh -->
    <rect x="190" y="158" width="24" height="38" rx="8" transform="rotate(-8 190 158)" fill="#132a21"/>
    <!-- Tělo a nohy -->
    <path d="M 212 154 L 204 198 L 194 238 M 208 196 L 228 242" stroke="#132a21" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <!-- Hlava s kšiltovkou -->
    <circle cx="218" cy="138" r="11" fill="#132a21"/>
    <path d="M 218 132 L 234 136" stroke="#132a21" stroke-width="4.5" stroke-linecap="round"/>

    <!-- Ruka s turistickou holí (animovaná) -->
    <g class="anim-hiker-arm">
      <path d="M 214 162 L 238 176 L 252 168" stroke="#132a21" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <line x1="250" y1="154" x2="246" y2="248" stroke="#132a21" stroke-width="4.5" stroke-linecap="round"/>
    </g>
  </g>

  <!-- Červeno-bílý terč vlevo (Checkpoint) -->
  <g class="target-group">
    <circle cx="106" cy="212" r="54" fill="#193e32"/>
    <circle cx="106" cy="212" r="47" fill="#d63629"/>
    <circle cx="106" cy="212" r="34" fill="#ffffff"/>
    <circle cx="106" cy="212" r="21" fill="#d63629"/>
    <circle cx="106" cy="212" r="9" fill="#ffffff"/>
    <!-- Pulzní vlna terče (animace 3) -->
    <circle class="anim-target-ring" cx="106" cy="212" r="47" fill="none" stroke="#d63629" stroke-width="5" opacity="0"/>
  </g>

  <!-- Oranžový špendlík zapíchnutý do terče -->
  <g class="anim-pin">
    <line x1="106" y1="212" x2="138" y2="146" stroke="#193e32" stroke-width="6" stroke-linecap="round"/>
    <circle cx="144" cy="132" r="20" fill="#f27a24" stroke="#193e32" stroke-width="4.5"/>
    <circle cx="138" cy="126" r="6" fill="#ffd29d"/>
  </g>

  <!-- Spodní tmavozelená tabulka s nápisem CZEKPOINT -->
  <g>
    <rect x="44" y="294" width="312" height="58" rx="14" fill="#193e32" stroke="#112b22" stroke-width="3"/>
    <text x="200" y="334" text-anchor="middle" fill="#ffffff" font-family="'Segoe UI', system-ui, sans-serif" font-weight="800" font-size="37" letter-spacing="1.5">CZEKPOINT</text>
    <g clip-path="url(#${clipId})">
      <rect class="anim-shine" x="20" y="280" width="46" height="90" transform="skewX(-22)" fill="#ffffff" opacity="0"/>
    </g>
  </g>
</svg>`;
}

/**
 * Vygeneruje obalující HTML komponentu loga pro vložení do stránky.
 * @param {Object} options
 * @returns {string} HTML markup
 */
export function renderBrandLogoHtml(options = {}) {
  const {
    id = 'hero-brand-logo',
    svgId = 'czekpoint-logo',
    className = 'logo-stage',
    title = 'Klikni pro jemnou animaci (styl Seznam.cz)',
    ariaLabel = 'Czekpoint — osobní atlas procházek',
  } = options;

  return `<div class="${className}" id="${id}" role="button" tabindex="0" title="${title}" aria-label="${ariaLabel}">
  ${renderBrandLogoSvg({ id: svgId, clipId: `${id}-banner-clip` })}
</div>`;
}

/**
 * Spustí konkrétní animaci na daném SVG elementu.
 * @param {SVGElement|HTMLElement} target
 * @param {string|Object} stateInput
 * @param {Object} options
 * @returns {number|boolean} timeoutId nebo false
 */
export function triggerBrandLogoAnimation(target, stateInput, options = {}) {
  if (!target) return false;
  const svg = target.tagName && target.tagName.toLowerCase() === 'svg'
    ? target
    : target.querySelector?.('.czekpoint-logo-svg') || target.querySelector?.('svg');
  if (!svg) return false;

  const durationMs = options.durationMs || DEFAULT_DURATION_MS;
  const stateObj = typeof stateInput === 'string'
    ? LOGO_ANIM_STATES.find(s => s.id === stateInput || s.cls === stateInput) || { cls: stateInput, label: stateInput }
    : stateInput;

  if (!stateObj?.cls) return false;

  LOGO_ANIM_STATES.forEach(s => svg.classList.remove(s.cls));
  void (svg.getBoundingClientRect?.() || svg.offsetWidth); // Vynucení reflow pro restart animace
  svg.classList.add(stateObj.cls);

  if (typeof options.onStart === 'function') {
    options.onStart(stateObj);
  }

  const timeoutId = setTimeout(() => {
    svg.classList.remove(stateObj.cls);
    if (typeof options.onEnd === 'function') {
      options.onEnd(stateObj);
    }
  }, durationMs);

  return timeoutId;
}

function createNoopController() {
  const noop = () => {};
  noop.dispose = noop;
  noop.trigger = () => false;
  noop.next = () => false;
  noop.isBusy = () => false;
  noop.getIndex = () => 0;
  return noop;
}

/**
 * Zapojí klidný animační cyklus a obsluhu interakcí (kliknutí / hover / klávesnice).
 * Každých 6,5 sekund přehraje jednu ze 7 animací s hladkým návratem do výchozího bodu.
 * Vrácený kontrolér lze volat jak jako funkci `controller()`, tak přes `controller.dispose()`.
 * @param {HTMLElement|string} targetElementOrSelector
 * @param {Object} options
 * @returns {Function} logo controller { dispose, trigger, next, isBusy, getIndex }
 */
export function mountBrandLogo(targetElementOrSelector, options = {}) {
  const container = typeof targetElementOrSelector === 'string'
    ? document.querySelector(targetElementOrSelector)
    : targetElementOrSelector;

  if (!container) {
    return createNoopController();
  }

  // Pokud již byl kontejner dříve inicializován, bezpečně uklidíme staré posluchače
  if (container._brandLogoDisposer) {
    try {
      if (typeof container._brandLogoDisposer === 'function') {
        container._brandLogoDisposer();
      } else if (typeof container._brandLogoDisposer.dispose === 'function') {
        container._brandLogoDisposer.dispose();
      }
    } catch {}
  }

  const svg = container.tagName && container.tagName.toLowerCase() === 'svg'
    ? container
    : container.querySelector('.czekpoint-logo-svg') || container.querySelector('svg');

  if (!svg) {
    return createNoopController();
  }

  const intervalMs = options.intervalMs || DEFAULT_CYCLE_MS;
  const durationMs = options.durationMs || DEFAULT_DURATION_MS;
  const triggerOnHover = options.triggerOnHover !== false;
  const onStateChange = options.onStateChange || null;

  let currentIndex = 0;
  let busy = false;
  let activeTimer = null;
  let cycleInterval = null;
  let isDisposed = false;

  const reducedMotionQuery = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function prefersReducedMotion() {
    return Boolean(reducedMotionQuery?.matches);
  }

  function playState(stateObj, force = false) {
    if ((busy && !force) || isDisposed || prefersReducedMotion()) return false;
    busy = true;

    LOGO_ANIM_STATES.forEach(s => svg.classList.remove(s.cls));
    void (svg.getBoundingClientRect?.() || svg.offsetWidth); // reset animace
    svg.classList.add(stateObj.cls);

    if (typeof onStateChange === 'function') {
      onStateChange(stateObj, true);
    }

    clearTimeout(activeTimer);
    activeTimer = setTimeout(() => {
      if (isDisposed) return;
      svg.classList.remove(stateObj.cls);
      busy = false;
      if (typeof onStateChange === 'function') {
        onStateChange(stateObj, false);
      }
    }, durationMs);

    return true;
  }

  function next(force = false) {
    if ((busy && !force) || isDisposed || prefersReducedMotion()) return false;
    const stateObj = LOGO_ANIM_STATES[currentIndex];
    const played = playState(stateObj, force);
    if (played) {
      currentIndex = (currentIndex + 1) % LOGO_ANIM_STATES.length;
    }
    return played;
  }

  function trigger(stateInput) {
    if (busy || isDisposed || prefersReducedMotion()) return false;
    const found = typeof stateInput === 'string'
      ? LOGO_ANIM_STATES.find(s => s.id === stateInput || s.cls === stateInput)
      : stateInput;
    if (found) {
      const idx = LOGO_ANIM_STATES.indexOf(found);
      if (idx !== -1) currentIndex = (idx + 1) % LOGO_ANIM_STATES.length;
      return playState(found);
    }
    return false;
  }

  function startAutoCycle() {
    if (cycleInterval || prefersReducedMotion()) return;
    cycleInterval = setInterval(() => {
      if (!isDisposed && !busy && typeof document !== 'undefined' && !document.hidden) {
        next();
      }
    }, intervalMs);
  }

  function stopAutoCycle() {
    if (cycleInterval) {
      clearInterval(cycleInterval);
      cycleInterval = null;
    }
  }

  startAutoCycle();

  const onClick = (e) => {
    // Pokud je logo odkaz, neblokujeme navigaci při kliknutí, ale spustíme animaci
    next(true);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      next(true);
    }
  };

  const onMouseEnter = () => {
    if (triggerOnHover && !busy) {
      next();
    }
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      stopAutoCycle();
    } else {
      startAutoCycle();
    }
  };

  const onReducedMotionChange = (e) => {
    if (e.matches) {
      stopAutoCycle();
      clearTimeout(activeTimer);
      LOGO_ANIM_STATES.forEach(s => svg.classList.remove(s.cls));
      busy = false;
    } else {
      startAutoCycle();
    }
  };

  container.addEventListener('click', onClick);
  container.addEventListener('keydown', onKeyDown);
  if (triggerOnHover) {
    container.addEventListener('mouseenter', onMouseEnter);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (reducedMotionQuery?.addEventListener) {
    reducedMotionQuery.addEventListener('change', onReducedMotionChange);
  }

  const dispose = () => {
    isDisposed = true;
    stopAutoCycle();
    clearTimeout(activeTimer);
    container.removeEventListener('click', onClick);
    container.removeEventListener('keydown', onKeyDown);
    if (triggerOnHover) {
      container.removeEventListener('mouseenter', onMouseEnter);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (reducedMotionQuery?.removeEventListener) {
      reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
    }
    LOGO_ANIM_STATES.forEach(s => svg.classList.remove(s.cls));
    busy = false;
    if (container._brandLogoDisposer === dispose) {
      delete container._brandLogoDisposer;
    }
  };

  dispose.dispose = dispose;
  dispose.trigger = trigger;
  dispose.next = next;
  dispose.isBusy = () => busy;
  dispose.getIndex = () => currentIndex;

  container._brandLogoDisposer = dispose;
  return dispose;
}

/**
 * Pevné nasazení animovaného loga č. 100 přímo do hlavičky webu (.site-header .brand).
 * Nahradí statický obrázek kompletním inline SVG a spustí 6,5s klidný animační cyklus.
 * @param {string|HTMLElement} targetElementOrSelector
 * @param {Object} options
 * @returns {Function} logo controller { dispose, trigger, next, isBusy, getIndex }
 */
export function mountAnimatedBrandLogo(targetElementOrSelector, options = {}) {
  const brandEl = typeof targetElementOrSelector === 'string'
    ? document.querySelector(targetElementOrSelector)
    : targetElementOrSelector;

  if (!brandEl) return createNoopController();

  // Najdeme stávající slot nebo obrázek
  let slot = brandEl.querySelector('.header-logo-slot');
  if (!slot) {
    slot = document.createElement('span');
    slot.className = 'header-logo-slot';
    const oldImg = brandEl.querySelector('img');
    if (oldImg) {
      brandEl.replaceChild(slot, oldImg);
    } else {
      brandEl.prepend(slot);
    }
  }

  if (slot._brandLogoController) {
    try {
      if (typeof slot._brandLogoController === 'function') {
        slot._brandLogoController();
      } else if (typeof slot._brandLogoController.dispose === 'function') {
        slot._brandLogoController.dispose();
      }
    } catch {}
    slot._brandLogoController = null;
  }

  // Vložíme inline SVG loga č. 100
  slot.innerHTML = renderBrandLogoSvg({
    id: 'header-brand-logo-svg',
    className: 'czekpoint-logo-svg header-logo-svg',
    clipId: 'header-brand-banner-clip',
    ariaLabel: 'Czekpoint — logo',
    width: options.width || 64,
    height: options.height || 64,
  });

  const controller = mountBrandLogo(slot, {
    intervalMs: options.intervalMs || DEFAULT_CYCLE_MS,
    durationMs: options.durationMs || DEFAULT_DURATION_MS,
    triggerOnHover: options.triggerOnHover !== false,
  });
  slot._brandLogoController = controller;
  return controller;
}

/**
 * Vloží do stránky plovoucí vrstvu živého ambientního pozadí (#ambient-bg).
 * Obsahuje jemné topografické vrstevnice, siluety smrků a rozcestníku a plující lesní jiskřičky.
 * @returns {Function} { dispose }
 */
export function mountAmbientBackground() {
  if (typeof document === 'undefined') {
    const noop = () => {};
    noop.dispose = noop;
    return noop;
  }
  let bg = document.querySelector('#ambient-bg');
  if (bg) {
    const removeBg = () => bg.remove();
    removeBg.dispose = removeBg;
    return removeBg;
  }

  bg = document.createElement('div');
  bg.id = 'ambient-bg';
  bg.setAttribute('aria-hidden', 'true');
  bg.innerHTML = `
    <!-- Topografické vrstevnice a kompasové kružnice -->
    <svg class="ambient-contours" viewBox="0 0 1000 1000" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M-50,200 Q200,120 450,220 T950,180 T1100,250" fill="none" stroke="#2e6f3e" stroke-width="1.2"/>
      <path d="M-50,350 Q300,280 600,380 T1100,320" fill="none" stroke="#2e6f3e" stroke-width="1.2"/>
      <path d="M-50,550 Q250,620 550,520 T1100,580" fill="none" stroke="#2e6f3e" stroke-width="1.2"/>
      <path d="M-50,750 Q400,680 750,780 T1100,720" fill="none" stroke="#2e6f3e" stroke-width="1.2"/>
      <circle cx="150" cy="200" r="140" fill="none" stroke="#2e6f3e" stroke-width="0.8" stroke-dasharray="6,8"/>
      <circle cx="850" cy="750" r="180" fill="none" stroke="#2e6f3e" stroke-width="0.8" stroke-dasharray="8,10"/>
      <line x1="850" y1="550" x2="850" y2="950" stroke="#2e6f3e" stroke-width="0.6"/>
      <line x1="650" y1="750" x2="1050" y2="750" stroke="#2e6f3e" stroke-width="0.6"/>
    </svg>

    <!-- Poloprůhledná silueta smrků v levém dolním rohu -->
    <svg class="ambient-silhouette ambient-silhouette-left" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <polygon points="40,30 15,90 28,90 10,140 26,140 5,190 75,190 54,140 70,140 52,90 65,90" fill="#1b4d2b"/>
      <polygon points="90,10 58,80 74,80 50,135 68,135 45,195 135,195 112,135 130,135 106,80 122,80" fill="#235c32"/>
      <polygon points="140,50 115,100 126,100 108,145 122,145 102,192 178,192 158,145 172,145 154,100 165,100" fill="#2e6f3e"/>
    </svg>

    <!-- Poloprůhledná silueta rozcestníku v pravém dolním rohu -->
    <svg class="ambient-silhouette ambient-silhouette-right" viewBox="0 0 160 200" xmlns="http://www.w3.org/2000/svg">
      <rect x="74" y="20" width="12" height="180" rx="3" fill="#6e4726"/>
      <circle cx="80" cy="18" r="5" fill="#8c5c32"/>
      <polygon points="48,32 112,32 126,45 112,58 48,58" fill="#c58344"/>
      <polygon points="112,66 48,66 34,79 48,92 112,92" fill="#d7995b"/>
      <polygon points="48,100 110,100 124,113 110,126 48,126" fill="#b47134"/>
    </svg>

    <!-- 5 pomalu stoupajících a pohasínajících lesních jiskřiček -->
    <div class="ambient-spores">
      <div class="floating-spore" style="left:12%;top:75%;width:6px;height:6px;animation-delay:0s;animation-duration:14s"></div>
      <div class="floating-spore" style="left:38%;top:85%;width:5px;height:5px;animation-delay:3s;animation-duration:16s"></div>
      <div class="floating-spore" style="left:65%;top:80%;width:7px;height:7px;animation-delay:6s;animation-duration:13s"></div>
      <div class="floating-spore" style="left:82%;top:70%;width:5.5px;height:5.5px;animation-delay:1.5s;animation-duration:15s"></div>
      <div class="floating-spore" style="left:48%;top:92%;width:4px;height:4px;animation-delay:8s;animation-duration:18s"></div>
    </div>
  `;

  document.body.prepend(bg);

  const dispose = () => {
    bg.remove();
  };
  dispose.dispose = dispose;
  return dispose;
}