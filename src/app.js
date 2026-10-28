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
  DEFAULT_APP_SETTINGS,
} from './walk-store.js';
import { ALLOWED_AVATARS, avatarUrl } from './avatars.js';
import { generatePostcardDataUrl, generatePostcardBlob } from './postcard.js';
import { explorerRank, chapterStatus, totalScore, trophies } from './walk-engine.js';
import { CHAPTERS, COLLECTIONS, RELICS } from './data.js';
import { renderWalkingStickHtml } from './walking-stick.js';
import { renderPilgrimsSection, renderSummitBook } from './pilgrims.js';
import { playTick, playHammer, triggerHaptic, applyStaggerAnimation } from './fx.js';
import { renderBrandLogoHtml, mountBrandLogo, mountAnimatedBrandLogo, mountAmbientBackground } from './brand-logo.js';
import { getCachedPlacePhoto, resolveVerifiedPlacePhoto, prefetchVerifiedPhotosForPlaces } from './poi-photos.js';

let disposeWalk = null;
let disposeBrandLogo = null;

function cleanupBrandLogo() {
  if (typeof disposeBrandLogo === 'function') {
    try { disposeBrandLogo(); } catch {}
  } else if (typeof disposeBrandLogo?.dispose === 'function') {
    try { disposeBrandLogo.dispose(); } catch {}
  }
  disposeBrandLogo = null;
}

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
  filters: { search: '', kind: 'all', itemType: 'all', maxDistance: null, strollerOnly: false, savedOnly: false },
  catalogScrollY: 0,
  returningFromDetail: false,
  passportSection: 'stick',
  passportTab: 'visited',
  renderId: 0,
  toastTimer: null,
};

const kinds = { forest: 'Příroda a les', view: 'Vyhlídka', culture: 'Památka a historie', water: 'U vody' };
const kindIcons = { forest: 'tree', view: 'mountain', culture: 'castle', water: 'water' };
const reportKinds = { clear: 'Bez viditelných potíží', mud: 'Bláto / mokrý povrch', obstacle: 'Překážka na cestě', closure: 'Omezený přístup', other: 'Jiná zkušenost' };
const illustrations = new Set(['forest', 'castle', 'lake']);
const illustrationUrl = route => `./assets/${illustrations.has(route.illustration) ? route.illustration : 'forest'}.svg`;
const routeLink = route => `#/trasa/${encodeURIComponent(route.id)}`;
const isSaved = id => state.saved.includes(id);
const visitFor = id => state.visits.find(visit => visit.routeId === id);
const errorMessage = error => error?.message || 'Operace se nepodařila. Zkus to prosím znovu.';

function isActualRouteItem(route) {
  return Boolean(route && (route.pointKind === 'route-start' || route.distanceKm != null));
}

function isInCurrentWalkPlan(id, stateObj = null) {
  const s = stateObj || loadState();
  const ids = s?.plannedRoute?.selectedPlaceIds;
  return Array.isArray(ids) && ids.includes(id);
}

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
  const inWalkPlan = isInCurrentWalkPlan(route.id, stateObj);
  const isRoute = isActualRouteItem(route);
  const typeBadge = isRoute
    ? `🥾 Trasa (${route.distanceKm != null ? `${number(route.distanceKm)} km` : 'okruh'})`
    : '📍 Samostatné místo';
  const hasStamp = stateObj.discoveries?.includes(route.id) || stateObj.discoveries?.includes(`catalog:${route.id}`);
  const stampBadge = hasStamp ? '📍 Potvrzeno podle GPS' : '';
  const extPhotosOn = stateObj.appSettings?.showExternalPhotos !== false;
  const cachedPhoto = extPhotosOn ? getCachedPlacePhoto(route) : null;
  const fallbackBitmap = illustrationUrl(route);
  const cardImgSrc = (cachedPhoto && cachedPhoto.photoUrl) ? cachedPhoto.photoUrl : fallbackBitmap;
  const photoLicenseTag = (cachedPhoto && cachedPhoto.photoUrl)
    ? `📸 Fotka · Wikimedia Commons (${cachedPhoto.license || 'CC BY-SA'})`
    : (isRoute ? '🥾 Trasa / okruh' : '🎨 Vektorová ilustrace kategorie');

  return `<article class="route-card" data-route-card="${e(route.id)}">
    <div class="card-image"><a href="${routeLink(route)}" data-catalog-link="true" tabindex="-1" aria-hidden="true"><img src="${e(cardImgSrc)}" alt="" width="600" height="340" loading="lazy" onerror="this.onerror=null;this.src='${e(fallbackBitmap)}';"></a>
      <span class="image-label">${e(photoLicenseTag)}</span>
      <button class="save-button ${saved ? 'saved' : ''}" type="button" data-action="save" data-id="${e(route.id)}" aria-pressed="${saved}" title="${saved ? 'Odebrat z oblíbených na později' : 'Uložit do oblíbených na později'}" aria-label="${saved ? 'Odebrat z oblíbených na později' : 'Uložit do oblíbených na později'}: ${e(route.title)}">${icon('heart')}</button>
    </div>
    <div class="card-content">
      <div class="card-kicker"><span class="item-type-badge ${isRoute ? 'route' : 'place'}">${e(typeBadge)}</span> · ${e(route.region)} · ${e(kinds[route.kind] || 'Místo')} ${stampBadge ? `· <strong>${stampBadge}</strong>` : ''}</div>
      <h3><a href="${routeLink(route)}" data-catalog-link="true">${e(route.title)}</a></h3>
      <p class="card-description">${e(route.subtitle)}</p>
      <div class="card-stats">
        <span>${icon(isRoute ? 'route' : 'pin')}${isRoute && route.distanceKm != null ? `Trasa ${number(route.distanceKm)} km` : 'Samostatný bod (zastávka)'}</span>
        <span>${icon(kindIcons[route.kind] || 'pin')}${e({ easy: 'Lehký přístup dle zdroje', moderate: 'Náročnější úseky', hard: 'Náročný terén', unknown: 'Náročnost neověřena' }[route.access?.difficulty] || 'Náročnost neověřena')}</span>
      </div>
      <div class="card-bottom" style="flex-wrap:wrap;gap:8px">
        <span class="access-tag ${e(route.access?.stroller || 'unknown')}">${icon('stroller')}${e(accessLabel(route))}</span>
        <div style="display:flex;gap:6px;align-items:center;margin-left:auto">
          <button type="button" class="button small ${inWalkPlan ? 'ghost' : 'lime'}" data-action="add-to-walk" data-id="${e(route.id)}" aria-pressed="${inWalkPlan}" title="${inWalkPlan ? 'Odebrat toto místo z dnešního plánu procházky' : 'Zařadit toto místo mezi zastávky dnešní procházky'}">
            ${inWalkPlan ? '✓ V dnešní výpravě' : '+ Přidat do výpravy'}
          </button>
          <a class="round-link" href="${routeLink(route)}" data-catalog-link="true" aria-label="Detail ${isRoute ? 'trasy' : 'místa'} ${e(route.title)}">${icon('arrow')}</a>
        </div>
      </div>
      ${passport && visit ? `<div class="visit-date">${icon('check')}Soukromá poznámka o návštěvě · ${formatDate(visit.visitedAt)}</div>` : `<div class="card-verification">${saved ? '♥ Uloženo v oblíbených na později · ' : ''}Z veřejných zdrojů</div>`}
      ${distanceTo(route) ? `<div class="card-verification">${e(distanceTo(route))} od tebe</div>` : ''}
    </div>
  </article>`;
}

