/**
 * Gen 3 (Emerald) damage calculator "engine" (minimal v1).
 *
 * Includes:
 * - Stat calc (base, IV, EV, level, optional nature)
 * - Physical/Special split by TYPE (Gen 3 rules)
 * - STAB
 * - Type effectiveness (Gen 3 chart)
 * - Random rolls (16 rolls: 85..100)
 * - Crit toggle (2x)
 * - Burn (halves physical unless you model abilities later)
 *
 * Not included (v1): weather, screens, items, abilities (except simple immunity via types),
 * multi-target, double battle modifiers, move effects, accuracy.
 *
 * You can plug in decomp data later (base stats, moves, type chart).
 */

// -------------------- Types --------------------
const TYPE = Object.freeze({
  NORMAL: "NORMAL",
  FIGHTING: "FIGHTING",
  FLYING: "FLYING",
  POISON: "POISON",
  GROUND: "GROUND",
  ROCK: "ROCK",
  BUG: "BUG",
  GHOST: "GHOST",
  STEEL: "STEEL",
  FIRE: "FIRE",
  WATER: "WATER",
  GRASS: "GRASS",
  ELECTRIC: "ELECTRIC",
  PSYCHIC: "PSYCHIC",
  ICE: "ICE",
  DRAGON: "DRAGON",
  DARK: "DARK",
});

// Gen 3 physical/special split is by TYPE, not by move.
const PHYSICAL_TYPES = new Set([
  TYPE.NORMAL,
  TYPE.FIGHTING,
  TYPE.FLYING,
  TYPE.POISON,
  TYPE.GROUND,
  TYPE.ROCK,
  TYPE.BUG,
  TYPE.GHOST,
  TYPE.STEEL,
]);

function isPhysicalType(moveType) {
  return PHYSICAL_TYPES.has(moveType);
}

// -------------------- Natures --------------------
// In your tool, you can pass nature as:
// { plus: "ATK"|"DEF"|"SPA"|"SPD"|"SPE"|null, minus: same|null }
function natureMultiplier(nature, statKey) {
  if (!nature || !nature.plus || !nature.minus) return 1.0;
  if (nature.plus === statKey && nature.minus !== statKey) return 1.1;
  if (nature.minus === statKey && nature.plus !== statKey) return 0.9;
  return 1.0;
}

