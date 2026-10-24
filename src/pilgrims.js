import { ALLOWED_AVATARS, avatarUrl } from './avatars.js';
import { createRng } from './postcard.js';
import { escapeHtml as e, formatDate } from './ui.js';
import { createStickBadge, renderStickBadgeSvg } from './walking-stick.js';

const COMPANION_LABELS = Object.freeze({
  solo: '🥾 Sólo poutník',
  dog: '🐕 Se psem',
  stroller: '👶 S kočárkem',
  family: '👨‍👩‍👧 Skupina / Rodina',
});

const RANKS = Object.freeze([
  { title: 'Sváteční chodec', level: 1 },
  { title: 'Místní stopař', level: 2 },
  { title: 'Průzkumník Třemšínska', level: 3 },
  { title: 'Strážce stezek', level: 4 },
  { title: 'Král Brd', level: 5 },
]);

/**
 * Generates deterministic sample pilgrims for the current 0.01 deg (~1 km) grid cell.
 * Clearly marked as local sample revír representation.
 */
export function getLocalRevirPilgrims(position) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    return [];
  }

  // Grid cell 0.01 deg
  const cellLat = Math.round(position.lat * 100) / 100;
  const cellLng = Math.round(position.lng * 100) / 100;
  const seedKey = `revir_${cellLat}_${cellLng}`;
  const rng = createRng(seedKey);

  const count = 3 + Math.floor(rng() * 3); // 3 to 5 pilgrims
  const companionKeys = ['solo', 'dog', 'stroller', 'family'];
  const pilgrims = [];

  for (let i = 0; i < count; i++) {
    const avatarIndex = Math.floor(rng() * ALLOWED_AVATARS.length);
    const avatar = ALLOWED_AVATARS[avatarIndex];
    const rankObj = RANKS[Math.floor(rng() * RANKS.length)];
    const compMode = companionKeys[Math.floor(rng() * companionKeys.length)];
    const badgesCount = 1 + Math.floor(rng() * 12);
    const clinksCount = Math.floor(rng() * 18);

    const sampleBadge = createStickBadge({
      expId: `pilgrim_exp_${i}_${seedKey}`,
      distanceMeters: 1500 + Math.floor(rng() * 8000),
      stampsCount: 1 + Math.floor(rng() * 4),
      companionMode: compMode,
      categories: ['forest', 'views'],
    });
    sampleBadge.pinned = true;

    pilgrims.push({
      id: `pilgrim_${cellLat}_${cellLng}_${i}`,
      name: `Poutník ${avatar.name}`,
      avatarId: avatar.id,
      rankTitle: rankObj.title,
      level: rankObj.level,
      companionMode: compMode,
      badgesCount,
      clinksCount,
      sampleBadge,
    });
  }

  return pilgrims;
}

/**
 * Records a verified summit entry into the place summit book.
 */
export function recordSummitEntry(stateObj, placeId) {
  if (!stateObj || !placeId) return stateObj;
  const placeKey = String(placeId);
  const currentEntries = stateObj.summitEntries || {};
  if (currentEntries[placeKey]) return stateObj; // Already entered

  const avatarId = stateObj.profile?.avatarId || 'liska';
  const companionMode = stateObj.companionMode || 'solo';
  const entry = {
    avatarId,
    badgeShape: 'shield',
    badgeMetal: 'brass',
    companionMode,
    stampedAt: new Date().toISOString(),
  };

  const updatedEntries = {
    ...currentEntries,
    [placeKey]: entry,
  };

  return {
    ...stateObj,
    summitEntries: updatedEntries,
  };
}

/**
 * Renders the HTML section for local pilgrims in bottom sheet or passport.
 */
