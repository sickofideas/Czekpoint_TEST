import { ALLOWED_AVATAR_IDS, validateAvatarId } from './avatars.js';

export const POSTCARD_WIDTH = 1080;
export const POSTCARD_HEIGHT = 1350;

/**
 * Deterministic PRNG from string seed (MurmurHash3 / Mulberry32).
 */
export function createRng(seedStr = '') {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  }
  return function () {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Validates and sanitizes postcard metadata.
 * Explicitly rejects photos, external URLs, HTML, and unauthorized fields.
 */
export function validatePostcardMetadata(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Neplatná metadata pohlednice.');
  }

  // Reject forbidden user content
  if ('photo' in raw || 'photoUrl' in raw || 'photoBlob' in raw || 'image' in raw || 'svg' in raw || 'html' in raw) {
    throw new Error('Pohlednice nepřijímá vstupní fotografie ani externí grafiku.');
  }

  const expeditionId = typeof raw.expeditionId === 'string' && raw.expeditionId ? raw.expeditionId.slice(0, 80) : 'exp_default';
  const avatarId = validateAvatarId(raw.avatarId);
  const distanceMeters = Math.max(0, Math.min(1e8, Number(raw.distanceMeters) || 0));
  const cellsCount = Math.max(0, Math.min(10000, Number(raw.cellsCount) || 0));
  const stampsCount = Math.max(0, Math.min(1000, Number(raw.stampsCount) || 0));
  const templateVersion = Number(raw.templateVersion) === 1 ? 1 : 1;

  const validCategories = ['water', 'forest', 'culture', 'view'];
  const categories = Array.isArray(raw.categories)
    ? [...new Set(raw.categories.filter(c => validCategories.includes(c)))]
    : [];

  return {
    expeditionId,
    avatarId,
    distanceMeters,
    cellsCount,
    stampsCount,
    categories,
    templateVersion,
  };
}

/**
 * Formats distance safely for postcard presentation without coordinates or timing.
 */
