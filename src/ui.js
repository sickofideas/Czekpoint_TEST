export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

const paths = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  heart: '<path d="M20 5a5 5 0 0 0-8 2 5 5 0 0 0-8-2c-6 6 8 15 8 15s14-9 8-15Z"/>',
  tree: '<path d="m12 2-7 9h4l-6 7h18l-6-7h4Z"/><path d="M12 18v4"/>',
  castle: '<path d="M4 21V7h4V3h3v4h2V3h3v4h4v14Z"/><path d="M10 21v-5a2 2 0 0 1 4 0v5M8 10v2m8-2v2"/>',
  water: '<path d="M3 7q3-4 6 0t6 0 6 0M3 12q3-4 6 0t6 0 6 0M3 17q3-4 6 0t6 0 6 0"/>',
  mountain: '<path d="m2 20 8-16 5 9 2-4 5 11Z"/><path d="m7 10 3 2 3-2"/>',
  route: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h7a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  stroller: '<path d="M8 11h12a6 6 0 0 1-12 0Zm12 0a8 8 0 0 0-8-8v8M8 11 5 6H2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v14H3Z"/><circle cx="12" cy="13" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  external: '<path d="M14 3h7v7m0-7L11 13M9 5H4v15h15v-5"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  book: '<path d="M4 3h14a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Zm0 13h16M8 7h7m-7 4h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  warning: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>',
  leaf: '<path d="M20 3C8 1 2 8 5 15s17 5 15-12Z"/><path d="M3 22 15 10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  share: '<circle cx="18" cy="4" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="20" r="3"/><path d="m9 10 6-4M9 14l6 4"/>',
};
export function icon(name, extra = '') { return `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.pin}</svg>`; }
export function formatDate(iso, withTime = false) {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return 'Datum neznáme';
  return new Intl.DateTimeFormat('cs-CZ', {day:'numeric',month:'numeric',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(date);
}
export function localDateInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0,16);
}
export function number(val) {
  if (val == null || !Number.isFinite(val)) return '';
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(val);
}
