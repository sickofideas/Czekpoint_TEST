import { haversineMeters } from './domain.js';

const R = 6378137, RAD = Math.PI / 180;
export const CELL_SIZE = 128; // Mercator metres; about 83 ground metres in Rožmitál.
export const MAX_CELLS = 12000;
export const emptyWalk = () => ({version:1, cells:[], meters:0, discoveries:[]});
export function project(p) { return {x:R*p.lng*RAD, y:R*Math.log(Math.tan(Math.PI/4+p.lat*RAD/2))}; }
export function unproject(x,y) { return {lng:x/R/RAD, lat:(2*Math.atan(Math.exp(y/R))-Math.PI/2)/RAD}; }
export function cellId(p) { const q=project(p);return `${Math.floor(q.x/CELL_SIZE)}:${Math.floor(q.y/CELL_SIZE)}`; }
export function cellCenter(id) { const [x,y]=id.split(':').map(Number);return unproject((x+.5)*CELL_SIZE,(y+.5)*CELL_SIZE); }
export function cellBounds(id) { const [x,y]=id.split(':').map(Number);return [unproject(x*CELL_SIZE,y*CELL_SIZE),unproject((x+1)*CELL_SIZE,(y+1)*CELL_SIZE)]; }
export function parseWalk(raw) {
  if(raw==null)return emptyWalk();
  const p=JSON.parse(raw);
  if(p?.version!==1 || !Array.isArray(p.cells) || p.cells.length>MAX_CELLS || p.cells.some(id=>typeof id!=='string'||!/^[-\d]+:[-\d]+$/.test(id)||id.split(':').some(v=>!Number.isInteger(Number(v))||Math.abs(Number(v))>156544)) || new Set(p.cells).size!==p.cells.length || !Number.isFinite(p.meters)||p.meters<0||p.meters>1e9 || !Array.isArray(p.discoveries)||p.discoveries.length>5000 || p.discoveries.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9:/]{1,100}$/.test(id))) throw new Error('Uložený průzkum nelze přečíst. Data zachována; před resetem si je exportuj.');
  return {version:1,cells:p.cells,meters:p.meters,discoveries:[...new Set(p.discoveries)]};
}
export function score(p) { return p.cells.length*10 + Math.floor(p.meters/50) + Math.floor(p.cells.length/6)*25 + p.discoveries.length*30; }
export function trophies(p) {
  return [ ['first','První stopa',p.cells.length>=1,'Prozkoumej první dílek'],['scout','Průzkumník',p.cells.length>=6,'Prozkoumej 6 dílků'],['kilometer','Kilometr venku',p.meters>=1000,'Nasbírej 1 km chůze'],['wanderer','Tulák',p.cells.length>=25,'Prozkoumej 25 dílků'],['three','Dál než včera',p.meters>=3000,'Nasbírej 3 km chůze'],['place','Místní objev',p.discoveries.length>=1,'Přibliž se k načtenému skutečnému místu'] ].map(([id,title,earned,goal])=>({id,title,earned,goal}));
}
export function acceptFix(progress,anchor,fix,now=Date.now()) {
  const reject = reason => ({progress,anchor,accepted:false,reason});
  if(!fix || !['lat','lng','accuracy','timestamp'].every(k=>Number.isFinite(fix[k])) || Math.abs(fix.lat)>85 || Math.abs(fix.lng)>180 || fix.accuracy<0)return reject('Neplatná GPS poloha.');
  if(fix.accuracy>40)return reject(`GPS je nepřesná (±${Math.round(fix.accuracy)} m). Čekám na lepší signál.`);
  if(now-fix.timestamp>15000||fix.timestamp>now+5000)return reject('Čekám na čerstvou GPS polohu.');
  let meters=0;
  if(anchor) {
    const dt=(fix.timestamp-anchor.timestamp)/1000;
    if(dt<=0)return reject('Čekám na novou polohu.');
    const distance=haversineMeters(anchor,fix);
    if(dt>60) return {progress,anchor:fix,accepted:false,reason:'GPS se vrátila po výpadku. Pokračuj v chůzi; mezeru nepočítáme.'};
    if(distance/dt>3.5 || (Number.isFinite(fix.speed)&&fix.speed>3.5)) return {progress,anchor:fix,accepted:false,reason:'Příliš rychlý pohyb nebo skok GPS. Tento úsek nepočítáme.'};
    if(distance<Math.max(20,(anchor.accuracy+fix.accuracy)*.8))return reject('GPS běží. Pro další postup popojdi přibližně 20–60 metrů.');
    meters=distance;
  } else if(Number.isFinite(fix.speed)&&fix.speed>3.5) return reject('Počkej, až se budeš pohybovat pěšky.');
  const id=cellId(fix), fresh=!progress.cells.includes(id);
  if(fresh&&progress.cells.length>=MAX_CELLS)return reject('Dosažen limit místního pilotu. Exportuj svůj průzkum.');
  const next={...progress,cells:fresh?[...progress.cells,id]:progress.cells,meters:progress.meters+meters};
  const mystery=fresh&&next.cells.length%6===0;
  return {progress:next,anchor:fix,accepted:true,fresh,mystery,reason:mystery?'Mystery nález! Odhalil/a jsi další fragment příběhu. +25 bodů':fresh?'Nový dílek mapy! +10 bodů':'Pokračuješ po známé cestě. Vzdálenost přibývá.'};
}
export function discoverNearby(progress,fix,places) {
  const found=places.filter(p=>p.collectible!==false && !progress.discoveries.includes(p.id) && (haversineMeters(fix,p)??Infinity)<=60);
  return {...progress,discoveries:[...progress.discoveries,...found.map(p=>p.id)].slice(0,5000)};
}

