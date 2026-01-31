// Loads Pokémon base data (species stats, base moves, etc.)
export async function loadPokemon(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = path + sep + 'v=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load pokemon: ${path}`);
  return await res.json();
}
export async function loadJson(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = path + sep + 'v=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load JSON: ${path}`);
  return res.json();
}