function renderExplore() {
  const totalPlaces = state.routes.filter(r => !isActualRouteItem(r)).length;
  const totalRoutes = state.routes.filter(r => isActualRouteItem(r)).length;
  main.innerHTML = `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy"><div class="eyebrow">${icon('leaf')} Začni kousek od domova</div>
      <h1 id="hero-title" tabindex="-1">Ven s dobrým<br><em>přehledem.</em></h1>
      <p>Katalog obsahuje <strong>${totalPlaces} samostatných míst</strong> (hrady, vyhlídky, muzea, rybníky) a <strong>${totalRoutes} připravené trasy</strong>. Místo si můžeš uložit srdíčkem do oblíbených na později, nebo ho tlačítkem <strong>+ Přidat do výpravy</strong> rovnou zařadit do dnešní procházky.</p>
      <div class="hero-actions"><a class="button primary" href="#/prochazka">Začít procházku s mapou ${icon('arrow')}</a><a class="button ghost" href="#vylety" data-action="scroll-routes">Prohlédnout katalog míst a tras</a></div>
      <div class="trust-line"><span>${icon('check')}Bez registrace</span><span>${icon('book')}Osobní atlas bez reklam</span></div>
    </div>
    <div class="hero-art">${renderBrandLogoHtml({ id: 'hero-brand-logo' })}</div>
    </section>
    <section id="vylety" class="explore-section" aria-labelledby="routes-heading">
      <div class="section-heading"><div><h2 id="routes-heading">Katalog míst a tras</h2><p>Rozlišujeme jednotlivá místa (zastávky) a vycházkové trasy (okruhy).</p></div><span class="subtle muted">Rožmitálsko a okolí · ${state.routes.length} položek</span></div>
      <div class="filter-panel"><div class="filter-top"><label class="search-field">${icon('search')}<span class="sr-only">Hledat místo nebo trasu</span><input id="search-input" type="search" placeholder="Hledat místo, památku nebo trasu…" maxlength="100" value="${e(state.filters.search)}"></label>
      <label><span class="sr-only">Typ položky</span><select id="type-filter" class="filter-select"><option value="all">Vše: místa i trasy</option><option value="place">📍 Jen samostatná místa</option><option value="route">🥾 Jen trasy (okruhy)</option></select></label>
      <label><span class="sr-only">Maximální délka trasy</span><select id="distance-filter" class="filter-select"><option value="">Libovolná délka</option><option value="3">Trasy do 3 km</option><option value="5">Trasy do 5 km</option><option value="10">Trasy do 10 km</option></select></label>
      <label class="check-filter"><input id="stroller-filter" type="checkbox" ${state.filters.strollerOnly ? 'checked' : ''}> S kočárkem dle zdroje</label>
      <label class="check-filter"><input id="saved-filter" type="checkbox" ${state.filters.savedOnly ? 'checked' : ''}> ♥ Jen oblíbené (na později)</label></div>
      <div class="filter-chips" role="group" aria-label="Kategorie míst a tras">${[['all', 'Všechny kategorie', 'globe'], ['forest', 'Příroda a les', 'tree'], ['water', 'U vody', 'water'], ['culture', 'Památky a historie', 'castle'], ['view', 'Vyhlídky a vrcholy', 'mountain']].map(([id, label, ic]) => `<button class="chip ${state.filters.kind === id ? 'active' : ''}" type="button" data-action="filter-kind" data-kind="${id}" aria-pressed="${state.filters.kind === id}">${icon(ic)}${label}</button>`).join('')}</div></div>
      <p id="results-info" class="results-info" role="status" aria-live="polite"></p><div id="route-grid" class="route-grid"></div>
      <aside class="info-strip">${icon('info')}<div><strong>Dobrá informace má svůj zdroj.</strong><p>Karty vycházejí z uvedených veřejných zdrojů. Terénní kontrola probíhá postupně.</p></div></aside>
    </section>`;
  document.querySelector('#type-filter').value = state.filters.itemType || 'all';
  document.querySelector('#distance-filter').value = state.filters.maxDistance || '';
  document.querySelector('#search-input').addEventListener('input', event => { state.filters.search = event.target.value; renderExploreResults(); });
  document.querySelector('#type-filter').addEventListener('change', event => { state.filters.itemType = event.target.value || 'all'; renderExploreResults(); });
  document.querySelector('#distance-filter').addEventListener('change', event => { state.filters.maxDistance = event.target.value ? Number(event.target.value) : null; renderExploreResults(); });
  document.querySelector('#stroller-filter').addEventListener('change', event => { state.filters.strollerOnly = event.target.checked; renderExploreResults(); });
  document.querySelector('#saved-filter').addEventListener('change', event => { state.filters.savedOnly = event.target.checked; renderExploreResults(); });
  renderExploreResults();
  cleanupBrandLogo();
  disposeBrandLogo = mountBrandLogo('#hero-brand-logo');
}