// -------------------- Type Effectiveness (Gen 3) --------------------
// Multiplier outputs: 0, 0.5, 1, 2
// Note: Gen 3 chart is the classic one (no Fairy).
// This table is attackerType -> defenderType -> multiplier.
const TYPE_CHART = (() => {
  const t = {};
  for (const a of Object.values(TYPE)) t[a] = {};

  // Helper
  const set = (atk, def, mult) => (t[atk][def] = mult);

  // Default all to 1
  for (const atk of Object.values(TYPE)) {
    for (const def of Object.values(TYPE)) {
      t[atk][def] = 1;
    }
  }

  // NORMAL
  set(TYPE.NORMAL, TYPE.ROCK, 0.5);
  set(TYPE.NORMAL, TYPE.STEEL, 0.5);
  set(TYPE.NORMAL, TYPE.GHOST, 0);

  // FIGHTING
  set(TYPE.FIGHTING, TYPE.NORMAL, 2);
  set(TYPE.FIGHTING, TYPE.ROCK, 2);
  set(TYPE.FIGHTING, TYPE.STEEL, 2);
  set(TYPE.FIGHTING, TYPE.ICE, 2);
  set(TYPE.FIGHTING, TYPE.DARK, 2);
  set(TYPE.FIGHTING, TYPE.FLYING, 0.5);
  set(TYPE.FIGHTING, TYPE.POISON, 0.5);
  set(TYPE.FIGHTING, TYPE.BUG, 0.5);
  set(TYPE.FIGHTING, TYPE.PSYCHIC, 0.5);
  set(TYPE.FIGHTING, TYPE.GHOST, 0);

  // FLYING
  set(TYPE.FLYING, TYPE.FIGHTING, 2);
  set(TYPE.FLYING, TYPE.BUG, 2);
  set(TYPE.FLYING, TYPE.GRASS, 2);
  set(TYPE.FLYING, TYPE.ROCK, 0.5);
  set(TYPE.FLYING, TYPE.STEEL, 0.5);
  set(TYPE.FLYING, TYPE.ELECTRIC, 0.5);

  // POISON
  set(TYPE.POISON, TYPE.GRASS, 2);
  set(TYPE.POISON, TYPE.POISON, 0.5);
  set(TYPE.POISON, TYPE.GROUND, 0.5);
  set(TYPE.POISON, TYPE.ROCK, 0.5);
  set(TYPE.POISON, TYPE.GHOST, 0.5);
  set(TYPE.POISON, TYPE.STEEL, 0);

  // GROUND
  set(TYPE.GROUND, TYPE.FIRE, 2);
  set(TYPE.GROUND, TYPE.ELECTRIC, 2);
  set(TYPE.GROUND, TYPE.POISON, 2);
  set(TYPE.GROUND, TYPE.ROCK, 2);
  set(TYPE.GROUND, TYPE.STEEL, 2);
  set(TYPE.GROUND, TYPE.BUG, 0.5);
  set(TYPE.GROUND, TYPE.GRASS, 0.5);
  set(TYPE.GROUND, TYPE.FLYING, 0);

  // ROCK
  set(TYPE.ROCK, TYPE.FIRE, 2);
  set(TYPE.ROCK, TYPE.ICE, 2);
  set(TYPE.ROCK, TYPE.FLYING, 2);
  set(TYPE.ROCK, TYPE.BUG, 2);
  set(TYPE.ROCK, TYPE.FIGHTING, 0.5);
  set(TYPE.ROCK, TYPE.GROUND, 0.5);
  set(TYPE.ROCK, TYPE.STEEL, 0.5);

  // BUG
  set(TYPE.BUG, TYPE.GRASS, 2);
  set(TYPE.BUG, TYPE.PSYCHIC, 2);
  set(TYPE.BUG, TYPE.DARK, 2);
  set(TYPE.BUG, TYPE.FIRE, 0.5);
  set(TYPE.BUG, TYPE.FIGHTING, 0.5);
  set(TYPE.BUG, TYPE.POISON, 0.5);
  set(TYPE.BUG, TYPE.FLYING, 0.5);
  set(TYPE.BUG, TYPE.GHOST, 0.5);
  set(TYPE.BUG, TYPE.STEEL, 0.5);

  // GHOST
  set(TYPE.GHOST, TYPE.GHOST, 2);
  set(TYPE.GHOST, TYPE.PSYCHIC, 2);
  set(TYPE.GHOST, TYPE.DARK, 0.5);
  set(TYPE.GHOST, TYPE.NORMAL, 0);

  // STEEL
  set(TYPE.STEEL, TYPE.ROCK, 2);
  set(TYPE.STEEL, TYPE.ICE, 2);
  set(TYPE.STEEL, TYPE.FIRE, 0.5);
  set(TYPE.STEEL, TYPE.WATER, 0.5);
  set(TYPE.STEEL, TYPE.ELECTRIC, 0.5);
  set(TYPE.STEEL, TYPE.STEEL, 0.5);

  // FIRE
  set(TYPE.FIRE, TYPE.GRASS, 2);
  set(TYPE.FIRE, TYPE.ICE, 2);
  set(TYPE.FIRE, TYPE.BUG, 2);
  set(TYPE.FIRE, TYPE.STEEL, 2);
  set(TYPE.FIRE, TYPE.FIRE, 0.5);
  set(TYPE.FIRE, TYPE.WATER, 0.5);
  set(TYPE.FIRE, TYPE.ROCK, 0.5);
  set(TYPE.FIRE, TYPE.DRAGON, 0.5);

  // WATER
  set(TYPE.WATER, TYPE.FIRE, 2);
  set(TYPE.WATER, TYPE.GROUND, 2);
  set(TYPE.WATER, TYPE.ROCK, 2);
  set(TYPE.WATER, TYPE.WATER, 0.5);
  set(TYPE.WATER, TYPE.GRASS, 0.5);
  set(TYPE.WATER, TYPE.DRAGON, 0.5);

  // GRASS
  set(TYPE.GRASS, TYPE.WATER, 2);
  set(TYPE.GRASS, TYPE.GROUND, 2);
  set(TYPE.GRASS, TYPE.ROCK, 2);
  set(TYPE.GRASS, TYPE.FIRE, 0.5);
  set(TYPE.GRASS, TYPE.GRASS, 0.5);
  set(TYPE.GRASS, TYPE.POISON, 0.5);
  set(TYPE.GRASS, TYPE.FLYING, 0.5);
  set(TYPE.GRASS, TYPE.BUG, 0.5);
  set(TYPE.GRASS, TYPE.DRAGON, 0.5);
  set(TYPE.GRASS, TYPE.STEEL, 0.5);

  // ELECTRIC
  set(TYPE.ELECTRIC, TYPE.WATER, 2);
  set(TYPE.ELECTRIC, TYPE.FLYING, 2);
  set(TYPE.ELECTRIC, TYPE.ELECTRIC, 0.5);
  set(TYPE.ELECTRIC, TYPE.GRASS, 0.5);
  set(TYPE.ELECTRIC, TYPE.DRAGON, 0.5);
  set(TYPE.ELECTRIC, TYPE.GROUND, 0);

  // PSYCHIC
  set(TYPE.PSYCHIC, TYPE.FIGHTING, 2);
  set(TYPE.PSYCHIC, TYPE.POISON, 2);
  set(TYPE.PSYCHIC, TYPE.PSYCHIC, 0.5);
  set(TYPE.PSYCHIC, TYPE.STEEL, 0.5);
  set(TYPE.PSYCHIC, TYPE.DARK, 0);

  // ICE
  set(TYPE.ICE, TYPE.GRASS, 2);
  set(TYPE.ICE, TYPE.GROUND, 2);
  set(TYPE.ICE, TYPE.FLYING, 2);
  set(TYPE.ICE, TYPE.DRAGON, 2);
  set(TYPE.ICE, TYPE.FIRE, 0.5);
  set(TYPE.ICE, TYPE.WATER, 0.5);
  set(TYPE.ICE, TYPE.ICE, 0.5);
  set(TYPE.ICE, TYPE.STEEL, 0.5);

  // DRAGON
  set(TYPE.DRAGON, TYPE.DRAGON, 2);
  set(TYPE.DRAGON, TYPE.STEEL, 0.5);

  // DARK
  set(TYPE.DARK, TYPE.PSYCHIC, 2);
  set(TYPE.DARK, TYPE.GHOST, 2);
  set(TYPE.DARK, TYPE.FIGHTING, 0.5);
  set(TYPE.DARK, TYPE.DARK, 0.5);
  set(TYPE.DARK, TYPE.STEEL, 0.5);

  return t;
})();

