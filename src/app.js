import { CONFIG } from '../config.js';
import { createRepository } from './repository.js';
import { filterRoutes, validateReport, haversineMeters, isReportFresh, summarizeReports, QUICK_TAGS, isPioneerEligible } from './domain.js';
import { escapeHtml as e, safeUrl, icon, formatDate, localDateInput, number } from './ui.js';
import { preparePhoto } from './media.js';
import { mountWalk } from './walk.js';
import { clearWalk, loadWalk, loadWalkMeta, saveWalkMeta, clearWalkMeta } from './walk-store.js';
import { emptyWalk, explorerRank, sectorStatus, totalScore } from './walk-engine.js';
import { SECTORS, COLLECTIONS, RELICS } from './data.js';

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
  routes: [], saved: [], visits: [], repo: null, position: null, view: 'explore',
  filters: { search: '', kind: 'all', maxDistance: null, strollerOnly: false, savedOnly: false },
  passportTab: 'visited', renderId: 0, toastTimer: null,
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
  const meta = loadWalkMeta();
  const tier = meta.tiers?.[route.id];
  const tierBadge = tier === 'gold' ? '🥇 Zlato' : tier === 'silver' ? '🥈 Stříbro' : tier === 'bronze' ? '🥉 Bronz' : '';

  return `<article class="route-card" data-route-card="${e(route.id)}">
    <div class="card-image"><a href="${routeLink(route)}" tabindex="-1" aria-hidden="true"><img src="${illustrationUrl(route)}" alt="" width="600" height="340" loading="lazy"></a>
      <span class="image-label">Ilustrace místa</span>
      <button class="save-button ${saved ? 'saved' : ''}" type="button" data-action="save" data-id="${e(route.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Odebrat z uložených' : 'Uložit výlet'}: ${e(route.title)}">${icon('heart')}</button>
    </div>
    <div class="card-content">
      <div class="card-kicker">${e(route.region)} · ${e(kinds[route.kind] || 'Výlet')} ${tierBadge ? `· <strong>${tierBadge}</strong>` : ''}</div>
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
      <p>Krásný výhled je začátek. Zjisti, jaká cesta k němu vede, na co se připravit a co zažili lidé před tebou.</p>
      <div class="hero-actions"><a class="button primary" href="#/prochazka">Spustit mapu a procházku ${icon('arrow')}</a><a class="button ghost" href="#vylety" data-action="scroll-routes">Vybrat výlet</a></div>
      <div class="trust-line"><span>${icon('check')}Bez registrace na prohlížení</span><span>${icon('book')}Tvoje zkušenost pomáhá</span></div>
    </div>
    <div class="hero-art"><img class="project-art" src="./assets/czekpoint-brand.png" width="1024" height="1024" alt="Czekpoint: turista v přírodě s motivem QR kódu"></div>
    </section>
    <section id="vylety" class="explore-section" aria-labelledby="routes-heading">
      <div class="section-heading"><div><h2 id="routes-heading">Kam vyrazíme?</h2><p>Pár pečlivě vybraných míst. Každé má svůj příběh i přístup.</p></div><span class="subtle muted">Třemšínsko · pilotní výběr</span></div>
      <div class="filter-panel"><div class="filter-top"><label class="search-field">${icon('search')}<span class="sr-only">Hledat výlet</span><input id="search-input" type="search" placeholder="Hledat místo nebo cestu…" maxlength="100" value="${e(state.filters.search)}"></label>
      <label><span class="sr-only">Maximální délka trasy</span><select id="distance-filter" class="filter-select"><option value="">Libovolná délka</option><option value="3">Do 3 km</option><option value="5">Do 5 km</option><option value="10">Do 10 km</option></select></label>
      <label class="check-filter"><input id="stroller-filter" type="checkbox" ${state.filters.strollerOnly ? 'checked' : ''}> S kočárkem dle zdroje</label>
      <label class="check-filter"><input id="saved-filter" type="checkbox" ${state.filters.savedOnly ? 'checked' : ''}> Jen uložené</label></div>
      <div class="filter-chips" role="group" aria-label="Druh výletu">${[['all', 'Všechny výlety', 'globe'], ['forest', 'Do lesa', 'tree'], ['water', 'K vodě', 'water'], ['culture', 'Za historií', 'castle'], ['view', 'Za výhledem', 'mountain']].map(([id, label, ic]) => `<button class="chip ${state.filters.kind === id ? 'active' : ''}" type="button" data-action="filter-kind" data-kind="${id}" aria-pressed="${state.filters.kind === id}">${icon(ic)}${label}</button>`).join('')}</div></div>
      <p id="results-info" class="results-info" role="status" aria-live="polite"></p><div id="route-grid" class="route-grid"></div>
      <aside class="info-strip">${icon('info')}<div><strong>Dobrá informace má svůj zdroj.</strong><p>Karty vycházejí z uvedených veřejných zdrojů. Trasy jsme zatím osobně neprošli a aktuální stav může být jiný. Nová hlášení přibudou až od skutečných návštěvníků.</p></div></aside>
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
  const meta = loadWalkMeta();
  const currentTier = meta.tiers?.[id] || (visited ? 'silver' : null);

  const tierBadgeHtml = currentTier === 'gold'
    ? '<span class="detail-trophy-badge gold">🥇 Zlatá trofej místa (+120 b.)</span>'
    : currentTier === 'silver'
    ? '<span class="detail-trophy-badge silver">🥈 Stříbrná trofej místa (+60 b.)</span>'
    : currentTier === 'bronze'
    ? '<span class="detail-trophy-badge bronze">🥉 Bronzová trofej místa (+30 b.)</span>'
    : '<span class="detail-trophy-badge none">◇ Trofej zatím nezískána</span>';

  document.title = `${route.title} · Czekpoint`;
  main.innerHTML = `<a class="back-link" href="#/">${icon('back')}Zpět na výlety</a>
    <div class="detail-header">
      <div>
        <div class="eyebrow">${icon(kindIcons[route.kind] || 'pin')}${e(route.region)} · ${e(kinds[route.kind] || 'Výlet')}</div>
        <h1 tabindex="-1">${e(route.title)}</h1>
        <p>${e(route.subtitle)}</p>
        <div style="margin-top:10px">${tierBadgeHtml}</div>
      </div>
      <button type="button" class="button" data-action="share" data-id="${e(id)}">${icon('share')}Sdílet místo</button>
    </div>
    <div class="detail-grid">
      <div class="detail-main">
        <div class="detail-cover"><img src="${illustrationUrl(route)}" width="600" height="340" alt="Ilustrace místa"><span class="image-label">Ilustrace · fotografie návštěvníků níže</span></div>
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
        <p>${visited ? `Návštěva ${formatDate(visitFor(id).visitedAt)}. Jde o tvůj vlastní záznam.` : 'Výletový pas si návštěvy pamatuje v tomto prohlížeči.'}</p>
        <div class="field-status">${icon('info')}<span>${route.fieldCheckedAt ? `Terénní kontrola: ${formatDate(route.fieldCheckedAt)}` : 'Terénní kontrola zatím neproběhla.'}</span></div>
      </aside>
    </div>
    <section id="hlaseni" class="report-section" aria-labelledby="reports-title">
      <div class="section-heading">
        <div>
          <h2 id="reports-title">Zkušenosti a kronika cesty</h2>
          <p id="reports-summary">Načítáme hlášení…</p>
        </div>
        <button type="button" class="button primary" data-action="report" data-id="${e(id)}">${icon('plus')}Přidat zkušenost a fotku</button>
      </div>
      <div id="chronicle-box"></div>
      <div id="report-list" class="report-list"><p class="small-note" role="status">Načítáme zkušenosti návštěvníků…</p></div>
      <p class="detail-report-note">Hlášení popisuje konkrétní návštěvu. Není potvrzením bezpečnosti nebo průchodnosti celé trasy.</p>
    </section>`;

  try {
    const reports = await state.repo.listReports(id);
    if (renderId !== state.renderId) return;
    renderReports(route, reports);
  } catch (error) {
    if (renderId !== state.renderId) return;
    document.querySelector('#reports-summary').textContent = 'Hlášení se nepodařilo načíst.';
    document.querySelector('#report-list').innerHTML = `<div class="notice error">${e(errorMessage(error))}<br><button type="button" class="button small" data-action="reload">Zkusit znovu</button></div>`;
  }
}

function renderReports(route, reports) {
  const publishedReports = reports.filter(report => report.status === 'published');
  const summary = summarizeReports(publishedReports, Date.now());
  const local = state.repo.mode === 'local';
  document.querySelector('#reports-summary').textContent = local ? 'Lokální test: příspěvky a fotky zůstávají v tomto prohlížeči.' : summary.recentCount ? `${summary.recentCount} zveřejněných hlášení za posledních 7 dní.` : 'Za posledních 7 dní nemáme zveřejněné hlášení. Aktuální stav neznáme.';

  // Živá fotokronika místa
  const photoReports = reports.filter(r => r.photoUrl && /^(https?:|blob:)/.test(r.photoUrl));
  const chronicleBox = document.querySelector('#chronicle-box');
  if (chronicleBox) {
    if (photoReports.length) {
      chronicleBox.innerHTML = `
        <div class="photo-chronicle">
          <h3>Fotokronika místa (${photoReports.length})</h3>
          <div class="photo-chronicle-scroll">
            ${photoReports.map(r => `
              <div class="photo-chronicle-item">
                <img class="photo-chronicle-thumb" src="${e(r.photoUrl)}" alt="Foto: ${e(r.author)}" loading="lazy">
                <strong>${e(r.author)}</strong>
                <small class="muted">${formatDate(r.observedAt, true)}</small>
                ${r.tags && r.tags.length ? `<div class="report-tags">${r.tags.map(t => {
                  const tagObj = QUICK_TAGS.find(qt => qt.id === t);
                  return `<span class="report-tag-pill">${e(tagObj?.label || t)}</span>`;
                }).join('')}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      chronicleBox.innerHTML = '';
    }
  }

  const list = document.querySelector('#report-list');
  if (!reports.length) {
    list.innerHTML = `<div class="report-empty">${icon('camera')}<h3>První skutečná zkušenost může být tvoje.</h3><p>Byl/a jsi tu? Vyfoť užitečný detail cesty, získej Zlatou trofej a napiš, co bys chtěl/a vědět před výletem.</p><button type="button" class="button" data-action="report" data-id="${e(route.id)}">Přidat první zkušenost ${icon('arrow')}</button></div>`;
    return;
  }

  list.innerHTML = reports.map(report => {
    const photo = report.photoUrl && /^(https?:|blob:)/.test(report.photoUrl) ? report.photoUrl : null;
    const tagPills = report.tags && report.tags.length ? `
      <div class="report-tags">
        ${report.tags.map(t => {
          const tagObj = QUICK_TAGS.find(qt => qt.id === t);
          return `<span class="report-tag-pill">${e(tagObj?.label || t)}</span>`;
        }).join('')}
      </div>
    ` : '';

    return `<article class="report-card">
      <div class="report-top">
        <span class="report-type ${e(report.kind)}">${icon(report.kind === 'clear' ? 'check' : report.kind === 'other' ? 'info' : 'warning')}${e(reportKinds[report.kind] || 'Zkušenost')}</span>
        ${report.isOwn ? `<button type="button" class="delete-report" data-action="delete-report" data-id="${e(report.id)}" data-route="${e(route.id)}" aria-label="Smazat moje hlášení">${icon('trash')}</button>` : ''}
      </div>
      <div class="report-meta">${e(report.author)} · návštěva ${formatDate(report.observedAt, true)}</div>
      <p class="report-note">${e(report.note)}</p>
      ${tagPills}
      ${photo ? `<img class="report-photo" src="${e(photo)}" alt="Fotografie přiložená ke zkušenosti z cesty" loading="lazy">` : ''}
      ${report.photoUnavailable ? '<p class="small-note">Fotografii se nepodařilo načíst. Zkus stránku později obnovit.</p>' : ''}
      <div class="report-flags">
        ${!isReportFresh(report, Date.now(), CONFIG.reportFreshDays) ? '<span class="flag">Starší než 7 dní</span>' : ''}
        ${report.status === 'pending' ? '<span class="flag pending">Čeká na schválení · vidíš jen ty</span>' : ''}
        ${report.status === 'rejected' ? '<span class="flag pending">Nezveřejněno · vidíš jen ty</span>' : ''}
        ${local ? '<span class="flag">Pouze na tomto zařízení</span>' : ''}
        ${report.isOwn ? '<span class="flag">Tvoje zkušenost</span>' : ''}
      </div>
    </article>`;
  }).join('');
}

