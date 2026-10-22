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