function typeEffectiveness(moveType, defenderTypes) {
  // defenderTypes: [type1, type2|null]
  const [t1, t2] = defenderTypes;
  const m1 = TYPE_CHART[moveType][t1] ?? 1;
  const m2 = t2 ? (TYPE_CHART[moveType][t2] ?? 1) : 1;
  return m1 * m2; // can be 0, 0.25, 0.5, 1, 2, 4
}

function hasSTAB(moveType, attackerTypes) {
  return attackerTypes.includes(moveType);
}

// -------------------- Stat Calculation --------------------
function calcHP(base, iv, ev, level) {
  const evTerm = Math.floor(ev / 4);
  return Math.floor(((2 * base + iv + evTerm) * level) / 100) + level + 10;
}

function calcOtherStat(base, iv, ev, level) {
  const evTerm = Math.floor(ev / 4);
  return Math.floor(((2 * base + iv + evTerm) * level) / 100) + 5;
}

function applyNature(stat, nature, statKey) {
  const mult = natureMultiplier(nature, statKey);
  // Important: emulate game-ish flooring. Gen 3 effectively floors after applying multiplier.
  if (mult === 1.1) return Math.floor((stat * 110) / 100);
  if (mult === 0.9) return Math.floor((stat * 90) / 100);
  return stat;
}