function renderExploreResults() {
  const grid = document.querySelector('#route-grid');
  if (!grid) return;
  let routes = filterRoutes(state.routes, { ...state.filters, savedIds: state.saved });
  if (state.filters.itemType === 'place') {
    routes = routes.filter(r => !isActualRouteItem(r));
  } else if (state.filters.itemType === 'route') {
    routes = routes.filter(r => isActualRouteItem(r));
  }
  if (state.position) routes = [...routes].sort((a, b) => (a.location ? haversineMeters(state.position, a.location) : Infinity) - (b.location ? haversineMeters(state.position, b.location) : Infinity));
  const placesCount = routes.filter(r => !isActualRouteItem(r)).length;
  const routesCount = routes.filter(r => isActualRouteItem(r)).length;
  document.querySelector('#results-info').textContent = `Zobrazeno ${routes.length} z ${state.routes.length} položek (${placesCount} samostatných míst, ${routesCount} tras)${state.position ? ' · seřazeno podle vzdušné vzdálenosti' : ''}${state.filters.maxDistance ? ' · samostatná místa bez délky trasy jsou skrytá' : ''}`;
  grid.innerHTML = routes.length ? routes.map(route => renderCard(route)).join('') : `<div class="empty-state">${icon('search')}<h3>Tady je zatím ticho.</h3><p>Tomuto výběru žádné místo ani trasa neodpovídá. Zkus méně filtrů nebo jiné hledání.</p><button type="button" class="button" data-action="reset-filters">Zobrazit všechna místa a trasy</button></div>`;
  prefetchVerifiedPhotosForPlaces(routes.slice(0, 12), {
    maxCount: 12,
    onPlaceResolved: (resolvedRoute, photoRes) => {
      const cardEl = document.querySelector(`[data-route-card="${CSS.escape(resolvedRoute.id)}"]`);
      if (!cardEl) return;
      const img = cardEl.querySelector('.card-image img');
      const lbl = cardEl.querySelector('.card-image .image-label');
      if (img && photoRes.photoUrl) img.src = photoRes.photoUrl;
      if (lbl && photoRes.license) lbl.textContent = `📸 Ověřená fotka (${photoRes.license})`;
    },
  });
}

function fact(label, value, ic) { return `<div class="fact"><span>${icon(ic)}${label}</span><strong class="${value == null ? 'unknown' : ''}">${value == null ? 'Zatím nezjištěno' : e(value)}</strong></div>`; }

