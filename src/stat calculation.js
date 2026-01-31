// Gen 3 stat calculator (Ruby/Sapphire/Emerald/FRLG)

const NATURE_MODS = {
  // Format: [atk, def, spa, spd, spe]
  adamant: [1.1, 1.0, 0.9, 1.0, 1.0],
  lonely:  [1.1, 0.9, 1.0, 1.0, 1.0],
  brave:   [1.1, 1.0, 1.0, 1.0, 0.9],
  naughty: [1.1, 1.0, 1.0, 0.9, 1.0],
  bold:    [0.9, 1.1, 1.0, 1.0, 1.0],
  impish:  [1.0, 1.1, 0.9, 1.0, 1.0],
  lax:     [1.0, 1.1, 1.0, 0.9, 1.0],
  relaxed: [1.0, 1.1, 1.0, 1.0, 0.9],
  modest:  [0.9, 1.0, 1.1, 1.0, 1.0],
  mild:    [1.0, 0.9, 1.1, 1.0, 1.0],
  rash:    [1.0, 1.0, 1.1, 0.9, 1.0],
  quiet:   [1.0, 1.0, 1.1, 1.0, 0.9],
  calm:    [0.9, 1.0, 1.0, 1.1, 1.0],
  gentle:  [1.0, 0.9, 1.0, 1.1, 1.0],
  careful: [1.0, 1.0, 0.9, 1.1, 1.0],
  sassy:   [1.0, 1.0, 1.0, 1.1, 0.9],
  timid:   [0.9, 1.0, 1.0, 1.0, 1.1],
  hasty:   [1.0, 0.9, 1.0, 1.0, 1.1],
  jolly:   [1.0, 1.0, 0.9, 1.0, 1.1],
  naive:   [1.0, 1.0, 1.0, 0.9, 1.1],
  // neutral natures
  hardy:   [1.0, 1.0, 1.0, 1.0, 1.0],
  docile:  [1.0, 1.0, 1.0, 1.0, 1.0],
  serious: [1.0, 1.0, 1.0, 1.0, 1.0],
  bashful: [1.0, 1.0, 1.0, 1.0, 1.0],
  quirky:  [1.0, 1.0, 1.0, 1.0, 1.0],
};

function clampInt(n, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function calcHpGen3(base, iv, ev, level) {
  base = clampInt(base, 1, 255);
  iv = clampInt(iv, 0, 31);
  ev = clampInt(ev, 0, 255);
  level = clampInt(level, 1, 100);

  const evTerm = Math.floor(ev / 4);
  const core = Math.floor(((2 * base + iv + evTerm) * level) / 100);
  return core + level + 10;
}

function calcOtherStatGen3(base, iv, ev, level, natureMod) {
  base = clampInt(base, 1, 255);
  iv = clampInt(iv, 0, 31);
  ev = clampInt(ev, 0, 255);
  level = clampInt(level, 1, 100);

  const evTerm = Math.floor(ev / 4);
  const core = Math.floor(((2 * base + iv + evTerm) * level) / 100) + 5;
  return Math.floor(core * natureMod);
}

function calcAllStatsGen3({ baseStats, ivs, evs, level, nature }) {
  const nat = (nature || "hardy").toLowerCase();
  const mods = NATURE_MODS[nat] || NATURE_MODS.hardy;

  return {
    hp: calcHpGen3(baseStats.hp, ivs.hp, evs.hp, level),
    atk: calcOtherStatGen3(baseStats.atk, ivs.atk, evs.atk, level, mods[0]),
    def: calcOtherStatGen3(baseStats.def, ivs.def, evs.def, level, mods[1]),
    spa: calcOtherStatGen3(baseStats.spa, ivs.spa, evs.spa, level, mods[2]),
    spd: calcOtherStatGen3(baseStats.spd, ivs.spd, evs.spd, level, mods[3]),
    spe: calcOtherStatGen3(baseStats.spe, ivs.spe, evs.spe, level, mods[4]),
  };
}

// --- Example: Mudkip L15 Adamant, IV=15 all, EV=0 all ---
const mudkip = {
  baseStats: { hp: 50, atk: 70, def: 50, spa: 50, spd: 50, spe: 40 },
  ivs:       { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 },
  evs:       { hp: 0,  atk: 0,  def: 0,  spa: 0,  spd: 0,  spe: 0 },
  level: 15,
  nature: "adamant",
};

// Export the main calculator for use by the app
export { calcAllStatsGen3, calcHpGen3, calcOtherStatGen3, NATURE_MODS };
