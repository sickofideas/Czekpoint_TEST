export const ALLOWED_AVATARS = Object.freeze([
  { id: 'liska', name: 'Liška' },
  { id: 'sova', name: 'Sova' },
  { id: 'jelen', name: 'Jelen' },
  { id: 'jezek', name: 'Ježek' },
  { id: 'vydra', name: 'Vydra' },
  { id: 'zajic', name: 'Zajíc' },
  { id: 'veverka', name: 'Veverka' },
  { id: 'medved', name: 'Medvěd' },
  { id: 'rys', name: 'Rys' },
  { id: 'datel', name: 'Datel' },
  { id: 'list', name: 'List' },
  { id: 'kapradina', name: 'Kapradina' },
]);

export const ALLOWED_AVATAR_IDS = new Set(ALLOWED_AVATARS.map(a => a.id));

export function isValidAvatarId(avatarId) {
  return typeof avatarId === 'string' && ALLOWED_AVATAR_IDS.has(avatarId.trim());
}

export function validateAvatarId(avatarId) {
  if (typeof avatarId !== 'string') return 'liska';
  const clean = avatarId.trim();
  return ALLOWED_AVATAR_IDS.has(clean) ? clean : 'liska';
}

export function validateProfile(rawProfile) {
  if (!rawProfile || typeof rawProfile !== 'object') {
    return { avatarId: 'liska' };
  }
  // Strictly reject URLs, HTML, scripts, base64 or custom fields
  const avatarId = validateAvatarId(rawProfile.avatarId);
  return { avatarId };
}

export function avatarUrl(avatarId) {
  const valid = validateAvatarId(avatarId);
  return `./assets/avatars/${valid}.svg`;
}
