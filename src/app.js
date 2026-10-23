import { CONFIG } from '../config.js';
import { createRepository } from './repository.js';
import { filterRoutes, haversineMeters, isReportFresh, summarizeReports } from './domain.js';
import { escapeHtml as e, safeUrl, icon, formatDate, number } from './ui.js';
import { mountWalk } from './walk.js';
import {
  clearState,
  loadState,
  saveState,
  setProfileAvatar,
  exportStateJson,
  previewImportState,
  importStateJson,
} from './walk-store.js';
import { ALLOWED_AVATARS, avatarUrl } from './avatars.js';
import { generatePostcardDataUrl, generatePostcardBlob } from './postcard.js';
import { explorerRank, chapterStatus, totalScore } from './walk-engine.js';
import { CHAPTERS, COLLECTIONS, RELICS } from './data.js';
import { renderWalkingStickHtml } from './walking-stick.js';
import { renderPilgrimsSection, renderSummitBook } from './pilgrims.js';
import { playTick, playHammer, triggerHaptic } from './fx.js';

let disposeWalk = null;

const main = document.querySelector('#main');
const reportDialog = document.querySelector('#report-dialog');
const confirmDialog = document.querySelector('#confirm-dialog');
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: 'start' });
});

const state = {
  routes: [],
  saved: [],
  visits: [],
  repo: null,
  position: null,
  view: 'explore',
  filters: { search: '', kind: 'all', maxDistance: null, strollerOnly: false, savedOnly: false },
  passportTab: 'visited',
  renderId: 0,
  toastTimer: null,
};

const kinds = { forest: 'Lesní výlet', view: 'Vyhlídka', culture: 'Historie', water: 'U vody' };
const kindIcons = { forest: 'tree', view: 'mountain', culture: 'castle', water: 'water' };
const reportKinds = { clear: 'Bez viditelných potíží', mud: 'Bláto / mokrý povrch', obstacle: 'Překážka na cestě', closure: 'Omezený přístup', other: 'Jiná zkušenost' };
const illustrations = new Set(['forest', 'castle', 'lake']);
const illustrationUrl = route => `./assets/${illustrations.has(route.illustration) ? route.illustration : 'forest'}.svg`;
const routeLink = route => `#/trasa/${encodeURIComponent(route.id)}`;
const isSaved = id => state.saved.includes(id);
const visitFor = id => state.visits.find(visit => visit.routeId === id);
const errorMessage = error => error?.message || 'Operace se nepodařila. Zkus to prosím znovu.';

function toast(message, error = false) {
  const box = document.querySelector('#toast');
  clearTimeout(state.toastTimer);
  box.textContent = message;
  box.classList.toggle('error', error);
  box.hidden = false;
  state.toastTimer = setTimeout(() => { box.hidden = true; }, 5500);
}

function accessLabel(route) {
  const value = route.access?.stroller || 'unknown';
  return { yes: 'Kočárek dle zdroje', no: 'Nevhodné pro kočárek', unknown: 'Kočárek: neověřeno' }[value] || 'Kočárek: neověřeno';
}

function distanceTo(route) {
  if (!state.position || !route.location) return '';
  const meters = haversineMeters(state.position, route.location);
  return Number.isFinite(meters) ? `${number(meters / 1000)} km vzdušně` : '';
}

function renderCard(route, passport = false) {
  const visit = visitFor(route.id);
  const saved = isSaved(route.id);
  const stateObj = loadState();
  const hasStamp = stateObj.discoveries?.includes(route.id) || stateObj.discoveries?.includes(`catalog:${route.id}`);
  const stampBadge = hasStamp ? '✓ GPS razítko' : '';

  return `<article class="route-card" data-route-card="${e(route.id)}">
    <div class="card-image"><a href="${routeLink(route)}" tabindex="-1" aria-hidden="true"><img src="${illustrationUrl(route)}" alt="" width="600" height="340" loading="lazy"></a>
      <span class="image-label">Ilustrace místa</span>
      <button class="save-button ${saved ? 'saved' : ''}" type="button" data-action="save" data-id="${e(route.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Odebrat z uložených' : 'Uložit výlet'}: ${e(route.title)}">${icon('heart')}</button>
    </div>
    <div class="card-content">
      <div class="card-kicker">${e(route.region)} · ${e(kinds[route.kind] || 'Výlet')} ${stampBadge ? `· <strong>${stampBadge}</strong>` : ''}</div>
      <h3><a href="${routeLink(route)}">${e(route.title)}</a></h3>
      <p class="card-description">${e(route.subtitle)}</p>
      <div class="card-stats">
        <span>${icon('route')}${route.distanceKm != null ? `${number(route.distanceKm)} km` : 'Délka nezjištěna'}</span>
        <span>${icon(kindIcons[route.kind] || 'pin')}${e({ easy: 'Lehká dle zdroje', moderate: 'Náročnější úseky', hard: 'Náročná', unknown: 'Náročnost neověřena' }[route.access?.difficulty] || 'Náročnost neověřena')}</span>
      </div>
      <div class="card-bottom">
        <span class="access-tag ${e(route.access?.stroller || 'unknown')}">${icon('stroller')}${e(accessLabel(route))}</span>
        <a class="round-link" href="${routeLink(route)}" aria-label="Detail výletu ${e(route.title)}">${icon('arrow')}</a>
      </div>
      ${passport && visit ? `<div class="visit-date">${icon('check')}Tvoje návštěva · ${formatDate(visit.visitedAt)}</div>` : '<div class="card-verification">Z dostupných zdrojů · terén zatím neověřen</div>'}
      ${distanceTo(route) ? `<div class="card-verification">${e(distanceTo(route))} od tebe</div>` : ''}
    </div>
  </article>`;
}

