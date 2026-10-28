/**
 * Czekpoint v1.2 — Koláž z fotek navštívených míst na pohlednici (Bod 6)
 *
 * Generuje SVG a PNG pohlednici („Pozdrav z výpravy“):
 * - Při 1 navštíveném místě: velká hlavní fotka v polaroidovém rámečku s popiskem místa.
 * - Při 2–4+ navštívených místech: stylová mřížka (koláž 1+2 nebo 2×2 polaroidových snímků
 *   s jemnými bílými okraji a názvy navštívených míst na každé fotce),
 *   doplněná o razítko Czekpointu, mini-mapu prošlé trasy, ušlé kilometry, nastoupané metry a získané body.
 */

import { generateCategoryPlaceSvgDataUrl } from './place-photos.js';
import { formatPostcardDistance, renderPostcard as renderCanvasPostcard } from './postcard.js';

function escapeXml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildMiniMapPathSvg(trailCoords = [], boxX = 720, boxY = 930, boxW = 270, boxH = 175) {
  const flat = [];
  if (Array.isArray(trailCoords)) {
    for (const item of trailCoords) {
      if (Array.isArray(item) && item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
        flat.push({ lat: Number(item[0]), lng: Number(item[1]) });
      } else if (Array.isArray(item)) {
        for (const sub of item) {
          if (Array.isArray(sub) && sub.length >= 2 && Number.isFinite(Number(sub[0]))) {
            flat.push({ lat: Number(sub[0]), lng: Number(sub[1]) });
          } else if (sub && Number.isFinite(Number(sub.lat)) && Number.isFinite(Number(sub.lng))) {
            flat.push({ lat: Number(sub.lat), lng: Number(sub.lng) });
          }
        }
      } else if (item && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng))) {
        flat.push({ lat: Number(item.lat), lng: Number(item.lng) });
      }
    }
  }

  const pad = 22;
  const innerW = boxW - pad * 2;
  const innerH = boxH - pad * 2 - 16;

  if (flat.length < 2) {
    // Dekorativní smyčka prošlé trasy, pokud je záznam krátký
    const cx = boxX + boxW / 2;
    const cy = boxY + boxH / 2 - 6;
    return `
      <g class="postcard-minimap">
        <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="16" fill="#ebe6d5" stroke="#b5a886" stroke-width="2.5"/>
        <path d="M ${cx - 68} ${cy + 22} Q ${cx - 25} ${cy - 48} ${cx + 25} ${cy - 18} T ${cx + 72} ${cy + 16}" fill="none" stroke="#2b583f" stroke-width="4.5" stroke-dasharray="7,5" stroke-linecap="round"/>
        <circle cx="${cx - 68}" cy="${cy + 22}" r="6" fill="#2b583f" stroke="#ffffff" stroke-width="2"/>
        <circle cx="${cx + 72}" cy="${cy + 16}" r="7" fill="#d9480f" stroke="#ffffff" stroke-width="2"/>
        <text x="${boxX + boxW / 2}" y="${boxY + boxH - 12}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#46594b">🗺️ MINI-MAPA PROŠLÉ TRASY</text>
      </g>
    `;
  }

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of flat) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const latSpan = Math.max(0.0008, maxLat - minLat);
  const lngSpan = Math.max(0.0008, maxLng - minLng);

  const toX = lng => boxX + pad + ((lng - minLng) / lngSpan) * innerW;
  const toY = lat => boxY + pad + innerH - ((lat - minLat) / latSpan) * innerH;

  const pathPts = flat.map(p => `${toX(p.lng).toFixed(1)},${toY(p.lat).toFixed(1)}`);
  const d = `M ${pathPts.join(' L ')}`;
  const startPt = flat[0];
  const endPt = flat[flat.length - 1];

  return `
    <g class="postcard-minimap">
      <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="16" fill="#ebe6d5" stroke="#b5a886" stroke-width="2.5"/>
      <path d="${d}" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
      <path d="${d}" fill="none" stroke="#23573c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${toX(startPt.lng).toFixed(1)}" cy="${toY(startPt.lat).toFixed(1)}" r="6" fill="#23573c" stroke="#ffffff" stroke-width="2"/>
      <circle cx="${toX(endPt.lng).toFixed(1)}" cy="${toY(endPt.lat).toFixed(1)}" r="7" fill="#d9480f" stroke="#ffffff" stroke-width="2"/>
      <text x="${boxX + boxW / 2}" y="${boxY + boxH - 12}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#46594b">🗺️ MINI-MAPA PROŠLÉ TRASY</text>
    </g>
  `;
}

