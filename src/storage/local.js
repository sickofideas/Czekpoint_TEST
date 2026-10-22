import { routes } from '../data.js';

export const REPORT_KINDS = ['clear', 'mud', 'obstacle', 'closure', 'other'];
const LOCATION_STATES = ['nearby', 'away', 'unavailable', 'not-requested'];
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DB_NAME = 'czekpoint-local-v1';

export function validateReportInput(input, config = {}, now = Date.now()) {
  if (!input || typeof input.routeId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.routeId)) throw new Error('Vyberte platné místo.');
  if (!REPORT_KINDS.includes(input.kind)) throw new Error('Vyberte druh hlášení.');
  const note = String(input.note ?? '').trim();
  const author = String(input.author ?? '').trim() || 'Návštěvník';
  if (note.length > 1000) throw new Error('Poznámka může mít nejvýše 1 000 znaků.');
  if (author.length > 60) throw new Error('Přezdívka může mít nejvýše 60 znaků.');
  const observed = new Date(input.observedAt ?? now);
  if (!Number.isFinite(observed.getTime()) || observed.getTime() > now + 5 * 60_000) throw new Error('Datum pozorování musí být platné a nesmí být v budoucnosti.');
  const photoBlob = input.photoBlob ?? null;
  if (photoBlob !== null) {
    if (!(photoBlob instanceof Blob) || !PHOTO_TYPES.includes(photoBlob.type)) throw new Error('Fotografie musí být JPEG, PNG nebo WebP.');
    const maxBytes = Math.min(Number(config.maxPhotoBytes) || 2_097_152, 2_097_152);
    if (!photoBlob.size || photoBlob.size > maxBytes) throw new Error('Fotografie je prázdná nebo větší než povolené 2 MB.');
  }
  const check = input.locationCheck ?? { state: 'not-requested' };
  if (!LOCATION_STATES.includes(check.state)) throw new Error('Neplatný výsledek kontroly polohy.');
  const numberOrNull = (value, max) => {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('Neplatná přesnost nebo vzdálenost polohy.');
    return value;
  };
  return {
    routeId: input.routeId, kind: input.kind, note, author,
    observedAt: observed.toISOString(), photoBlob,
    // Whitelist fields: precise GPS coordinates never enter storage.
    locationCheck: { state: check.state, accuracy: numberOrNull(check.accuracy, 100_000), distance: numberOrNull(check.distance, 40_000_000) },
  };
}

export function createLocalRepository(config = {}) {
  let databasePromise;
  const objectUrls = new Map();
  const revoke = (id) => {
    const entry = objectUrls.get(id);
    if (entry) URL.revokeObjectURL(entry.url);
    objectUrls.delete(id);
  };
  const revokeAll = () => { for (const id of objectUrls.keys()) revoke(id); };
  globalThis.addEventListener?.('pagehide', revokeAll);

  function open() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('Prohlížeč nepodporuje místní úložiště IndexedDB.')); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const reports = db.createObjectStore('reports', { keyPath: 'id' });
        reports.createIndex('routeId', 'routeId');
        db.createObjectStore('saved', { keyPath: 'routeId' });
        db.createObjectStore('visits', { keyPath: 'routeId' });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Místní úložiště nelze otevřít.'));
      request.onblocked = () => reject(new Error('Úložiště je blokováno jiným otevřeným oknem aplikace.'));
    });
    return databasePromise;
  }

  async function transaction(stores, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('Zápis do místního úložiště selhal.'));
      tx.onabort = () => reject(tx.error ?? new Error('Operace místního úložiště byla přerušena.'));
      try { work(tx, (value) => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  const readAll = (store) => transaction([store], 'readonly', (tx, done) => {
    tx.objectStore(store).getAll().onsuccess = (event) => done(event.target.result);
  });
  function present(row) {
    let photoUrl = null;
    if (row.photoBlob) {
      if (!objectUrls.has(row.id)) objectUrls.set(row.id, { url: URL.createObjectURL(row.photoBlob), routeId: row.routeId });
      photoUrl = objectUrls.get(row.id).url;
    }
    const { photoBlob, ...report } = row;
    return { ...report, photoUrl, isOwn: true };
  }

  return {
    mode: 'local',
    async init() { await open(); },
    async listRoutes() { return structuredClone(routes); },
    async listReports(routeId) {
      const rows = await transaction(['reports'], 'readonly', (tx, done) => {
        const store = tx.objectStore('reports');
        const request = routeId ? store.index('routeId').getAll(routeId) : store.getAll();
        request.onsuccess = () => done(request.result);
      });
      const ids = new Set(rows.map((row) => row.id));
      for (const [id, entry] of objectUrls) if ((!routeId || entry.routeId === routeId) && !ids.has(id)) revoke(id);
      return rows.sort((a, b) => b.observedAt.localeCompare(a.observedAt)).map(present);
    },
    async createReport(input) {
      const values = validateReportInput(input, config);
      if (!routes.some((route) => route.id === values.routeId)) throw new Error('Místo nebylo nalezeno.');
      const report = { ...values, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'published' };
      await transaction(['reports'], 'readwrite', (tx) => { tx.objectStore('reports').add(report); });
      return present(report);
    },
    async deleteReport(id) {
      await transaction(['reports'], 'readwrite', (tx) => { tx.objectStore('reports').delete(id); });
      revoke(id);
    },
    async listSavedIds() { return (await readAll('saved')).map((row) => row.routeId); },
    async toggleSaved(routeId) {
      // Cloud IDs need not occur in the bundled example catalogue.
      if (typeof routeId !== 'string' || !routeId) throw new Error('Neplatné místo.');
      return transaction(['saved'], 'readwrite', (tx, done) => {
        const store = tx.objectStore('saved');
        store.get(routeId).onsuccess = (event) => {
          const exists = Boolean(event.target.result);
          if (exists) store.delete(routeId); else store.put({ routeId });
          done(!exists);
        };
      });
    },
    async listVisits() { return (await readAll('visits')).sort((a, b) => b.visitedAt.localeCompare(a.visitedAt)); },
    async addVisit(routeId) {
      if (typeof routeId !== 'string' || !routeId) throw new Error('Neplatné místo.');
      const visit = { routeId, visitedAt: new Date().toISOString() };
      await transaction(['visits'], 'readwrite', (tx) => { tx.objectStore('visits').put(visit); });
      return visit;
    },
    async removeVisit(routeId) {
      await transaction(['visits'], 'readwrite', (tx) => { tx.objectStore('visits').delete(routeId); });
    },
    async clearLocalData() {
      await transaction(['reports', 'saved', 'visits'], 'readwrite', (tx) => {
        for (const name of ['reports', 'saved', 'visits']) tx.objectStore(name).clear();
      });
      revokeAll();
    },
  };
}