function renderPassport() {
  const visitedRoutes = state.routes.filter(route => visitFor(route.id));
  const savedRoutes = state.routes.filter(route => isSaved(route.id));
  const routes = state.passportTab === 'visited' ? visitedRoutes : savedRoutes;

  let progress = emptyWalk();
  try { progress = loadWalk(); } catch {}
  const meta = loadWalkMeta();
  const totalPts = totalScore(progress, meta, SECTORS, COLLECTIONS, state.routes);
  const rank = explorerRank(totalPts);
  const sStatus = sectorStatus(SECTORS, state.routes, meta.tiers);

  main.innerHTML = `
    <section class="passport-header">
      <div>
        <div class="eyebrow">${icon('book')} Tvoje výpravy a trofeje</div>
        <h1 tabindex="-1">Můj výletový pas.</h1>
        <p>Sbírka navštívených míst, odemčených pečetí a relikvií z Rožmitálska.</p>
      </div>
      <div class="passport-stats">
        <div class="passport-stat"><strong>${visitedRoutes.length}</strong><span>navštívených míst</span></div>
        <div class="passport-stat"><strong>${savedRoutes.length}</strong><span>uložených cílů</span></div>
      </div>
    </section>

    <div class="passport-rank-card">
      <div>
        <div class="eyebrow" style="color:#d8e99e;margin-bottom:6px">Hodnost průzkumníka</div>
        <h2 style="color:#fff;margin:0 0 6px">Úroveň ${rank.level} · ${rank.title}</h2>
        <p style="margin:0;font-size:13px;opacity:.85">Dosah odkrývání mlhy: ${rank.fogRadiusM} m · Dosah odhalení trofejí: ${rank.revealDistanceM} m</p>
      </div>
      <div style="text-align:right">
        <strong>${totalPts} b.</strong>
        <span style="display:block;font-size:11px;opacity:.8">celkové skóre</span>
      </div>
    </div>

    <section class="passport-section">
      <div class="section-heading">
        <div>
          <h2>Pečetě měst a sektorů (SnowRunner styl)</h2>
          <p>Dokonči všechna místa v sektoru na Zlato. Odemkne se Pečeť a trvale se rozpustí mlha (+300 b.).</p>
        </div>
      </div>
      <div class="seals-grid">
        ${Object.values(sStatus).map(s => `
          <div class="seal-item ${s.unlocked ? 'unlocked' : ''}">
            <span class="seal-icon">${s.unlocked ? '🏆' : '🔒'}</span>
            <strong>${e(s.sealTitle)}</strong>
            <span class="muted">${e(s.title)}</span>
            <small style="font-weight:700">${s.completed}/${s.total} zlatých trofejí</small>
            ${s.unlocked ? '<span style="color:#4a6828;font-weight:700">✓ Pečeť odemčena (+300 b.)</span>' : '<span class="muted">Zkompletuj všechna místa</span>'}
          </div>
        `).join('')}
      </div>
    </section>

    <section class="passport-section">
      <div class="section-heading">
        <div>
          <h2>Tematické kolekce trofejí</h2>
          <p>Navštiv a zaznamenej všechna místa v tematické sérii a získej bonus +200 b.</p>
        </div>
      </div>
      <div class="collections-grid">
        ${Object.values(COLLECTIONS).map(col => {
          const totalItems = col.routeIds.length;
          const doneItems = col.routeIds.filter(id => Boolean(meta.tiers?.[id])).length;
          const isDone = doneItems === totalItems;
          return `
            <div class="collection-item ${isDone ? 'completed' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:start">
                <strong>${e(col.title)}</strong>
                <span style="font-weight:700;color:${isDone ? '#4a6828' : '#73836d'}">${isDone ? '✓ +200 b.' : `+${col.bonusPoints} b.`}</span>
              </div>
              <small>${doneItems}/${totalItems} trofejí splněno</small>
              <ul class="bullet-list" style="margin:4px 0;font-size:11px">
                ${col.routeIds.map(id => {
                  const r = state.routes.find(x => x.id === id);
                  const hasTier = Boolean(meta.tiers?.[id]);
                  return `<li>${hasTier ? '✓' : '◇'} ${e(r?.title || id)}</li>`;
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
          const isUnlocked = Math.floor(progress.cells.length / 6) > i;
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
    <aside class="info-strip">${icon('lock')}<div><strong>Tvůj pas zůstává v tomto prohlížeči.</strong><p>Návštěvy jsou tvoje vlastní záznamy. Neověřujeme jimi fyzickou přítomnost. Vymazání dat prohlížeče smaže i pas.</p></div></aside>
  `;
}

function renderAbout() {
  main.innerHTML = `<div class="about-intro"><div class="eyebrow">${icon('leaf')}Malý projekt, skutečné výlety</div><h1 tabindex="-1">Dobrá cesta začíná<br>dobrou informací.</h1><p>Czekpoint je první test průvodce místními výlety. Pomáhá najít důležité informace o přístupu a předat vlastní zkušenost dalším lidem.</p></div>
    <div class="about-grid"><section class="panel">${icon('route')}<h2>Vyber. Podívej se. Vyraz.</h2><p>Na kartě najdeš známé údaje o cestě, její omezení a odkaz na původní zdroj. Navigaci otevřeš ve stávající mapové službě. Po návratu si místo můžeš uložit do pasu.</p></section>
    <section class="panel">${icon('shield')}<h2>Neznámé přiznáváme.</h2><p>Úvodní karty vycházejí z veřejných zdrojů. Terénní ověření zatím neproběhlo. Ilustrace nejsou fotografie skutečného stavu. Když chybí čas, převýšení nebo čerstvé hlášení, zobrazíme to.</p></section>
    <section class="panel">${icon('camera')}<h2>Zkušenost má své datum.</h2><p>Napiš, kdy jsi na místě byl/a, a popiš konkrétní úsek. Fotka překážky nebo povrchu může pomoci víc než obecné hodnocení. Hlášení starší než 7 dní označujeme jako starší.</p><p>Volitelné porovnání polohy ukazuje jen přibližnou vzdálenost telefonu. Nedokazuje pravost fotografie ani průchodnost trasy.</p></section>
    <section class="panel">${icon('lock')}<h2>Tvoje data a soukromí</h2><p>${state.repo.mode === 'local' ? 'Teď používáš lokální test. Hlášení, fotky, uložená místa i návštěvy ukládáme do tohoto prohlížeče. Ostatní lidé je neuvidí.' : 'Používáš sdílenou verzi. Příspěvek a fotka se odešlou provozovateli a po schválení budou veřejné. Vlastní čekající příspěvky vidíš jen ty. Identita přispěvatele je anonymní účet spojený s tímto prohlížečem.'}</p><p>Fotky před uložením zmenšíme a odstraníme vložená EXIF metadata. Polohu zjišťujeme pouze po stisku tlačítka; přesné souřadnice telefonu k hlášení neposíláme. Pas i oblíbená místa zůstávají lokální.</p></section></div>
    <div class="about-foot"><p class="small-note">Bez sledovacích reklam a bez analytických měřicích skriptů. Odkaz na mapu nebo zdroj otevře jinou službu s vlastními pravidly. Průzkum mapy navíc ukládá přibližně navštívené dílky v tomto prohlížeči. Mapové podklady načítá OpenStreetMap; volitelné hledání míst odešle zaokrouhlenou oblast do Overpass API. Toto je pilotní verze 0.3.</p><div class="notice">${state.repo.mode === 'local' ? 'Lokální test není záloha. Smazání dat prohlížeče odstraní i uložené fotky a záznamy.' : 'Přístup k vlastním hlášením je spojený s anonymní relací tohoto prohlížeče. Vymazáním relace můžeš ztratit možnost příspěvky smazat; případné odstranění pak řeší provozovatel.'}</div>
    <div class="data-actions"><button type="button" class="button danger small" data-action="clear-local">${icon('trash')}Vymazat lokální testovací data</button><p>${state.repo.mode === 'local' ? 'Smaže hlášení, fotky, pas, uložená místa a herní průzkum (mapu, body, trofeje) v tomto prohlížeči.' : 'Smaže lokální pas, uložená místa a herní průzkum. Příspěvky na serveru zůstanou; vlastní můžeš smazat jednotlivě u výletu.'}</p></div></div>`;
}

function renderNotFound() {
  main.innerHTML = `<div class="empty-state">${icon('pin')}<h1 tabindex="-1">Tuhle cestu zatím neznáme.</h1><p>Odkaz neodpovídá žádnému dostupnému výletu.</p><a class="button primary" href="#/">Zpět na výlety</a></div>`;
}

async function renderPage({ focus = false } = {}) {
  disposeWalk?.(); disposeWalk = null;
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
      onOpenReport: (r) => openReport(r),
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

function openReport(route) {
  let photoBlob = null;
  let previewUrl = null;
  let photoSequence = 0;
  let preparing = false;
  let saving = false;
  let photoError = false;
  let locationCheck = { state: 'not-requested', accuracy: null, distance: null };
  const selectedTags = new Set();
  const local = state.repo.mode === 'local';
  const savedName = (() => { try { return localStorage.getItem('czekpoint.author') || ''; } catch { return ''; } })();

  reportDialog.innerHTML = `
    <div class="dialog-header">
      <div>
        <h2 id="report-title">Jaká byla cesta?</h2>
        <p>${e(route.title)}</p>
      </div>
      <button type="button" class="close-dialog" aria-label="Zavřít hlášení">${icon('close')}</button>
    </div>
    <form id="report-form" class="report-form">
      <div id="form-error" class="form-error" role="alert"></div>
      <div class="form-row">
        <div class="form-field">
          <label for="report-kind">Co chceš předat dál?</label>
          <select id="report-kind" name="kind">
            ${Object.entries(reportKinds).map(([value, label]) => `<option value="${value}" ${value === 'other' ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label for="observed-at">Kdy jsi tu byl/a?</label>
          <input id="observed-at" name="observedAt" type="datetime-local" value="${localDateInput()}" max="${localDateInput(new Date(Date.now() + 5 * 60000))}" min="${localDateInput(new Date(Date.now() - 30 * 86400000))}" required>
        </div>
      </div>

      <div class="form-field">
        <span class="field-label">Rychlé štítky stavu cesty</span>
        <div class="quick-tags" id="quick-tags-box">
          ${QUICK_TAGS.map(t => `<button type="button" class="tag-pill" data-tag="${t.id}">${e(t.label)}</button>`).join('')}
        </div>
      </div>

      <div class="form-field">
        <label for="report-note">Konkrétní zkušenost <span class="muted">(5–600 znaků)</span></label>
        <textarea id="report-note" name="note" minlength="5" maxlength="600" required placeholder="Např. na posledním úseku před vyhlídkou je po dešti kluzké kamení…"></textarea>
        <span class="field-hint">Popiš jen to, co jsi opravdu viděl/a. Uveď úsek cesty, ke kterému se zkušenost vztahuje.</span>
      </div>
      <div class="form-field">
        <label for="report-author">Tvoje přezdívka</label>
        <input id="report-author" name="author" minlength="2" maxlength="40" required autocomplete="nickname" placeholder="Jak tě máme uvést?" value="${e(savedName)}">
      </div>
      <div class="form-field">
        <label for="report-photo">Fotka z návštěvy <span class="muted">(přidáním získáš Zlatou trofej)</span></label>
        <div class="photo-input">
          <input id="report-photo" type="file" accept="image/jpeg,image/png,image/webp">
          <span class="field-hint">Vlastní JPG, PNG nebo WebP, vstup do 12 MB. Před uložením fotku zmenšíme a odstraníme metadata.</span>
        </div>
        <div id="photo-preview" class="photo-preview" hidden></div>
      </div>
      <div class="location-check">
        <button type="button" id="check-location" class="button small">${icon('locate')}Porovnat moji polohu</button>
        <span id="location-result">Volitelné. ${route.location ? 'Uloží se jen přibližná vzdálenost a přesnost, ne souřadnice telefonu.' : 'U tohoto místa nemáme ověřené souřadnice.'}</span>
      </div>
      <div class="form-footer">
        <p>${local ? 'Zkušební režim: hlášení i fotka zůstanou v tomto prohlížeči.' : 'Příspěvek a fotka se odešlou provozovateli.'}</p>
        <button id="submit-report" type="submit" class="button primary">${icon('plus')}${local ? 'Uložit zkušenost' : 'Odeslat ke schválení'}</button>
      </div>
    </form>
  `;

  const form = reportDialog.querySelector('form');
  const errorBox = reportDialog.querySelector('#form-error');
  const submit = reportDialog.querySelector('#submit-report');
  const fileInput = reportDialog.querySelector('#report-photo');
  const preview = reportDialog.querySelector('#photo-preview');
  const close = reportDialog.querySelector('.close-dialog');

  reportDialog.querySelector('#quick-tags-box').addEventListener('click', event => {
    const pill = event.target.closest('.tag-pill');
    if (!pill) return;
    const tagId = pill.dataset.tag;
    if (selectedTags.has(tagId)) {
      selectedTags.delete(tagId);
      pill.classList.remove('active');
    } else {
      if (selectedTags.size < 6) {
        selectedTags.add(tagId);
        pill.classList.add('active');
      }
    }
  });

  function updateSubmit() { submit.disabled = preparing || saving || photoError; }
  function clearPhoto() {
    photoSequence++; photoBlob = null; photoError = false; preparing = false;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; preview.hidden = true; preview.innerHTML = ''; fileInput.value = ''; errorBox.textContent = ''; updateSubmit();
  }
  close.addEventListener('click', () => { if (!saving) reportDialog.close(); });
  const preventCancel = event => { if (saving) event.preventDefault(); };
  reportDialog.addEventListener('cancel', preventCancel);
  reportDialog.addEventListener('close', () => { photoSequence++; if (previewUrl) URL.revokeObjectURL(previewUrl); reportDialog.removeEventListener('cancel', preventCancel); }, { once: true });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    clearPhoto();
    if (!file) return;
    const sequence = ++photoSequence;
    preparing = true; updateSubmit();
    preview.hidden = false; preview.innerHTML = '<p class="small-note" role="status">Připravujeme fotku…</p>';
    try {
      const blob = await preparePhoto(file, CONFIG.maxPhotoBytes);
      if (sequence !== photoSequence || !reportDialog.open) return;
      photoBlob = blob; previewUrl = URL.createObjectURL(blob);
      preview.innerHTML = `<img src="${previewUrl}" alt="Náhled přiložené fotografie"><button type="button" class="close-dialog" aria-label="Odebrat fotku">${icon('close')}</button>`;
      preview.querySelector('button').addEventListener('click', clearPhoto);
    } catch (error) {
      if (sequence !== photoSequence) return;
      photoError = true; errorBox.textContent = errorMessage(error); preview.innerHTML = '<button type="button" class="button small">Pokračovat bez fotky</button>'; preview.querySelector('button').addEventListener('click', clearPhoto);
    } finally { if (sequence === photoSequence) { preparing = false; updateSubmit(); } }
  });

  const locationButton = reportDialog.querySelector('#check-location');
  locationButton.disabled = !route.location;
  locationButton.addEventListener('click', async () => {
    locationButton.disabled = true;
    const result = reportDialog.querySelector('#location-result');
    result.textContent = 'Zjišťujeme polohu pouze pro toto hlášení…';
    try {
      const position = await locate();
      const measuredDistance = haversineMeters(position, route.location);
      if (!Number.isFinite(measuredDistance)) throw new Error('Referenční poloha místa není platná.');
      const distance = Math.round(measuredDistance);
      locationCheck = { state: distance <= Math.max(250, position.accuracy) ? 'nearby' : 'away', accuracy: Math.round(position.accuracy), distance };
      result.textContent = `Od referenčního bodu ${distance < 1000 ? `${distance} m` : `${number(distance / 1000)} km`}, přesnost ±${Math.round(position.accuracy)} m.`;
    } catch (error) { locationCheck = { state: 'unavailable', accuracy: null, distance: null }; result.textContent = errorMessage(error); }
    finally { if (reportDialog.open) locationButton.disabled = false; }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || preparing || photoError) return;
    errorBox.textContent = '';
    const data = new FormData(form);
    const date = new Date(data.get('observedAt'));
    const input = {
      routeId: route.id, kind: data.get('kind'), note: data.get('note'),
      author: data.get('author'), observedAt: Number.isNaN(date.valueOf()) ? '' : date.toISOString(),
      tags: Array.from(selectedTags),
    };
    const validation = validateReport(input);
    if (!validation.valid) { errorBox.textContent = validation.errors.join(' '); return; }

    saving = true; updateSubmit(); close.disabled = true; fileInput.disabled = true; locationButton.disabled = true;
    submit.textContent = 'Ukládáme…';
    try {
      const existingReports = await state.repo.listReports(route.id);
      const isPioneer = isPioneerEligible(existingReports);

      await state.repo.createReport({ ...validation.value, photoBlob, locationCheck, tags: Array.from(selectedTags) });
      try { localStorage.setItem('czekpoint.author', validation.value.author); } catch {}

      // Update trophies and visit
      const meta = loadWalkMeta();
      if (photoBlob) {
        if (!visitFor(route.id)) await state.repo.addVisit(route.id);
        meta.tiers[route.id] = 'gold';
        if (isPioneer && !meta.pioneerAwards?.includes(route.id)) {
          meta.pioneerAwards = [...(meta.pioneerAwards || []), route.id];
          toast('⭐ Získán Bonus Průkopníka (+100 b.) za čerstvou fotku!');
        } else {
          toast('🥇 Získána Zlatá trofej místa (+120 b.)!');
        }
      } else {
        if (meta.tiers[route.id] !== 'gold') meta.tiers[route.id] = 'silver';
      }
      saveWalkMeta(meta);
      await refreshPersonal();

      saving = false; reportDialog.close();
      await renderPage();
      document.querySelector('#hlaseni')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!photoBlob) toast(local ? 'Zkušenost je uložená v tomto prohlížeči.' : 'Zkušenost čeká na schválení. Zatím ji vidíš jen ty.');
    } catch (error) {
      errorBox.textContent = errorMessage(error); saving = false; close.disabled = false; fileInput.disabled = false; locationButton.disabled = !route.location; submit.innerHTML = `${icon('plus')}${local ? 'Uložit zkušenost' : 'Odeslat ke schválení'}`; updateSubmit();
    }
  });

  reportDialog.showModal();
}

document.addEventListener('click', async event => {
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
    if (action === 'report' && route) { openReport(route); return; }
    if (action === 'reload') { await renderPage(); return; }
    if (action === 'save' && route) {
      button.disabled = true; await state.repo.toggleSaved(id); await refreshPersonal();
      if (state.view === 'explore') renderExploreResults(); else if (state.view === 'passport') renderPassport(); else await renderPage();
      toast(isSaved(id) ? 'Výlet máš uložený na později.' : 'Výlet byl odebrán z uložených.'); return;
    }
    if (action === 'visit' && route) {
      const visited = Boolean(visitFor(id));
      if (visited && !await askConfirmation('Odebrat návštěvu z pasu?', `Místo „${route.title}“ zůstane mezi výlety. Odstraní se pouze tvůj záznam návštěvy.`, 'Odebrat návštěvu')) return;
      button.disabled = true;
      if (visited) {
        await state.repo.removeVisit(id);
      } else {
        await state.repo.addVisit(id);
        const meta = loadWalkMeta();
        if (meta.tiers[id] !== 'gold') meta.tiers[id] = 'silver';
        saveWalkMeta(meta);
      }
      await refreshPersonal(); await renderPage();
      toast(visited ? 'Návštěva byla odebrána.' : 'Další místo ve tvém výletovém pasu (+Stříbrná trofej).');
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
      if (!await askConfirmation('Smazat tuto zkušenost?', 'Odstraní se tvoje hlášení i přiložená fotografie. Tuto akci nejde vrátit.', 'Smazat hlášení')) return;
      button.disabled = true; await state.repo.deleteReport(id); await renderPage(); toast('Zkušenost byla smazána.'); return;
    }
    if (action === 'clear-local') {
      if (!await askConfirmation('Vymazat lokální data?', state.repo.mode === 'local' ? 'Z tohoto prohlížeče se smažou všechna testovací hlášení, fotky, návštěvy, uložená místa i odkrytá mapa, body a trofeje.' : 'Z tohoto prohlížeče se smaže výletový pas, uložená místa a herní průzkum s body. Serverové příspěvky ani přístup k nim se nemažou.', 'Vymazat data')) return;
      button.disabled = true;
      await state.repo.clearLocalData();
      clearWalk();
      clearWalkMeta();
      try { localStorage.removeItem('czekpoint.author'); } catch {}
      await refreshPersonal(); await renderPage(); toast('Lokální data včetně průzkumu byla vymazána.');
    }
  } catch (error) { toast(errorMessage(error), true); } finally { if (button.isConnected) button.disabled = false; }
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
    if (state.repo.mode === 'local') { banner.hidden = false; banner.innerHTML = 'Lokální test · Tvoje hlášení, fotky a pas zatím vidíš jen na tomto zařízení. <a href="#/o-projektu">Jak to funguje</a>'; }
    await renderPage();
  } catch (error) {
    main.innerHTML = `<div class="empty-state">${icon('warning')}<h1>Data se nepodařilo připravit.</h1><p>${e(errorMessage(error))}</p><p>Data nejsou nahrazena ukázkou. Zkontroluj připojení a nastavení úložiště.</p><button type="button" class="button primary" id="retry-boot">Zkusit znovu</button></div>`;
    document.querySelector('#retry-boot').addEventListener('click', () => location.reload());
  }
}
boot();