/**
 * speciesBase: { hp, atk, def, spa, spd, spe, type1, type2|null }
 * ivs/evs: { hp, atk, def, spa, spd, spe }
 */
function calcFinalStats({ speciesBase, level, ivs, evs, nature }) {
  const hp = calcHP(speciesBase.hp, ivs.hp, evs.hp, level);

  let atk = calcOtherStat(speciesBase.atk, ivs.atk, evs.atk, level);
  let def = calcOtherStat(speciesBase.def, ivs.def, evs.def, level);
  let spa = calcOtherStat(speciesBase.spa, ivs.spa, evs.spa, level);
  let spd = calcOtherStat(speciesBase.spd, ivs.spd, evs.spd, level);
  let spe = calcOtherStat(speciesBase.spe, ivs.spe, evs.spe, level);

  atk = applyNature(atk, nature, "ATK");
  def = applyNature(def, nature, "DEF");
  spa = applyNature(spa, nature, "SPA");
  spd = applyNature(spd, nature, "SPD");
  spe = applyNature(spe, nature, "SPE");

  return { hp, atk, def, spa, spd, spe };
}

// -------------------- Damage Calculation --------------------
/**
 * Calculate Gen 3 damage for a single roll.
 * This is a v1 integer-math friendly version.
 */
function calcDamageOneRoll({
  level,
  power,
  attackStat,
  defenseStat,
  stab, // 1.0 or 1.5
  typeMult, // 0, 0.25, 0.5, 1, 2, 4
  crit, // boolean
  randomPercent, // 85..100
  burn, // boolean; halves physical damage
}) {
  // Base damage: (((2L/5+2)*P*A/D)/50)+2
  const term1 = Math.floor((2 * level) / 5) + 2;
  let base = Math.floor((term1 * power * attackStat) / defenseStat);
  base = Math.floor(base / 50) + 2;

  // Apply burn (Gen 3 halves physical damage when burned; ignore Guts etc. in v1)
  if (burn) base = Math.floor(base / 2);

  // Crit (Gen 3 = 2x). In real game, crit also affects stat stage ignoring; v1 ignores stat stages entirely.
  if (crit) base = base * 2;

  // Apply modifiers: random, STAB, type
  // Random is percentage
  let dmg = Math.floor((base * randomPercent) / 100);

  // STAB is 3/2
  if (stab === 1.5) dmg = Math.floor((dmg * 3) / 2);

  // Type effectiveness can be fractional; implement via rational steps
  // Multiply by 0, 1/4, 1/2, 1, 2, 4 using integer ops
  if (typeMult === 0) return 0;
  if (typeMult === 0.25) dmg = Math.floor(dmg / 4);
  else if (typeMult === 0.5) dmg = Math.floor(dmg / 2);
  else if (typeMult === 1) dmg = dmg;
  else if (typeMult === 2) dmg = dmg * 2;
  else if (typeMult === 4) dmg = dmg * 4;
  else {
    // fallback for any odd multiplier (shouldn't happen in Gen 3 chart)
    dmg = Math.floor(dmg * typeMult);
  }

  return Math.max(0, dmg);
}

/**
 * Main API: compute 16-roll range and KO info.
 *
 * attacker/defender: {
 *   level,
 *   base: { hp, atk, def, spa, spd, spe, type1, type2|null },
 *   ivs: { hp, atk, def, spa, spd, spe },
 *   evs: { hp, atk, def, spa, spd, spe },
 *   nature: { plus, minus } | null,
 *   status: { burned: boolean } // optional
 * }
 *
 * move: { power, type }
 */
