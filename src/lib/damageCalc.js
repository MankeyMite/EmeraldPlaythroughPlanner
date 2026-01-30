// Extremely small damage calc helper for Gen 3 (simplified). Use real formulas later.
// This function returns a damage range {min, max} for an attack from attacker to defender.
export function calcDamage({attack, attackStat, defense, defenseStat, power, level = 50}) {
  // Stats are expected to be final effective stats (after IV/EV/Nature)
  const A = attackStat;
  const D = defenseStat;
  const base = Math.floor(Math.floor((Math.floor((2 * level) / 5 + 2) * power * A) / D) / 50) + 2;
  const min = Math.max(1, Math.floor(base * 0.85));
  const max = Math.max(1, Math.floor(base * 1.00));
  return {min, max};
}