function renderPolaroidSlotSvg({ x, y, w, h, rot = 0, place, clipId }) {
  const title = String(place?.title || 'Navštívené místo').trim();
  const shortTitle = title.length > 30 ? title.slice(0, 28).trim() + '…' : title;
  const rawPhoto = place?.photoUrl || generateCategoryPlaceSvgDataUrl(place);
  const safeHref = escapeXml(rawPhoto);
  const borderPad = 14;
  const bottomCaptionH = 54;
  const imgW = Math.max(40, w - borderPad * 2);
  const imgH = Math.max(40, h - borderPad - bottomCaptionH);
  const cx = x + w / 2;
  const cy = y + h / 2;

  return `
    <g class="postcard-polaroid" transform="rotate(${rot} ${cx} ${cy})">
      <rect x="${x + 4}" y="${y + 7}" width="${w}" height="${h}" rx="12" fill="rgba(22, 36, 28, 0.18)"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#ffffff" stroke="#dcd6c6" stroke-width="2"/>
      <defs>
        <clipPath id="${clipId}">
          <rect x="${x + borderPad}" y="${y + borderPad}" width="${imgW}" height="${imgH}" rx="7"/>
        </clipPath>
      </defs>
      <g clip-path="url(#${clipId})">
        <rect x="${x + borderPad}" y="${y + borderPad}" width="${imgW}" height="${imgH}" fill="#264738"/>
        <image href="${safeHref}" x="${x + borderPad}" y="${y + borderPad}" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid slice"/>
      </g>
      <text x="${x + w / 2}" y="${y + h - 20}" text-anchor="middle" font-family="Georgia, serif" font-size="19" font-weight="700" fill="#193e32">📍 ${escapeXml(shortTitle)}</text>
    </g>
  `;
}

/**
 * Vygeneruje kompletní SVG pohlednici s koláží navštívených míst (`visitedPlacesWithPhotos`),
 * razítkem Czekpointu, mini-mapou prošlé trasy, ušlými kilometry, nastoupanými metry a získanými body.
 */