function calcDamageRange({ attacker, defender, move, options = {} }) {
  const {
    crit = false,
    includeRolls = true,
    ignoreRandom = false, // if true, only compute max roll (100)
  } = options;

  const atkStats = calcFinalStats({
    speciesBase: attacker.base,
    level: attacker.level,
    ivs: attacker.ivs,
    evs: attacker.evs,
    nature: attacker.nature,
  });

  const defStats = calcFinalStats({
    speciesBase: defender.base,
    level: defender.level,
    ivs: defender.ivs,
    evs: defender.evs,
    nature: defender.nature,
  });

  const attackerTypes = [attacker.base.type1, attacker.base.type2].filter(Boolean);
  const defenderTypes = [defender.base.type1, defender.base.type2].filter(Boolean);

  const phys = isPhysicalType(move.type);
  const A = phys ? atkStats.atk : atkStats.spa;
  const D = phys ? defStats.def : defStats.spd;

  const stab = hasSTAB(move.type, attackerTypes) ? 1.5 : 1.0;
  const eff = typeEffectiveness(move.type, defenderTypes);

  const burned = !!attacker.status?.burned;
  const burnApplies = burned && phys; // v1 (no Guts check)

  const rolls = [];
  const rollPercents = ignoreRandom ? [100] : Array.from({ length: 16 }, (_, i) => 85 + i);

  for (const rp of rollPercents) {
    const dmg = calcDamageOneRoll({
      level: attacker.level,
      power: move.power,
      attackStat: A,
      defenseStat: D,
      stab,
      typeMult: eff,
      crit,
      randomPercent: rp,
      burn: burnApplies,
    });
    rolls.push(dmg);
  }

  const min = Math.min(...rolls);
  const max = Math.max(...rolls);

  const hp = defStats.hp;
  const minPct = hp === 0 ? 0 : (min / hp) * 100;
  const maxPct = hp === 0 ? 0 : (max / hp) * 100;

  return {
    attackerFinal: atkStats,
    defenderFinal: defStats,
    moveCategory: phys ? "PHYSICAL" : "SPECIAL",
    stab,
    effectiveness: eff,
    burnApplied: burnApplies,
    crit,
    rolls: includeRolls ? rolls : undefined,
    min,
    max,
    minPercent: minPct,
    maxPercent: maxPct,
    // Basic KO checks (no leftovers/items in v1)
    ohkoGuaranteed: min >= hp,
    ohkoPossible: max >= hp,
  };
}

// -------------------- Example (you can delete) --------------------
// Minimal species base data (from base_stats.h)
// Sableye: 50/75/75/65/65/50, Dark/Ghost
// Makuhita: 72/60/30/20/30/25, Fighting
const BASE = {
  SABLEYE: { hp: 50, atk: 75, def: 75, spa: 65, spd: 65, spe: 50, type1: TYPE.DARK, type2: TYPE.GHOST },
  MAKUHITA: { hp: 72, atk: 60, def: 30, spa: 20, spd: 30, spe: 25, type1: TYPE.FIGHTING, type2: null },
};

// Example: "Fake" move just to show output format.
// In Gen 3, Shadow Ball is GHOST (physical), power 80.
const MOVE = { SHADOW_BALL: { power: 80, type: TYPE.GHOST } };

function demo() {
  const attacker = {
    level: 19,
    base: BASE.SABLEYE,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: null, // neutral
    status: { burned: false },
  };

  const defender = {
    level: 19,
    base: BASE.MAKUHITA,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: null,
    status: {},
  };

  const out = calcDamageRange({
    attacker,
    defender,
    move: MOVE.SHADOW_BALL,
    options: { crit: false, includeRolls: true },
  });

  console.log(out);
}

// Uncomment to test locally in Node:
// demo();

// -------------------- Exports (Node/ESM friendly) --------------------
export {
  TYPE,
  calcFinalStats,
  calcDamageRange,
  typeEffectiveness,
  isPhysicalType,
};
