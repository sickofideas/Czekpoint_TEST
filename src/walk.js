import { emptyWalk, acceptFix, cellBounds, cellCenter, score, trophies, discoverNearby } from './walk-engine.js';
import { loadWalk, saveWalk, WALK_KEY } from './walk-store.js';
import { fetchNearby } from './nearby.js';
import { haversineMeters } from './domain.js';
import { escapeHtml as e, number } from './ui.js';

export function mountWalk(root, routes, config) {
  const L=window.L;
  let progress=emptyWalk(),storageError='';
  try {progress=loadWalk();}catch(error){storageError=error.message;}
  let map, fog, tileLayer, player, accuracyRing, anchor=null, lastFix=null, watch=null, active=false, disposed=false, demo=false, demoIndex=0, releaseLock=null, wake=null, frame=null, starting=false;
  let sessionMeters=0, sessionCells=0, follow=true, reveal=true, nearby=[];
  const aborter=new AbortController();
  const catalogue=routes.filter(r=>r.location).map(r=>({id:`catalog:${r.id}`,title:r.pointKind==='place'?r.title:`Start výletu: ${r.title}`,lat:r.location.lat,lng:r.location.lng,url:`#/trasa/${r.id}`,collectible:r.pointKind==='place'}));
  root.innerHTML=`<section class="walk-heading"><div><div class="eyebrow">Malé kroky. Nový svět.</div><h1 tabindex="-1">Tvoje mapa dobrodružství.</h1><p>Vyraz, rozkryj mlhu a proměň obyčejnou procházku v malou výpravu.</p></div><span class="walk-tag">PROCHÁZKA · BETA</span></section>
  <div class="walk-stats" aria-label="Celkový průzkum"><div><strong id="walk-points">0</strong><span>bodů celkem</span></div><div><strong id="walk-cells">0</strong><span>odkrytých dílků</span></div><div><strong id="walk-distance">0</strong><span>km chůze celkem</span></div><div><strong id="walk-relics">0</strong><span>mystery nálezů</span></div></div>
  <div id="walk-demo-banner" class="notice" hidden>UKÁZKA · Simulovaný pohyb v Rožmitále. Žádná GPS, žádné ukládání bodů. Skutečnou návštěvu nepotvrzuje.</div>
  <div class="walk-map-wrap"><div id="walk-map" aria-label="Interaktivní mapa průzkumu"></div><div class="walk-map-toolbar"><button class="button small" id="walk-center">◎ Moje poloha</button><button class="button small" id="walk-fog" aria-pressed="true">Mlha: zapnutá</button></div></div>
  <p id="tile-status" class="small-note" role="status"></p>
  <div class="walk-controls"><button id="walk-start" class="button primary">▶ Vyrazit s GPS</button><button id="walk-stop" class="button" disabled>Ⅱ Pozastavit</button><button id="walk-demo" class="button">Ukázka bez GPS</button><button id="walk-step" class="button lime" hidden>Další krok ukázky</button></div>
  <div class="walk-status-panel"><strong id="walk-status" role="status" aria-live="polite">${e(storageError||'Připraveno. Venku spusť GPS a povol přístup k poloze.')}</strong><span id="walk-session">Dnes v této relaci: 0 m · 0 nových dílků</span><label><input type="checkbox" id="walk-awake" checked> Při chůzi držet displej zapnutý</label><span id="wake-status" class="small-note">Displej: zámek není aktivní.</span></div>
  <div class="walk-columns"><section class="panel"><h2>Co odhalíš za další zatáčkou?</h2><p id="walk-mystery"></p><div id="walk-collection" class="mystery-collection"></div><div id="walk-trophies" class="trophy-grid"></div><p class="small-note">Mystery nálezy jsou herní odměny za každých 6 nových dílků. Nejsou to skutečné předměty schované v terénu.</p></section>
  <section class="panel"><h2>Skutečná místa poblíž</h2><p>Muzea, vyhlídky a památky v okolí. Otazník se odhalí do 180 m; do 60 m získáš místní objev (+30 bodů).</p><button class="button" id="walk-nearby">Najít místa poblíž (OSM)</button><p class="small-note">Hledání odešle do Overpass API oblast kolem polohy zaokrouhlené na 0,01°. Bez přesné trasy. Body za chůzi fungují i bez hledání.</p><div id="nearby-status" role="status"></div><p id="nearby-origin" class="small-note"></p><div id="walk-places"></div><p class="small-note">Zdroj míst: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> a uvedené zdroje katalogu. Dostupnost ani vstup nejsou ověřeny. Vzdálenosti jsou vzdušné.</p></section></div>
  <details class="walk-help"><summary>Jak procházku testovat a co ukládáme</summary><p>Nech stránku v popředí. Při přepnutí aplikace, zamknutí telefonu nebo odchodu z této mapy záznam pozastavíme. Po návratu stiskni znovu Vyrazit s GPS. Používej HTTPS adresu GitHub Pages; soubor otevřený dvojklikem nefunguje.</p><p>Každý nový dílek přidá 10 bodů; každých 50 započítaných metrů 1 bod. Přesnost GPS musí být do 40 m. Stání, výpadky a rychlé skoky nebodují spolehlivě; nejde o krokoměr ani soutěžní důkaz chůze. Drž se veřejných cest. Odměny tě neposílají mimo cestu.</p><p>Odkryté dílky (přibližná poloha), vzdálenost a objevy zůstávají jen v tomto prohlížeči. Mapový podklad se načítá z OpenStreetMap, který vidí zobrazenou oblast a síťový požadavek. Mapu lze vždy odkrýt tlačítkem Mlha; to nepřidá body. Bez internetu se nové mapové podklady ani okolní místa nenačtou.</p><button id="walk-export" class="button small">Exportovat průzkum do JSON</button><p class="small-note">Export obsahuje přibližně navštívené oblasti. Reset je v Jak to funguje → Vymazat lokální testovací data. Ukázka skutečný průzkum nikdy nepřepisuje.</p></details>`;
  const $=id=>root.querySelector(`#${id}`);
  const status=text=>{if(!disposed)$('walk-status').textContent=text;};
  const placesLayer=L?.layerGroup();
  function drawFog(){
    if(!map||disposed)return;
    const canvas=fog, size=map.getSize(), ratio=Math.min(devicePixelRatio||1,2);
    canvas.width=size.x*ratio;canvas.height=size.y*ratio;canvas.style.width=`${size.x}px`;canvas.style.height=`${size.y}px`;
    L.DomUtil.setPosition(canvas,map.containerPointToLayerPoint([0,0]));
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
    if(!reveal)return;
    ctx.fillStyle='rgba(16,43,39,.79)';ctx.fillRect(0,0,size.x,size.y);
    ctx.globalCompositeOperation='destination-out';
    for(const id of progress.cells){const [sw,ne]=cellBounds(id),a=map.latLngToContainerPoint([ne.lat,sw.lng]),b=map.latLngToContainerPoint([sw.lat,ne.lng]);if(b.x<0||a.x>size.x||b.y<0||a.y>size.y)continue;ctx.fillRect(a.x-1,a.y-1,b.x-a.x+2,b.y-a.y+2);}
  }
  function scheduleFog(){if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=null;drawFog();});}
  function renderPlaces(){
    $('nearby-origin').textContent=demo?'Vzdálenosti od simulovaného bodu.':lastFix?'Vzdálenosti od poslední přijaté GPS polohy.':'Vzdálenosti od středu mapy, nikoli od tebe. Tvoji polohu ještě neznáme.';
    placesLayer?.clearLayers();
    const all=[...catalogue,...nearby];
    const origin=lastFix||map?.getCenter();
    const normalized=origin?{lat:origin.lat,lng:origin.lng}:null;
    const list=all.map(p=>({...p,distance:haversineMeters(normalized,p)??Infinity})).filter(p=>p.distance<=2500).sort((a,b)=>a.distance-b.distance);
    $('walk-places').innerHTML=list.slice(0,8).map(p=>{const known=p.distance<=180||progress.discoveries.includes(p.id)||!p.collectible;return `<div class="nearby-place"><strong>${known?e(p.title):'✧ Neodhalené místo'}</strong><span>${Math.round(p.distance)} m vzdušně ${progress.discoveries.includes(p.id)?'· objeveno':''}</span>${known?`<a href="${e(p.url)}" ${p.url.startsWith('#')?'':'target="_blank" rel="noopener"'}>Detail místa ↗</a>`:'<small>Přiblížením odhalíš, co tu je.</small>'}</div>`;}).join('')||'<p class="small-note">Zatím nemáme načtené místo v dosahu. Spusť GPS a hledej okolí; mapa se odkrývá i bez míst.</p>';
    if(!map)return;
    for(const p of list){const known=p.distance<=180||progress.discoveries.includes(p.id)||!p.collectible;L.marker([p.lat,p.lng],{icon:L.divIcon({className:'mystery-pin',html:progress.discoveries.includes(p.id)?'✓':known?'◇':'?',iconSize:[30,30]}),title:known?p.title:'Neodhalené místo'}).bindPopup(`<strong>${known?e(p.title):'Neodhalené místo'}</strong><br>${Math.round(p.distance)} m vzdušně${known?`<br><a href="${e(p.url)}" ${p.url.startsWith('#')?'':'target="_blank" rel="noopener"'}>Detail a zdroj</a>`:''}`).addTo(placesLayer);}
  }
  function stats(){
    $('walk-points').textContent=score(progress);$('walk-cells').textContent=progress.cells.length;$('walk-distance').textContent=number(progress.meters/1000);$('walk-relics').textContent=Math.floor(progress.cells.length/6);
    $('walk-session').textContent=`${demo?'Ukázka':'Tato relace'}: ${Math.round(sessionMeters)} m · ${sessionCells} nových dílků`;
    const remaining=6-progress.cells.length%6;
    $('walk-mystery').textContent=`Ještě ${remaining} nových dílků do dalšího mystery nálezu. Za každým šestým čeká fragment tvého příběhu a 25 bodů.`;
    const fragments=['Mlžný kompas','List tichého lesa','Kamenná hvězda','Klíč od obzoru','Kapka ranní rosy','Srdce objevitele'];
    const count=Math.floor(progress.cells.length/6);
    $('walk-collection').innerHTML=fragments.map((name,i)=>`<span class="fragment ${count>i?'found':''}">${count>i?`✧ ${name}${count>6?` ×${Math.floor((count+5-i)/6)}`:''}`:'? Neznámý fragment'}</span>`).join('');
    $('walk-trophies').innerHTML=trophies(progress).map(t=>`<div class="trophy ${t.earned?'earned':''}"><span>${t.earned?'✦':'◇'}</span><strong>${e(t.title)}</strong><small>${t.earned?'Získáno':e(t.goal)}</small></div>`).join('');
    $('walk-start').disabled=active||starting||demo||!!storageError;
    $('walk-stop').disabled=!active&&!starting;
    $('walk-step').hidden=!demo;$('walk-demo-banner').hidden=!demo;
    $('walk-demo').textContent=demo?'Ukončit ukázku':'Ukázka bez GPS';
    scheduleFog();renderPlaces();
  }
  async function releaseWake(){if(wake){const w=wake;wake=null;await w.release().catch(()=>{});}if(!disposed)$('wake-status').textContent='Displej: zámek není aktivní.';}
  async function holdWake(){
    if(!active||!$('walk-awake').checked)return;
    if(!navigator.wakeLock){$('wake-status').textContent='Telefon neumí držet displej zapnutý. Hlídej jeho zhasnutí.';return;}
    try {const w=await navigator.wakeLock.request('screen');if(!active||disposed||!$('walk-awake').checked){await w.release();return;}wake=w;$('wake-status').textContent='Displej zůstává zapnutý (vyšší spotřeba baterie).';w.addEventListener('release',()=>{if(wake===w){wake=null;if(!disposed)$('wake-status').textContent='Telefon uvolnil zámek displeje. Hlídej jeho zhasnutí.';}});}
    catch{if(!disposed)$('wake-status').textContent='Zámek displeje nebyl povolen. Nech obrazovku zapnutou ručně.';}
  }
  function stop(message){active=false;starting=false;if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}anchor=null;releaseWake();releaseLock?.();releaseLock=null;if(!disposed){stats();if(message)status(message);}}
  function sample(fix,now=Date.now()){
    if(disposed||(!active&&!demo))return;
    const result=acceptFix(progress,anchor,fix,now);anchor=result.anchor;
    if(!result.accepted){status(result.reason);return;}
    const next=discoverNearby(result.progress,fix,[...catalogue,...nearby]);
    if(!demo){try{saveWalk(next);}catch(error){stop(error.message);return;}}
    sessionMeters+=next.meters-progress.meters;if(result.fresh)sessionCells++;
    const discoveries=next.discoveries.length-progress.discoveries.length;
    progress=next;lastFix=fix;
    if(map){player.setLatLng([fix.lat,fix.lng]).setStyle({opacity:1,fillOpacity:1});accuracyRing.setLatLng([fix.lat,fix.lng]).setRadius(fix.accuracy);if(follow)map.setView([fix.lat,fix.lng],Math.max(16,map.getZoom()),{animate:false});}
    stats();status(`${discoveries?'Místní objev! +30 bodů. ':''}${result.reason} GPS ±${Math.round(fix.accuracy)} m.`);
  }
  async function start(){
    if(active||starting||demo||disposed)return;
    if(!isSecureContext||!navigator.geolocation){status('GPS vyžaduje HTTPS (GitHub Pages) a podporovaný prohlížeč.');return;}
    if(!navigator.locks){status('Tento prohlížeč nepodporuje bezpečný souběh záznamu. Použij aktuální Chrome nebo Safari.');return;}
    starting=true;stats();status('Spouštím GPS…');
    try{await navigator.locks.request('czekpoint-walk',{ifAvailable:true},async lock=>{
      if(disposed||!starting)return;
      if(!lock){starting=false;stats();status('Procházka už běží v jiné kartě. Pozastav ji tam.');return;}
      progress=loadWalk();starting=false;active=true;anchor=null;follow=true;stats();status('Čekám na GPS. Povol polohu a vyjdi na otevřené místo.');
      const held=new Promise(resolve=>{releaseLock=resolve;});
      watch=navigator.geolocation.watchPosition(p=>sample({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,speed:p.coords.speed,timestamp:p.timestamp}),error=>{if(error.code===1)stop('Poloha není povolená. Povol ji v nastavení webu, nebo zkus ukázku.');else{anchor=null;status('GPS zatím není dostupná. Počkej venku; výpadek se do vzdálenosti nezapočítá.');}}, {enableHighAccuracy:true,maximumAge:0,timeout:15000});
      holdWake();await held;
    });}catch(error){stop(error.message||'GPS nelze spustit.');}
  }
  if(L){
    const center=progress.cells.length?cellCenter(progress.cells.at(-1)):{lat:49.6030031,lng:13.8629039};
    map=L.map($('walk-map'),{zoomControl:true,minZoom:3,maxZoom:18,maxBounds:[[-85,-180],[85,180]],maxBoundsViscosity:1}).setView([center.lat,center.lng],16);
    tileLayer=L.tileLayer(config.mapTileUrl,{maxZoom:19,noWrap:true,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    tileLayer.on('tileerror',()=>{$('tile-status').textContent='Mapový podklad se nenačetl. Zkontroluj internet; body a uložený průzkum nejsou ztraceny.';});
    const pane=map.createPane('walk-fog');pane.style.zIndex='450';pane.style.pointerEvents='none';fog=L.DomUtil.create('canvas','walk-fog',pane);fog.setAttribute('aria-hidden','true');
    placesLayer.addTo(map);accuracyRing=L.circle([center.lat,center.lng],{radius:0,color:'#68c8ff',weight:1,fillOpacity:.12,pane:'markerPane'}).addTo(map);player=L.circleMarker([center.lat,center.lng],{radius:8,color:'white',weight:3,fillColor:'#218bea',opacity:0,fillOpacity:0,pane:'markerPane'}).addTo(map);
    map.on('move zoom resize',scheduleFog);map.on('dragstart',()=>{follow=false;});
    map.on('moveend',()=>{if(!lastFix)renderPlaces();});
  }else{$('walk-map').textContent='Mapová knihovna chybí. Nahraj celý balíček včetně assets/vendor. GPS a body lze testovat bez podkladu.';}
  $('walk-start').addEventListener('click',start);$('walk-stop').addEventListener('click',()=>stop('Pozastaveno. Průzkum je uložený; pokračuj znovu tlačítkem Vyrazit s GPS.'));
  $('walk-awake').addEventListener('change',()=>{$('walk-awake').checked?holdWake():releaseWake();});
  $('walk-fog').addEventListener('click',()=>{reveal=!reveal;$('walk-fog').textContent=`Mlha: ${reveal?'zapnutá':'vypnutá'}`;$('walk-fog').setAttribute('aria-pressed',reveal);scheduleFog();});
  $('walk-center').addEventListener('click',()=>{follow=true;if(lastFix&&map)map.setView([lastFix.lat,lastFix.lng],16);else status('Nejdřív spusť GPS nebo ukázku.');});
  $('walk-demo').addEventListener('click',()=>{
    stop();demo=!demo;lastFix=null;nearby=[];anchor=null;sessionCells=0;sessionMeters=0;
    if(demo){progress=emptyWalk();demoIndex=0;stats();stepDemo();}
    else{try{progress=loadWalk();}catch(error){storageError=error.message;progress=emptyWalk();}stats();status(storageError||'Ukázka skončila. Skutečný průzkum zůstal zachovaný.');if(map){player.setStyle({opacity:0,fillOpacity:0});accuracyRing.setRadius(0);const c=progress.cells.length?cellCenter(progress.cells.at(-1)):{lat:49.6030031,lng:13.8629039};map.setView([c.lat,c.lng],16);}}
  });
  function stepDemo(){const fix={lat:49.6030031+demoIndex*.00046,lng:13.8629039+Math.sin(demoIndex*.7)*.0002,accuracy:5,timestamp:Date.now()+demoIndex*40000};demoIndex++;sample(fix,fix.timestamp);}
  $('walk-step').addEventListener('click',stepDemo);
  $('walk-nearby').addEventListener('click',async()=>{
    if(demo){$('nearby-status').textContent='Ukázka okolí používá pouze připravený katalog. Pro hledání u sebe zapni skutečnou GPS.';return;}
    if(!lastFix||Date.now()-lastFix.timestamp>60000){$('nearby-status').textContent='Nejdřív spusť GPS a získej čerstvou polohu.';return;}
    $('walk-nearby').disabled=true;$('nearby-status').textContent='Hledám skutečná místa v okolí…';
    try{const found=await fetchNearby(lastFix,config.overpassUrl,aborter.signal);if(disposed||demo)return;nearby=found;renderPlaces();$('nearby-status').textContent=found.length?`Načteno ${found.length} míst. Objevy se připíšou při dalším započítaném pohybu.`:'V okolí nemáme odpovídající místa. Průzkum a mystery odměny fungují dál.';}
    catch(error){if(!disposed)$('nearby-status').textContent=error.name==='AbortError'?'Hledání trvalo příliš dlouho. Zkus to za chvíli.':error.message;}
    finally{if(!disposed)$('walk-nearby').disabled=false;}
  });
  $('walk-export').addEventListener('click',()=>{try{const raw=localStorage.getItem(WALK_KEY)||JSON.stringify(emptyWalk());const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='czekpoint-pruzkum.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){status(error.message);}});
  const visibility=()=>{if(document.hidden&&(active||starting))stop('Záznam se pozastavil při skrytí aplikace. Pro pokračování znovu zapni GPS.');};
  document.addEventListener('visibilitychange',visibility);
  const pagehide=()=>stop();window.addEventListener('pagehide',pagehide);
  const storageChanged=event=>{if(event.key===WALK_KEY&&!demo){stop();try{progress=loadWalk();storageError='';}catch(error){storageError=error.message;}stats();status(storageError||'Průzkum se změnil v jiné kartě. Pro pokračování znovu spusť GPS.');}};
  window.addEventListener('storage',storageChanged);
  stats();
  return ()=>{disposed=true;stop();aborter.abort();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);window.removeEventListener('storage',storageChanged);if(frame)cancelAnimationFrame(frame);map?.remove();};
}
