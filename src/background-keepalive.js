/**
 * Czekpoint — Podpora běhu a záznamu na pozadí i při zhasnutém displeji / v kapse.
 * 
 * Využívá kombinaci:
 * 1. Přehrávání neslyšného audio streamu ve smyčce (Silent Audio Keep-Alive),
 *    které mobilním systémům (Android, iOS Safari) signalizuje aktivní mediální službu.
 *    Díky tomu operační systém neuspí vlákno JavaScriptu a nepřeruší navigator.geolocation.watchPosition.
 * 2. Media Session API (notifikace na zamčené obrazovce se stavem výpravy a tlačítky Pauza/Ukončit).
 * 3. Screen Wake Lock API (volitelné zabránění zhasnutí obrazovky, pokud je zapnuto).
 */

// 48-bajtový platný neslyšný WAV soubor (8-bit PCM ticho)
export const SILENT_WAV_BASE64 = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQQAAACAgICA';

let audioElement = null;
let audioTickCallback = null;

export function getAudioKeepaliveElement() {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  if (!audioElement) {
    try {
      audioElement = new Audio(SILENT_WAV_BASE64);
      audioElement.loop = true;
      audioElement.playsInline = true;
      audioElement.volume = 0.01;
      audioElement.addEventListener?.('timeupdate', () => {
        if (typeof audioTickCallback === 'function') {
          try {
            audioTickCallback(Date.now());
          } catch {}
        }
      });
    } catch {
      audioElement = null;
    }
  }
  return audioElement;
}

/**
 * @param {Object} [options]
 * @param {string} [options.title]
 * @param {string} [options.artist]
 * @param {string} [options.album]
 * @param {(() => void) | null} [options.onPause]
 * @param {(() => void) | null} [options.onResume]
 * @param {(() => void) | null} [options.onStop]
 * @param {((now: number) => void) | null} [options.onTick]
 */
export function startBackgroundTracking({
  title = 'Záznam výpravy běží',
  artist = 'Czekpoint · Objevování a mapa',
  album = 'Záznam na pozadí i při zhasnutém displeji',
  onPause = /** @type {(() => void) | null} */ (null),
  onResume = /** @type {(() => void) | null} */ (null),
  onStop = /** @type {(() => void) | null} */ (null),
  onTick = /** @type {((now: number) => void) | null} */ (null),
} = {}) {
  if (typeof window === 'undefined' && typeof navigator === 'undefined') return;

  if (typeof onTick === 'function') {
    audioTickCallback = onTick;
  }

  const audio = getAudioKeepaliveElement();
  if (audio) {
    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch {}
  }

  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist,
        album,
        artwork: [
          { src: './assets/icon.svg', sizes: '96x96', type: 'image/svg+xml' },
          { src: './assets/icon.svg', sizes: '192x192', type: 'image/svg+xml' },
        ],
      });
      navigator.mediaSession.playbackState = 'playing';

      if (typeof onPause === 'function') {
        navigator.mediaSession.setActionHandler('pause', () => onPause());
      }
      if (typeof onResume === 'function') {
        navigator.mediaSession.setActionHandler('play', () => onResume());
      }
      if (typeof onStop === 'function') {
        navigator.mediaSession.setActionHandler('stop', () => onStop());
      }
    } catch {}
  }
}

export function updateBackgroundTracking({ title, album } = {}) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !navigator.mediaSession?.metadata) return;
  try {
    if (title) navigator.mediaSession.metadata.title = title;
    if (album) navigator.mediaSession.metadata.album = album;
  } catch {}
}

export function pauseBackgroundTracking() {
  const audio = getAudioKeepaliveElement();
  if (audio) {
    try { audio.pause(); } catch {}
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'paused';
    } catch {}
  }
}

export function stopBackgroundTracking() {
  const audio = getAudioKeepaliveElement();
  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = 'none';
    } catch {}
  }
}