export function renderPilgrimsSection(stateObj, position, actions = {}) {
  const s = stateObj || {};
  const optIn = Boolean(s.pilgrimsOptIn);
  const clinksCount = Number(s.clinksCount) || 0;

  if (!optIn) {
    return `
      <div class="pilgrims-box">
        <div class="pilgrims-optin-prompt">
          <div class="pilgrim-icon-lead">👥</div>
          <div>
            <strong>Poutníci v okolí (100% anonymní opt-in)</strong>
            <p class="small-note">Zapni pro zobrazení poutníků v revíru (zaokrouhleno na ~1 km čtverec, bez ukládání polohy a bez sledování). Můžeš si prohlížet hole a cinknout na pozdrav.</p>
          </div>
          <button class="button small primary" id="toggle-pilgrims-optin-btn">
            Zapnout poutníky v okolí
          </button>
        </div>
      </div>
    `;
  }

  const pilgrims = getLocalRevirPilgrims(position || { lat: 49.603, lng: 13.863 });

  return `
    <div class="pilgrims-box">
      <div class="pilgrims-header">
        <div>
          <span class="eyebrow">Poutníci v okolí</span>
          <div class="pilgrims-title-line">
            <strong>Revír Rožmitálsko</strong>
            <span class="local-sample-pill">Lokální ukázka poutníků v revíru</span>
          </div>
          <p class="small-note">Poloha zaokrouhlena na 0,01° (~1 km). Žádný volný text, žádné sledování.</p>
        </div>
        <div class="clinks-badge-pill" title="Počet přátelských cinknutí holemi">
          🦯 <strong>${clinksCount}</strong> cinknutí
        </div>
      </div>

      <div class="pilgrims-list">
        ${pilgrims.map(p => `
          <div class="pilgrim-card" data-pilgrim-id="${e(p.id)}">
            <img class="pilgrim-avatar" src="${avatarUrl(p.avatarId)}" alt="${e(p.name)}" width="40" height="40">
            <div class="pilgrim-info">
              <strong>${e(p.name)}</strong>
              <span class="small-note">${COMPANION_LABELS[p.companionMode] || '🥾'} · ${e(p.rankTitle)} (úroveň ${p.level})</span>
              <span class="pilgrim-stick-stat">🦯 ${p.badgesCount} štítků na holi · 💬 ${p.clinksCount} pozdravů</span>
            </div>
            <button class="button small clink-btn" data-pilgrim-id="${e(p.id)}" title="Cinknout holí na pozdrav">
              🦯 Cinknout
            </button>
          </div>
        `).join('')}
      </div>

      <div style="margin-top:10px;text-align:right">
        <button class="button small subtle" id="toggle-pilgrims-optin-btn">
          Vypnout poutníky v okolí
        </button>
      </div>
    </div>
  `;
}

/**
 * Renders the Summit Book section in route detail.
 */
export function renderSummitBook(placeId, summitEntries = {}) {
  const entry = summitEntries[placeId];
  if (!entry) {
    return `
      <section class="panel summit-book-panel">
        <div class="summit-book-header">
          <span class="summit-book-icon">📖</span>
          <div>
            <h3>Místní vrcholová kniha</h3>
            <p class="small-note">Ověřené zápisy poutníků, kteří zde získali GPS razítko (10–60 s do 60 m).</p>
          </div>
        </div>
        <div class="summit-empty-card">
          <p>Zatím v této knize nemáš svůj vrcholový zápis.</p>
          <span class="small-note">Vyraž sem s GPS v režimu výpravy, vyčkej na ověření polohy a zapiš se do vrcholové knihy.</span>
        </div>
      </section>
    `;
  }

  const compLabel = COMPANION_LABELS[entry.companionMode] || '🥾 Poutník';
  const dateStr = formatDate(entry.stampedAt, true);

  return `
    <section class="panel summit-book-panel signed">
      <div class="summit-book-header">
        <span class="summit-book-icon">📖</span>
        <div>
          <h3>Místní vrcholová kniha</h3>
          <p class="small-note">Ověřený zápis z terénu s GPS razítkem.</p>
        </div>
      </div>
      <div class="summit-entry-card">
        <img src="${avatarUrl(entry.avatarId)}" width="48" height="48" alt="Avatar" class="summit-avatar">
        <div class="summit-entry-details">
          <strong class="summit-signature">Zapsáno ve vrcholové knize</strong>
          <span class="summit-meta">${e(compLabel)} · ${e(dateStr)}</span>
          <span class="summit-badge-tag">🏅 Získáno ověřené GPS razítko místa (+30 b.)</span>
        </div>
      </div>
    </section>
  `;
}