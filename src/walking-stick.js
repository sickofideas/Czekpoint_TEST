import { escapeHtml as e } from './ui.js';
import { createRng } from './postcard.js';

export const WALKING_STICK_TIERS = Object.freeze([
  {
    id: 'leskova',
    minScore: 0,
    title: 'Lísková hůl poutníka',
    subtitle: 'Pevná lísková větev seříznutá u cesty',
    woodColor: '#8d6e63',
    woodGradient: 'linear-gradient(90deg, #6d4c41 0%, #8d6e63 40%, #a1887f 70%, #5d4037 100%)',
    capColor: '#4e342e',
    accentColor: '#bcaaa4',
  },
  {
    id: 'bukova',
    minScore: 200,
    title: 'Buková hůl s koženým řemínkem',
    subtitle: 'Hladce opracovaný lesní buk s koženým poutkem',
    woodColor: '#a1887f',
    woodGradient: 'linear-gradient(90deg, #795548 0%, #a1887f 40%, #bcaaa4 70%, #5d4037 100%)',
    capColor: '#6d4c41',
    accentColor: '#d7ccc8',
  },
  {
    id: 'dubova',
    minScore: 600,
    title: 'Vyřezávaná dubová hůl s kovovým hrotem',
    subtitle: 'Dubové dřevo s ornamenty a kovanou špičkou',
    woodColor: '#5d4037',
    woodGradient: 'linear-gradient(90deg, #3e2723 0%, #5d4037 40%, #795548 70%, #2e1c14 100%)',
    capColor: '#78909c',
    accentColor: '#cfd8dc',
  },
  {
    id: 'strazce-brd',
    minScore: 1200,
    title: 'Mistrovská hůl Strážce Brd s mosaznou hlavicí',
    subtitle: 'Tmavé leštěné dřevo s tepanou mosaznou rukojetí',
    woodColor: '#3e2723',
    woodGradient: 'linear-gradient(90deg, #271406 0%, #3e2723 40%, #4e342e 70%, #1b0c03 100%)',
    capColor: '#ffd700',
    accentColor: '#ffe082',
  },
]);

export const BADGE_SHAPES = Object.freeze(['shield', 'crest', 'oval', 'hex']);
export const BADGE_METALS = Object.freeze(['copper', 'brass', 'silver', 'enamel']);

const COMPANION_ICONS = Object.freeze({
  solo: '🥾',
  dog: '🐕',
  stroller: '👶',
  family: '👨‍👩‍👧',
});

/**
 * Returns the walking stick progression tier based on player's total score.
 */
export function getWalkingStickTier(score = 0) {
  const pts = Number(score) || 0;
  let currentTier = WALKING_STICK_TIERS[0];
  for (const tier of WALKING_STICK_TIERS) {
    if (pts >= tier.minScore) {
      currentTier = tier;
    }
  }
  return currentTier;
}

/**
 * Creates a unique tin badge awarded upon completing an expedition.
 */