export function renderPostcardSvg(summary = {}) {
  const W = 1080;
  const H = 1350;
  const rawPlaces = Array.isArray(summary.visitedPlacesWithPhotos)
    ? summary.visitedPlacesWithPhotos.filter(Boolean)
    : [];

  const distLabel = formatPostcardDistance(Number(summary.distanceMeters) || 0);
  const gainM = Math.max(0, Math.round(Number(summary.elevationGainM ?? summary.gainM) || 0));
  const pointsEarned = Math.max(0, Math.round(Number(summary.pointsEarned) || 0));
  const stampsCount = Math.max(rawPlaces.length, Math.round(Number(summary.newStampsCount ?? summary.stampsCount) || 0));
  const dateStr = summary.date
    ? new Date(summary.date).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });

  let collageHtml = '';
  const areaX = 86;
  const areaY = 265;
  const areaW = W - 172; // 908
  const areaH = 610;

  if (rawPlaces.length === 0) {
    const defaultPlace = {
      title: summary.areaLabel || 'Putování krajinou s Czekpointem',
      kind: 'view',
      category: 'views',
    };
    collageHtml = renderPolaroidSlotSvg({
      x: areaX + 30,
      y: areaY + 10,
      w: areaW - 60,
      h: areaH - 20,
      rot: -0.8,
      place: defaultPlace,
      clipId: 'pc-clip-0',
    });
  } else if (rawPlaces.length === 1) {
    // Při 1 navštíveném místě: velká hlavní fotka v rámečku s popiskem místa
    collageHtml = renderPolaroidSlotSvg({
      x: areaX + 24,
      y: areaY + 8,
      w: areaW - 48,
      h: areaH - 16,
      rot: -1.1,
      place: rawPlaces[0],
      clipId: 'pc-clip-single',
    });
  } else if (rawPlaces.length === 2) {
    // 2 navštívená místa: 2 velké polaroidové snímky vedle sebe
    const colW = Math.floor((areaW - 28) / 2);
    collageHtml =
      renderPolaroidSlotSvg({
        x: areaX,
        y: areaY + 20,
        w: colW,
        h: areaH - 40,
        rot: -1.8,
        place: rawPlaces[0],
        clipId: 'pc-clip-2a',
      }) +
      renderPolaroidSlotSvg({
        x: areaX + colW + 28,
        y: areaY + 24,
        w: colW,
        h: areaH - 40,
        rot: 1.6,
        place: rawPlaces[1],
        clipId: 'pc-clip-2b',
      });
  } else if (rawPlaces.length === 3) {
    // 1+2 koláž: velký snímek vlevo + 2 snímky vpravo nad sebou
    const leftW = Math.floor(areaW * 0.53);
    const rightW = areaW - leftW - 24;
    const halfH = Math.floor((areaH - 22) / 2);
    collageHtml =
      renderPolaroidSlotSvg({
        x: areaX,
        y: areaY,
        w: leftW,
        h: areaH,
        rot: -1.2,
        place: rawPlaces[0],
        clipId: 'pc-clip-3a',
      }) +
      renderPolaroidSlotSvg({
        x: areaX + leftW + 24,
        y: areaY,
        w: rightW,
        h: halfH,
        rot: 1.4,
        place: rawPlaces[1],
        clipId: 'pc-clip-3b',
      }) +
      renderPolaroidSlotSvg({
        x: areaX + leftW + 24,
        y: areaY + halfH + 22,
        w: rightW,
        h: halfH,
        rot: -1.1,
        place: rawPlaces[2],
        clipId: 'pc-clip-3c',
      });
  } else {
    // 4+ navštívených míst: mřížka 2×2 polaroidových snímků
    const items = rawPlaces.slice(0, 4);
    const colW = Math.floor((areaW - 26) / 2);
    const rowH = Math.floor((areaH - 24) / 2);
    const rots = [-1.4, 1.3, 1.1, -1.3];
    collageHtml = items
      .map((pl, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        return renderPolaroidSlotSvg({
          x: areaX + col * (colW + 26),
          y: areaY + row * (rowH + 24),
          w: colW,
          h: rowH,
          rot: rots[idx] || 0,
          place: pl,
          clipId: `pc-clip-4-${idx}`,
        });
      })
      .join('');
  }

  const miniMapSvg = buildMiniMapPathSvg(
    summary.trailCoordinates || summary.walkSegments || [],
    704,
    926,
    290,
    188
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>
      <linearGradient id="pcBg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#faf8f0"/>
        <stop offset="55%" stop-color="#f3efe2"/>
        <stop offset="100%" stop-color="#e8e3d1"/>
      </linearGradient>
    </defs>

    <!-- Pergamenový podklad pohlednice -->
    <rect width="${W}" height="${H}" fill="url(#pcBg)"/>
    <rect x="34" y="34" width="${W - 68}" height="${H - 68}" rx="18" fill="none" stroke="#1e4032" stroke-width="12"/>
    <rect x="50" y="50" width="${W - 100}" height="${H - 100}" rx="10" fill="none" stroke="#b9cba8" stroke-width="3"/>

    <!-- Hlavička pohlednice -->
    <text x="${W / 2}" y="114" text-anchor="middle" font-family="Georgia, serif" font-size="26" font-weight="700" fill="#193e32" letter-spacing="6">C Z E K P O I N T</text>
    <text x="${W / 2}" y="176" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="48" font-weight="700" fill="#193e32">POZDRAV Z VÝPRAVY</text>
    <text x="${W / 2}" y="216" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="#596f60" letter-spacing="2">OSOBNÍ ATLAS PROCHÁZEK · ${escapeXml(dateStr.toUpperCase())}</text>

    <line x1="140" y1="238" x2="${W - 140}" y2="238" stroke="#9eb592" stroke-width="2"/>

    <!-- Koláž navštívených míst (Polaroid mřížka) -->
    <g class="postcard-collage-group">
      ${collageHtml}
    </g>

    <!-- Statistiky výpravy vlevo dole + Mini-mapa prošlé trasy vpravo dole -->
    <g class="postcard-stats-group">
      <!-- Karta 1: Ušlé kilometry -->
      <rect x="86" y="926" width="290" height="86" rx="14" fill="#ffffff" stroke="#c8d6bd" stroke-width="2.5"/>
      <text x="112" y="962" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#5e7464">👣 UŠLÁ VZDÁLENOST</text>
      <text x="112" y="996" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#193e32">${escapeXml(distLabel)}</text>

      <!-- Karta 2: Nastoupané metry -->
      <rect x="395" y="926" width="290" height="86" rx="14" fill="#ffffff" stroke="#c8d6bd" stroke-width="2.5"/>
      <text x="421" y="962" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#5e7464">⛰️ NASTOUPANÉ METRY</text>
      <text x="421" y="996" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#193e32">+${gainM} m</text>

      <!-- Karta 3: Navštívená místa / razítka -->
      <rect x="86" y="1028" width="290" height="86" rx="14" fill="#ffffff" stroke="#c8d6bd" stroke-width="2.5"/>
      <text x="112" y="1064" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#5e7464">📍 NAVŠTÍVENÁ MÍSTA</text>
      <text x="112" y="1098" font-family="Georgia, serif" font-size="28" font-weight="700" fill="#193e32">${stampsCount} ${stampsCount === 1 ? 'místo' : stampsCount >= 2 && stampsCount <= 4 ? 'místa' : 'míst'}</text>

      <!-- Karta 4: Získané body -->
      <rect x="395" y="1028" width="290" height="86" rx="14" fill="#eef5dc" stroke="#a6c46c" stroke-width="2.5"/>
      <text x="421" y="1064" font-family="system-ui, sans-serif" font-size="14" font-weight="800" fill="#3b5e2b">⭐ ZÍSKANÉ BODY</text>
      <text x="421" y="1098" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#234718">+${pointsEarned} bodů</text>
    </g>

    <!-- Mini-mapa prošlé trasy -->
    ${miniMapSvg}

    <!-- Poštovní razítko Czekpointu a patička -->
    <g transform="translate(185, 1215) rotate(-6)">
      <circle cx="0" cy="0" r="64" fill="none" stroke="#8c3b2b" stroke-width="4" stroke-dasharray="7,4"/>
      <circle cx="0" cy="0" r="54" fill="none" stroke="#8c3b2b" stroke-width="2"/>
      <text x="0" y="-20" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="800" fill="#8c3b2b" letter-spacing="2">CZEKPOINT</text>
      <text x="0" y="5" text-anchor="middle" font-family="Georgia, serif" font-size="18" font-weight="700" fill="#8c3b2b">OVĚŘENO GPS</text>
      <text x="0" y="26" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#8c3b2b">v1.2 · ČR</text>
    </g>

    <text x="295" y="1202" font-family="Georgia, serif" font-style="italic" font-size="27" fill="#1e4032">„Každý krok zanechá stopu v paměti.“</text>
    <text x="295" y="1236" font-family="system-ui, sans-serif" font-size="17" font-weight="600" fill="#5a7060">Czekpoint · Osobní atlas procházek a objevování krajiny</text>
    <text x="295" y="1264" font-family="monospace" font-size="14" fill="#7d9182">ID výpravy: ${escapeXml(String(summary.id || summary.expeditionId || 'exp_v1.2').slice(0, 24))}</text>
  </svg>`;
}

/**
 * Vrátí Data URL SVG pohlednice s koláží navštívených míst.
 */
export function renderPostcardSvgDataUrl(summary = {}) {
  const svg = renderPostcardSvg(summary);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export { renderCanvasPostcard as renderPostcard, formatPostcardDistance };