function renderExplore() {
  main.innerHTML = `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy"><div class="eyebrow">${icon('leaf')} Začni kousek od domova</div>
      <h1 id="hero-title" tabindex="-1">Ven s dobrým<br><em>přehledem.</em></h1>
      <p>Krásný výlet je začátek. Czekpoint je tvůj osobní atlas procházek: vyjdi ven, odkrývej své okolí a sbírej ověřená GPS razítka.</p>
      <div class="hero-actions"><a class="button primary" href="#/prochazka">Spustit mapu a procházku ${icon('arrow')}</a><a class="button ghost" href="#vylety" data-action="scroll-routes">Vybrat výlet</a></div>
      <div class="trust-line"><span>${icon('check')}Bez registrace na prohlížení</span><span>${icon('book')}Osobní atlas bez reklam</span></div>
    </div>
    <div class="hero-art"><img class="project-art" src="./assets/hero-atlas.svg" width="720" height="460" alt="Czekpoint: osobní atlas procházek v přírodě"></div>
    </section>
    <section id="vylety" class="explore-section" aria-labelledby="routes-heading">
      <div class="section-heading"><div><h2 id="routes-heading">Kam vyrazíme?</h2><p>Pár pečlivě vybraných míst. Každé má svůj příběh i přístup.</p></div><span class="subtle muted">Třemšínsko · pilotní výběr</span></div>
      <div class="filter-panel"><div class="filter-top"><label class="search-field">${icon('search')}<span class="sr-only">Hledat výlet</span><input id="search-input" type="search" placeholder="Hledat místo nebo cestu…" maxlength="100" value="${e(state.filters.search)}"></label>
      <label><span class="sr-only">Maximální délka trasy</span><select id="distance-filter" class="filter-select"><option value="">Libovolná délka</option><option value="3">Do 3 km</option><option value="5">Do 5 km</option><option value="10">Do 10 km</option></select></label>
      <label class="check-filter"><input id="stroller-filter" type="checkbox" ${state.filters.strollerOnly ? 'checked' : ''}> S kočárkem dle zdroje</label>
      <label class="check-filter"><input id="saved-filter" type="checkbox" ${state.filters.savedOnly ? 'checked' : ''}> Jen uložené</label></div>
      <div class="filter-chips" role="group" aria-label="Druh výletu">${[['all', 'Všechny výlety', 'globe'], ['forest', 'Do lesa', 'tree'], ['water', 'K vodě', 'water'], ['culture', 'Za historií', 'castle'], ['view', 'Za výhledem', 'mountain']].map(([id, label, ic]) => `<button class="chip ${state.filters.kind === id ? 'active' : ''}" type="button" data-action="filter-kind" data-kind="${id}" aria-pressed="${state.filters.kind === id}">${icon(ic)}${label}</button>`).join('')}</div></div>
      <p id="results-info" class="results-info" role="status" aria-live="polite"></p><div id="route-grid" class="route-grid"></div>
      <aside class="info-strip">${icon('info')}<div><strong>Dobrá informace má svůj zdroj.</strong><p>Karty vycházejí z uvedených veřejných zdrojů. Terénní kontrola probíhá postupně.</p></div></aside>
    </section>`;
  document.querySelector('#distance-filter').value = state.filters.maxDistance || '';
  document.querySelector('#search-input').addEventListener('input', event => { state.filters.search = event.target.value; renderExploreResults(); });
  document.querySelector('#distance-filter').addEventListener('change', event => { state.filters.maxDistance = event.target.value ? Number(event.target.value) : null; renderExploreResults(); });
  document.querySelector('#stroller-filter').addEventListener('change', event => { state.filters.strollerOnly = event.target.checked; renderExploreResults(); });
  document.querySelector('#saved-filter').addEventListener('change', event => { state.filters.savedOnly = event.target.checked; renderExploreResults(); });
  renderExploreResults();
}

function renderExploreResults() {
  const grid = document.querySelector('#route-grid');
  if (!grid) return;
  let routes = filterRoutes(state.routes, { ...state.filters, savedIds: state.saved });
  if (state.position) routes = [...routes].sort((a, b) => (a.location ? haversineMeters(state.position, a.location) : Infinity) - (b.location ? haversineMeters(state.position, b.location) : Infinity));
  document.querySelector('#results-info').textContent = `${routes.length} z ${state.routes.length} výletů${state.position ? ' · seřazeno podle vzdušné vzdálenosti ke známým bodům' : ''}${state.filters.maxDistance ? ' · trasy bez známé délky jsou skryté' : ''}`;
  grid.innerHTML = routes.length ? routes.map(route => renderCard(route)).join('') : `<div class="empty-state">${icon('search')}<h3>Tady je zatím ticho.</h3><p>Tomuto výběru žádný výlet neodpovídá. Zkus méně filtrů nebo jiné místo.</p><button type="button" class="button" data-action="reset-filters">Zobrazit všechny výlety</button></div>`;
}

function fact(label, value, ic) { return `<div class="fact"><span>${icon(ic)}${label}</span><strong class="${value == null ? 'unknown' : ''}">${value == null ? 'Zatím nezjištěno' : e(value)}</strong></div>`; }

