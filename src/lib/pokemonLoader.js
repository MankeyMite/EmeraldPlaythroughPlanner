// Loads Pokémon base data (species stats, base moves, etc.)
export async function loadPokemon(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load pokemon: ${path}`);
  return await res.json();
}
