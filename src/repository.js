import { createLocalRepository } from './storage/local.js';
import { createSupabaseRepository } from './storage/supabase.js';

export async function createRepository(config = {}) {
  if (config.mode === 'local' || config.mode == null) return createLocalRepository(config);
  if (config.mode === 'cloud') return createSupabaseRepository(config);
  throw new Error('Neznámý režim úložiště. Použijte local nebo cloud.');
}
