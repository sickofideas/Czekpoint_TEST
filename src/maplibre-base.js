// Experimentální 2D MapLibre podklad pro stávající Leaflet mapu.
// Během přepínání se mapa, GPS, mlha a ostatní vrstvy nevytvářejí znovu.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const ATTRIBUTION = '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
let dependenciesPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('Načítání knihovny vypršelo.')); }, 15000);
    script.src = new URL(src, document.baseURI).href;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('MapLibre knihovnu se nepodařilo načíst.')); };
    document.head.appendChild(script);
  });
}

export function loadMapLibreDependencies() {
  if (!dependenciesPromise) {
    dependenciesPromise = (async () => {
      if (!window.maplibregl) await loadScript('./assets/vendor/maplibre/maplibre-gl.js');
      if (!window.L?.maplibreGL) await loadScript('./assets/vendor/maplibre/leaflet-maplibre-gl.js');
      if (!window.L?.maplibreGL || !window.maplibregl) throw new Error('MapLibre není k dispozici.');
    })().catch(error => { dependenciesPromise = null; throw error; });
  }
  return dependenciesPromise;
}

export async function makeMapLibreLayer(L) {
  await loadMapLibreDependencies();
  return L.maplibreGL({ style: STYLE_URL, attributionControl: { customAttribution: ATTRIBUTION }, interactive: false });
}