export function createStickBadge({
  expId = '',
  distanceMeters = 0,
  stampsCount = 0,
  companionMode = 'solo',
  categories = [],
  createdAt = new Date().toISOString(),
}) {
  const rng = createRng(expId || String(Date.now()));

  // Choose shape deterministically
  const shapeIndex = Math.floor(rng() * BADGE_SHAPES.length);
  const shape = BADGE_SHAPES[shapeIndex];

  // Choose metal based on expedition merits and randomness
  let metal = 'copper';
  const mRand = rng();
  if (stampsCount >= 3 || distanceMeters >= 5000) {
    metal = mRand > 0.5 ? 'silver' : 'enamel';
  } else if (stampsCount >= 1 || distanceMeters >= 2000) {
    metal = mRand > 0.4 ? 'brass' : 'silver';
  } else {
    metal = mRand > 0.5 ? 'brass' : 'copper';
  }

  // Determine approved area label
  let areaLabel = 'Rožmitálsko · Toulky krajem';
  if (categories.includes('forest') && categories.includes('view')) {
    areaLabel = 'Brdské hřebeny · Lesní výprava';
  } else if (categories.includes('forest')) {
    areaLabel = 'Rožmitálsko · Lesní výprava';
  } else if (categories.includes('views')) {
    areaLabel = 'Třemšínsko · Vrcholová stezka';
  } else if (categories.includes('water')) {
    areaLabel = 'Rožmitálsko · Vodní okruh';
  } else if (categories.includes('culture') || categories.includes('sacral')) {
    areaLabel = 'Rožmitál · Historická stezka';
  }

  const id = `badge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    expId: String(expId || 'exp'),
    shape,
    metal,
    areaLabel,
    distanceMeters: Math.max(0, Math.round(Number(distanceMeters) || 0)),
    stampsCount: Math.max(0, Math.round(Number(stampsCount) || 0)),
    companionMode: ['solo', 'dog', 'stroller', 'family'].includes(companionMode) ? companionMode : 'solo',
    pinned: false,
    createdAt: String(createdAt),
  };
}

/**
 * Generates pure SVG of the tin walking stick badge.
 */
export function renderStickBadgeSvg(badge, options = {}) {
  const b = badge || {};
  const width = options.width || 120;
  const height = options.height || 64;
  const companionIcon = COMPANION_ICONS[b.companionMode] || '🥾';
  const distKm = b.distanceMeters >= 1000 ? `${(b.distanceMeters / 1000).toFixed(1)} km` : `${b.distanceMeters || 0} m`;
  const stampsText = b.stampsCount > 0 ? `${b.stampsCount} razítko` : 'Cesta';
  const metal = b.metal || 'brass';
  const shape = b.shape || 'shield';

  // Metal color gradients
  let fillDef = '';
  let textColor = '#2a1e12';
  let borderColor = '#6c4a1e';
  let nailColor = '#3a2a1b';

  if (metal === 'copper') {
    fillDef = `
      <linearGradient id="g_${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#d48a56"/>
        <stop offset="35%" stop-color="#f0b284"/>
        <stop offset="70%" stop-color="#bf703d"/>
        <stop offset="100%" stop-color="#914d24"/>
      </linearGradient>`;
    borderColor = '#5f2e12';
    textColor = '#351608';
  } else if (metal === 'silver') {
    fillDef = `
      <linearGradient id="g_${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#bdc3c7"/>
        <stop offset="35%" stop-color="#ffffff"/>
        <stop offset="70%" stop-color="#bdc3c7"/>
        <stop offset="100%" stop-color="#7f8c8d"/>
      </linearGradient>`;
    borderColor = '#4a555c';
    textColor = '#22292e';
    nailColor = '#22292e';
  } else if (metal === 'enamel') {
    fillDef = `
      <linearGradient id="g_${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#215241"/>
        <stop offset="40%" stop-color="#2d6a54"/>
        <stop offset="100%" stop-color="#14362b"/>
      </linearGradient>`;
    borderColor = '#d4af37';
    textColor = '#f4f6e6';
    nailColor = '#ffd700';
  } else {
    // brass
    fillDef = `
      <linearGradient id="g_${b.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#e0be62"/>
        <stop offset="35%" stop-color="#fff1b0"/>
        <stop offset="70%" stop-color="#c99c35"/>
        <stop offset="100%" stop-color="#8c6819"/>
      </linearGradient>`;
    borderColor = '#5e430c';
    textColor = '#3b2904';
  }

  // Path outline according to shape
  let pathD = '';
  if (shape === 'shield') {
    pathD = `M 6,4 Q ${width / 2},0 ${width - 6},4 Q ${width - 2},${height * 0.65} ${width / 2},${height - 2} Q 2,${height * 0.65} 6,4 Z`;
  } else if (shape === 'crest') {
    pathD = `M 8,3 Q ${width / 2},7 ${width - 8},3 Q ${width - 2},${height / 2} ${width - 8},${height - 3} Q ${width / 2},${height - 7} 8,${height - 3} Q 2,${height / 2} 8,3 Z`;
  } else if (shape === 'hex') {
    pathD = `M 12,3 L ${width - 12},3 L ${width - 2},${height / 2} L ${width - 12},${height - 3} L 12,${height - 3} L 2,${height / 2} Z`;
  } else {
    // oval
    pathD = `M 14,3 Q ${width / 2},1 ${width - 14},3 Q ${width - 2},${height / 2} ${width - 14},${height - 3} Q ${width / 2},${height - 1} 14,${height - 3} Q 2,${height / 2} 14,3 Z`;
  }

  return `
    <svg class="stick-badge-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Štítek: ${e(b.areaLabel)}">
      <defs>
        ${fillDef}
        <filter id="sh_${b.id}" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1" flood-opacity="0.35"/>
        </filter>
      </defs>
      <!-- Base shape -->
      <path d="${pathD}" fill="url(#g_${b.id})" stroke="${borderColor}" stroke-width="1.6" filter="url(#sh_${b.id})"/>
      <!-- Inner embossed contour -->
      <path d="${pathD}" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8" transform="scale(0.92) translate(${width * 0.04}, ${height * 0.04})"/>
      
      <!-- Top nail hole -->
      <circle cx="${width / 2}" cy="5" r="1.7" fill="${nailColor}" stroke="rgba(255,255,255,0.6)" stroke-width="0.6"/>
      <!-- Bottom nail hole -->
      <circle cx="${width / 2}" cy="${height - 5}" r="1.7" fill="${nailColor}" stroke="rgba(255,255,255,0.6)" stroke-width="0.6"/>

      <!-- Text content -->
      <text x="${width / 2}" y="19" font-family="Georgia, serif" font-size="7.5" font-weight="bold" fill="${textColor}" text-anchor="middle" letter-spacing="0.2">
        ${e(b.areaLabel)}
      </text>

      <text x="${width / 2}" y="36" font-family="system-ui, sans-serif" font-size="11" font-weight="800" fill="${textColor}" text-anchor="middle">
        ${companionIcon} ${e(distKm)}
      </text>

      <text x="${width / 2}" y="49" font-family="system-ui, sans-serif" font-size="7" font-weight="600" fill="${textColor}" opacity="0.85" text-anchor="middle">
        ${e(stampsText)}
      </text>
    </svg>
  `.trim();
}

/**
 * Renders HTML for the player's walking stick and badges in passport view.
 */
export function renderWalkingStickHtml(stateObj, actions = {}) {
  const s = stateObj || {};
  const badges = Array.isArray(s.stickBadges) ? s.stickBadges : [];
  const pinnedBadges = badges.filter(b => b.pinned);
  const unpinnedBadges = badges.filter(b => !b.pinned);

  // Compute total score for walking stick tier
  const c = Array.isArray(s.cells) ? s.cells.length : 0;
  const m = Number(s.meters) || 0;
  const d = Array.isArray(s.discoveries) ? s.discoveries.length : 0;
  const pts = (Number(s.legacyScore) || 0) + 10 * c + Math.floor(m / 50) + 25 * Math.floor(c / 6) + 30 * d;
  const tier = getWalkingStickTier(pts);

  return `
    <div class="walking-stick-section">
      <div class="stick-tier-banner" style="border-left: 5px solid ${tier.capColor}">
        <div>
          <span class="eyebrow">Virtuální turistická hůl</span>
          <h3 class="stick-tier-title">${e(tier.title)}</h3>
          <p class="small-note">${e(tier.subtitle)} · Dosáhni ${tier.minScore} b. pro tuto hůl</p>
        </div>
        <div class="stick-badge-count-pill">
          <strong>${pinnedBadges.length}</strong>
          <span>přibitých štítků</span>
        </div>
      </div>

      ${unpinnedBadges.length > 0 ? `
        <div class="unpinned-badges-box">
          <div class="unpinned-header">
            <strong>🔨 Nové štítky k přibití (${unpinnedBadges.length}):</strong>
            <span class="small-note">Přibij si získaný plechový štítek ze své výpravy na hůl</span>
          </div>
          <div class="unpinned-badges-grid">
            ${unpinnedBadges.map(b => `
              <div class="unpinned-badge-card" data-badge-id="${e(b.id)}">
                <div class="badge-preview-slot">
                  ${renderStickBadgeSvg(b, { width: 110, height: 58 })}
                </div>
                <button class="button small hammer-badge-btn" data-badge-id="${e(b.id)}">
                  🔨 Přibít na hůl
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="stick-showcase">
        <div class="stick-shaft" style="background: ${tier.woodGradient}">
          <div class="stick-head" style="background: ${tier.capColor}"></div>
          <div class="stick-nail-area">
            ${pinnedBadges.length === 0 ? `
              <div class="stick-empty-hint">
                <span>🦯 Hůl je zatím prázdná. Dokonči výpravu s GPS a získej svůj první plechový štítek!</span>
              </div>
            ` : `
              <div class="stick-badges-column">
                ${pinnedBadges.map((b, idx) => `
                  <div class="pinned-badge-wrap" style="transform: rotate(${(idx % 2 === 0 ? -1 : 1) * ((idx % 3) + 0.5)}deg)">
                    ${renderStickBadgeSvg(b, { width: 120, height: 64 })}
                  </div>
                `).join('')}
              </div>
            `}
          </div>
          <div class="stick-tip" style="background: ${tier.capColor}"></div>
        </div>
      </div>
    </div>
  `;
}