async function renderDetail(id, renderId) {
  const route = state.routes.find(item => item.id === id);
  if (!route) { renderNotFound(); return; }
  const saved = isSaved(id);
  const visited = Boolean(visitFor(id));
  const stateObj = loadState();
  const inWalkPlan = isInCurrentWalkPlan(id, stateObj);
  const isRoute = isActualRouteItem(route);
  const hasStamp = stateObj.discoveries?.includes(id) || stateObj.discoveries?.includes(`catalog:${id}`);

  const stampBadgeHtml = hasStamp
    ? '<span class="detail-trophy-badge" style="background:#eef5ce;border:1px solid #afbf68;color:#345032;">📍 Potvrzeno podle GPS (opakované vzorky v dosahu ≤ 20 m)</span>'
    : !isRoute && route.collectible !== false
    ? '<span class="detail-trophy-badge none">📍 Samostatné místo · Potvrzení podle GPS vyžaduje opakované vzorky pod 20 m</span>'
    : '<span class="detail-trophy-badge none">🥾 Vycházková trasa / okruh</span>';

  const extPhotosOn = stateObj.appSettings?.showExternalPhotos !== false;
  const cachedPhoto = extPhotosOn ? getCachedPlacePhoto(route) : null;
  const fallbackBitmap = illustrationUrl(route);
  const coverSrc = (cachedPhoto && cachedPhoto.photoUrl) ? cachedPhoto.photoUrl : fallbackBitmap;
  const coverLabel = (cachedPhoto && cachedPhoto.photoUrl)
    ? `📸 Fotka · Wikimedia Commons (${cachedPhoto.license || 'CC BY-SA'})`
    : (isRoute ? '🥾 Trasa / okruh' : '🎨 Vektorová ilustrace kategorie');

  document.title = `${route.title} · Czekpoint`;
  main.innerHTML = `<a class="back-link" href="#/katalog" data-action="back-to-catalog">${icon('back')}Zpět do katalogu míst a tras</a>
    <div class="detail-header">
      <div>
        <div class="eyebrow">${icon(kindIcons[route.kind] || 'pin')}${e(route.region)} · ${isRoute ? '🥾 Trasa / okruh' : '📍 Samostatné místo'} · ${e(kinds[route.kind] || 'Místo')}</div>
        <h1 tabindex="-1">${e(route.title)}</h1>
        <p>${e(route.subtitle)}</p>
        <div style="margin-top:10px">${stampBadgeHtml}</div>
      </div>
      <button type="button" class="button" data-action="share" data-id="${e(id)}">${icon('share')}Sdílet odkaz</button>
    </div>
    <div class="detail-grid">
      <div class="detail-main">
        <div class="detail-cover"><img id="detail-cover-img" src="${e(coverSrc)}" width="600" height="340" alt="Fotografie nebo ilustrace místa" onerror="this.onerror=null;this.src='${e(fallbackBitmap)}';"><span class="image-label" id="detail-cover-label">${e(coverLabel)}</span></div>
        <section class="panel">
          <h2>O ${isRoute ? 'trase' : 'místě'}</h2>
          <p>${e(route.summary)}</p>
          <h3>Výchozí bod / umístění</h3>
          <p>${e(route.startLabel || 'Výchozí bod ověř v přiloženém zdroji.')}</p>
          <h3>Povrch a přístup</h3>
          <p>${e(route.access?.surface || 'Povrch zatím není ověřen.')}</p>
          ${route.obstacles?.length ? `<h3>Na co myslet předem</h3><ul class="bullet-list">${route.obstacles.map(item => `<li>${e(item)}</li>`).join('')}</ul>` : ''}
          ${route.highlights?.length ? `<h3>Zajímavosti</h3><ul class="bullet-list">${route.highlights.map(item => `<li>${e(item)}</li>`).join('')}</ul>` : ''}
        </section>
        <section class="panel">
          <h2>Odkud informace máme</h2>
          <p>Údaje z veřejného zdroje jsme zpracovali ${formatDate(route.source?.checkedAt)}. Toto datum není terénní kontrola ani potvrzení aktuálního stavu.</p>
          ${safeUrl(route.source?.url) ? `<a class="source-link" href="${e(safeUrl(route.source.url))}" target="_blank" rel="noopener noreferrer">${e(route.source.label)} ${icon('external')}</a>` : ''}
        </section>
        ${renderSummitBook(route.id, stateObj.summitEntries || {})}
      </div>
      <aside class="panel sidebar-card" aria-label="Přehled a akce">
        <div class="facts">
          ${fact('Typ položky', isRoute ? 'Trasa (okruh)' : 'Samostatné místo', isRoute ? 'route' : 'pin')}
          ${fact('Délka trasy', isRoute && route.distanceKm != null ? `${number(route.distanceKm)} km` : isRoute ? null : 'Samostatný bod', 'route')}
          ${fact('Převýšení', route.elevationM == null ? 'Neověřeno' : `${number(route.elevationM)} m`, 'mountain')}
          ${fact('Obtížnost', { easy: 'Lehká dle zdroje', moderate: 'Střední', hard: 'Náročná', unknown: 'Neověřeno' }[route.access?.difficulty] ?? 'Neověřeno', 'tree')}
        </div>
        <div class="access-box ${e(route.access?.stroller || 'unknown')}">
          ${icon('stroller')}
          <div>
            <strong>${e(accessLabel(route))}</strong>
            <span>${route.access?.stroller === 'yes' ? 'Údaj ze zdroje. Aktuální překážky se mohou změnit.' : route.access?.stroller === 'no' ? 'Počítej s omezeními uvedenými v popisu.' : 'Přístup s kočárkem zatím nemáme doložený.'}</span>
          </div>
        </div>
        <div class="stack-actions">
          <button type="button" class="button ${inWalkPlan ? 'ghost' : 'primary'}" data-action="add-to-walk" data-id="${e(id)}" aria-pressed="${inWalkPlan}">
            ${icon('route')}${inWalkPlan ? '✓ Zařazeno v dnešní výpravě (odebrat)' : '+ Přidat jako zastávku do výpravy'}
          </button>
          <button type="button" class="button ${saved ? 'lime' : ''}" data-action="save" data-id="${e(id)}" aria-pressed="${saved}">
            ${icon('heart')}${saved ? '♥ V oblíbených na později' : '♡ Uložit do oblíbených na později'}
          </button>
          <button type="button" class="button ${visited ? 'lime' : ''}" data-action="visit" data-id="${e(id)}">
            ${icon(visited ? 'check' : 'book')}${visited ? '✓ Soukromá poznámka: Byl/a jsem tady' : 'Poznamenat návštěvu do deníku'}
          </button>
          ${safeUrl(route.mapUrl) ? `<a class="button" href="${e(safeUrl(route.mapUrl))}" target="_blank" rel="noopener noreferrer">${icon('external')}Ukázat na externí mapě</a>` : ''}
        </div>
        <p>${visited ? `Návštěva zapsána ${formatDate(visitFor(id).visitedAt)} v tvém soukromém deníku.` : '„Přidat do výpravy“ zařadí bod mezi zastávky dnešní trasy na mapě. „Uložit do oblíbených“ si položku schová na později.'}</p>
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

  if (extPhotosOn && !cachedPhoto) {
    resolveVerifiedPlacePhoto(route).then(res => {
      if (renderId !== state.renderId) return;
      if (res && res.hasVerifiedPhoto && res.photoUrl && loadState().appSettings?.showExternalPhotos !== false) {
        const imgEl = document.querySelector('#detail-cover-img');
        const lblEl = document.querySelector('#detail-cover-label');
        if (imgEl) imgEl.src = res.photoUrl;
        if (lblEl) lblEl.textContent = `📸 Fotka · Wikimedia Commons (${res.license || 'CC BY-SA'})`;
      }
    }).catch(() => {});
  }

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
  state.passportSection = state.passportSection || 'stick';
  const visitedRoutes = state.routes.filter(route => visitFor(route.id));
  const savedRoutes = state.routes.filter(route => isSaved(route.id));
  const routes = state.passportTab === 'visited' ? visitedRoutes : savedRoutes;

  const stateObj = loadState();
  const currentAvatarId = stateObj.profile?.avatarId || 'liska';
  const totalPts = totalScore(stateObj);
  const rank = explorerRank(totalPts);
  const cStatus = chapterStatus(CHAPTERS, state.routes, stateObj.discoveries);
  const expeditions = stateObj.expeditionHistory || [];

  let sectionContent = '';

  if (state.passportSection === 'stick') {
    // Tab 1: 🦯 Moje hůl a profil
    sectionContent = `
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
            <h2>Můj avatar (12 živých poutníků)</h2>
            <p>Vyber si svého avatara pro výpravy a zápisy na vrcholech</p>
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
    `;
  } else if (state.passportSection === 'postcards') {
    // Tab 2: 🖼️ Pohlednice a deník
    sectionContent = `
      <section class="passport-section">
        <div class="section-heading">
          <div>
            <h2>Moje pohlednice z dokončených výprav</h2>
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
                  <img src="${dataUrl}" alt="Pohlednice z výpravy" loading="lazy" data-action="preview-postcard" data-exp-id="${e(exp.id)}" style="cursor:pointer" title="Klikni pro zvětšení pohlednice">
                  <div class="postcard-card-stats">
                    <span>👣 ${dist}</span>
                    <span>🗺️ +${exp.newCellsCount} dílků</span>
                    <span>⭐ +${exp.newStampsCount} razítek</span>
                  </div>
                  <div class="postcard-actions">
                    <button type="button" class="button small ghost" data-action="preview-postcard" data-exp-id="${e(exp.id)}">🔍 Zvětšit</button>
                    <button type="button" class="button small primary" data-action="download-postcard" data-exp-id="${e(exp.id)}">Stáhnout pohlednici (PNG)</button>
                    <button type="button" class="button small" data-action="share-postcard" data-exp-id="${e(exp.id)}">Sdílet</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <div id="passport-postcard-modal-slot"></div>
        ` : `
          <div class="empty-state" style="padding:24px 12px;text-align:center">
            <p class="small-note">Zatím nemáš žádnou pohlednici. Vydej se na procházku, ukonči výpravu a vytvoř svou první ilustrovanou vzpomínku!</p>
            <a class="button small" href="#/prochazka">Vyrazit na procházku s GPS</a>
          </div>
        `}
      </section>

      <section class="passport-section">
        <div class="section-heading">
          <div>
            <h2>Můj osobní výletový deník</h2>
            <p>Zaznamenané návštěvy a uložené výlety na později.</p>
          </div>
        </div>
        <div class="passport-tabs" role="group" aria-label="Obsah deníku">
          <button class="chip ${state.passportTab === 'visited' ? 'active' : ''}" data-action="passport-tab" data-tab="visited" aria-pressed="${state.passportTab === 'visited'}">${icon('check')}Moje návštěvy (${visitedRoutes.length})</button>
          <button class="chip ${state.passportTab === 'saved' ? 'active' : ''}" data-action="passport-tab" data-tab="saved" aria-pressed="${state.passportTab === 'saved'}">${icon('heart')}Na později (${savedRoutes.length})</button>
        </div>
        <div class="route-grid">${routes.length ? routes.map(route => renderCard(route, true)).join('') : `<div class="empty-state">${icon(state.passportTab === 'visited' ? 'book' : 'heart')}<h3>${state.passportTab === 'visited' ? 'První stránka zatím čeká.' : 'Kam vyrazíš příště?'}</h3><p>${state.passportTab === 'visited' ? 'Na detailu výletu klepni po návštěvě na „Byl/a jsem tady“. Tvoje sbírka začne prvním místem.' : 'Srdíčkem si ulož výlety, které tě zaujmou. Najdeš je tady, až bude chuť vyrazit.'}</p><a class="button primary" href="#/katalog">Katalog výletů ${icon('arrow')}</a></div>`}</div>
      </section>
    `;
  } else {
    // Tab 3: 🏆 Sbírka a kapitoly
    const earnedTrophies = trophies({ version: 1, cells: stateObj.cells, meters: stateObj.meters, discoveries: stateObj.discoveries });
    sectionContent = `
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

      <section class="passport-section">
        <div class="section-heading">
          <div>
            <h2>Získané trofeje</h2>
            <p>Odměny za vytrvalost a objevování neznámých zákoutí.</p>
          </div>
        </div>
        <div class="trophy-grid">
          ${earnedTrophies.map(t => `
            <div class="trophy ${t.earned ? 'earned' : ''}">
              <span>${t.earned ? '✦' : '◇'}</span>
              <strong>${e(t.title)}</strong>
              <small>${t.earned ? 'Získáno' : e(t.goal)}</small>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  main.innerHTML = `
    <section class="passport-header">
      <div>
        <div class="eyebrow">${icon('book')} Tvoje výpravy a atlas</div>
        <h1 tabindex="-1">Můj výletový pas.</h1>
        <p>Sbírka navštívených míst, kapitol a relikvií z Rožmitálska.</p>
      </div>
      <div class="passport-brand-banner">${renderBrandLogoHtml({ id: 'passport-brand-logo', className: 'logo-stage passport-banner-logo' })}</div>
      <div class="passport-stats">
        <div class="passport-stat"><strong>${visitedRoutes.length}</strong><span>navštívených míst</span></div>
        <div class="passport-stat"><strong>${stateObj.discoveries.length}</strong><span>GPS razítek</span></div>
      </div>
    </section>

    <!-- 3 Big Clean Passport Tabs -->
    <div class="passport-section-tabs" role="tablist" aria-label="Sekce pasu">
      <button type="button" class="passport-section-tab ${state.passportSection === 'stick' ? 'active' : ''}" data-action="passport-section" data-section="stick" role="tab" aria-selected="${state.passportSection === 'stick'}">
        🦯 Moje hůl a profil
      </button>
      <button type="button" class="passport-section-tab ${state.passportSection === 'postcards' ? 'active' : ''}" data-action="passport-section" data-section="postcards" role="tab" aria-selected="${state.passportSection === 'postcards'}">
        🖼️ Pohlednice a deník
      </button>
      <button type="button" class="passport-section-tab ${state.passportSection === 'collections' ? 'active' : ''}" data-action="passport-section" data-section="collections" role="tab" aria-selected="${state.passportSection === 'collections'}">
        🏆 Sbírka a kapitoly
      </button>
    </div>

    ${sectionContent}

    <aside class="info-strip" style="margin-top:24px">${icon('lock')}<div><strong>Tvůj pas zůstává v tomto prohlížeči.</strong><p>Návštěvy jsou tvoje vlastní záznamy. Vymazání dat prohlížeče smaže i pas.</p></div></aside>
  `;

  // Apply stagger animations to visible grids
  applyStaggerAnimation('.avatar-grid', '.avatar-card');
  applyStaggerAnimation('.postcard-grid', '.postcard-card');
  applyStaggerAnimation('.seals-grid', '.seal-item');
  applyStaggerAnimation('.collections-grid', '.collection-item');
  applyStaggerAnimation('.relics-grid', '.relic-item');
  applyStaggerAnimation('.trophy-grid', '.trophy');
  applyStaggerAnimation('.route-grid', '.route-card');
  cleanupBrandLogo();
  disposeBrandLogo = mountBrandLogo('#passport-brand-logo');
}

