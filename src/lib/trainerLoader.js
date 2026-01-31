// Loads trainer JSON files from `src/data/trainers`
export async function loadTrainer(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = path + sep + 'v=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load trainer: ${path}`);
  const trainer = await res.json();
  return normalizeTrainerIVs(trainer);
}

// Convert an 8-bit stored IV (0-255) to per-stat IV (0-31).
// The input used in trainers_parties.h is scaled where 255 -> 31.
export function byteIvTo31(ivByte) {
  const MAX = 31;
  if (typeof ivByte !== 'number' || Number.isNaN(ivByte)) return 0;
  // Ensure bounds then scale and floor
  const clamped = Math.max(0, Math.min(255, Math.floor(ivByte)));
  return Math.floor((clamped * MAX) / 255);
}

// Normalize trainer object: convert any `.iv` fields from 0-255 to 0-31.
// Leaves existing small IVs (<=31) untouched.
export function normalizeTrainerIVs(trainer) {
  if (!trainer || !Array.isArray(trainer.pokemons)) return trainer;
  const mapped = trainer.pokemons.map((p) => {
    const copy = Object.assign({}, p);
    if (typeof copy.iv === 'number') {
      if (copy.iv > 31) copy.iv = byteIvTo31(copy.iv);
      else copy.iv = Math.max(0, Math.min(31, Math.floor(copy.iv)));
    } else {
      // default IV if missing: 31
      copy.iv = 31;
    }
    return copy;
  });
  return Object.assign({}, trainer, { pokemons: mapped });
}

// Validate basic expected shape
export function validateTrainer(trainer) {
  if (!trainer.name || !Array.isArray(trainer.pokemons)) return false;
  return true;
}
