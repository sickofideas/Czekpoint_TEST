import { createLocalRepository, validateReportInput } from './local.js';

const BUCKET = 'report-photos';
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

export function validateCloudConfig(config) {
  let url;
  try { url = new URL(config.supabaseUrl); } catch { throw new Error('Doplňte platnou Supabase URL v config.js.'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Supabase URL musí používat HTTPS (výjimka je localhost).');
  const key = String(config.supabaseAnonKey ?? '').trim();
  if (!key || key.startsWith('sb_secret_')) throw new Error('Použijte veřejný publishable/anon klíč, nikdy secret/service_role klíč.');
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role !== 'anon') throw new Error('Nepovolená role klíče.');
    } catch { throw new Error('Do prohlížeče patří pouze veřejný anon klíč.'); }
  }
  return { url: url.href.replace(/\/+$/, ''), key };
}

export function createAuthClient(connection, { fetchImpl = globalThis.fetch, storage = globalThis.localStorage, now = Date.now, locks = globalThis.navigator?.locks } = {}) {
  const storageKey = `czekpoint-auth:${connection.url}`;
  let inFlight;
  function load() {
    let value;
    try { value = storage.getItem(storageKey); } catch { throw new Error('Prohlížeč blokuje uložení anonymní identity.'); }
    if (!value) return null;
    try {
      const session = JSON.parse(value);
      if (!session.access_token || !session.refresh_token || !session.user?.id || !Number.isFinite(session.expires_at)) throw new Error();
      return session;
    } catch { throw new Error('Uložená cloudová identita je poškozená. Viz obnovení identity v supabase/README.md.'); }
  }
  async function request(path, { method = 'GET', body, headers = {}, session = null } = {}) {
    const requestHeaders = { apikey: connection.key, ...headers };
    if (session) requestHeaders.Authorization = `Bearer ${session.access_token}`;
    else if (connection.key.split('.').length === 3) requestHeaders.Authorization = `Bearer ${connection.key}`;
    let payload = body;
    if (body != null && !(body instanceof Blob)) {
      requestHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let response;
    try { response = await fetchImpl(connection.url + path, { method, headers: requestHeaders, body: payload }); }
    catch { throw new Error('Cloud není dostupný. Zkontrolujte připojení; data nebyla převedena do lokálního režimu.'); }
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok) {
      const hint = data?.msg || data?.message || data?.error_description || data?.error || 'Požadavek selhal';
      const error = new Error(`Cloud (${response.status}): ${String(hint).slice(0, 240)}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function renew(create) {
    const stored = load();
    if (stored && stored.expires_at > now() / 1000 + 60) return stored;
    if (!stored && !create) return null;
    const path = stored ? '/auth/v1/token?grant_type=refresh_token' : '/auth/v1/signup';
    const data = await request(path, { method: 'POST', body: stored ? { refresh_token: stored.refresh_token } : { data: {} } });
    if (!data?.access_token || !data.refresh_token || !data.user?.id) throw new Error('Supabase nevrátil anonymní přihlášení. Zapněte Anonymous Sign-Ins.');
    const session = { access_token: data.access_token, refresh_token: data.refresh_token, user: { id: data.user.id }, expires_at: Number(data.expires_at) || Math.floor(now() / 1000) + Number(data.expires_in || 3600) };
    try { storage.setItem(storageKey, JSON.stringify(session)); } catch { throw new Error('Anonymní identitu nelze uložit. Hlášení nebylo odesláno.'); }
    return session;
  }
  async function getSession(create = false) {
    if (inFlight) {
      const session = await inFlight;
      if (session || !create) return session;
    }
    inFlight = locks?.request ? locks.request(storageKey, () => renew(create)) : renew(create);
    try { return await inFlight; } finally { inFlight = null; }
  }
  return { getSession, request, storageKey };
}

export function createSupabaseRepository(config, dependencies = {}) {
  const connection = validateCloudConfig(config);
  const local = dependencies.localRepository ?? createLocalRepository(config);
  const auth = createAuthClient(connection, dependencies);
  const signedUrls = new Map();
  async function photoUrl(path, session) {
    if (!path) return null;
    const cached = signedUrls.get(path);
    if (cached?.expires > Date.now() + 30_000) return cached.url;
    const result = await auth.request(`/storage/v1/object/sign/${BUCKET}/${encodePath(path)}`, { method: 'POST', body: { expiresIn: 300 }, session });
    const signed = result?.signedURL ?? result?.signedUrl;
    if (!signed) throw new Error('Cloud nevrátil odkaz na fotografii.');
    const url = signed.startsWith('http') ? signed : `${connection.url}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
    signedUrls.set(path, { url, expires: Date.now() + 300_000 });
    return url;
  }
  async function present(row, session) {
    let url = null;
    let photoUnavailable = false;
    try { url = await photoUrl(row.photo_path, session); }
    catch { photoUnavailable = true; }
    return {
      id: row.id, routeId: row.route_id, kind: row.kind, note: row.note, author: row.author,
      observedAt: row.observed_at, createdAt: row.created_at, status: row.status,
      locationCheck: { state: row.location_state, accuracy: row.location_accuracy, distance: row.location_distance },
      photoUrl: url, photoUnavailable, isOwn: row.user_id === session?.user.id,
    };
  }
  async function removePhoto(path, session) {
    if (!path) return;
    await auth.request(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: { prefixes: [path] }, session });
    signedUrls.delete(path);
  }
  return {
    mode: 'cloud',
    async init() { await local.init(); },
    async listRoutes() {
      const rows = await auth.request('/rest/v1/routes?select=id,data&published=eq.true&order=id');
      if (!Array.isArray(rows)) throw new Error('Cloud vrátil neplatný seznam míst.');
      return rows.map((row) => ({ ...row.data, id: row.id }));
    },
    async listReports(routeId) {
      const session = await auth.getSession();
      const filter = routeId ? `&route_id=eq.${encodeURIComponent(routeId)}` : '';
      const rows = await auth.request(`/rest/v1/reports?select=*&order=observed_at.desc&limit=100${filter}`, { session });
      if (!Array.isArray(rows)) throw new Error('Cloud vrátil neplatná hlášení.');
      return Promise.all(rows.map((row) => present(row, session)));
    },
    async createReport(input) {
      const clean = validateReportInput(input, config);
      const session = await auth.getSession(true);
      const id = crypto.randomUUID();
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[clean.photoBlob?.type];
      const path = clean.photoBlob ? `${session.user.id}/${id}.${extension}` : null;
      const body = { id, route_id: clean.routeId, user_id: session.user.id, kind: clean.kind, note: clean.note, author: clean.author, observed_at: clean.observedAt, photo_path: path, location_state: clean.locationCheck.state, location_accuracy: clean.locationCheck.accuracy, location_distance: clean.locationCheck.distance };
      const rows = await auth.request('/rest/v1/reports', { method: 'POST', body, session, headers: { Prefer: 'return=representation' } });
      const row = rows?.[0];
      if (!row?.id) throw new Error('Cloud nepotvrdil uložení hlášení. Před opakováním obnovte stránku.');
      if (clean.photoBlob) {
        try {
          await auth.request(`/storage/v1/object/${BUCKET}/${encodePath(path)}`, { method: 'POST', body: clean.photoBlob, headers: { 'Content-Type': clean.photoBlob.type, 'x-upsert': 'false' }, session });
        } catch (error) {
          // A failed network response may still follow a committed upload.
          try {
            await removePhoto(path, session);
            await auth.request(`/rest/v1/reports?id=eq.${id}`, { method: 'DELETE', session });
          } catch { throw new Error('Fotografii se nepodařilo potvrdit. Hlášení může zůstat mezi vašimi čekajícími; obnovte stránku a případně je smažte.'); }
          throw error;
        }
      }
      // Preview errors are explicit metadata, never a retry of a committed insert.
      return present(row, session);
    },
    async deleteReport(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Neplatné ID hlášení.');
      const session = await auth.getSession();
      if (!session) throw new Error('Tento prohlížeč nemá identitu autora hlášení.');
      const rows = await auth.request(`/rest/v1/reports?id=eq.${encodeURIComponent(id)}&select=id,user_id,photo_path`, { session });
      const row = rows?.[0];
      if (!row || row.user_id !== session.user.id) throw new Error('Smazat můžete pouze vlastní hlášení.');
      await removePhoto(row.photo_path, session);
      await auth.request(`/rest/v1/reports?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', session });
    },
    listSavedIds: () => local.listSavedIds(),
    toggleSaved: (id) => local.toggleSaved(id),
    listVisits: () => local.listVisits(),
    addVisit: (id) => local.addVisit(id),
    removeVisit: (id) => local.removeVisit(id),
    // Keep Auth: deleting local passport data must not lose ownership of cloud reports.
    clearLocalData: () => local.clearLocalData(),
  };
}