function renderAbout() {
  main.innerHTML = `<div class="about-intro"><div class="eyebrow">${icon('leaf')}Osobní atlas procházek</div><h1 tabindex="-1">Dobrá cesta začíná<br>dobrou informací.</h1><p>Czekpoint je osobní atlas procházek: vyjdi ven, odkrývej své okolí, objev skutečné místo a odnes si ověřené GPS razítko a ilustrovanou pohlednici.</p></div>
    <div class="about-grid"><section class="panel">${icon('route')}<h2>Vyber. Podívej se. Vyraz.</h2><p>Na kartě najdeš známé údaje o cestě, její omezení a odkaz na původní zdroj. Navigaci otevřeš ve stávající mapové službě. Po návratu si místo můžeš uložit do pasu.</p></section>
    <section class="panel">${icon('shield')}<h2>Neznámé přiznáváme.</h2><p>Úvodní karty vycházejí z veřejných zdrojů. Terénní ověření probíhá postupně. Ilustrace nejsou fotografie skutečného stavu. Když chybí čas, převýšení nebo ověřená poloha, zobrazíme to jako neověřený údaj.</p></section>
    <section class="panel">${icon('pin')}<h2>Jedno GPS razítko místa (+30 b.).</h2><p>Razítko získáš osobní návštěvou u ověřeného místa (pod 20 m při opakovaném přesném měření GPS ≤ 40 m). Začátky okruhů razítka neudělují.</p></section>
    <section class="panel">${icon('lock')}<h2>Tvoje data, soukromí a externí služby</h2>
      <p>Tvůj výletový pas, historie chůze, profil i odkrytá mapa jsou uloženy <strong>lokálně v prohlížeči</strong>. Při zobrazení mapy a výpočtu trasy se vybrané souřadnice odesílají těmto veřejným službám:</p>
      <ul style="margin:8px 0 0 18px;padding:0;font-size:0.95rem;line-height:1.5">
        <li><strong>OpenStreetMap (tile.openstreetmap.org):</strong> načítá dlaždice mapového podkladu pro právě zobrazenou oblast.</li>
        <li><strong>OSRM (router.project-osrm.org):</strong> při plánování výpravy přijímá souřadnice startu a zastávek pro výpočet pěší trasy. Při nedostupnosti se zobrazí přímé orientační spojnice.</li>
        <li><strong>Open-Meteo (api.open-meteo.com):</strong> na vyžádání („Načíst převýšení“) přijímá souřadnice bodů trasy pro výpočet nadmořské výšky. Během výpravy navíc načítá krátkodobou předpověď počasí na příštích 60 minut (odesílají se zaokrouhlené souřadnice s přesností přibližně na 1 km, nejvýše jednou za 15 minut nebo při posunu o více než 3 km; data pod licencí CC BY 4.0).</li>
        <li><strong>Overpass API (overpass-api.de):</strong> při načítání bodů zájmu a značených tras v okolí přijímá souřadnice středu oblasti a poloměr hledání.</li>
      </ul>
      <p style="margin-top:8px;font-size:0.92rem"><strong>Sdílený kód trasy (CZK1-…):</strong> obsahuje zakódované souřadnice startu, seznam zastávek (názvy a souřadnice), zvolený poloměr, kategorie, doprovod a herní režim. Neobsahuje tvé jméno ani historii chůze.</p>
      <p style="margin-top:6px;font-size:0.92rem"><strong>Ukázkoví poutníci v pasu:</strong> postavy poutníků v sekci „Ukázkoví poutníci v okolí“ jsou generované lokální ukázkové postavy pro atmosféru revíru, nikoli skuteční uživatelé připojení přes síť.</p>
    </section></div>
    <div class="about-foot">
      <p class="small-note">Bez sledovacích reklam a bez analytických měřicích skriptů. Toto je verze v1.4-part2.</p>
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

function renderSettingsPage() {
  let s = loadState();
  const cfg = s.appSettings || DEFAULT_APP_SETTINGS;
  const gameMode = cfg.gameMode || 'gamified';

  const SETTINGS_LIST = [
    { key: 'showExternalPhotos', icon: '🖼️', label: '🖼️ Zobrazovat externí fotografie míst (Wikipedie)', desc: 'Zobrazovat externí fotografie z Wikipedie/Wikimedia Commons se zdrojem a licencí (při vypnutí jen čisté vektorové ilustrace).', val: cfg.showExternalPhotos !== false },
    { key: 'mindfulnessPrompts', icon: '🍃', label: 'Volitelné výzvy všímavosti na cestě', desc: 'Jemné pozorovací tipy k zastavení v terénu (lze kdykoliv jedním klepnutím přeskočit nebo zde trvale vypnout).', val: cfg.mindfulnessPrompts !== false },
    { key: 'fogParchment', icon: '📜', label: 'Tajemný pergamen (odkrývání mlhy)', desc: 'Neznámá místa na mapě skrývá pergamen a odkrývají se tvou chůzí s měkkým rozsvěcením.', val: cfg.fogParchment },
    { key: 'kctTrails', icon: '🥾', label: 'Turistické značky KČT a naučné stezky', desc: 'Zobrazuje oficiální červené, modré, zelené a žluté pěší značky na mapě.', val: cfg.kctTrails },
    { key: 'contours', icon: '⛰️', label: 'Vrstevnice a terén (OpenTopoMap)', desc: 'Zapne vrstevnicový podklad s kopci a výškami.', val: cfg.contours },
    { key: 'footprints', icon: '👣', label: 'Stopy pohorek za mnou', desc: 'Kreslí střídavé otisky podrážek levé a pravé boty natočené ve směru chůze.', val: cfg.footprints },
    { key: 'orbitalArrow', icon: '🎯', label: 'Zlatá směrová šipka u Avatara', desc: 'Ukazuje přímý směr k dalšímu checkpointu po obvodu tvé postavičky.', val: cfg.orbitalArrow },
    { key: 'voiceNav', icon: '🗣️', label: 'Česká hlasová navigace', desc: 'Hlasové pokyny před odbočkou a fanfára při získání razítka.', val: cfg.voiceNav },
    { key: 'soundFx', icon: '🔊', label: 'Zvukové efekty a fanfáry', desc: 'Zvuk při potvrzení cíle, cinknutí hole v pasu a kliknutí.', val: cfg.soundFx },
    { key: 'keepAwake', icon: '📱', label: 'Držet rozsvícený displej', desc: 'Při chůzi s telefonem v ruce zabrání automatickému zhasnutí obrazovky.', val: cfg.keepAwake },
    { key: 'autoSortStops', icon: '🔄', label: 'Chytré řazení zastávek', desc: 'Automaticky seřadí vybraná místa podle pěší trasy bez zbytečných zacházek.', val: cfg.autoSortStops },
  ];

  main.innerHTML = `
    <div class="settings-page-shell">
      <div class="settings-page-head">
        <span class="settings-eyebrow">⚙️ Nastavení mimo hlavní mapu</span>
        <h1 class="settings-main-title" tabindex="-1">Nastavení aplikace a herního stylu</h1>
        <p class="settings-lead">Ve výchozím nastavení je zapnuto vše pro gamifikaci. Pokud chceš cokoliv vypnout (např. pergamen, turistické značky, zvuky), jednoduše přepni pilulku na <strong>Vypnuto</strong>.</p>
      </div>

      <!-- 3 striktní herní módy -->
      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-card-badge">Herní režim</span>
          <h2>3 hlavní herní styly výpravy</h2>
          <p class="small-note">Vyber si režim, který ti nejlépe vyhovuje. Každý režim automaticky nastaví mlhu i zobrazení trasy.</p>
        </div>

        <div class="game-mode-grid" role="radiogroup" aria-label="Výběr herního stylu">
          <button type="button" class="game-mode-card ${gameMode === 'explorer' ? 'active' : ''}" data-setting-mode="explorer">
            <span class="gmc-icon">🧭</span>
            <strong>🧭 Objevování</strong>
            <p>Zahalená mapa pergamenem, žádná narýsovaná čára trasy na zemi. Orientuješ se podle kompasu a objevuješ krajinu na vlastní pěst.</p>
            <span class="gmc-badge">${gameMode === 'explorer' ? '✓ Aktivní styl' : 'Zvolit tento styl'}</span>
          </button>

          <button type="button" class="game-mode-card ${gameMode === 'gamified' ? 'active' : ''}" data-setting-mode="gamified">
            <span class="gmc-icon">📜</span>
            <strong>📜 Výprava s pergamenem</strong>
            <p>Poloprůhledná pergamenová mapa s měkkým rozsvěcením, vypočtená pěší trasa po cestách, stopy pohorek, Avatar se šipkou a razítka.</p>
            <span class="gmc-badge">${gameMode === 'gamified' ? '✓ Aktivní styl' : 'Zvolit tento styl'}</span>
          </button>

          <button type="button" class="game-mode-card ${gameMode === 'casual' ? 'active' : ''}" data-setting-mode="casual">
            <span class="gmc-icon">🗺️</span>
            <strong>🗺️ Turistická mapa</strong>
            <p>Úplně čistá otevřená mapa bez jakékoliv mlhy, zřetelně vyznačená trasa i checkpointy. Vhodné pro děti i seniory.</p>
            <span class="gmc-badge">${gameMode === 'casual' ? '✓ Aktivní styl' : 'Zvolit tento styl'}</span>
          </button>
        </div>
      </section>

      <!-- Přepínače jednotlivých funkcí (Pilulky Ano / Ne) -->
      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-card-badge">Jednotlivé prvky</span>
          <h2>Přizpůsobení zobrazení a chování</h2>
        </div>

        <div class="settings-pills-list">
          ${SETTINGS_LIST.map(item => `
            <div class="settings-pill-row">
              <div class="settings-pill-info">
                <span class="settings-icon-bubble">${item.icon}</span>
                <div>
                  <strong>${e(item.label)}</strong>
                  <p>${e(item.desc)}</p>
                </div>
              </div>
              <div class="settings-pill-switch" role="radiogroup" aria-label="${e(item.label)}">
                <button type="button" class="settings-pill-btn ${item.val ? 'is-active' : ''}" data-action="toggle-setting" data-key="${item.key}" data-val="true">
                  ✓ Zapnuto
                </button>
                <button type="button" class="settings-pill-btn ${!item.val ? 'is-active' : ''}" data-action="toggle-setting" data-key="${item.key}" data-val="false">
                  Vypnuto
                </button>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="settings-card-footer">
          <button type="button" class="button small ghost" data-action="reset-app-settings">↺ Obnovit výchozí herní nastavení (vše zapnuto)</button>
          <a href="#/" class="button primary">▶ Přejít na mapu a vyrazit</a>
        </div>
      </section>

      <!-- Testovací GPS simulátor chůze (mimo mapu) -->
      <section class="settings-card">
        <div class="settings-card-head">
          <span class="settings-card-badge">Vývoj a testování</span>
          <h2>🧪 Testovací simulátor GPS chůze</h2>
          <p class="small-note">Simulátor je vyhrazen pro testování, funguje zcela odděleně od mapy a nezkresluje tvůj skutečný profil ani postup v terénu.</p>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:12px 0">
          <a href="#/?sim=1" class="button lime">🧪 Otevřít testovací simulátor na mapě</a>
          <span class="small-note">Zobrazí testovací panel pod mapou bez překrývání herní plochy.</span>
        </div>
      </section>

      <div class="about-foot" style="margin-top:20px">
        <div class="data-actions">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
            <button type="button" class="button small" data-action="export-state">${icon('arrow')}Exportovat zálohu průzkumu (JSON)</button>
            <button type="button" class="button small" data-action="import-state">${icon('book')}Obnovit průzkum ze zálohy (JSON)</button>
          </div>
          <button type="button" class="button danger small" data-action="clear-local">${icon('trash')}Vymazat lokální data a resetovat průzkum</button>
        </div>
      </div>
    </div>
  `;
}

function renderNotFound() {
  main.innerHTML = `<div class="empty-state">${icon('pin')}<h1 tabindex="-1">Tuhle cestu zatím neznáme.</h1><p>Odkaz neodpovídá žádnému dostupnému výletu.</p><a class="button primary" href="#/">Zpět na výlety</a></div>`;
}

async function renderPage({ focus = false } = {}) {
  const prevView = state.view;
  if (prevView === 'catalog') {
    state.catalogScrollY = window.scrollY || 0;
  }
  disposeWalk?.(); disposeWalk = null;
  cleanupBrandLogo();
  main.classList.remove('page-enter');
  void main.offsetWidth;
  main.classList.add('page-enter');
  const renderId = ++state.renderId;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = parts[0] || '';
  state.view = (view === '' || view === 'prochazka') ? 'walk' : view === 'katalog' ? 'catalog' : view === 'pas' ? 'passport' : view === 'nastaveni' ? 'settings' : view === 'o-projektu' ? 'about' : view === 'trasa' ? 'detail' : 'unknown';
  document.title = 'Czekpoint — Začni cestu s přehledem';
  document.querySelectorAll('[data-nav]').forEach(link => {
    const active = link.dataset.nav === state.view || (state.view === 'detail' && link.dataset.nav === 'catalog');
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#passport-count').textContent = state.visits.length;
  if (view === 'trasa') {
    let id; try { id = decodeURIComponent(parts[1] || ''); } catch { id = ''; }
    await renderDetail(id, renderId);
  } else if (view === '' || view === 'prochazka') {
    disposeWalk = mountWalk(main, state.routes, CONFIG, {
      onAddVisit: async (id) => {
        await state.repo.addVisit(id);
        await refreshPersonal();
      },
    });
  } else if (view === 'katalog') {
    renderExplore();
    if (prevView === 'detail' || state.returningFromDetail) {
      const targetScroll = state.catalogScrollY || 0;
      state.returningFromDetail = false;
      requestAnimationFrame(() => window.scrollTo(0, targetScroll));
      return;
    }
  }
  else if (view === 'pas') renderPassport();
  else if (view === 'nastaveni') renderSettingsPage();
  else if (view === 'o-projektu') renderAbout();
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
  // Akce patřící výhradně do Výletového pasu (Bod 4: jedno klepnutí = jedna akce)
  if (state.view === 'passport') {
    const hammerBtn = event.target.closest('.hammer-badge-btn');
    if (hammerBtn) {
      const badgeId = hammerBtn.dataset.badgeId;
      let s = loadState();
      const badge = (s.stickBadges || []).find(b => b.id === badgeId);
      if (badge) {
        badge.pinned = true;
        hammerBtn.classList.add('hammering');
        playHammer(s.soundEnabled);
        triggerHaptic([40, 50, 40]);
        setTimeout(() => {
          s = saveState(s);
          if (state.view === 'passport') renderPassport();
          toast('Plechový štítek byl přibit na tvoji hůl!');
        }, 320);
      }
      return;
    }

    const clinkBtn = event.target.closest('.clink-btn');
    if (clinkBtn) {
      let s = loadState();
      clinkBtn.classList.add('clinking');
      playHammer(s.soundEnabled);
      triggerHaptic(50);
      s.clinksCount = (Number(s.clinksCount) || 0) + 1;
      s = saveState(s);
      setTimeout(() => {
        if (state.view === 'passport') renderPassport();
        toast('Cinknul jsi holí na pozdrav!');
      }, 300);
      return;
    }

    const pilgrimsToggleBtn = event.target.closest('#toggle-pilgrims-optin-btn');
    if (pilgrimsToggleBtn) {
      let s = loadState();
      s.pilgrimsOptIn = !s.pilgrimsOptIn;
      playTick(s.soundEnabled);
      s = saveState(s);
      renderPassport();
      return;
    }
  }

  const button = event.target.closest('[data-action]');
  if (!button || !state.repo) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const route = state.routes.find(item => item.id === id);

  try {
    if (action === 'scroll-routes') { event.preventDefault(); document.querySelector('#vylety')?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (action === 'back-to-catalog') {
      state.returningFromDetail = true;
      return;
    }
    if (action === 'filter-item-type') {
      state.filters.itemType = button.dataset.itemType || 'all';
      document.querySelectorAll('[data-action="filter-item-type"]').forEach(chip => {
        const active = chip.dataset.itemType === state.filters.itemType;
        chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
      });
      renderExploreResults(); return;
    }
    if (action === 'filter-kind') {
      state.filters.kind = button.dataset.kind;
      document.querySelectorAll('[data-action="filter-kind"]').forEach(chip => {
        const active = chip.dataset.kind === state.filters.kind;
        chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
      });
      renderExploreResults(); return;
    }
    if (action === 'reset-filters') {
      state.filters = { search: '', kind: 'all', itemType: 'all', maxDistance: null, strollerOnly: false, savedOnly: false };
      renderExplore(); document.querySelector('#search-input')?.focus(); return;
    }
    if (action === 'add-to-walk' && route) {
      let s = loadState();
      const planned = s.plannedRoute || {
        origin: { id: 'namesti', label: 'Náměstí Rožmitál', lat: 49.6014, lng: 13.8644 },
        radiusKm: 10,
        categories: ['castles', 'views', 'water', 'nature'],
        selectedPlaceIds: [],
        companionMode: s.companionMode || 'solo',
        explorationMode: s.explorationMode || 'focus',
      };
      const ids = Array.isArray(planned.selectedPlaceIds) ? [...planned.selectedPlaceIds] : [];
      const inWalk = ids.includes(id);
      if (inWalk) {
        planned.selectedPlaceIds = ids.filter(x => x !== id);
      } else {
        if (ids.length >= 10) {
          toast('Ve výpravě může být nejvýše 10 zastávek.', true);
          return;
        }
        planned.selectedPlaceIds = [...ids, id];
      }
      s.plannedRoute = planned;
      s = saveState(s);
      playTick(s.soundEnabled);
      if (state.view === 'catalog' || state.view === 'explore') renderExploreResults();
      else if (state.view === 'detail') await renderDetail(id, state.renderId);
      toast(inWalk ? `„${route.title}“ odebráno ze zastávek výpravy.` : `„${route.title}“ přidáno do zastávek výpravy.`);
      return;
    }
    if (action === 'passport-section') {
      state.passportSection = button.dataset.section;
      playTick();
      renderPassport();
      return;
    }
    if (action === 'passport-tab') {
      state.passportTab = button.dataset.tab;
      playTick();
      renderPassport();
      return;
    }
    if (action === 'reload') { await renderPage(); return; }
    if (action === 'save' && route) {
      button.disabled = true; await state.repo.toggleSaved(id); await refreshPersonal();
      if (state.view === 'catalog' || state.view === 'explore') renderExploreResults(); else if (state.view === 'passport') renderPassport(); else await renderPage();
      toast(isSaved(id) ? 'Uloženo do oblíbených na později (mimo aktivní trasu).' : 'Odebráno z oblíbených.'); return;
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
      button.querySelector('img')?.classList.add('avatar-pop');
      playTick();
      triggerHaptic(40);
      toast(`Avatar změněn: ${chosen ? chosen.name : avatarId}. Uloženo v tomto zařízení.`);
      setTimeout(() => renderPassport(), 180);
      return;
    }
    if (action === 'preview-postcard') {
      const expId = button.dataset.expId;
      const stateObj = loadState();
      const exp = (stateObj.expeditionHistory || []).find(x => x.id === expId);
      if (exp) {
        openPassportPostcardModal(exp);
      }
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

function registerOfflineServiceWorker() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

async function boot() {
  registerOfflineServiceWorker();
  mountAnimatedBrandLogo();
  mountAmbientBackground();
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