/** Trail point retention: 1 hour (3600_000 ms), max 600 points */
export function appendTrail(trail, fix, now = Date.now()) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return Array.isArray(trail) ? trail : [];
  const fresh = (Array.isArray(trail) ? trail : []).filter((p) => p && Number.isFinite(p.ts) && now - p.ts <= 3600_000 && p.ts <= now + 5000);
  const point = {
    lat: Math.round(fix.lat * 1e5) / 1e5,
    lng: Math.round(fix.lng * 1e5) / 1e5,
    ts: now,
  };
  return [...fresh, point].slice(-600);
}

/** Prunes points older than 1h and returns them with computed opacity 0.15 - 0.9 */
export function pruneTrail(trail, now = Date.now()) {
  const list = Array.isArray(trail) ? trail : [];
  return list
    .filter((p) => p && Number.isFinite(p.ts) && now - p.ts <= 3600_000 && p.ts <= now + 5000)
    .map((p) => {
      const age = Math.max(0, now - p.ts);
      const ratio = 1 - Math.min(1, age / 3600_000);
      const opacity = Math.round((0.15 + 0.75 * ratio) * 100) / 100;
      return { lat: p.lat, lng: p.lng, ts: p.ts, opacity };
    });
}

/** Explorer levels and ranks */
export function explorerRank(totalPoints = 0) {
  const pts = Math.max(0, Number(totalPoints) || 0);
  if (pts < 200) {
    return { level: 1, title: 'Sváteční chodec', nextAt: 200, fogRadiusM: 65, revealDistanceM: 180 };
  } else if (pts < 500) {
    return { level: 2, title: 'Místní stopař', nextAt: 500, fogRadiusM: 78, revealDistanceM: 230 };
  } else if (pts < 1000) {
    return { level: 3, title: 'Průzkumník Třemšínska', nextAt: 1000, fogRadiusM: 92, revealDistanceM: 290 };
  } else if (pts < 2000) {
    return { level: 4, title: 'Strážce stezek', nextAt: 2000, fogRadiusM: 110, revealDistanceM: 360 };
  } else {
    return { level: 5, title: 'Král Brd', nextAt: null, fogRadiusM: 130, revealDistanceM: 450 };
  }
}

/** SnowRunner style sector completion and unlocks */
export function sectorStatus(sectors, routes, tiers = {}) {
  const sectorList = Array.isArray(sectors) ? sectors : Object.values(sectors || {});
  const result = {};
  for (const sector of sectorList) {
    const sectorPlaces = (Array.isArray(routes) ? routes : []).filter(
      (r) => r.sector === sector.id && (r.pointKind === 'place' || !r.pointKind)
    );
    const total = sectorPlaces.length;
    const goldCount = sectorPlaces.filter((r) => tiers?.[r.id] === 'gold').length;
    const bronzeCount = sectorPlaces.filter((r) => Boolean(tiers?.[r.id])).length;
    const unlocked = total > 0 && goldCount === total;
    result[sector.id] = {
      id: sector.id,
      title: sector.title,
      total,
      completed: goldCount,
      bronzeCount,
      unlocked,
      bonusPoints: sector.bonusPoints ?? 300,
      sealTitle: sector.sealTitle,
      center: sector.center,
      radiusM: sector.radiusM,
    };
  }
  return result;
}

/** Deterministic daily challenge per date string YYYY-MM-DD */
export function dailyChallenge(dateStr, progress = {}, sessionStats = {}, meta = {}) {
  const challenges = [
    { id: 'cells', title: 'Odkryj 3 nové dílky v mlze', target: 3, points: 50, metric: sessionStats?.cells ?? 0 },
    { id: 'distance', title: 'Ujdi na procházce alespoň 500 m', target: 500, points: 50, metric: sessionStats?.meters ?? 0 },
    { id: 'trophy', title: 'Získej nebo vylepši 1 trofej místa', target: 1, points: 80, metric: sessionStats?.trophies ?? 0 },
  ];
  let hash = 0;
  const str = String(dateStr || '');
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  const index = Math.abs(hash) % challenges.length;
  const ch = challenges[index];
  const progressVal = ch.metric || 0;
  const completed = progressVal >= ch.target;
  const claimed = Boolean(meta?.dailyClaimed?.includes(str));
  return { ...ch, date: str, progress: progressVal, completed, claimed };
}

/** Comprehensive explorer score */
export function totalScore(progress = emptyWalk(), meta = {}, sectors = {}, collections = {}, routes = []) {
  let pts = score(progress);
  for (const [placeId, tier] of Object.entries(meta?.tiers || {})) {
    const hasDisc = progress.discoveries?.some((d) => d === `catalog:${placeId}` || d === placeId);
    if (tier === 'gold') pts += hasDisc ? 90 : 120;
    else if (tier === 'silver') pts += hasDisc ? 30 : 60;
    else if (tier === 'bronze' && !hasDisc) pts += 30;
  }
  pts += (meta?.pioneerAwards || []).length * 100;
  const sStatus = sectorStatus(sectors, routes, meta?.tiers);
  pts += Object.values(sStatus).filter((s) => s.unlocked).reduce((sum, s) => sum + (s.bonusPoints || 300), 0);
  for (const col of Object.values(collections || {})) {
    const allDone = col.routeIds?.length > 0 && col.routeIds.every((id) => Boolean(meta?.tiers?.[id]));
    if (allDone) pts += col.bonusPoints || 200;
  }
  pts += (meta?.dailyClaimed || []).length * 50;
  return pts;
}