async function renderDetail(id, renderId) {
  const route = state.routes.find(item => item.id === id);
  if (!route) { renderNotFound(); return; }
  const saved = isSaved(id);
  const visited = Boolean(visitFor(id));
  const stateObj = loadState();
  const hasStamp = stateObj.discoveries?.includes(id) || stateObj.discoveries?.includes(`catalog:${id}`);

  const stampBadgeHtml = hasStamp
    ? '<span class="detail-trophy-badge" style="background:#eef5ce;border:1px solid #afbf68;color:#345032;">✓ Ověřené GPS razítko místa (+30 b.)</span>'
    : route.pointKind === 'place' && route.collectible !== false
    ? '<span class="detail-trophy-badge none">GPS razítko: získáš osobní návštěvou na 10–60 s</span>'
    : '<span class="detail-trophy-badge none">Začátek trasy / okruhu</span>';

  document.title = `${route.title} · Czekpoint`;
  main.innerHTML = `<a class="back-link" href="#/">${icon('back')}Zpět na výlety</a>
    <div class="detail-header">
      <div>
        <div class="eyebrow">${icon(kindIcons[route.kind] || 'pin')}${e(route.region)} · ${e(kinds[route.kind] || 'Výlet')}</div>
        <h1 tabindex="-1">${e(route.title)}</h1>
        <p>${e(route.subtitle)}</p>
        <div style="margin-top:10px">${stampBadgeHtml}</div>
      </div>
      <button type="button" class="button" data-action="share" data-id="${e(id)}">${icon('share')}Sdílet místo</button>
    </div>
    <div class="detail-grid">
      <div class="detail-main">
        <div class="detail-cover"><img src="${illustrationUrl(route)}" width="600" height="340" alt="Ilustrace místa"><span class="image-label">Ilustrace místa</span></div>
        <section class="panel">
          <h2>Co tě čeká na cestě</h2>
          <p>${e(route.summary)}</p>
          <h3>Odkud vyrazit</h3>
          <p>${e(route.startLabel || 'Výchozí bod ověř v přiloženém zdroji.')}</p>
          <h3>Povrch a přístup</h3>
          <p>${e(route.access?.surface || 'Povrch zatím neznáme.')}</p>
          ${route.obstacles?.length ? `<h3>Na co myslet předem</h3><ul class="bullet-list">${route.obstacles.map(item => `<li>${e(item)}</li>`).join('')}</ul>` : ''}
          ${route.highlights?.length ? `<h3>Malé důvody vyrazit</h3><ul class="bullet-list">${route.highlights.map(item => `<li>${e(item)}</li>`).join('')}</ul>` : ''}
        </section>
        <section class="panel">
          <h2>Odkud informace máme</h2>
          <p>Údaje z veřejného zdroje jsme zpracovali ${formatDate(route.source?.checkedAt)}. Toto datum není terénní kontrola ani potvrzení aktuálního stavu.</p>
          ${safeUrl(route.source?.url) ? `<a class="source-link" href="${e(safeUrl(route.source.url))}" target="_blank" rel="noopener noreferrer">${e(route.source.label)} ${icon('external')}</a>` : ''}
        </section>
        ${renderSummitBook(route.id, stateObj.summitEntries || {})}
      </div>
      <aside class="panel sidebar-card" aria-label="Přehled výletu">
        <div class="facts">
          ${fact('Délka', route.distanceKm == null ? null : `${number(route.distanceKm)} km`, 'route')}
          ${fact('Doba chůze', route.durationMinutes == null ? null : `${route.durationMinutes} min`, 'clock')}
          ${fact('Převýšení', route.elevationM == null ? null : `${number(route.elevationM)} m`, 'mountain')}
          ${fact('Obtížnost', { easy: 'Lehká dle zdroje', moderate: 'Střední', hard: 'Náročná', unknown: null }[route.access?.difficulty] ?? null, 'tree')}
        </div>
        <div class="access-box ${e(route.access?.stroller || 'unknown')}">
          ${icon('stroller')}
          <div>
            <strong>${e(accessLabel(route))}</strong>
            <span>${route.access?.stroller === 'yes' ? 'Údaj ze zdroje. Aktuální překážky se mohou změnit.' : route.access?.stroller === 'no' ? 'Počítej s omezeními uvedenými v popisu.' : 'Přístup s kočárkem zatím nemáme doložený.'}</span>
          </div>
        </div>
        <div class="stack-actions">
          ${safeUrl(route.mapUrl) ? `<a class="button primary" href="${e(safeUrl(route.mapUrl))}" target="_blank" rel="noopener noreferrer">${icon('route')}Otevřít v mapě ${icon('external')}</a>` : ''}
          <button type="button" class="button ${saved ? 'lime' : ''}" data-action="save" data-id="${e(id)}" aria-pressed="${saved}">${icon('heart')}${saved ? 'Uloženo na později' : 'Uložit na později'}</button>
          <button type="button" class="button ${visited ? 'lime' : ''}" data-action="visit" data-id="${e(id)}">${icon(visited ? 'check' : 'book')}${visited ? 'Zaznamenáno v mém pasu' : 'Byl/a jsem tady'}</button>
        </div>
        <p>${visited ? `Návštěva ${formatDate(visitFor(id).visitedAt)}. Jde o tvůj vlastní soukromý záznam.` : 'Tlačítko „Byl/a jsem tady“ slouží jako soukromá poznámka v tvém pasu (0 b.).'}</p>
        <div class="field-status">${icon('info')}<span>${route.fieldCheckedAt ? `Terénní kontrola: ${formatDate(route.fieldCheckedAt)}` : 'Terénní kontrola zatím neproběhla.'}</span></div>
      </aside>
    </div>
    <section id="hlaseni" class="report-section" aria-labelledby="reports-title">
      <div class="section-heading">
        <div>
          <h2 id="reports-title">Soukromý archiv starších záznamů</h2>
          <p id="reports-summary">Načítáme existující záznamy…</p>
        </div>
      </div>
      <div id="report-list" class="report-list"><p class="small-note" role="status">Hledáme existující záznamy…</p></div>
    </section>`;

  try {
    const reports = await state.repo.listReports(id);
    if (renderId !== state.renderId) return;
    renderReports(route, reports);
  } catch (error) {
    if (renderId !== state.renderId) return;
    document.querySelector('#reports-summary').textContent = 'Záznamy se nepodařilo načíst.';
    document.querySelector('#report-list').innerHTML = `<div class="notice error">${e(errorMessage(error))}<br><button type="button" class="button small" data-action="reload">Zkusit znovu</button></div>`;
  }
}