export function formatPostcardDistance(meters) {
  if (meters >= 1000) {
    const km = (meters / 1000).toFixed(1).replace('.', ',');
    return `${km} km`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Renders the 1080x1350 illustrated postcard onto a Canvas rendering context.
 */
export function renderPostcard(canvas, rawMetadata) {
  const meta = validatePostcardMetadata(rawMetadata);
  const rng = createRng(meta.expeditionId);

  canvas.width = POSTCARD_WIDTH;
  canvas.height = POSTCARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = POSTCARD_WIDTH;
  const H = POSTCARD_HEIGHT;

  // 1. Rich textured parchment background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, '#f9f8f2');
  bgGrad.addColorStop(0.5, '#f4f3ea');
  bgGrad.addColorStop(1, '#ebeee0');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Decorative border
  ctx.strokeStyle = '#2b4f40';
  ctx.lineWidth = 14;
  ctx.strokeRect(36, 36, W - 72, H - 72);

  ctx.strokeStyle = '#c6d8b2';
  ctx.lineWidth = 4;
  ctx.strokeRect(52, 52, W - 104, H - 104);

  // 2. Corner flourishes
  const cornerSize = 40;
  ctx.fillStyle = '#2b4f40';
  ctx.fillRect(52, 52, cornerSize, 6);
  ctx.fillRect(52, 52, 6, cornerSize);
  ctx.fillRect(W - 52 - cornerSize, 52, cornerSize, 6);
  ctx.fillRect(W - 58, 52, 6, cornerSize);
  ctx.fillRect(52, H - 58, cornerSize, 6);
  ctx.fillRect(52, H - 52 - cornerSize, 6, cornerSize);
  ctx.fillRect(W - 52 - cornerSize, H - 58, cornerSize, 6);
  ctx.fillRect(W - 58, H - 52 - cornerSize, 6, cornerSize);

  // 3. Top Header
  ctx.fillStyle = '#193e32';
  ctx.textAlign = 'center';
  ctx.font = 'bold 32px Georgia, serif';
  ctx.letterSpacing = '8px';
  ctx.fillText('C Z E K P O I N T', W / 2, 130);

  ctx.font = 'italic 54px Georgia, serif';
  ctx.letterSpacing = '2px';
  ctx.fillStyle = '#1c3e32';
  ctx.fillText('Moje malá výprava', W / 2, 205);

  ctx.font = '22px sans-serif';
  ctx.fillStyle = '#5c7263';
  ctx.letterSpacing = '4px';
  ctx.fillText('OTISK CESTY · OSOBNÍ ATLAS', W / 2, 245);

  // Decorative header line with diamond
  ctx.strokeStyle = '#8da97e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(140, 265);
  ctx.lineTo(W / 2 - 20, 265);
  ctx.moveTo(W / 2 + 20, 265);
  ctx.lineTo(W - 140, 265);
  ctx.stroke();

  ctx.fillStyle = '#4a6d51';
  ctx.beginPath();
  ctx.arc(W / 2, 265, 6, 0, Math.PI * 2);
  ctx.fill();

  // 4. Center Landscape Illustration Box
  const illX = 90;
  const illY = 295;
  const illW = W - 180;
  const illH = 590;

  ctx.save();
  ctx.beginPath();
  ctx.rect(illX, illY, illW, illH);
  ctx.clip();

  // Sky
  const skyGrad = ctx.createLinearGradient(0, illY, 0, illY + illH);
  skyGrad.addColorStop(0, '#dbe7dd');
  skyGrad.addColorStop(0.6, '#edf3e7');
  skyGrad.addColorStop(1, '#f7f6ec');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(illX, illY, illW, illH);

  // Sun / Moon
  const sunX = illX + illW * 0.75 + (rng() - 0.5) * 80;
  const sunY = illY + 110;
  ctx.fillStyle = '#fae19c';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 54, 0, Math.PI * 2);
  ctx.fill();

  // Mountains in background
  ctx.fillStyle = '#9fb89c';
  ctx.beginPath();
  ctx.moveTo(illX, illY + 410);
  ctx.lineTo(illX + 180, illY + 260);
  ctx.lineTo(illX + 380, illY + 380);
  ctx.lineTo(illX + 580, illY + 230);
  ctx.lineTo(illX + illW, illY + 430);
  ctx.lineTo(illX + illW, illY + illH);
  ctx.lineTo(illX, illY + illH);
  ctx.closePath();
  ctx.fill();

  // Mid-ground hills
  ctx.fillStyle = '#6f966d';
  ctx.beginPath();
  ctx.moveTo(illX, illY + 450);
  ctx.quadraticCurveTo(illX + 260, illY + 340, illX + 500, illY + 440);
  ctx.quadraticCurveTo(illX + 720, illY + 380, illX + illW, illY + 470);
  ctx.lineTo(illX + illW, illY + illH);
  ctx.lineTo(illX, illY + illH);
  ctx.closePath();
  ctx.fill();

  // Foreground rolling terrain
  ctx.fillStyle = '#426848';
  ctx.beginPath();
  ctx.moveTo(illX, illY + 500);
  ctx.quadraticCurveTo(illX + 340, illY + 450, illX + illW, illY + 520);
  ctx.lineTo(illX + illW, illY + illH);
  ctx.lineTo(illX, illY + illH);
  ctx.closePath();
  ctx.fill();

  // Category specific motifs
  const hasWater = meta.categories.includes('water');
  const hasCulture = meta.categories.includes('culture');
  const hasForest = meta.categories.includes('forest') || meta.categories.length === 0;
  const hasView = meta.categories.includes('view');

  if (hasWater) {
    // Water basin / lake at bottom
    ctx.fillStyle = '#548882';
    ctx.beginPath();
    ctx.ellipse(illX + illW / 2, illY + 540, illW * 0.45, 65, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wave ripples
    ctx.strokeStyle = '#d4ebe5';
    ctx.lineWidth = 3;
    for (let r = 0; r < 4; r++) {
      ctx.beginPath();
      const wy = illY + 515 + r * 15;
      ctx.moveTo(illX + illW * 0.25, wy);
      ctx.quadraticCurveTo(illX + illW * 0.5, wy - 8, illX + illW * 0.75, wy);
      ctx.stroke();
    }
  }

  if (hasCulture) {
    // Castle / historic silhouette on the left ridge
    ctx.fillStyle = '#263b2c';
    const cx = illX + 120;
    const cy = illY + 340;
    // Tower 1
    ctx.fillRect(cx, cy, 50, 90);
    // Battlements
    ctx.fillRect(cx - 5, cy - 12, 18, 14);
    ctx.fillRect(cx + 17, cy - 12, 16, 14);
    ctx.fillRect(cx + 37, cy - 12, 18, 14);
    // Wall
    ctx.fillRect(cx + 50, cy + 30, 80, 60);
    // Tower 2
    ctx.fillRect(cx + 130, cy + 10, 40, 80);
    ctx.beginPath();
    ctx.moveTo(cx + 125, cy + 10);
    ctx.lineTo(cx + 150, cy - 25);
    ctx.lineTo(cx + 175, cy + 10);
    ctx.closePath();
    ctx.fill();
  }

  if (hasForest) {
    // Pine trees
    ctx.fillStyle = '#1c3e29';
    const treeCount = 8;
    for (let i = 0; i < treeCount; i++) {
      const tx = illX + 80 + i * (illW - 160) / treeCount + (rng() - 0.5) * 30;
      const ty = illY + 440 + (rng() - 0.5) * 40;
      const th = 85 + rng() * 45;
      const tw = th * 0.45;

      ctx.beginPath();
      ctx.moveTo(tx, ty - th);
      ctx.lineTo(tx + tw / 2, ty);
      ctx.lineTo(tx - tw / 2, ty);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (hasView) {
    // Sun rays over peaks
    ctx.strokeStyle = 'rgba(250, 225, 156, 0.45)';
    ctx.lineWidth = 4;
    for (let a = -45; a <= 45; a += 15) {
      const rad = a * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(sunX, sunY);
      ctx.lineTo(sunX + Math.sin(rad) * 220, sunY + Math.cos(rad) * 220);
      ctx.stroke();
    }
  }

  ctx.restore();

  // Border around illustration
  ctx.strokeStyle = '#2b4f40';
  ctx.lineWidth = 6;
  ctx.strokeRect(illX, illY, illW, illH);

  // 5. Avatar Medallion in Center-Bottom of Frame
  const medX = W / 2;
  const medY = illY + illH;
  const medR = 80;

  // Medallion outer gold ring
  ctx.fillStyle = '#f7f5ec';
  ctx.beginPath();
  ctx.arc(medX, medY, medR + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b4f40';
  ctx.lineWidth = 6;
  ctx.stroke();

  // Medallion inner dark forest circle
  ctx.fillStyle = '#193e32';
  ctx.beginPath();
  ctx.arc(medX, medY, medR, 0, Math.PI * 2);
  ctx.fill();

  // Draw avatar badge
  ctx.fillStyle = '#d8e99e';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(meta.avatarId.toUpperCase(), medX, medY + 10);

  // 6. Stats and Achievements Row
  const statsY = 990;

  // Stats boxes
  const boxW = 260;
  const boxH = 120;
  const gap = 30;
  const totalRowW = boxW * 3 + gap * 2;
  const startX = (W - totalRowW) / 2;

  const boxes = [
    { label: 'UŠLÁ VZDÁLENOST', value: formatPostcardDistance(meta.distanceMeters), icon: '👣' },
    { label: 'NOVÉ DÍLKY', value: `${meta.cellsCount} ${meta.cellsCount === 1 ? 'dílek' : meta.cellsCount < 5 ? 'dílky' : 'dílků'}`, icon: '🗺️' },
    { label: 'GPS RAZÍTKA', value: `${meta.stampsCount} ${meta.stampsCount === 1 ? 'razítko' : meta.stampsCount < 5 ? 'razítka' : 'razítek'}`, icon: '⭐' },
  ];

  boxes.forEach((box, i) => {
    const bx = startX + i * (boxW + gap);
    ctx.fillStyle = '#f2f4ec';
    ctx.strokeStyle = '#bacdb1';
    ctx.lineWidth = 3;

    // Rounded box
    ctx.beginPath();
    ctx.roundRect(bx, statsY, boxW, boxH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.font = '24px sans-serif';
    ctx.fillText(box.icon, bx + boxW / 2, statsY + 36);

    ctx.fillStyle = '#193e32';
    ctx.font = 'bold 28px Georgia, serif';
    ctx.fillText(box.value, bx + boxW / 2, statsY + 74);

    ctx.fillStyle = '#687d6b';
    ctx.font = 'bold 13px sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillText(box.label, bx + boxW / 2, statsY + 100);
  });

  // 7. Bottom Postal Seal / Stamp & Signature
  const stampY = 1175;

  // Circular Postmark / Stamp
  const stampX = 220;
  const stampR = 64;

  ctx.save();
  ctx.translate(stampX, stampY);
  ctx.rotate(-0.08); // Slight organic rotation

  ctx.strokeStyle = '#8c4838';
  ctx.lineWidth = 4;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(0, 0, stampR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, stampR - 8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#8c4838';
  ctx.font = 'bold 14px sans-serif';
  ctx.letterSpacing = '2px';
  ctx.textAlign = 'center';
  ctx.fillText('CZEKPOINT', 0, -22);
  ctx.font = 'bold 18px Georgia, serif';
  ctx.fillText('PILOT · v0.8', 0, 4);
  ctx.font = '12px sans-serif';
  ctx.fillText('OVĚŘENO GPS', 0, 24);
  ctx.restore();

  // Bottom motto & sign-off
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2b4f40';
  ctx.font = 'italic 26px Georgia, serif';
  ctx.fillText('„Každý krok zanechá stopu v paměti.“', 340, stampY - 10);

  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#657d6d';
  ctx.letterSpacing = '1px';
  ctx.fillText('Osobní atlas procházek Rožmitálska · Uloženo v tomto zařízení', 340, stampY + 22);

  ctx.fillStyle = '#8ca393';
  ctx.font = '13px monospace';
  ctx.fillText(`ID výpravy: ${meta.expeditionId.slice(0, 20)}`, 340, stampY + 46);
}

/**
 * Generates PNG data URL from postcard metadata.
 */
export function generatePostcardDataUrl(metadata) {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  renderPostcard(canvas, metadata);
  return canvas.toDataURL('image/png');
}

/**
 * Generates PNG Blob from postcard metadata.
 */
export function generatePostcardBlob(metadata) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      return reject(new Error('Canvas is only available in browser environment.'));
    }
    const canvas = document.createElement('canvas');
    renderPostcard(canvas, metadata);
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Pohlednici se nepodařilo vygenerovat.'));
    }, 'image/png');
  });
}
