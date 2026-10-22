const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const REPORT_KINDS = new Set(['clear', 'mud', 'obstacle', 'closure', 'other']);

function searchText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').trim();
}

/** Missing duration/access data never counts as a confirmed match. */
export function filterRoutes(routes, options = {}) {
  const { search = '', kind, maxDuration, maxDistance, strollerOnly = false, savedOnly = false, savedIds = [] } = options ?? {};
  const words = searchText(search).split(/\s+/).filter(Boolean);
  const saved = savedIds instanceof Set ? savedIds : new Set(Array.isArray(savedIds) ? savedIds : []);
  const duration = maxDuration == null || maxDuration === '' || maxDuration === 'all' ? null : Number(maxDuration);
  const hasDurationLimit = duration !== null && Number.isFinite(duration) && duration >= 0;
  const distance = maxDistance == null || maxDistance === '' || maxDistance === 'all' ? null : Number(maxDistance);
  const hasDistanceLimit = distance !== null && Number.isFinite(distance) && distance >= 0;

  return (Array.isArray(routes) ? routes : []).filter((route) => {
    if (!route || (kind && kind !== 'all' && route.kind !== kind)) return false;
    if (strollerOnly && route.access?.stroller !== 'yes') return false;
    if (savedOnly && !saved.has(route.id)) return false;
    if (hasDurationLimit && (!Number.isFinite(route.durationMinutes) || route.durationMinutes > duration)) return false;
    if (hasDistanceLimit && (!Number.isFinite(route.distanceKm) || route.distanceKm > distance)) return false;
    const haystack = searchText([route.title, route.subtitle, route.region, route.summary, ...(route.highlights ?? [])].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

// Require an explicit timezone and real calendar date; Date.parse alone normalizes February 30.
function parseIsoTimestamp(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hours, minutes, seconds = '0', , zone] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth
      || Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return NaN;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return NaN;
  return Date.parse(value);
}

/** Freshness uses the observed time, never the upload time. Five minutes allow clock skew. */
export function isReportFresh(report, now = Date.now(), days = 7) {
  const observed = parseIsoTimestamp(report?.observedAt);
  return Number.isFinite(observed) && Number.isFinite(now) && Number.isFinite(days) && days >= 0
    && observed <= now + FUTURE_TOLERANCE_MS && now - observed <= days * DAY_MS;
}

/** Returns normalized data only when every required field is valid. */
export function validateReport(input, now = Date.now()) {
  const errors = [];
  const record = input && typeof input === 'object' ? input : {};
  const routeId = typeof record.routeId === 'string' ? record.routeId.trim() : '';
  const note = typeof record.note === 'string' ? record.note.trim() : '';
  const author = typeof record.author === 'string' ? record.author.trim() : '';
  const kind = record.kind;
  const observed = parseIsoTimestamp(record.observedAt);
  if (!routeId) errors.push('Vyberte místo, ke kterému hlášení patří.');
  if (!REPORT_KINDS.has(kind)) errors.push('Vyberte platný typ hlášení.');
  if (Array.from(note).length < 5 || Array.from(note).length > 600) errors.push('Popis musí mít 5 až 600 znaků.');
  if (Array.from(author).length < 2 || Array.from(author).length > 40) errors.push('Jméno nebo přezdívka musí mít 2 až 40 znaků.');
  if (!Number.isFinite(observed) || !Number.isFinite(now)) {
    errors.push('Uveďte platný čas pozorování.');
  } else if (observed > now + FUTURE_TOLERANCE_MS) {
    errors.push('Čas pozorování nesmí být více než 5 minut v budoucnosti.');
  } else if (now - observed > 30 * DAY_MS) {
    errors.push('Hlášení nesmí být starší než 30 dní.');
  }
  if (record.photo != null && typeof record.photo !== 'string') errors.push('Fotografie musí být připravená jako obrazový odkaz.');
  const valid = errors.length === 0;
  const value = valid ? { routeId, kind, note, author, observedAt: new Date(observed).toISOString() } : null;
  if (valid && record.photo) value.photo = record.photo;
  return { valid, errors, value };
}

/** Returns null for missing/invalid coordinates instead of pretending proximity is known. */
export function haversineMeters(a, b) {
  const valid = (point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
  if (!valid(a) || !valid(b)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(b.lat - a.lat);
  const longitudeDelta = radians(b.lng - a.lng);
  const central = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, central))));
}

/** A recent warning survives a later 'clear' report; reports are observations, not guarantees. */
export function summarizeReports(reports, now = Date.now()) {
  const recognized = (Array.isArray(reports) ? reports : []).filter((report) => {
    const time = parseIsoTimestamp(report?.observedAt);
    return REPORT_KINDS.has(report?.kind) && Number.isFinite(time) && time <= now + FUTURE_TOLERANCE_MS;
  });
  const recent = recognized.filter((report) => isReportFresh(report, now));
  const latestTime = recognized.reduce((latest, report) => Math.max(latest, parseIsoTimestamp(report.observedAt)), -Infinity);
  return {
    recentCount: recent.length,
    latestAt: Number.isFinite(latestTime) ? new Date(latestTime).toISOString() : null,
    hasWarning: recent.some((report) => report.kind !== 'clear'),
  };
}