function renderReports(route, reports) {
  const publishedReports = reports.filter(report => report.status === 'published' || report.isOwn);
  const summary = summarizeReports(publishedReports, Date.now());
  const local = state.repo.mode === 'local';
  document.querySelector('#reports-summary').textContent = publishedReports.length
    ? `${publishedReports.length} starších záznamů v archivu prohlížeče.`
    : 'Žádné dřívější záznamy k tomuto místu v archivu nejsou.';

  const list = document.querySelector('#report-list');
  if (!publishedReports.length) {
    list.innerHTML = `<div class="report-empty">${icon('book')}<h3>Archiv záznamů je prázdný.</h3><p>V této verzi byla ukončena veřejná hlášení i nahrávání fotografií. Czekpoint funguje jako tvůj osobní atlas procházek.</p></div>`;
    return;
  }

  list.innerHTML = publishedReports.map(report => {
    const photo = report.photoUrl && /^(https?:|blob:)/.test(report.photoUrl) ? report.photoUrl : null;
    return `<article class="report-card">
      <div class="report-top">
        <span class="report-type ${e(report.kind)}">${icon(report.kind === 'clear' ? 'check' : report.kind === 'other' ? 'info' : 'warning')}${e(reportKinds[report.kind] || 'Záznam')}</span>
        ${report.isOwn ? `<button type="button" class="delete-report" data-action="delete-report" data-id="${e(report.id)}" data-route="${e(route.id)}" aria-label="Smazat starší záznam">${icon('trash')}</button>` : ''}
      </div>
      <div class="report-meta">${e(report.author || 'Návštěvník')} · návštěva ${formatDate(report.observedAt, true)}</div>
      ${report.note ? `<p class="report-note">${e(report.note)}</p>` : ''}
      ${photo ? `<img class="report-photo" src="${e(photo)}" alt="Archivní fotografie" loading="lazy">` : ''}
      <div class="report-flags">
        <span class="flag">Archivní záznam</span>
        ${local ? '<span class="flag">V tomto prohlížeči</span>' : ''}
      </div>
    </article>`;
  }).join('');
}

