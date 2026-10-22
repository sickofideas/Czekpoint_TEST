// Veřejná konfigurace. Nikdy sem nevkládej service_role ani secret klíč.
// Úplný postup zapnutí sdíleného režimu je v supabase/README.md.
export const CONFIG = Object.freeze({
  mode: 'local', // 'local' = tento prohlížeč; 'cloud' = společná databáze Supabase
  supabaseUrl: '',
  supabaseAnonKey: '', // pouze veřejný publishable / anon klíč
  reportFreshDays: 7,
  maxPhotoBytes: 2097152,
  mapTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  overpassUrl: 'https://overpass-api.de/api/interpreter',
});