function renderPassport() {
  const visitedRoutes = state.routes.filter(route => visitFor(route.id));
  const savedRoutes = state.routes.filter(route => isSaved(route.id));
  const routes = state.passportTab === 'visited' ? visitedRoutes : savedRoutes;

  const stateObj = loadState();
  const currentAvatarId = stateObj.profile?.avatarId || 'liska';
  const totalPts = totalScore(stateObj);
  const rank = explorerRank(totalPts);
  const cStatus = chapterStatus(CHAPTERS, state.routes, stateObj.discoveries);
  const expeditions = stateObj.expeditionHistory || [];

  main.innerHTML = `
    <section class="passport-header">
      <div>
        <div class="eyebrow">${icon('book')} Tvoje výpravy a atlas</div>
        <h1 tabindex="-1">Můj výletový pas.</h1>
        <p>Sbírka navštívených míst, kapitol a relikvií z Rožmitálska.</p>
      </div>
      <div class="passport-stats">
        <div class="passport-stat"><strong>${visitedRoutes.length}</strong><span>navštívených míst</span></div>
        <div class="passport-stat"><strong>${stateObj.discoveries.length}</strong><span>GPS razítek</span></div>
      </div>
    </section>

    <section class="passport-section">
      <div class="section-heading">
        <div>
          <h2>Můj avatar</h2>
          <p>Uloženo v tomto zařízení</p>
        </div>
      </div>
      <div class="avatar-grid" role="radiogroup" aria-label="Výběr avatara">
        ${ALLOWED_AVATARS.map(a => {
          const isSelected = a.id === currentAvatarId;
          return `
            <button type="button" class="avatar-card ${isSelected ? 'selected' : ''}" data-action="select-avatar" data-avatar-id="${e(a.id)}" aria-pressed="${isSelected}">
              <img src="${avatarUrl(a.id)}" alt="${e(a.name)}" width="44" height="44">
              <span>${e(a.name)}</span>
              ${isSelected ? '<span class="avatar-check">✓ Vybráno</span>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    </section>

    <section class="passport-section" id="passport-stick-section">
      ${renderWalkingStickHtml(stateObj)}
    </section>

    <section class="passport-section" id="passport-pilgrims-section">
      ${renderPilgrimsSection(stateObj, state.position)}
    </section>

    <div class="passport-rank-card">
      <div>
        <div class="eyebrow" style="color:#d8e99e;margin-bottom:6px">Hodnost průzkumníka</div>
        <h2 style="color:#fff;margin:0 0 6px">Úroveň ${rank.level} · ${rank.title}</h2>
        <p style="margin:0;font-size:13px;opacity:.85">Dosah odkrývání mlhy: 65 m · Dosah odhalení: ${rank.revealDistanceM} m</p>
      </div>
      <div style="text-align:right">
        <strong>${totalPts} b.</strong>
        <span style="display:block;font-size:11px;opacity:.8">celkové skóre</span>
      </div>
    </div>

    <section class="passport-section">
      <div class="section-heading">
        <div>
          <h2>Moje pohlednice a kronika výprav</h2>
          <p>Ilustrované vzpomínky sestavené z tvých dokončených výprav.</p>
        </div>
      </div>
      ${expeditions.length ? `
        <div class="postcard-grid">
          ${expeditions.map(exp => {
            const dataUrl = generatePostcardDataUrl(exp);
            const dist = exp.distanceMeters >= 1000 ? (exp.distanceMeters / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(exp.distanceMeters) + ' m';
            return `
              <div class="postcard-card">
                <img src="${dataUrl}" alt="Pohlednice z výpravy" loading="lazy">
                <div class="postcard-card-stats">
                  <span>👣 ${dist}</span>
                  <span>🗺️ +${exp.newCellsCount} dílků</span>
                  <span>⭐ +${exp.newStampsCount} razítek</span>
                </div>
                <div class="postcard-actions">
                  <button type="button" class="button small primary" data-action="download-postcard" data-exp-id="${e(exp.id)}">Stáhnout pohlednici (PNG)</button>
                  <button type="button" class="button small" data-action="share-postcard" data-exp-id="${e(exp.id)}">Sdílet</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="empty-state" style="padding:24px 12px;text-align:center">
          <p class="small-note">Zatím nemáš žádnou pohlednici. Vydej se na procházku, ukonči výpravu a vytvoř svou první ilustrovanou vzpomínku!</p>
          <a class="button small" href="#/prochazka">Vyrazit s GPS na mapu</a>
        </div>
      `}
    </section>

    <section class="passport-section">
      <div class="section-heading">
        <div>
          <h2>Kapitoly Rožmitálska</h2>
          <p>Ověřené zastávky se započítávají po získání trvalého GPS razítka v terénu.</p>
        </div>
      </div>
      <div class="seals-grid">
        ${Object.values(cStatus).map(c => `
          <div class="seal-item ${c.unlocked ? 'unlocked' : ''}">
            <span class="seal-icon">${c.unlocked ? '🏆' : '📖'}</span>
            <strong>${e(c.sealTitle)}</strong>
            <span class="muted">${e(c.title)}</span>
            <small style="font-weight:700">${c.completed}/${c.total} ověřených zastávek</small>
            ${c.unlocked ? '<span style="color:#4a6828;font-weight:700">✓ Kapitola dokončena!</span>' : '<span class="muted">Získej chybějící zastávky</span>'}
          </div>
        `).join('')}
      </div>
    </section>

    <section class="passport-section">
      <div class="section-heading">
        <div>
          <h2>Tematické série zastávek</h2>
          <p>Navštiv a prozkoumej místa v tematických sériích Rožmitálska.</p>
        </div>
      </div>
      <div class="collections-grid">
        ${Object.values(COLLECTIONS).map(col => {
          const totalItems = col.routeIds.length;
          const doneItems = col.routeIds.filter(id => stateObj.discoveries.includes(id) || stateObj.discoveries.includes(`catalog:${id}`)).length;
          const isDone = totalItems > 0 && doneItems === totalItems;
          return `
            <div class="collection-item ${isDone ? 'completed' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:start">
                <strong>${e(col.title)}</strong>
                <span style="font-weight:700;color:${isDone ? '#4a6828' : '#73836d'}">${isDone ? '✓ Splněno' : `${doneItems}/${totalItems}`}</span>
              </div>
              <small>${doneItems}/${totalItems} GPS razítek</small>
              <ul class="bullet-list" style="margin:4px 0;font-size:11px">
                ${col.routeIds.map(id => {
                  const r = state.routes.find(x => x.id === id);
                  const hasStamp = stateObj.discoveries.includes(id) || stateObj.discoveries.includes(`catalog:${id}`);
                  return `<li>${hasStamp ? '✓' : '◇'} ${e(r?.title || id)}</li>`;
                }).join('')}
              </ul>
            </div>
          `;
        }).join('')}
      </div>
    </section>

    <section class="passport-section">
      <div class="section-heading">
        <div>
          <h2>Sběratelská vitrína rožmitálských relikvií</h2>
          <p>Relikvie se odemykají za každých 6 nově odkrytých dílků v mlze.</p>
        </div>
      </div>
      <div class="relics-grid">
        ${RELICS.map((relic, i) => {
          const isUnlocked = Math.floor(stateObj.cells.length / 6) > i;
          return `
            <div class="relic-item ${isUnlocked ? 'unlocked' : 'locked'}">
              <span style="font-size:24px">${isUnlocked ? '✨' : '❓'}</span>
              <strong>${isUnlocked ? e(relic.title) : 'Tajemná relikvie'}</strong>
              <p style="margin:0;font-size:11px;color:var(--muted)">${isUnlocked ? e(relic.lore) : `Odemkne se po ${(i + 1) * 6} odkrytých dílcích.`}</p>
            </div>
          `;
        }).join('')}
      </div>
    </section>

    <div class="passport-tabs" role="group" aria-label="Obsah pasu">
      <button class="chip ${state.passportTab === 'visited' ? 'active' : ''}" data-action="passport-tab" data-tab="visited" aria-pressed="${state.passportTab === 'visited'}">${icon('check')}Moje návštěvy</button>
      <button class="chip ${state.passportTab === 'saved' ? 'active' : ''}" data-action="passport-tab" data-tab="saved" aria-pressed="${state.passportTab === 'saved'}">${icon('heart')}Na později</button>
    </div>
    <div class="route-grid">${routes.length ? routes.map(route => renderCard(route, true)).join('') : `<div class="empty-state">${icon(state.passportTab === 'visited' ? 'book' : 'heart')}<h3>${state.passportTab === 'visited' ? 'První stránka zatím čeká.' : 'Kam vyrazíš příště?'}</h3><p>${state.passportTab === 'visited' ? 'Na detailu výletu klepni po návštěvě na „Byl/a jsem tady“. Tvoje sbírka začne prvním místem.' : 'Srdíčkem si ulož výlety, které tě zaujmou. Najdeš je tady, až bude chuť vyrazit.'}</p><a class="button primary" href="#/">Objevit výlety ${icon('arrow')}</a></div>`}</div>
    <aside class="info-strip">${icon('lock')}<div><strong>Tvůj pas zůstává v tomto prohlížeči.</strong><p>Návštěvy jsou tvoje vlastní záznamy. Vymazání dat prohlížeče smaže i pas.</p></div></aside>
  `;
}

function renderAbout() {
  main.innerHTML = `<div class="about-intro"><div class="eyebrow">${icon('leaf')}Osobní atlas procházek</div><h1 tabindex="-1">Dobrá cesta začíná<br>dobrou informací.</h1><p>Czekpoint je osobní atlas procházek: vyjdi ven, odkrývej své okolí, objev skutečné místo a odnes si ověřené GPS razítko a ilustrovanou pohlednici.</p></div>
    <div class="about-grid"><section class="panel">${icon('route')}<h2>Vyber. Podívej se. Vyraz.</h2><p>Na kartě najdeš známé údaje o cestě, její omezení a odkaz na původní zdroj. Navigaci otevřeš ve stávající mapové službě. Po návratu si místo můžeš uložit do pasu.</p></section>
    <section class="panel">${icon('shield')}<h2>Neznámé přiznáváme.</h2><p>Úvodní karty vycházejí z veřejných zdrojů. Terénní ověření probíhá postupně. Ilustrace nejsou fotografie skutečného stavu. Když chybí čas, převýšení nebo ověřená poloha, zobrazíme to.</p></section>
    <section class="panel">${icon('pin')}<h2>Jedno GPS razítko místa (+30 b.).</h2><p>Razítko získáš osobní návštěvou na 10–60 sekund u ověřeného místa. Začátky okruhů razítka neudělují.</p></section>
    <section class="panel">${icon('lock')}<h2>Tvoje data a soukromí</h2><p>Všechna data o tvé chůzi, odkrývání mlhy, profil i navštívená místa jsou uložena výhradně v tvém zařízení. Žádná poloha se neposílá na externí servery.</p></section></div>
    <div class="about-foot">
      <p class="small-note">Bez sledovacích reklam a bez analytických měřicích skriptů. Mapové podklady načítá OpenStreetMap; volitelné hledání míst odešle zaokrouhlenou oblast do Overpass API. Toto je verze v0.5.</p>
      <div class="data-actions">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button type="button" class="button small" data-action="export-state">${icon('arrow')}Exportovat průzkum (JSON)</button>
          <button type="button" class="button small" data-action="import-state">${icon('book')}Obnovit průzkum ze zálohy (JSON)</button>
          <input type="file" id="app-import-file" accept=".json,application/json" hidden>
        </div>
        <button type="button" class="button danger small" data-action="clear-local">${icon('trash')}Vymazat lokální data a resetovat průzkum</button>
        <p>Smaže výletový pas, uložená místa a veškerý herní průzkum v tomto prohlížeči.</p>
      </div>
    </div>`;
}

function renderNotFound() {
  main.innerHTML = `<div class="empty-state">${icon('pin')}<h1 tabindex="-1">Tuhle cestu zatím neznáme.</h1><p>Odkaz neodpovídá žádnému dostupnému výletu.</p><a class="button primary" href="#/">Zpět na výlety</a></div>`;
}

async function renderPage({ focus = false } = {}) {
  disposeWalk?.(); disposeWalk = null;
  main.classList.remove('page-enter');
  void main.offsetWidth;
  main.classList.add('page-enter');
  const renderId = ++state.renderId;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = parts[0] || '';
  state.view = view === 'prochazka' ? 'walk' : view === 'pas' ? 'passport' : view === 'o-projektu' ? 'about' : view === 'trasa' ? 'detail' : 'explore';
  document.title = 'Czekpoint — Začni cestu s přehledem';
  document.querySelectorAll('[data-nav]').forEach(link => { const active = link.dataset.nav === state.view || (state.view === 'detail' && link.dataset.nav === 'explore'); link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  document.querySelector('#passport-count').textContent = state.visits.length;
  if (view === 'trasa') {
    let id; try { id = decodeURIComponent(parts[1] || ''); } catch { id = ''; }
    await renderDetail(id, renderId);
  } else if (view === 'prochazka') {
    disposeWalk = mountWalk(main, state.routes, CONFIG, {
      onAddVisit: async (id) => {
        await state.repo.addVisit(id);
        await refreshPersonal();
      },
    });
  } else if (view === 'pas') renderPassport();
  else if (view === 'o-projektu') renderAbout();
  else if (view === '') renderExplore();
  else renderNotFound();
  if (focus && renderId === state.renderId) { window.scrollTo(0, 0); main.querySelector('h1')?.focus({ preventScroll: true }); }
}

async function refreshPersonal() {
  [state.saved, state.visits] = await Promise.all([state.repo.listSavedIds(), state.repo.listVisits()]);
  document.querySelector('#passport-count').textContent = state.visits.length;
}

function askConfirmation(title, text, confirmLabel = 'Potvrdit') {
  return new Promise(resolve => {
    confirmDialog.innerHTML = `<form method="dialog"><h2 id="confirm-title">${e(title)}</h2><p>${e(text)}</p><div class="confirm-actions"><button class="button" value="cancel" autofocus>Zrušit</button><button class="button danger" value="confirm">${e(confirmLabel)}</button></div></form>`;
    confirmDialog.returnValue = 'cancel';
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
    confirmDialog.showModal();
  });
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Tento prohlížeč neumí zjistit polohu.')); return; }
    navigator.geolocation.getCurrentPosition(position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }), error => reject(new Error(error.code === 1 ? 'Poloha nebyla povolena.' : error.code === 3 ? 'Zjištění polohy trvalo příliš dlouho.' : 'Polohu se nepodařilo zjistit.')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

document.addEventListener('click', async event => {
  const hammerBtn = event.target.closest('.hammer-badge-btn');
  if (hammerBtn) {
    const badgeId = hammerBtn.dataset.badgeId;
    const s = loadState();
    const badge = (s.stickBadges || []).find(b => b.id === badgeId);
    if (badge) {
      badge.pinned = true;
      hammerBtn.classList.add('hammering');
      playHammer(s.soundEnabled);
      triggerHaptic([40, 50, 40]);
      setTimeout(() => {
        saveState(s);
        renderPassport();
        toast('Plechový štítek byl přibit na tvoji hůl!');
      }, 320);
    }
    return;
  }

  const clinkBtn = event.target.closest('.clink-btn');
  if (clinkBtn) {
    const s = loadState();
    clinkBtn.classList.add('clinking');
    playHammer(s.soundEnabled);
    triggerHaptic(50);
    s.clinksCount = (Number(s.clinksCount) || 0) + 1;
    saveState(s);
    setTimeout(() => {
      renderPassport();
      toast('Cinknul jsi holí na pozdrav!');
    }, 300);
    return;
  }

  const pilgrimsToggleBtn = event.target.closest('#toggle-pilgrims-optin-btn');
  if (pilgrimsToggleBtn) {
    const s = loadState();
    s.pilgrimsOptIn = !s.pilgrimsOptIn;
    playTick(s.soundEnabled);
    saveState(s);
    renderPassport();
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button || !state.repo) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const route = state.routes.find(item => item.id === id);

  try {
    if (action === 'scroll-routes') { event.preventDefault(); document.querySelector('#vylety')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (action === 'filter-kind') {
      state.filters.kind = button.dataset.kind;
      document.querySelectorAll('[data-action="filter-kind"]').forEach(chip => {
        const active = chip.dataset.kind === state.filters.kind;
        chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
      });
      renderExploreResults(); return;
    }
    if (action === 'reset-filters') {
      state.filters = { search: '', kind: 'all', maxDistance: null, strollerOnly: false, savedOnly: false };
      renderExplore(); document.querySelector('#search-input')?.focus(); return;
    }
    if (action === 'passport-tab') { state.passportTab = button.dataset.tab; renderPassport(); return; }
    if (action === 'reload') { await renderPage(); return; }
    if (action === 'save' && route) {
      button.disabled = true; await state.repo.toggleSaved(id); await refreshPersonal();
      if (state.view === 'explore') renderExploreResults(); else if (state.view === 'passport') renderPassport(); else await renderPage();
      toast(isSaved(id) ? 'Výlet máš uložený na později.' : 'Výlet byl odebrán z uložených.'); return;
    }
    if (action === 'visit' && route) {
      const visited = Boolean(visitFor(id));
      if (visited && !await askConfirmation('Odebrat návštěvu z pasu?', `Místo „${route.title}“ zůstane mezi výlety. Odstraní se pouze tvůj soukromý záznam návštěvy.`, 'Odebrat návštěvu')) return;
      button.disabled = true;
      if (visited) {
        await state.repo.removeVisit(id);
      } else {
        await state.repo.addVisit(id);
      }
      await refreshPersonal(); await renderPage();
      toast(visited ? 'Návštěva byla odebrána.' : 'Místo bylo zaznamenáno v tvém výletovém pasu.');
      return;
    }
    if (action === 'locate') {
      button.disabled = true; toast('Prohlížeč může požádat o jednorázové povolení polohy.');
      state.position = await locate(); renderExploreResults(); toast('Výlety jsou seřazené podle vzdušné vzdálenosti.'); return;
    }
    if (action === 'share' && route) {
      const url = new URL(location.href); url.hash = `/trasa/${encodeURIComponent(id)}`;
      if (navigator.share) { try { await navigator.share({ title: `${route.title} · Czekpoint`, url: url.href }); } catch (error) { if (error.name !== 'AbortError') throw error; } }
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url.href); toast('Odkaz na místo je zkopírovaný.'); }
      else toast('Odkaz můžeš zkopírovat z adresního řádku prohlížeče.');
      return;
    }
    if (action === 'delete-report') {
      if (!await askConfirmation('Smazat tento archivní záznam?', 'Odstraní se archivní hlášení i případná přiložená fotografie. Tuto akci nelze vrátit.', 'Smazat záznam')) return;
      button.disabled = true; await state.repo.deleteReport(id); await renderPage(); toast('Archivní záznam byl smazán.'); return;
    }
    if (action === 'select-avatar') {
      const avatarId = button.dataset.avatarId;
      setProfileAvatar(avatarId);
      const chosen = ALLOWED_AVATARS.find(a => a.id === avatarId);
      toast(`Avatar změněn: ${chosen ? chosen.name : avatarId}. Uloženo v tomto zařízení.`);
      renderPassport();
      return;
    }
    if (action === 'download-postcard') {
      const expId = button.dataset.expId;
      const stateObj = loadState();
      const exp = (stateObj.expeditionHistory || []).find(x => x.id === expId);
      if (exp) {
        const dataUrl = generatePostcardDataUrl(exp);
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `pohlednice-${exp.id}.png`;
        a.click();
      }
      return;
    }
    if (action === 'share-postcard') {
      const expId = button.dataset.expId;
      const stateObj = loadState();
      const exp = (stateObj.expeditionHistory || []).find(x => x.id === expId);
      if (exp) {
        try {
          const blob = await generatePostcardBlob(exp);
          const file = new File([blob], `pohlednice-${exp.id}.png`, { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: 'Moje malá výprava · Czekpoint',
              text: `Pohlednice z mé výpravy s Czekpointem.`,
              files: [file],
            });
          } else if (navigator.share) {
            await navigator.share({
              title: 'Moje malá výprava · Czekpoint',
              text: `Pohlednice z mé výpravy s Czekpointem.`,
            });
          } else {
            const dataUrl = generatePostcardDataUrl(exp);
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `pohlednice-${exp.id}.png`;
            a.click();
          }
        } catch (err) {
          if (err.name !== 'AbortError') toast('Sdílení se nezdařilo.', true);
        }
      }
      return;
    }
    if (action === 'export-state') {
      const jsonStr = exportStateJson();
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(new Blob([jsonStr], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `czekpoint-pruzkum-${today}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Záloha průzkumu byla exportována.');
      return;
    }
    if (action === 'import-state') {
      document.querySelector('#app-import-file')?.click();
      return;
    }
    if (action === 'clear-local') {
      if (!await askConfirmation('Vymazat lokální data a resetovat průzkum?', 'Z tohoto prohlížeče se smaže výletový pas, uložená místa a veškerý herní průzkum s body a odkrytou mapou.', 'Vymazat data')) return;
      button.disabled = true;
      await state.repo.clearLocalData();
      clearState();
      try { localStorage.removeItem('czekpoint.author'); } catch {}
      await refreshPersonal(); await renderPage(); toast('Lokální data včetně průzkumu byla vymazána.');
    }
  } catch (error) { toast(errorMessage(error), true); } finally { if (button.isConnected) button.disabled = false; }
});

document.addEventListener('change', async event => {
  if (event.target.id === 'app-import-file') {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const preview = previewImportState(text);
      const confirmed = await askConfirmation(
        'Obnovit průzkum ze zálohy?',
        `Záloha obsahuje: Avatar ${preview.avatarId}, ${preview.cellsCount} dílků, ${preview.metersKm} km, ${preview.stampsCount} razítek a ${preview.historyCount} výprav. Současný postup v tomto prohlížeči bude nahrazen.`,
        'Obnovit zálohu'
      );
      if (confirmed) {
        importStateJson(text);
        await refreshPersonal();
        await renderPage();
        toast('Průzkum byl úspěšně obnoven ze zálohy.');
      }
    } catch (err) {
      toast('Chyba při obnově zálohy: ' + err.message, true);
    } finally {
      event.target.value = '';
    }
  }
});

window.addEventListener('hashchange', () => { if (reportDialog.open) reportDialog.close(); renderPage({ focus: true }).catch(error => toast(errorMessage(error), true)); });
window.addEventListener('pageshow', event => { if (event.persisted && state.repo) refreshPersonal().then(() => renderPage()).catch(error => toast(errorMessage(error), true)); });

async function boot() {
  try {
    state.repo = await createRepository(CONFIG);
    await state.repo.init();
    state.routes = await state.repo.listRoutes();
    await refreshPersonal();
    const banner = document.querySelector('#mode-banner');
    if (state.repo.mode === 'local') { banner.hidden = false; banner.innerHTML = 'Lokální režim · Tvůj pas a průzkum zůstávají v tomto zařízení. <a href="#/o-projektu">O projektu</a>'; }
    await renderPage();
  } catch (error) {
    main.innerHTML = `<div class="empty-state">${icon('warning')}<h1>Data se nepodařilo připravit.</h1><p>${e(errorMessage(error))}</p><p>Zkontroluj připojení k internetu a obnov stránku.</p><button type="button" class="button primary" id="retry-boot">Zkusit znovu</button></div>`;
    document.querySelector('#retry-boot').addEventListener('click', () => location.reload());
  }
}
boot();
