import { normalizeTrainerIVs, loadTrainer } from './lib/trainerLoader.js';
import { SPECIES_NATIONAL } from './lib/PokémonNationalDexNr.js';
import { calcAllStatsGen3 } from './stat calculation.js';

// App version / cache-buster. In production you can replace this with a fixed
// release string. Using a changing value here forces fresh fetches so users
// don't see stale header/data files when the app is updated.
const APP_VERSION = String(Date.now());

function fetchNoCache(path){
  const sep = path.includes('?') ? '&' : '?';
  const url = path + sep + 'v=' + APP_VERSION;
  try{ return fetch(url, { cache: 'no-store' }); }catch(e){ return fetch(url); }
}

// build a quick lookup map from normalized species name -> national dex number
const SPECIES_MAP = new Map();
for (const [num, name] of SPECIES_NATIONAL){
  const key = name.toLowerCase().replace(/[^a-z0-9]/g,'');
  SPECIES_MAP.set(key, num);
}

function normalizeNameForLookup(s){
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9]/g,'');
}

// In-memory planned-team storage (do not persist by default)
window.__emerald_planned_team = window.__emerald_planned_team || [];
window.__emerald_planned_team_natures = window.__emerald_planned_team_natures || [];
window.__emerald_planned_team_abilities = window.__emerald_planned_team_abilities || [];
function getPlannedTeam(){ return window.__emerald_planned_team || []; }
function getPlannedNatures(){ return window.__emerald_planned_team_natures || []; }
function getPlannedAbilities(){ return window.__emerald_planned_team_abilities || []; }

function getSpriteNumberForSpeciesName(speciesName){
  const key = normalizeNameForLookup(speciesName);
  let num = SPECIES_MAP.get(key) || null;
  if (!num){
    // try fuzzy contains match
    for (const [k,v] of SPECIES_MAP.entries()){
      if (k.includes(key) || key.includes(k)) { num = v; break; }
    }
  }
  if (!num) return null;
  // No offset needed — national dex file aligns with sprite numbering
  return String(num).padStart(4,'0');
}

// --- Parse src/data/raw/species_info.h to extract base stats and types ---
let _speciesInfoMap = null;
async function loadSpeciesInfoH(){
  if (_speciesInfoMap) return _speciesInfoMap;
  _speciesInfoMap = {};
  try{
    const res = await fetchNoCache('src/data/raw/species_info.h');
    if (!res.ok) return _speciesInfoMap;
    const text = await res.text();
    // match blocks like: [SPECIES_NAME] = { ... },
    const re = /\[\s*(SPECIES_[A-Z0-9_]+)\s*\]\s*=\s*\{([\s\S]*?)\n\s*\},/g;
    let m;
    while((m = re.exec(text))){
      const token = m[1];
      const body = m[2];
      const info = {};
      const getNum = (k) => {
          const pattern = '\\.' + k + '\\s*=\\s*([0-9]+)';
          const r = new RegExp(pattern, 'i');
        const mm = body.match(r);
        return mm ? parseInt(mm[1],10) : null;
      };
      const hp = getNum('baseHP');
      const atk = getNum('baseAttack');
      const def = getNum('baseDefense');
      const spe = getNum('baseSpeed');
      const spa = getNum('baseSpAttack');
      const spd = getNum('baseSpDefense');
      info.baseStats = { hp, atk, def, spa, spd, spe };
      // types: .types = { TYPE_WATER, TYPE_GROUND },
      const typesMatch = body.match(/\.types\s*=\s*\{([^\}]+)\}/i);
      if (typesMatch){
        const inside = typesMatch[1];
        const types = Array.from(inside.matchAll(/TYPE_([A-Z0-9_]+)/g)).map(x=>x[1].toLowerCase());
        info.types = types.map(t=>t.replace(/_/g,'').toLowerCase());
      } else {
        info.types = null;
      }
      // abilities: .abilities = {ABILITY_OVERGROW, ABILITY_NONE},
      const abilitiesMatch = body.match(/\.abilities\s*=\s*\{([^\}]+)\}/i);
      if (abilitiesMatch){
        const inside = abilitiesMatch[1];
        const abilities = Array.from(inside.matchAll(/(ABILITY_[A-Z0-9_]+)/g)).map(x=>x[1]);
        info.abilities = abilities;
      } else {
        info.abilities = null;
      }
      _speciesInfoMap[token] = info;
    }
  }catch(e){
    // ignore parse errors
  }
  return _speciesInfoMap;
}

function nameToTokenVariants(name){
  // generate a few token variants to find in species_info map
  if (!name) return [];
  const upper = name.toUpperCase();
  const v = [];
  // basic: replace non-alnum with underscore
  v.push('SPECIES_' + upper.replace(/[^A-Z0-9]/g,'_'));
  // compact: remove non-alnum
  v.push('SPECIES_' + upper.replace(/[^A-Z0-9]/g,''));
  // nidoran special-cases
  if (upper.includes('NIDORAN')){
    v.push('SPECIES_NIDORAN_F');
    v.push('SPECIES_NIDORAN_M');
  }
  // Mr. Mime variants
  if (upper.includes('MR') && upper.includes('MIME')){
    v.push('SPECIES_MR_MIME');
  }
  return v;
}

async function getSpeciesInfoByName(name){
  const map = await loadSpeciesInfoH();
  const variants = nameToTokenVariants(name);
  for (const t of variants){ if (map[t]) return { token: t, info: map[t] }; }
  // try direct token if already passed in
  if (map[name]) return { token: name, info: map[name] };
  return null;
}

// Minimal trainer + teambuilder UI
const TRAINERS_JSON = 'src/data/trainers/trainers_parties.json';

const NATURES = [
  'Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed','Impish','Lax','Timid','Hasty','Serious','Jolly','Naive','Modest','Mild','Quiet','Bashful','Rash','Calm','Gentle','Sassy','Careful'
];

// Gen3 nature modifiers: which stat is boosted and which is lowered
const NATURE_MODS = {
  'Hardy': null,
  'Lonely': { up: 'atk', down: 'def' },
  'Brave': { up: 'atk', down: 'spe' },
  'Adamant': { up: 'atk', down: 'spa' },
  'Naughty': { up: 'atk', down: 'spd' },
  'Bold': { up: 'def', down: 'atk' },
  'Docile': null,
  'Relaxed': { up: 'def', down: 'spe' },
  'Impish': { up: 'def', down: 'spa' },
  'Lax': { up: 'def', down: 'spd' },
  'Timid': { up: 'spe', down: 'atk' },
  'Hasty': { up: 'spe', down: 'def' },
  'Serious': null,
  'Jolly': { up: 'spe', down: 'spa' },
  'Naive': { up: 'spe', down: 'spd' },
  'Modest': { up: 'spa', down: 'atk' },
  'Mild': { up: 'spa', down: 'def' },
  'Quiet': { up: 'spa', down: 'spe' },
  'Bashful': null,
  'Rash': { up: 'spa', down: 'spd' },
  'Calm': { up: 'spd', down: 'atk' },
  'Gentle': { up: 'spd', down: 'def' },
  'Sassy': { up: 'spd', down: 'spe' },
  'Careful': { up: 'spd', down: 'spa' }
};

// Badge definitions for Hoenn (Gen3): which stat(s) each badge boosts
// Implemented: +10% to listed stat(s) when active (internal battles only)
const HOENN_BADGES = {
  'Stone Badge': { key: 'stone', stats: ['atk'] },
  'Balance Badge': { key: 'balance', stats: ['def'] },
  'Mind Badge': { key: 'mind', stats: ['spa','spd'] },
  'Dynamo Badge': { key: 'dynamo', stats: ['spe'] }
};

function loadActiveBadges(){
  // Badges are always active by default (UI removed). Return all defined Hoenn badges.
  try{ return new Set(Object.keys(HOENN_BADGES)); }catch(e){ return new Set(); }
}

function saveActiveBadges(set){
  try{ const arr = Array.from(set); localStorage.setItem('emerald_active_badges', JSON.stringify(arr)); }catch(e){}
}

function applyBadgeBoostsToStats(statsObj, badgeSet){
  if (!badgeSet || badgeSet.size === 0) return statsObj;
  const out = Object.assign({}, statsObj);
  for (const b of badgeSet){
    // find badge by name or key
    let def = HOENN_BADGES[b] || Object.values(HOENN_BADGES).find(x=>x.key === b);
    if (!def) continue;
    for (const s of def.stats){ if (out[s] != null) out[s] = Math.floor(out[s] * 1.10); }
  }
  return out;
}

function prettySpecies(code) {
  if (!code) return '';
  return code.replace(/^SPECIES_/, '').toLowerCase().replace(/(^|_)([a-z])/g, (m,p,c)=>c.toUpperCase());
}

function prettyId(code){
  if (!code) return '';
  return code.replace(/^SPECIES_/, '').toLowerCase();
}

function prettyMove(code){
  if (!code) return '';
  return code.replace(/^MOVE_/, '').toLowerCase().replace(/_/g,' ').replace(/(^|\s)([a-z])/g,(m,p,c)=>c.toUpperCase());
}

function prettyAbility(code){
  if (!code) return '';
  return code.replace(/^ABILITY_/, '').toLowerCase().replace(/_/g,' ').replace(/(^|\s)([a-z])/g,(m,p,c)=>c.toUpperCase());
}

function createInput(labelText, attrs = {}){
  const wrapper = document.createElement('div');
  wrapper.style.marginBottom = '6px';
  const label = document.createElement('label');
  label.className = 'muted';
  label.textContent = labelText;
  const input = document.createElement('input');
  Object.assign(input, attrs);
  input.style.width = '100%';
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function createSelect(labelText, options){
  const wrapper = document.createElement('div');
  wrapper.style.marginBottom = '6px';
  const label = document.createElement('label');
  label.className = 'muted';
  label.textContent = labelText;
  const sel = document.createElement('select');
  sel.style.width = '100%';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  }
  wrapper.appendChild(label);
  wrapper.appendChild(sel);
  return { wrapper, sel };
}

function createStatBarsContainer(){
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '6px';
  container.style.alignItems = 'stretch';
  return container;
}

function renderStatBars(container, stats){
  // optional third arg 'nature' supported (backwards compatible)
  const args = Array.from(arguments);
  const nature = args.length >= 3 ? args[2] : null;
  const mods = nature && NATURE_MODS[nature] ? NATURE_MODS[nature] : null;
  container.innerHTML = '';
  if (!stats) { container.textContent = 'Base: —'; return; }
  const order = [ ['HP','hp'], ['Attack','atk'], ['Defense','def'], ['Sp. Atk','spa'], ['Sp. Def','spd'], ['Speed','spe'] ];
  const maxStat = 200; // scaling reference
  let total = 0;
    for (const [label, key] of order){
    const val = stats[key] || 0;
    total += val;
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    const lab = document.createElement('div');
    lab.textContent = label;
    lab.style.width = '70px';
    lab.style.fontSize = '12px';
    lab.style.color = '#333';
    // color by nature mods: boosted red, lowered blue
    if (mods){
      if (mods.up === key) lab.style.color = '#c33';
      if (mods.down === key) lab.style.color = '#33aaff';
    }
    row.appendChild(lab);

    const barWrap = document.createElement('div');
    barWrap.style.flex = '1';
    barWrap.style.background = '#eee';
    barWrap.style.height = '10px';
    barWrap.style.borderRadius = '6px';
    barWrap.style.position = 'relative';
    const fill = document.createElement('div');
    const pct = Math.min(100, Math.round((val / maxStat) * 100));
    fill.style.width = pct + '%';
    fill.style.height = '100%';
    // color by value
    if (val >= 110) fill.style.background = '#66cc33';
    else if (val >= 80) fill.style.background = '#9acd32';
    else fill.style.background = '#f0c330';
    fill.style.borderRadius = '6px';
    barWrap.appendChild(fill);
    row.appendChild(barWrap);

    const num = document.createElement('div');
    num.textContent = String(val);
    num.style.width = '40px';
    num.style.fontSize = '12px';
    num.style.textAlign = 'right';
    num.style.color = '#111';
    row.appendChild(num);

    container.appendChild(row);
  }
  // total row
  const totRow = document.createElement('div');
  totRow.style.display = 'flex';
  totRow.style.justifyContent = 'space-between';
  totRow.style.marginTop = '6px';
  const left = document.createElement('div'); left.textContent = 'Total'; left.style.fontWeight = '600'; left.style.fontSize='12px';
  const right = document.createElement('div'); right.textContent = String(total); right.style.fontWeight='600'; right.style.fontSize='12px';
  totRow.appendChild(left); totRow.appendChild(right);
  container.appendChild(totRow);
}

async function loadTrainers(){
  const res = await fetchNoCache(TRAINERS_JSON);
  if (!res.ok) throw new Error('Failed loading trainers');
  return await res.json();
}

// Load species data (base stats, moves) from src/data/pokemon/<id>.json when available.
const speciesCache = new Map();
let _speciesIndex = null;
async function loadSpeciesIndex(){
  if (_speciesIndex) return _speciesIndex;
  _speciesIndex = new Set();
  try{
    const res = await fetchNoCache('src/lib/speciesIndex.json');
    if (!res.ok) return _speciesIndex;
    const arr = await res.json();
    for (const a of arr) _speciesIndex.add(a);
  }catch(e){ /* ignore */ }
  return _speciesIndex;
}

async function loadSpeciesData(id){
  if (speciesCache.has(id)) return speciesCache.get(id);
  const idx = await loadSpeciesIndex();
  if (!idx || !idx.has(id)){
    speciesCache.set(id, null);
    return null;
  }
  const path = `src/data/pokemon/${id}.json`;
  try{
    const res = await fetchNoCache(path);
    if (!res.ok) throw new Error('no');
    const data = await res.json();
    speciesCache.set(id, data);
    return data;
  }catch(e){
    speciesCache.set(id, null);
    return null;
  }
}

// --- Load level-up learnsets, TM/HM learnsets, and evolution table from C headers in src/data/raw ---
let _levelUpLearnsets = null;
async function loadLevelUpLearnsetsH(){
  if (_levelUpLearnsets) return _levelUpLearnsets;
  _levelUpLearnsets = {};
  try{
    const res = await fetchNoCache('src/data/raw/level_up_learnsets.h');
    if (!res.ok) return _levelUpLearnsets;
    const text = await res.text();
    const re = /static\s+const\s+u16\s+s([A-Za-z0-9_]+)LevelUpLearnset\s*\[\]\s*=\s*\{([\s\S]*?)\n\s*\};/g;
    let m;
    while((m = re.exec(text))){
      let name = m[1];
      const body = m[2];
      name = name.replace(/([a-z])([A-Z])/g,'$1_$2').replace(/[^A-Za-z0-9_]/g,'_').toUpperCase();
      const token = 'SPECIES_' + name;
      const moves = [];
      const rm = /LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*(MOVE_[A-Z0-9_]+)\s*\)/g;
      let mm;
      while((mm = rm.exec(body))){
        moves.push({ level: parseInt(mm[1],10), move: mm[2] });
      }
      _levelUpLearnsets[token] = moves;
    }
  }catch(e){ }
  return _levelUpLearnsets;
}

let _tmhmLearnsets = null;
async function loadTMHMLearnsetsH(){
  if (_tmhmLearnsets) return _tmhmLearnsets;
  _tmhmLearnsets = {};
  try{
    const res = await fetchNoCache('src/data/raw/tmhm_learnsets.h');
    if (!res.ok) return _tmhmLearnsets;
    const text = await res.text();
    const re = /\[\s*(SPECIES_[A-Z0-9_]+)\s*\]\s*=\s*\{\s*\.learnset\s*=\s*\{([\s\S]*?)\}\s*\}/g;
    let m;
    while((m = re.exec(text))){
      const token = m[1];
      const body = m[2];
      const moves = Array.from(body.matchAll(/\.([A-Z0-9_]+)\s*=\s*TRUE/g)).map(x => ('MOVE_' + x[1]));
      _tmhmLearnsets[token] = moves;
    }
  }catch(e){ }
  return _tmhmLearnsets;
}

let _evolutionTable = null;
async function loadEvolutionsH(){
  if (_evolutionTable) return _evolutionTable;
  _evolutionTable = {};
  try{
    const res = await fetchNoCache('src/data/raw/evolution.h');
    if (!res.ok) return _evolutionTable;
    const text = await res.text();
    const re = /\[\s*(SPECIES_[A-Z0-9_]+)\s*\]\s*=\s*\{([\s\S]*?)\},/g;
    let m;
    while((m = re.exec(text))){
      const token = m[1];
      const body = m[2];
      const evos = [];
      // find inner { ... } groups containing EVO entries
      const innerRe = /\{([^}]+)\}/g;
      let im;
      while((im = innerRe.exec(body))){
        const parts = im[1].split(',').map(s=>s.trim()).filter(Boolean);
        if (parts.length >= 3){
          const method = parts[0];
          const paramRaw = parts[1];
          const target = parts[2];
          const param = /^[0-9]+$/.test(paramRaw) ? parseInt(paramRaw,10) : paramRaw;
          evos.push({ method, param, species: target });
        }
      }
      _evolutionTable[token] = evos;
    }
  }catch(e){ }
  return _evolutionTable;
}

// Convenience loaders that normalize names/tokens where needed
async function loadLearnsets(){ return await loadLevelUpLearnsetsH(); }
async function loadTMHMs(){ return await loadTMHMLearnsetsH(); }
async function loadEvolutions(){ return await loadEvolutionsH(); }

// --- Battle level computation and legal-species devolution ---
function computeBattleLevel(trainer){
  if (!trainer || !Array.isArray(trainer.pokemons)) return 1;
  let max = 1;
  for (const p of trainer.pokemons){
    const raw = (p.lvl !== undefined ? p.lvl : (p.level !== undefined ? p.level : 1));
    const lvl = parseInt(raw, 10) || 1;
    if (lvl > max) max = lvl;
  }
  // Cap player-facing battle level for Elite Four / Champion sequence
  // In Emerald Nuzlocke progression we treat Sidney -> Wallace as the late-game
  // block where player's Pokémon are limited to level 55 by default.
  try{
    const eliteNames = new Set(['sidney','phoebe','glacia','drake','wallace']);
    const tname = (trainer && trainer.name) ? String(trainer.name).toLowerCase() : '';
    if (eliteNames.has(tname)) return Math.min(max, 55);
  }catch(e){ /* ignore and fallthrough */ }
  return max;
}

// Compute the default player-side level to use when populating planned-team slots
// For early trainers we match the trainer's highest level; for Elite Four/Champion
// (Sidney -> Wallace) we use a Nuzlocke cap of 55 by default.
function computePlayerDefaultLevel(trainer){
  const enemyLevel = computeBattleLevel(trainer);
  try{
    const eliteNames = new Set(['sidney','phoebe','glacia','drake','wallace']);
    const tname = (trainer && trainer.name) ? String(trainer.name).toLowerCase() : '';
    if (eliteNames.has(tname)) return 55;
  }catch(e){ }
  return enemyLevel;
}

function buildReverseEvolutionMap(evoTable){
  const rev = {};
  for (const src in evoTable){
    const evos = evoTable[src] || [];
    for (const e of evos){
      const tgt = e.species;
      if (!rev[tgt]) rev[tgt] = [];
      rev[tgt].push({ from: src, method: e.method, param: e.param });
    }
  }
  return rev;
}

function computeMinLevelForSpecies(token, revMap, memo = {}){
  if (memo[token] != null) return memo[token];
  const preds = revMap[token];
  if (!preds || preds.length === 0){ memo[token] = 1; return 1; }
  let best = Infinity;
  for (const p of preds){
    // if evolution to `token` requires a level, that level is the minimum for token via that route
    const method = (p.method||'').toString();
    const param = p.param;
    let lvl = 1;
    if (/EVO_LEVEL/i.test(method) && typeof param === 'number') lvl = param;
    else lvl = 1;
    if (lvl < best) best = lvl;
  }
  memo[token] = (best === Infinity) ? 1 : best;
  return memo[token];
}

function collectAncestors(token, revMap, out = new Set()){
  if (out.has(token)) return out;
  out.add(token);
  const preds = revMap[token] || [];
  for (const p of preds){
    collectAncestors(p.from, revMap, out);
  }
  return out;
}

async function devolveSpeciesToLegalAtLevel(nameOrToken, level, trainerOrSeg = null){
  const evoTable = await loadEvolutions();
  const rev = buildReverseEvolutionMap(evoTable);
  // normalize incoming to a token if a name was provided
  let token = nameOrToken;
  if (!/^SPECIES_/.test(nameOrToken)){
    const variants = nameToTokenVariants(nameOrToken);
    token = variants.length ? variants[0] : ('SPECIES_' + nameOrToken.toUpperCase().replace(/[^A-Z0-9]/g,'_'));
  }
  const requested = token;
  // collect all ancestors including self
  const ancestors = Array.from(collectAncestors(token, rev));
  // compute minLevels for each ancestor
  const memo = {};
  const candidates = ancestors.map(t=>({ token: t, minLevel: computeMinLevelForSpecies(t, rev, memo) }));
  // pick the candidate with the largest minLevel <= level
  candidates.sort((a,b)=>a.minLevel - b.minLevel);
  let chosen = token;
  for (const c of candidates){
    if (c.minLevel <= level) chosen = c.token;
  }

  // Special-case rules for species that evolve by non-standard methods.
  try{
    // Determine progression segment: prefer trainer identity when provided
    let seg = null;
    if (trainerOrSeg != null){
      if (typeof trainerOrSeg === 'number') seg = trainerOrSeg;
      else if (typeof trainerOrSeg === 'object' && trainerOrSeg.name) seg = trainerNameToSegment(trainerOrSeg) || null;
      else if (typeof trainerOrSeg === 'string') seg = parseInt(trainerOrSeg,10) || null;
    }
    if (seg == null) seg = approximateSegmentForLevel(parseInt(level||0,10));

    // Shedinja/Nincada
    if (chosen === 'SPECIES_SHEDINJA' && (parseInt(level||0,10) < 20)){
      chosen = 'SPECIES_NINCADA';
    }
    // Crobat/Golbat: prefer Crobat at Wattson era
    if (chosen === 'SPECIES_GOLBAT' && seg >= 3){ chosen = 'SPECIES_CROBAT'; }
    if (chosen === 'SPECIES_CROBAT' && seg < 3){ chosen = 'SPECIES_ZUBAT'; }
    // Bellossom: Oddish -> Gloom at Wattson (seg >=3), -> Bellossom at Flannery (seg >=4)
    if (chosen === 'SPECIES_BELLOSSOM'){
      if (seg < 3) chosen = 'SPECIES_ODDISH';
      else if (seg < 4) chosen = 'SPECIES_GLOOM';
      else chosen = 'SPECIES_BELLOSSOM';
    }
    // Vileplume: Oddish -> Gloom at Wattson (seg >=3), -> Vileplume at Winona (seg >=6)
    if (chosen === 'SPECIES_VILEPLUME'){
      if (seg < 3) chosen = 'SPECIES_ODDISH';
      else if (seg < 6) chosen = 'SPECIES_GLOOM';
      else chosen = 'SPECIES_VILEPLUME';
    }
    // Azumarill requested handling: Marill available from Roxanne (seg>=1),
    // Azumarill available from Brawly (seg>=2). Avoid mapping to Azurill.
    if (requested === 'SPECIES_AZUMARILL'){
      if (seg >= 2) chosen = 'SPECIES_AZUMARILL';
      else chosen = 'SPECIES_MARILL';
    }
    // Azumarill: don't devolve to Azurill (egg-only) when user explicitly
    // requested Azumarill; prefer Marill instead since Marill can be caught.
    if (chosen === 'SPECIES_AZURRIL' && requested === 'SPECIES_AZUMARILL'){
      chosen = 'SPECIES_MARILL';
    }
    // Shiftry: if the user specifically requested Shiftry, keep it as Nuzleaf
    // until Winona (seg >=6); otherwise respect candidate selection.
    if (requested === 'SPECIES_SHIFTRY'){
      if (seg < 6) chosen = 'SPECIES_NUZLEAF';
      else chosen = 'SPECIES_SHIFTRY';
    }
    // Delcatty: if explicitly requested, keep as Skitty until Flannery (seg >=4)
    if (requested === 'SPECIES_DELCATTY'){
      if (seg < 4) chosen = 'SPECIES_SKITTY';
      else chosen = 'SPECIES_DELCATTY';
    }
    // Milotic: if explicitly requested, keep as Feebas until Winona (seg >=6)
    if (requested === 'SPECIES_MILOTIC'){
      if (seg < 6) chosen = 'SPECIES_FEEBAS';
      else chosen = 'SPECIES_MILOTIC';
    }
    // Ludicolo: if the user specifically requested Ludicolo, keep it as Lombre
    // until Juan (seg >=8); if user requested Lombre/other, respect candidate selection.
    if (requested === 'SPECIES_LUDICOLO'){
      if (seg < 8) chosen = 'SPECIES_LOMBRE';
      else chosen = 'SPECIES_LUDICOLO';
    }
    // Ninjask: require level 20 on Nincada
    if (chosen === 'SPECIES_NINJASK' && (parseInt(level||0,10) < 20)){
      chosen = 'SPECIES_NINCADA';
    }
  }catch(e){ /* ignore */ }
  return chosen;
}

// expose helpers for debugging in browser console
window.computeBattleLevel = computeBattleLevel;
window.devolveSpeciesToLegalAtLevel = devolveSpeciesToLegalAtLevel;

// --- STAB move selection and TM availability windows ---
let _tmAvailabilityMap = null; // optional explicit per-trainer map { trainerName: [MOVE_...] }
let _tmAvailabilityBySegment = null; // built from src/data/tm_availability.json -> { segmentKey: Set(MOVE_...) }
let _tmMoveToSegment = null; // map MOVE_TOKEN -> numeric segment order (1..n)
function setTMAvailabilityMap(map){ _tmAvailabilityMap = map; }
window.setTMAvailabilityMap = setTMAvailabilityMap;

function segmentNameToOrder(name){
  if (!name) return 999;
  const n = String(name).toLowerCase();
  if (n === 'before_gym_1') return 1;
  const m = n.match(/before_gym_(\d+)/);
  if (m) return parseInt(m[1],10);
  if (n === 'after_gym_8_pre_elite') return 9;
  if (n === 'post_elite') return 10;
  // fallback: try to extract trailing digit
  const mm = n.match(/(\d+)/);
  return mm ? parseInt(mm[1],10) : 999;
}

function approximateSegmentForLevel(level){
  // heuristic mapping of trainer max level -> progression segment
  const l = parseInt(level||0,10);
  if (l <= 15) return 1;
  if (l <= 20) return 2;
  if (l <= 25) return 3;
  if (l <= 30) return 4;
  if (l <= 40) return 5;
  if (l <= 50) return 6;
  if (l <= 60) return 7;
  if (l <= 70) return 8;
  return 9;
}

function trainerNameToSegment(trainer){
  if (!trainer || !trainer.name) return null;
  const n = trainer.name.toLowerCase();
  // common gym leader name prefixes -> gym number
  const mapping = {
    'roxanne': 1,
    'brawly': 2,
    'wattson': 3,
    'flannery': 4,
    'norman': 5,
    'winona': 6,
    'tateandliza': 7,
    'tate': 7,
    'liza': 7,
    'juan': 8,
    'sidney': 9,
    'phoebe': 9,
    'glacia': 9,
    'drake': 9,
    'wallace': 9
  };
  for (const key in mapping){ if (n.includes(key)) return mapping[key]; }
  // fallback: if trainer names include a gym number like 'Roxanne1' attempt to extract numeric suffix
  const m = n.match(/(\D+)(\d+)$/);
  if (m){ const namePart = m[1]; for (const key in mapping){ if (namePart.includes(key)) return mapping[key]; } }
  return null;
}

async function loadTMAvailabilityJSON(){
  if (_tmAvailabilityBySegment) return _tmAvailabilityBySegment;
  _tmAvailabilityBySegment = {};
  _tmMoveToSegment = {};
  try{
    const res = await fetchNoCache('src/data/tm_availability.json');
    if (!res.ok) return _tmAvailabilityBySegment;
    const arr = await res.json();
    for (const e of arr){
      const seg = e.earliest || 'post_elite';
      if (!_tmAvailabilityBySegment[seg]) _tmAvailabilityBySegment[seg] = new Set();
      if (e.move) {
        _tmAvailabilityBySegment[seg].add(e.move);
        try{ const ord = segmentNameToOrder(seg); const cur = _tmMoveToSegment[e.move]; if (!cur || ord < cur) _tmMoveToSegment[e.move] = ord; }catch(e){}
      } else if (e.item && e.move) {
        _tmAvailabilityBySegment[seg].add(e.move);
        try{ const ord = segmentNameToOrder(seg); const cur = _tmMoveToSegment[e.move]; if (!cur || ord < cur) _tmMoveToSegment[e.move] = ord; }catch(e){}
      }
    }
  }catch(e){ /* ignore */ }
  return _tmAvailabilityBySegment;
}

function collectAllowedTMsUpToSegment(segOrder){
  // combine all segment sets whose order <= segOrder
  const out = new Set();
  if (!_tmAvailabilityBySegment) return out;
  for (const seg in _tmAvailabilityBySegment){
    try{
      const ord = segmentNameToOrder(seg);
      if (ord <= segOrder){
        for (const mv of _tmAvailabilityBySegment[seg]) out.add(mv);
      }
    }catch(e){}
  }
  return out;
}

// Return numeric segment assigned to a MOVE token (1..n), or null if unknown
function getTMMoveSegment(moveToken){
  if (!_tmMoveToSegment) return null;
  return _tmMoveToSegment[moveToken] || null;
}
window.getTMMoveSegment = getTMMoveSegment;

// Compute numeric segment for a trainer (prefer explicit name mapping, fall back to level heuristic)
function getTrainerSegmentNumber(trainer){
  const explicit = trainerNameToSegment(trainer || {});
  if (explicit) return explicit;
  const lvl = computeBattleLevel(trainer || {});
  return approximateSegmentForLevel(lvl);
}
window.getTrainerSegmentNumber = getTrainerSegmentNumber;

// expose the full move->segment map for debugging
function getTMMoveToSegmentMap(){ return _tmMoveToSegment || {}; }
window.getTMMoveToSegmentMap = getTMMoveToSegmentMap;

function getAvailableTMsForTrainer(trainer){
  // explicit per-trainer override wins
  if (_tmAvailabilityMap && trainer && trainer.name && _tmAvailabilityMap[trainer.name]){
    return new Set(_tmAvailabilityMap[trainer.name]);
  }
  // otherwise compute from tm_availability.json by estimating progression segment from trainer level
  try{
    // prefer explicit trainer name -> gym segment mapping when available
    const explicitSeg = trainerNameToSegment(trainer || {});
    const battleLevel = computeBattleLevel(trainer || {});
    const seg = explicitSeg || approximateSegmentForLevel(battleLevel);
    const allowed = collectAllowedTMsUpToSegment(seg);
    // if empty set => treat as allowing all (so legacy behavior preserved)
    if (allowed.size === 0) return null;
    return allowed;
  }catch(e){ return null; }
}

// small heuristic move power and move->type map for common Gen3 moves
const MOVE_POWER = {
  'MOVE_SOLAR_BEAM':120,'MOVE_FLAMETHROWER':90,'MOVE_FIRE_BLAST':110,'MOVE_SURF':95,'MOVE_HYDRO_PUMP':120,'MOVE_EARTHQUAKE':100,'MOVE_THUNDERBOLT':95,'MOVE_THUNDER':110,'MOVE_HYPER_BEAM':150,'MOVE_PSYCHIC':90,'MOVE_ICE_BEAM':90,'MOVE_BLIZZARD':110,'MOVE_SLUDGE_BOMB':90,'MOVE_ICE_PUNCH':75,'MOVE_THUNDER_PUNCH':75,'MOVE_RETURN':102,'MOVE_SHADOW_BALL':80,'MOVE_SLUDGE':55,'MOVE_BRICK_BREAK':75,'MOVE_SLASH':70,'MOVE_DRAGON_RAGE':0
};
const MOVE_TYPE = {
  'MOVE_SOLAR_BEAM':'grass','MOVE_FLAMETHROWER':'fire','MOVE_FIRE_BLAST':'fire','MOVE_SURF':'water','MOVE_HYDRO_PUMP':'water','MOVE_EARTHQUAKE':'ground','MOVE_THUNDERBOLT':'electric','MOVE_THUNDER':'electric','MOVE_PSYCHIC':'psychic','MOVE_ICE_BEAM':'ice','MOVE_BLIZZARD':'ice','MOVE_SLUDGE_BOMB':'poison','MOVE_DRAGON_RAGE':'dragon','MOVE_BRICK_BREAK':'fighting','MOVE_SLASH':'normal','MOVE_RETURN':'normal','MOVE_SHADOW_BALL':'ghost'
};

function isStatusMove(moveToken){
  // Note: tokens must be matched carefully — some names like CONFUSION are actual attacking moves
  const statusKeywords = ['GROWL','TAIL_WHIP','SYNTHESIS','GROWTH','SLEEP','POWDER','TOXIC','ROAR','REST','SAND_ATTACK','AGILITY','SANDSTORM','DOUBLE_TEAM','TELEPORT','LOCK_ON','MORNING_SUN'];
  for (const k of statusKeywords){ if (moveToken.includes(k)) return true; }
  return false;
}

function isSetupMoveToken(mv){
  if (!mv) return false;
  const s = String(mv).toUpperCase();
  return /SWORDS?_DANCE|BELLY_DRUM|DRAGON_DANCE|CURSE|GROWTH|IRON_DEFENSE|AMNESIA|COSMIC_POWER|CALM_MIND|BULK_UP|CHARGE|AGILITY/.test(s);
}

async function selectBestSTABMove(speciesNameOrToken, level, trainer=null){
  const lvlSets = await loadLevelUpLearnsetsH();
  const tmSets = await loadTMHMLearnsetsH();
  const movesMap = await loadBattleMovesH();
  // normalize token
  let token = speciesNameOrToken;
  if (!/^SPECIES_/.test(token)){
    const v = nameToTokenVariants(speciesNameOrToken);
    token = v.length? v[0] : ('SPECIES_' + speciesNameOrToken.toUpperCase().replace(/[^A-Z0-9]/g,'_'));
  }
  const levelMoves = (lvlSets[token] || []).filter(m=>m.level <= level).map(m=>m.move);
  const tmMoves = (tmSets[token] || []);
  // get species types
  const si = await getSpeciesInfoByName(speciesNameOrToken);
  const types = (si && si.info && si.info.types) ? si.info.types : [];
  const availableTMs = getAvailableTMsForTrainer(trainer);

  const candidates = [];
  // include level moves and available TM moves; do not filter out status moves here so they appear in choices
  for (const mv of levelMoves){ candidates.push({ move: mv, source: 'level' }); }
  for (const mv of tmMoves){ if (availableTMs === null || availableTMs.has(mv) ) candidates.push({ move: mv, source: 'tm' }); }

  if (candidates.length === 0){
    // fallback: allow status moves or any available level/tm move
    if (levelMoves.length) return levelMoves[0];
    if (tmMoves.length) return tmMoves[0];
    return null;
  }
  // compute scores asynchronously using parsed move data when available
  const scored = await Promise.all(candidates.map(async (c)=>{
    const moveToken = c.move;
    // start with conservative defaults, but prefer authoritative data from movesMap when available
    let power = (MOVE_POWER[moveToken] != null) ? MOVE_POWER[moveToken] : 50;
    let mtype = MOVE_TYPE[moveToken] || null;
    try{
      const resolved = await resolveMoveToken(moveToken);
      const mm = movesMap && (movesMap[resolved] || movesMap[moveToken]) ? (movesMap[resolved] || movesMap[moveToken]) : null;
      if (mm){
        // If parsed move entry exists but has no numeric power, treat as a status move (power = 0)
        if (mm.power == null || mm.power === 0) power = 0;
        else power = mm.power;
        if (mm.type) mtype = mm.type;
      } else {
        // fallback: treat known status-like tokens via simple heuristic
        if (isStatusMove(moveToken)) power = 0;
      }
    }catch(e){
      if (isStatusMove(moveToken)) power = 0;
    }
    const stab = (mtype && types.includes(mtype)) ? 50 : 0;
    return { move: moveToken, score: power + stab, source: c.source, power: power, mtype: mtype };
  }));
  scored.sort((a,b)=>b.score - a.score);
  // Prefer moves that actually deal damage (power > 0). Only pick a 0-power move
  // if there are no damaging moves available.
  const damaging = scored.filter(s => (s.power || 0) > 0);
  if (damaging.length > 0){ damaging.sort((a,b)=>b.score - a.score); return damaging[0].move; }
  // otherwise fall back to best available (even if 0 power)
  return scored[0].move;
}

window.selectBestSTABMove = selectBestSTABMove;

// --- Load battle moves (power/type/accuracy/flags) ---
let _battleMoves = null;
async function loadBattleMovesH(){
  if (_battleMoves) return _battleMoves;
  _battleMoves = {};
  try{
    const res = await fetchNoCache('src/data/raw/battle_moves.h');
    if (!res.ok) return _battleMoves;
    const text = await res.text();
    const re = /\[\s*(MOVE_[A-Z0-9_]+)\s*\]\s*=\s*\{([\s\S]*?)\n\s*\},/g;
    let m;
    while((m = re.exec(text))){
      const move = m[1];
      const body = m[2];
      const getNum = (k) => {
        const pattern = '\\.' + k + '\\s*=\\s*([0-9]+)';
        const r = new RegExp(pattern, 'i');
        const mm = body.match(r);
        return mm ? parseInt(mm[1],10) : null;
      };
      const power = getNum('power');
      const accuracy = getNum('accuracy');
      const pp = getNum('pp');
      const sec = getNum('secondaryEffectChance');
      const typeMatch = body.match(/\.type\s*=\s*TYPE_([A-Z0-9_]+)/i);
      const type = typeMatch ? typeMatch[1].toLowerCase() : null;
      // annotate category according to Gen3 rules (physical vs special depends on type)
      const category = type ? (SPECIAL_TYPES && SPECIAL_TYPES.has ? (SPECIAL_TYPES.has(type) ? 'special' : 'physical') : null) : null;
      const flagsMatch = body.match(/\.flags\s*=\s*([^,}]+)/i);
      const flags = [];
      if (flagsMatch){ const f = flagsMatch[1]; const found = Array.from(f.matchAll(/FLAG_[A-Z0-9_]+/g)).map(x=>x[0]); found.forEach(x=>flags.push(x)); }
      _battleMoves[move] = { move, power, accuracy, pp, secondaryEffectChance: sec, type, category, flags };
    }
  }catch(e){ }
  return _battleMoves;
}

// Build a small name->token index to help resolve non-token move strings
let _moveNameToToken = null;
async function buildMoveNameIndex(){
  if (_moveNameToToken) return _moveNameToToken;
  _moveNameToToken = {};
  const movesMap = await loadBattleMovesH();
  if (!movesMap) return _moveNameToToken;
  for (const k in movesMap){
    try{
      const pretty = prettyMove(k).toLowerCase().replace(/[^a-z0-9]/g,'');
      _moveNameToToken[pretty] = k;
      const plain = k.replace(/^MOVE_/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
      _moveNameToToken[plain] = k;
    }catch(e){ /* ignore */ }
  }
  return _moveNameToToken;
}

// Resolve a raw move string (e.g. "Surf", "AerialAce", "MOVE_SURF") to a canonical MOVE_ token
async function resolveMoveToken(raw){
  if (!raw) return null;
  if (/^MOVE_[A-Z0-9_]+$/.test(raw)) return raw;
  const movesMap = await loadBattleMovesH();
  // try sensible tokenizations
  const camelToUnderscore = raw.replace(/([a-z])([A-Z])/g,'$1_$2');
  const cleaned = camelToUnderscore.replace(/[^A-Za-z0-9]+/g,'_').toUpperCase();
  const cand = 'MOVE_' + cleaned.replace(/^MOVE_+/, '');
  if (movesMap && movesMap[cand]) return cand;
  const cand2 = 'MOVE_' + raw.toUpperCase().replace(/[^A-Z0-9]+/g,'_');
  if (movesMap && movesMap[cand2]) return cand2;
  // try indexed pretty names
  const idx = await buildMoveNameIndex();
  const key = String(raw).toLowerCase().replace(/[^a-z0-9]/g,'');
  if (idx && idx[key]) return idx[key];
  // last resort: try to match by prettyMove equality
  if (movesMap){
    for (const k in movesMap){ if (prettyMove(k).toLowerCase() === String(raw).toLowerCase()) return k; }
  }
  return cand;
}

// --- Type effectiveness table (Gen3) ---
const TYPE_CHART = (function(){
  const t = {};
  const setRow = (atk, obj) => { t[atk.toLowerCase()] = obj; };
  // fill defaults as 1, then override
  const all = ['normal','fighting','flying','poison','ground','rock','bug','ghost','steel','fire','water','grass','electric','psychic','ice','dragon','dark'];
  for (const a of all) { const row = {}; for (const d of all) row[d]=1; t[a]=row; }
  setRow('normal', {rock:0.5,ghost:0,steel:0.5});
  setRow('fighting',{normal:2,rock:2,steel:2,ice:2,dark:2,ghost:0,flying:0.5,poison:0.5,bug:0.5,psychic:0.5});
  setRow('flying',{fighting:2,bug:2,grass:2,rock:0.5,electric:0.5,steel:0.5});
  setRow('poison',{grass:2,poison:0.5,ground:0.5,rock:0.5,ghost:0.5,steel:0});
  setRow('ground',{fire:2,electric:2,poison:2,rock:2,steel:2,grass:0.5,bug:0.5,flying:0});
  setRow('rock',{fire:2,ice:2,flying:2,bug:2,fighting:0.5,ground:0.5,steel:0.5});
  setRow('bug',{grass:2,psychic:2,dark:2,fire:0.5,fighting:0.5,poison:0.5,flying:0.5,ghost:0.5,steel:0.5});
  setRow('ghost',{ghost:2,psychic:0,normal:0,dark:0.5});
  setRow('steel',{ice:2,rock:2,fire:0.5,water:0.5,electric:0.5,steel:0.5});
  setRow('fire',{grass:2,ice:2,bug:2,steel:2,fire:0.5,water:0.5,rock:0.5,dragon:0.5});
  setRow('water',{fire:2,ground:2,rock:2,water:0.5,grass:0.5,dragon:0.5});
  setRow('grass',{water:2,ground:2,rock:2,fire:0.5,grass:0.5,poison:0.5,flying:0.5,bug:0.5,dragon:0.5,steel:0.5});
  setRow('electric',{water:2,flying:2,grass:0.5,electric:0.5,ground:0});
  setRow('psychic',{fighting:2,poison:2,psychic:0.5,dark:0});
  setRow('ice',{grass:2,ground:2,flying:2,dragon:2,fire:0.5,water:0.5,ice:0.5,steel:0.5});
  setRow('dragon',{dragon:2,steel:0.5});
  setRow('dark',{psychic:2,ghost:2,fighting:0.5,dark:0.5});
  return t;
})();

// color palette for types (used in move/type displays)
const TYPE_COLORS = {
  fire:'#F08030', water:'#6890F0', grass:'#78C850', electric:'#F8D030', rock:'#B8A038', ground:'#E0C068', bug:'#A8B820', ghost:'#705898', steel:'#B8B8D0', ice:'#98D8D8', psychic:'#F85888', dark:'#705848', dragon:'#7038F8', normal:'#A8A878', fighting:'#C03028', poison:'#A040A0', flying:'#A890F0'
};

function renderTypeBadges(container, types){
  container.innerHTML = '';
  if (!types || types.length === 0){ container.textContent = 'Type: —'; return; }
  // normalize and dedupe (some data sources include the same type twice)
  const seen = new Set();
  const uniq = [];
  for (const t of types){
    if (!t) continue;
    const key = String(t).toLowerCase();
    if (!seen.has(key)) { seen.add(key); uniq.push(key); }
  }
  if (uniq.length === 0){ container.textContent = 'Type: —'; return; }
  const wrapper = document.createElement('div');
  wrapper.className = 'type-wrapper';
  wrapper.style.display = 'flex';
  wrapper.style.flexWrap = 'wrap';
  wrapper.style.gap = '6px';
  const label = document.createElement('div'); label.className = 'type-label'; label.textContent = 'Type:'; label.style.fontWeight = '600'; label.style.marginRight = '6px'; label.style.alignSelf='center';
  wrapper.appendChild(label);
  for (const key of uniq){
    const color = TYPE_COLORS[key] || '#ddd';
    const span = document.createElement('div');
    span.className = 'type-pill';
    span.textContent = key[0].toUpperCase() + key.slice(1);
    span.style.background = color;
    span.style.color = '#fff';
    span.style.padding = '2px 8px';
    span.style.borderRadius = '12px';
    span.style.fontSize = '12px';
    span.style.fontWeight = '600';
    span.style.display = 'inline-block';
    span.style.flex = '0 0 auto';
    span.style.whiteSpace = 'nowrap';
    wrapper.appendChild(span);
  }
  container.appendChild(wrapper);
}

function typeEffectiveness(atkType, defTypes){
  if (!atkType) return 1;
  const row = TYPE_CHART[atkType.toLowerCase()] || null;
  if (!row) return 1;
  let mult = 1;
  for (const d of (defTypes||[])){
    const dv = (row[d.toLowerCase()] != null) ? row[d.toLowerCase()] : 1;
    mult *= dv;
  }
  return mult;
}

// types that are special in Gen3
const SPECIAL_TYPES = new Set(['fire','water','electric','grass','ice','psychic','dragon','dark']);

function computeStatFromBase(base, iv=31, ev=0, level=50, isHP=false){
  const ev4 = Math.floor(ev/4);
  if (isHP){
    return Math.floor(((2*base + iv + ev4) * level)/100) + level + 10;
  } else {
    return Math.floor(((2*base + iv + ev4) * level)/100) + 5;
  }
}

// --- Core damage/scoring helpers (Emerald-like) ---
function _gen3RandomMultipliers(){
  const arr = [];
  for (let r=85;r<=100;r++) arr.push(r/100);
  return arr;
}

async function calcDamageRange(attackerToken, attackerLevel, defenderToken, defenderLevel, moveToken, options = {}){
  // returns DamageResult: { rolls:[], min, max, expected, ohkoGuaranteed, ohkoPossible, power, type }
  const movesMap = await loadBattleMovesH();
  const atkInfo = await getSpeciesInfoByName(prettySpecies(attackerToken).toLowerCase()) || await getSpeciesInfoByName(attackerToken);
  const defInfo = await getSpeciesInfoByName(prettySpecies(defenderToken).toLowerCase()) || await getSpeciesInfoByName(defenderToken);
  if (!atkInfo || !atkInfo.info || !defInfo || !defInfo.info) return { rolls: [], min:0, max:0, expected:0, ohkoGuaranteed:false, ohkoPossible:false };
  const atkBase = atkInfo.info.baseStats;
  const defBase = defInfo.info.baseStats;
  // If caller provided precomputed final stats (hp, atk, def, spa, spd, spe), use them
  const attStats = options.attStats || null;
  const defStats = options.defStats || null;
  const atkHP = attStats && attStats.hp ? attStats.hp : computeStatFromBase(atkBase.hp, options.attIV||31, options.attEV||0, attackerLevel, true);
  const defHP = defStats && defStats.hp ? defStats.hp : computeStatFromBase(defBase.hp, options.defIV||31, options.defEV||0, defenderLevel, true);

  // resolve move data with robust normalization (accepts 'WaterGun', 'Water_Gun', 'MOVE_WATER_GUN', etc.)
  let canonicalMove = moveToken;
  try{ canonicalMove = await resolveMoveToken(moveToken); }catch(e){ canonicalMove = moveToken; }
  let m = (movesMap && (movesMap[canonicalMove] || movesMap[moveToken])) ? (movesMap[canonicalMove] || movesMap[moveToken]) : null;
  // fallback normalization: compare alphanumeric-normalized keys and prettyMove equality
  if (!m && movesMap){
    const norm = String(moveToken||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    for (const k in movesMap){
      if (!movesMap[k]) continue;
      const kn = String(k).toLowerCase().replace(/[^a-z0-9]/g,'');
      const knStrip = kn.replace(/^move/, '');
      if (kn === norm || knStrip === norm){ m = movesMap[k]; canonicalMove = k; break; }
    }
  }
  if (!m && movesMap){
    for (const k in movesMap){ if (prettyMove(k).toLowerCase() === String(moveToken||'').toLowerCase()){ m = movesMap[k]; canonicalMove = k; break; } }
  }
  if (!m){
    // try the prebuilt name index (maps stripped names to tokens)
    try{
      const idx = await buildMoveNameIndex();
      const key = String(moveToken||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      if (idx && idx[key] && movesMap && movesMap[idx[key]]){ m = movesMap[idx[key]]; canonicalMove = idx[key]; }
    }catch(e){}
  }
  if (!m){
    // try canonical construction with underscores: WaterGun -> MOVE_WATER_GUN
    try{
      const camelToUnderscore = String(moveToken||'').replace(/([a-z])([A-Z])/g,'$1_$2');
      const cand = 'MOVE_' + camelToUnderscore.replace(/[^A-Za-z0-9]+/g,'_').toUpperCase();
      if (movesMap && movesMap[cand]){ m = movesMap[cand]; canonicalMove = cand; }
    }catch(e){}
  }
  const fallbackPower = MOVE_POWER[canonicalMove] || MOVE_POWER[moveToken] || (m? m.power : 50) || 50;
  const power = (m && (m.power != null)) ? m.power : fallbackPower;
  const mtype = (m && m.type) ? m.type : (MOVE_TYPE[canonicalMove] || MOVE_TYPE[moveToken] || null);
  // Debug instrumentation: log unexpected fallback power resolutions
  try{
    if (power === 50){
      let mStr = null;
      try{ mStr = JSON.stringify(m); }catch(e){ mStr = String(m); }
      console.debug('calcDamageRange: fallback power used', { moveToken, canonicalMove, fallbackPower, parsedMove: mStr, MOVE_POWER_entry: MOVE_POWER[canonicalMove], MOVE_TYPE_entry: MOVE_TYPE[canonicalMove] });
    }
  }catch(e){}
  // Prefer explicit category parsed from moves; fall back to type-based rule
  const isSpecial = (m && m.category) ? (m.category === 'special') : (mtype ? SPECIAL_TYPES.has(mtype) : false);

  const A = isSpecial ? (attStats && attStats.spa ? attStats.spa : computeStatFromBase(atkBase.spa, options.attIV||31, options.attEV||0, attackerLevel, false)) : (attStats && attStats.atk ? attStats.atk : computeStatFromBase(atkBase.atk, options.attIV||31, options.attEV||0, attackerLevel, false));
  const D = isSpecial ? (defStats && defStats.spd ? defStats.spd : computeStatFromBase(defBase.spd, options.defIV||31, options.defEV||0, defenderLevel, false)) : (defStats && defStats.def ? defStats.def : computeStatFromBase(defBase.def, options.defIV||31, options.defEV||0, defenderLevel, false));

  // Attacker / defender abilities passed in options (tokens like 'ABILITY_HUGE_POWER')
  const attAbility = options.attAbility || null;
  const defAbility = options.defAbility || null;
  const appliedAbilityNotes = [];

  // Apply Gen3 Hoenn badge stat boosts to attacker if requested.
  // If options.applyBadgeBonuses is true, check active badges and apply +10% to the relevant attacking stat (Atk or SpA).
  let badgeMultiplier = 1.0;
  let badgesApplied = [];
  try{
    if (options.applyBadgeBonuses){
      const active = loadActiveBadges();
      if (active && active.size > 0){
        const affectedStat = isSpecial ? 'spa' : 'atk';
        for (const b of active){
          const def = HOENN_BADGES[b] || Object.values(HOENN_BADGES).find(x=>x.key===b);
          if (!def) continue;
          if (def.stats.includes(affectedStat)){
            badgeMultiplier *= 1.10;
            badgesApplied.push(b);
          }
        }
      }
    }
  }catch(e){ /* ignore */ }

  // apply attacker ability stat modifiers before badges
  let A_afterAbility = A;
  try{
    if (attAbility === 'ABILITY_HUGE_POWER'){
      A_afterAbility = Math.floor(A_afterAbility * 2);
      appliedAbilityNotes.push({ side: 'att', ability: attAbility, effect: 'Huge Power doubles Attack' });
    }
    if (attAbility === 'ABILITY_GUTS' && options.attStatus){
      A_afterAbility = Math.floor(A_afterAbility * 1.5);
      appliedAbilityNotes.push({ side: 'att', ability: attAbility, effect: 'Guts increases Attack by 50% due to status' });
    }
  }catch(e){ }

  // If we have a computed A from above, multiply it by badgeMultiplier
  const A_eff = Math.max(1, Math.floor(A_afterAbility * badgeMultiplier));
  // replace A used in formula (apply badge-adjusted A)
  const base = Math.floor(((((2*attackerLevel)/5 + 2) * power * A_eff / D) / 50) + 2);
  let modifier = 1.0;
  // STAB and type effectiveness: normalize & dedupe types first
  const atkTypes = (atkInfo && atkInfo.info && Array.isArray(atkInfo.info.types)) ? Array.from(new Set(atkInfo.info.types.map(t=>String(t).toLowerCase()))) : [];
  const defTypes = (defInfo && defInfo.info && Array.isArray(defInfo.info.types)) ? Array.from(new Set(defInfo.info.types.map(t=>String(t).toLowerCase()))) : [];
  const hasStab = (mtype && atkTypes.includes(mtype));
  if (hasStab) modifier *= 1.5;
  const effMult = typeEffectiveness(mtype, defTypes);
  // keep base effectiveness separate for display; ability-driven modifiers (like Thick Fat)
  const effectivenessBase = effMult;
  const effectivenessNotes = [];
  modifier *= effMult;

  // Defensive ability checks that can short-circuit damage or modify it
  try{
    // Levitate: immunity to Ground
    if (defAbility === 'ABILITY_LEVITATE' && mtype === 'ground'){
      appliedAbilityNotes.push({ side: 'def', ability: defAbility, effect: 'Levitate grants immunity to Ground moves' });
      return { rolls: [], min:0, max:0, expected:0, ohkoGuaranteed:false, ohkoPossible:false, move: canonicalMove, power, type: mtype, category: (m && m.category) ? m.category : (isSpecial ? 'special' : 'physical'), defHP };
    }
    // Volt Absorb / Water Absorb / Flash Fire: immunity to matching type
    if (defAbility === 'ABILITY_VOLT_ABSORB' && mtype === 'electric'){
      appliedAbilityNotes.push({ side: 'def', ability: defAbility, effect: 'Volt Absorb grants immunity to Electric moves' });
      return { rolls: [], min:0, max:0, expected:0, ohkoGuaranteed:false, ohkoPossible:false, move: canonicalMove, power, type: mtype, category: (m && m.category) ? m.category : (isSpecial ? 'special' : 'physical'), defHP };
    }
    if (defAbility === 'ABILITY_WATER_ABSORB' && mtype === 'water'){
      appliedAbilityNotes.push({ side: 'def', ability: defAbility, effect: 'Water Absorb grants immunity to Water moves' });
      return { rolls: [], min:0, max:0, expected:0, ohkoGuaranteed:false, ohkoPossible:false, move: canonicalMove, power, type: mtype, category: (m && m.category) ? m.category : (isSpecial ? 'special' : 'physical'), defHP };
    }
    if (defAbility === 'ABILITY_FLASH_FIRE' && mtype === 'fire'){
      appliedAbilityNotes.push({ side: 'def', ability: defAbility, effect: 'Flash Fire grants immunity to Fire moves' });
      return { rolls: [], min:0, max:0, expected:0, ohkoGuaranteed:false, ohkoPossible:false, move: canonicalMove, power, type: mtype, category: (m && m.category) ? m.category : (isSpecial ? 'special' : 'physical'), defHP };
    }
    // Wonder Guard: only allow damage if super-effective (effectiveness > 1)
    if (defAbility === 'ABILITY_WONDER_GUARD'){
      if (typeof effMult !== 'undefined' && effMult <= 1){
        appliedAbilityNotes.push({ side: 'def', ability: defAbility, effect: 'Wonder Guard blocks non-super-effective damage' });
        return { rolls: [], min:0, max:0, expected:0, ohkoGuaranteed:false, ohkoPossible:false, move: canonicalMove, power, type: mtype, category: (m && m.category) ? m.category : (isSpecial ? 'special' : 'physical'), defHP };
      } else {
        appliedAbilityNotes.push({ side: 'def', ability: defAbility, effect: 'Wonder Guard does not block super-effective damage' });
      }
    }
    // Thick Fat: halves Fire/Ice damage after effectiveness. Represent as multiplier on effectiveness for display.
    if (defAbility === 'ABILITY_THICK_FAT' && (mtype === 'fire' || mtype === 'ice')){
      modifier *= 0.5;
      appliedAbilityNotes.push({ side: 'def', ability: defAbility, effect: 'Thick Fat halves Fire/Ice damage' });
      effectivenessNotes.push('*0.5 from Thick Fat');
    }
  }catch(e){ }

  const trueBase = Math.max(1, Math.floor(base * modifier));
  const mults = _gen3RandomMultipliers();
  const rolls = mults.map(mv => Math.max(1, Math.floor(trueBase * mv)));
  const min = Math.min(...rolls);
  const max = Math.max(...rolls);
  const expected = rolls.reduce((a,b)=>a+b,0)/rolls.length;
  // assemble result and attach any applied ability notes
  const result = {
    rolls,
    min,
    max,
    expected,
    ohkoGuaranteed: min >= defHP,
    ohkoPossible: max >= defHP,
    move: canonicalMove,
    power,
    type: mtype,
    category: (m && m.category) ? m.category : (isSpecial ? 'special' : 'physical'),
    defHP,
    attacker: { token: attackerToken, level: attackerLevel, atkStat: A, spaStat: (attStats && attStats.spa) || null, types: atkTypes },
    defender: { token: defenderToken, level: defenderLevel, defStat: D, spdStat: (defStats && defStats.spd) || null, hp: defHP, types: defTypes },
    rawBase: base,
    modifier,
    stab: hasStab ? 1.5 : 1.0,
    effectiveness: effMult,
    effectivenessBase: effectivenessBase,
    effectivenessDisplay: effectivenessNotes.length ? (String(effectivenessBase) + ' ' + effectivenessNotes.join(' ')) : String(effectivenessBase),
    trueBase,
    mults,
    badgeMultiplier: badgeMultiplier || 1.0,
    badgesApplied: badgesApplied || [],
    appliedAbilities: appliedAbilityNotes.length ? appliedAbilityNotes : undefined,
  };
  return result;
  return {
    rolls,
    min,
    max,
    expected,
    ohkoGuaranteed: min >= defHP,
    ohkoPossible: max >= defHP,
    move: canonicalMove,
    power,
    type: mtype,
    category: (m && m.category) ? m.category : (isSpecial ? 'special' : 'physical'),
    defHP,
    // extras for debugging/formula display
    attacker: { token: attackerToken, level: attackerLevel, atkStat: A, spaStat: (attStats && attStats.spa) || null, types: atkTypes },
    defender: { token: defenderToken, level: defenderLevel, defStat: D, spdStat: (defStats && defStats.spd) || null, hp: defHP, types: defTypes },
    rawBase: base,
    modifier,
    stab: hasStab ? 1.5 : 1.0,
    effectiveness: effMult,
    trueBase,
    mults,
    // badge debug info
    badgeMultiplier: badgeMultiplier || 1.0,
    badgesApplied: badgesApplied || [],
  };
}

function classifyKO(dmgResult, defenderHP){
  if (!dmgResult || dmgResult.max === 0) return 'NO_DAMAGE';
  if (dmgResult.min >= defenderHP) return 'OHKO_GUAR';
  if (dmgResult.max >= defenderHP) return 'OHKO_LIKELY';
  if (dmgResult.min * 2 >= defenderHP) return 'TWOHKO_GUAR';
  if (dmgResult.max * 2 >= defenderHP) return 'TWOHKO_LIKELY';
  return 'THREEPLUS';
}

function compareSpeed(attSpd, defSpd, speedTiePolicy='conservative'){
  if (attSpd > defSpd) return 'faster';
  if (attSpd === defSpd) return 'tie';
  return 'slower';
}

function computeHitsTaken(outspeeds, koClass, speedTiePolicy='conservative'){
  if (koClass === 'NO_DAMAGE') return Infinity;
  if (outspeeds === 'faster'){
    if (koClass.startsWith('OHKO')) return 0;
    if (koClass.startsWith('TWOHKO')) return 1;
    return 2;
  }
  if (outspeeds === 'tie'){
    // conservative: treat as slower; else risk flag will be set elsewhere
    if (koClass.startsWith('OHKO')) return 1;
    if (koClass.startsWith('TWOHKO')) return 2;
    return 3;
  }
  // slower
  if (koClass.startsWith('OHKO')) return 1;
  if (koClass.startsWith('TWOHKO')) return 2;
  return 3;
}

function estimateHpLossPct(hitsTaken, enemyBestDamage, ourHP){
  if (!isFinite(hitsTaken)) return 1; // cannot KO: assume full loss
  const dmg = (enemyBestDamage && enemyBestDamage > 0) ? enemyBestDamage : 0;
  const total = hitsTaken * dmg;
  return Math.max(0, Math.min(1, total / ourHP));
}

function ppRiskForStallWin(bestMove, estimatedTurnsToWin, movePP){
  if (!movePP) return 2;
  if (estimatedTurnsToWin <= movePP * 0.6) return 0;
  if (estimatedTurnsToWin <= movePP * 0.9) return 1;
  return 2;
}

async function computeEnemyBestHit(enemyMon, ourMon, context = {}){
  // enemyMon: { species, lvl, moves? }
  // ourMon: MonState with statsFinal.hp
  const movesMap = await loadBattleMovesH();
  const candidates = [];
  if (Array.isArray(enemyMon.moves) && enemyMon.moves.length){
    for (const mv of enemyMon.moves){
      // ignore pure support/status moves when choosing the enemy's best damaging hit
      // Also treat moves with 0 power (parsed or known) as status and skip them.
      try{
        if (isStatusMove(mv)) continue;
        const resolved = await resolveMoveToken(mv);
        const mm = movesMap && (movesMap[resolved] || movesMap[mv]) ? (movesMap[resolved] || movesMap[mv]) : null;
        let mvPower = null;
        if (mm){ mvPower = (mm.power == null) ? 0 : mm.power; }
        else { mvPower = (MOVE_POWER[mv] != null) ? MOVE_POWER[mv] : null; }
        if (mvPower === 0) continue;
      }catch(e){ /* ignore resolution errors, fall through */ }
      const dmg = await calcDamageRange(
        enemyMon.species,
        enemyMon.lvl || enemyMon.level || 50,
        ourMon.species,
        ourMon.level || ourMon.level || 50,
        mv,
        Object.assign({}, context, { attStats: enemyMon.statsFinal || enemyMon.stats || null, defStats: ourMon.statsFinal || ourMon.stats || null, attAbility: enemyMon.ability || null, defAbility: ourMon.ability || null })
      );
      candidates.push({ move: mv, expected: dmg.expected, max: dmg.max, dr: dmg });
    }
  }
  // fallback: use selectBestSTABMove if no explicit moves listed
  if (candidates.length === 0){
    const mv = await selectBestSTABMove(enemyMon.species, enemyMon.lvl || enemyMon.level || 50, null);
    if (mv){
      const dmg = await calcDamageRange(
        enemyMon.species,
        enemyMon.lvl || enemyMon.level || 50,
        ourMon.species,
        ourMon.level || ourMon.level || 50,
        mv,
        Object.assign({}, context, { attStats: enemyMon.statsFinal || enemyMon.stats || null, defStats: ourMon.statsFinal || ourMon.stats || null, attAbility: enemyMon.ability || null, defAbility: ourMon.ability || null })
      );
      candidates.push({ move: mv, expected: dmg.expected, max: dmg.max, dr: dmg });
    }
  }
  if (candidates.length === 0) return { expectedDamage: 0, maxDamage: 0, canDamage: false };
  // Prefer candidates that actually deal damage and have non-zero effectiveness.
  const damaging = candidates.filter(c=>c.dr && c.dr.max > 0 && (typeof c.dr.power === 'undefined' ? true : c.dr.power > 0) && (typeof c.dr.effectiveness === 'undefined' || c.dr.effectiveness > 0));
  if (damaging.length > 0){
    damaging.sort((a,b)=>b.expected - a.expected);
    const best = damaging[0];
    return { expectedDamage: best.expected, maxDamage: best.max, canDamage: best.max > 0 && (typeof best.dr.effectiveness === 'undefined' ? true : best.dr.effectiveness > 0), bestMove: best.move, dr: best.dr };
  }
  // If no damaging moves, prefer a move that is explicitly ineffective (effectiveness === 0),
  // so we can report the opponent cannot damage us instead of picking a support/status move.
  const zeroEff = candidates.filter(c=>c.dr && typeof c.dr.effectiveness !== 'undefined' && c.dr.effectiveness === 0);
  if (zeroEff.length > 0){
    zeroEff.sort((a,b)=>b.expected - a.expected);
    const best = zeroEff[0];
    return { expectedDamage: best.expected, maxDamage: best.max, canDamage: false, bestMove: best.move, dr: best.dr };
  }
  // Fallback: pick the best candidate (may be a support/status move that calcDamageRange produced nonzero for)
  candidates.sort((a,b)=>b.expected - a.expected);
  const best = candidates[0];
  return { expectedDamage: best.expected, maxDamage: best.max, canDamage: best.max > 0, bestMove: best.move, dr: best.dr };
}

// Compute pairwise score between one of our mons and one enemy mon according to user rules
async function computePairScore(userMon, enemyMon, context = {}){
  // userMon and enemyMon should include: species, level, statsFinal (hp, atk, def, spa, spd, spe), moves/moveset
  const uStats = userMon.statsFinal || userMon.stats || null;
  const eStats = enemyMon.statsFinal || enemyMon.stats || null;
  const uLevel = userMon.level || userMon.lvl || 50;
  const eLevel = enemyMon.level || enemyMon.lvl || 50;

  // choose user's best damaging move by expected damage
  let bestUser = { move: null, expected: 0 };
  const moves = userMon.moveset || userMon.movePool || userMon.moves || [];
  for (const mv of moves){
    if (!mv) continue;
    if (isStatusMove(mv)) continue;
    const dr = await calcDamageRange(userMon.species, uLevel, enemyMon.species, eLevel, mv, { attStats: uStats, defStats: eStats, applyBadgeBonuses: true, attAbility: userMon.ability || null, defAbility: enemyMon.ability || null });
    if (dr.expected > bestUser.expected){ bestUser = { move: mv, expected: dr.expected, dr }; }
  }

  // if user has no damaging move, offense = 0
  const userExpected = bestUser.expected || 0;
  const enemyBest = await computeEnemyBestHit(enemyMon, userMon, context);
  const enemyExpected = enemyBest && enemyBest.expectedDamage ? enemyBest.expectedDamage : 0;
  const enemyBestMoveToken = enemyBest && enemyBest.bestMove ? enemyBest.bestMove : null;

  // If the enemy's best attacking move has zero effectiveness multiplier (immunity),
  // treat this as an instant full score (user mon cannot be damaged by enemy moves).
  const enemyBestDrObj = enemyBest && enemyBest.dr ? enemyBest.dr : null;
  if (enemyBestDrObj && typeof enemyBestDrObj.effectiveness !== 'undefined' && enemyBestDrObj.effectiveness === 0 && userExpected > 0){
    return { total: 10, offense:  (function(){ let o=0; if (userExpected>0){ const hitsToKOUser = userExpected>1e-6 && eStats && eStats.hp ? Math.ceil((eStats.hp)/userExpected) : Infinity; if (hitsToKOUser===1) o=3; else if (hitsToKOUser===2) o=2; else if (hitsToKOUser===3) o=1; } return o;})(), defense: 6, speed: (uStats && eStats && uStats.spe != null && eStats.spe != null ? (uStats.spe>eStats.spe?1:(uStats.spe===eStats.spe?0.5:0)):0), reason: 'immune-effectiveness-zero', userExpected, enemyExpected, hitsToKOUser: (userExpected>1e-6 && eStats && eStats.hp ? Math.ceil((eStats.hp)/userExpected) : Infinity), hitsToKOEnemy: Infinity, userBestMove: bestUser.move?{id:bestUser.move, expected:bestUser.expected, dr:bestUser.dr}:null, enemyBestDr: enemyBestDrObj, enemyBestMove: enemyBestMoveToken };
  }

  // hits to KO calculations (use expected-mid damage)
  const eps = 1e-6;
  const hitsToKOUser = userExpected > eps ? Math.ceil((eStats && eStats.hp ? eStats.hp : 1) / userExpected) : Infinity;
  const hitsToKOEnemy = enemyExpected > eps ? Math.ceil((uStats && uStats.hp ? uStats.hp : 1) / enemyExpected) : Infinity;

  // Offense points: 1=>3,2=>2,3=>1,>=4=>0
  let offense = 0;
  if (hitsToKOUser === 1) offense = 3;
  else if (hitsToKOUser === 2) offense = 2;
  else if (hitsToKOUser === 3) offense = 1;
  else offense = 0;

  // Defense points: >=6 ->6, 5->5, 4->4, 3->3, 2->2, 1->1, 0 (cannot take single hit)
  let defense = 0;
  if (!isFinite(hitsToKOEnemy)) defense = 6; // effectively infinite survivability
  else if (hitsToKOEnemy >= 6) defense = 6;
  else if (hitsToKOEnemy === 5) defense = 5;
  else if (hitsToKOEnemy === 4) defense = 4;
  else if (hitsToKOEnemy === 3) defense = 3;
  else if (hitsToKOEnemy === 2) defense = 2;
  else if (hitsToKOEnemy === 1) defense = 1;
  else defense = 0;

  // Speed: outspeed 1, tie 0.5, slower 0
  let speedPts = 0;
  const uSpe = uStats && uStats.spe ? uStats.spe : 0;
  const eSpe = eStats && eStats.spe ? eStats.spe : 0;
  if (uSpe > eSpe) speedPts = 1;
  else if (uSpe === eSpe) speedPts = 0.5;
  else speedPts = 0;

  // Exceptions
  // assemble detailed result object
  const userBestMoveObj = bestUser.move ? { id: bestUser.move, expected: bestUser.expected || 0, max: (bestUser.dr && bestUser.dr.max) || null, dr: bestUser.dr || null } : null;

  // Capture fast OHKO as a candidate but do not return immediately — allow setup-route
  // evaluation to run so we can prefer setup when appropriate (especially on ties).
  let fastOhkoCandidate = null;
  if (uSpe > eSpe && hitsToKOUser === 1 && userExpected > 0){
    fastOhkoCandidate = { total: 10, offense, defense, speed: speedPts, reason: 'fast-ohko', userExpected, enemyExpected, hitsToKOUser, hitsToKOEnemy, userBestMove: userBestMoveObj, enemyBestDr: null, enemyBestMove: enemyBestMoveToken };
  }
  if (enemyExpected === 0 && userExpected > 0) return { total: 10, offense, defense, speed: speedPts, reason: 'immune-no-damage', userExpected, enemyExpected, hitsToKOUser, hitsToKOEnemy, userBestMove: userBestMoveObj, enemyBestDr: null, enemyBestMove: enemyBestMoveToken };

  const total = Math.min(10, offense + defense + speedPts);
  // include enemy best damage result if available
  const enemyBestDr = (enemyBest && enemyBest.dr) ? enemyBest.dr : null;
  let result = { total, offense, defense, speed: speedPts, hitsToKOUser, hitsToKOEnemy, userBestMove: userBestMoveObj, userExpected, enemyExpected, enemyBestDr, enemyBestMove: enemyBestMoveToken };

  // --- Setup-route evaluation (Route B) per specification ---
  // helpers: classify setup moves and evaluate viability
  function isSetupMoveToken(mv){ if (!mv) return false; const s = String(mv).toUpperCase(); return /SWORDS?_DANCE|BELLY_DRUM|DRAGON_DANCE|CURSE|GROWTH|IRON_DEFENSE|AMNESIA|COSMIC_POWER|CALM_MIND|BULK_UP|CHARGE|AGILITY/.test(s); }

  function classifySetupEffects(mv){ const name = String(mv).toUpperCase(); const out = { atk:0, spa:0, def:0, spd:0, spe:0, hpDeltaPct:0, special:'', accuracy:100 };
    if (/SWORDS?_DANCE/.test(name)) out.atk = 2;
    if (/BELLY_DRUM/.test(name)) { out.atk = 6; out.hpDeltaPct = -0.5; }
    if (/DRAGON_DANCE/.test(name)) { out.atk = 1; out.spe = 1; }
    if (/CURSE/.test(name)) { /* non-Ghost */ out.atk = 1; out.def = 1; out.spe = -1; }
    if (/GROWTH/.test(name)) out.spa = 1;
    if (/IRON_DEFENSE/.test(name)) out.def = 2;
    if (/AMNESIA/.test(name)) out.spd = 2;
    if (/COSMIC_POWER/.test(name)) { out.def = 1; out.spd = 1; }
    if (/CALM_MIND/.test(name)) { out.spa = 1; out.spd = 1; }
    if (/BULK_UP/.test(name)) { out.atk = 1; out.def = 1; }
    if (/CHARGE/.test(name)) { out.spd = 1; out.special = 'charge'; }
    if (/AGILITY/.test(name)) out.spe = 2;
    // accuracy if move has explicit accuracy in MOVE data will be applied later
    return out;
  }

  const setupMoves = (moves || []).filter(mv => mv && isSetupMoveToken(mv));
  async function evaluateSetupRoute(singleSetupMove){
    // returns { score, details }
    const movesMapLocal = await loadBattleMovesH();
    const setupInfo = classifySetupEffects(singleSetupMove);
    // opponent strongest damaging move
    const enemyThreat = await computeEnemyBestHit(enemyMon, userMon, context);
    const ourHP = (uStats && uStats.hp) ? uStats.hp : 1;
    const dAbs = (enemyThreat && enemyThreat.maxDamage) ? enemyThreat.maxDamage : (enemyThreat && enemyThreat.expectedDamage ? enemyThreat.expectedDamage : 0);
    const dFrac = ourHP > 0 ? (dAbs / ourHP) : 1;
    const dPercent = dFrac * 100;
    // special handling for Belly Drum
    let safetyTier = 'unsafe'; let scoreSetup = 0; let reason = '';
    if (setupInfo.atk === 6 && setupInfo.hpDeltaPct === -0.5){
      // Belly Drum thresholds
      if (dFrac < 0.25){ safetyTier = 'safe'; scoreSetup = 10; }
      else if (dFrac < 0.5){ safetyTier = 'risky'; scoreSetup = 9; }
      else { safetyTier = 'fail'; scoreSetup = 0; }
    } else {
      // non-belly thresholds
      if (dFrac < (1/3)){ safetyTier = 'safe'; scoreSetup = 10; }
      else if (dFrac < 0.5){ safetyTier = 'risky'; scoreSetup = 9; }
      else { safetyTier = 'unsafe'; scoreSetup = 8; }
    }

    // Defensive setup adjustment: if setup grants def/spd boosts, simulate reductions
    const defenseBoostStages = Math.max(0, (setupInfo.def||0) + (setupInfo.spd||0));
    if (defenseBoostStages > 0 && safetyTier !== 'safe'){
      // apply boost multipliers and recompute non-crit max damage
      const stageToMult = (s)=> Math.min(4.0, 1.0 + 0.5 * s); // +1 ->1.5, +2->2.0, etc.
      const defMult = stageToMult(setupInfo.def || 0);
      const spdMult = stageToMult(setupInfo.spd || 0);
      // clone our stats and apply defensive multipliers
      const boosted = Object.assign({}, uStats);
      if (boosted.def) boosted.def = Math.max(1, Math.floor(boosted.def * defMult));
      if (boosted.spd) boosted.spd = Math.max(1, Math.floor(boosted.spd * spdMult));
      // recompute enemy non-crit max damage using calcDamageRange (max value)
      const drBoosted = await calcDamageRange(enemyMon.species, enemyMon.level||enemyMon.lvl||50, userMon.species, userMon.level||userMon.lvl||50, enemyThreat.bestMove || enemyThreat.bestMove, Object.assign({}, context, { attStats: enemyMon.statsFinal || enemyMon.stats || null, defStats: boosted, attAbility: enemyMon.ability||null, defAbility: userMon.ability||null }));
      const dBoostAbs = (drBoosted && drBoosted.max) ? drBoosted.max : dAbs;
      const dBoostFrac = ourHP>0 ? (dBoostAbs / ourHP) : 1;
      if (dBoostFrac < (1/3)) { safetyTier = 'safe'; scoreSetup = 10; }
      else if (dBoostFrac < 0.5) { safetyTier = 'risky'; scoreSetup = 9; }
      else {
        // scale down based on required boosts
        if (defenseBoostStages <= 2) scoreSetup = 8;
        else if (defenseBoostStages <=4) scoreSetup = 7;
        else scoreSetup = 6;
      }
    }

    // Post-setup sweep evaluation: check if after applying offensive boosts we can OHKO or outspeed & OHKO
    let sweepAchieved = false; let sweepDetails = null;
    // create boosted attacker stats
    const atkBoostStages = Math.max(0, setupInfo.atk || 0);
    if (scoreSetup > 0){
      const stageToMult = (s)=> Math.min(4.0, 1.0 + 0.5 * s);
      const atkMult = stageToMult(atkBoostStages);
      const spaMult = stageToMult(setupInfo.spa || 0);
      const speMult = stageToMult(Math.max(0, setupInfo.spe || 0));
      const boostedA = Object.assign({}, uStats);
      if (boostedA.atk) boostedA.atk = Math.max(1, Math.floor(boostedA.atk * atkMult));
      if (boostedA.spa) boostedA.spa = Math.max(1, Math.floor(boostedA.spa * spaMult));
      if (boostedA.spe) boostedA.spe = Math.max(1, Math.floor(boostedA.spe * speMult));
      // evaluate best damaging move after boosts
      let bestAfter = { move: null, min:0, max:0 };
      for (const mv2 of moves || []){
        if (!mv2) continue; if (isStatusMove(mv2)) continue;
        const dr2 = await calcDamageRange(userMon.species, userMon.level||userMon.lvl||50, enemyMon.species, enemyMon.level||enemyMon.lvl||50, mv2, Object.assign({}, context, { attStats: boostedA, defStats: enemyMon.statsFinal || enemyMon.stats || null, attAbility: userMon.ability||null, defAbility: enemyMon.ability||null }));
        if (!dr2) continue;
        // check guarantee using min (must be min >= enemy HP to guarantee OHKO)
        const enemyHP = (enemyMon.statsFinal && enemyMon.statsFinal.hp) ? enemyMon.statsFinal.hp : 1;
        const guaranteed = dr2.min >= enemyHP;
        const likely = dr2.max >= enemyHP;
        if (guaranteed){ bestAfter = { move: mv2, min: dr2.min, max: dr2.max, dr: dr2 }; sweepAchieved = true; sweepDetails = { guaranteed:true, move:mv2, dr: dr2 }; break; }
        if (likely && !bestAfter.move) bestAfter = { move: mv2, min: dr2.min, max: dr2.max, dr: dr2 };
      }
      // if guaranteed OHKO found, compute accuracy cap
      if (sweepAchieved && sweepDetails){ const acc = (movesMapLocal && movesMapLocal[sweepDetails.move] && movesMapLocal[sweepDetails.move].accuracy) ? movesMapLocal[sweepDetails.move].accuracy : 100; let accCap = 10; if (acc >= 100) accCap = 10; else if (acc >=90) accCap = 9; else if (acc >=80) accCap = 8; else accCap = 7; // if requires two hits reduce by 1 (not implemented: check hits)
        // final setup score cannot exceed accCap
        scoreSetup = Math.min(scoreSetup, accCap);
      }
    }

    return { score: scoreSetup, move: singleSetupMove, dPercent, safetyTier, sweepAchieved, sweepDetails, enemyThreat, details: { setupInfo } };
  }

  // If this evaluation was already performed on an assumed boosted attacker (propagated from a
  // prior safe setup in the same trainer), skip attempting to evaluate a new setup route.
  const skipSetupEval = context && context.assumedSetupApplied;
  if (skipSetupEval) result.chosenRoute = 'assumed-boost';

  let bestSetup = null;
  if (!skipSetupEval) {
    for (const sm of setupMoves){ try{ const r = await evaluateSetupRoute(sm); if (!bestSetup || (r && r.score > bestSetup.score)) bestSetup = r; }catch(e){ /* ignore per-move errors */ } }
  }
  if (bestSetup && bestSetup.score != null){
    // choose higher of non-setup total vs setup route
    // Prefer setup route when it strictly improves the score, or when it's tied at the
    // maximum score (10). This ensures we prefer documented setup assumptions over
    // fast-OHKO heuristics when both would yield a perfect result.
    const setupScore = (bestSetup.score || 0);
    const currentScore = (result.total || 0);
    if (setupScore > currentScore || (setupScore === currentScore && currentScore === 10)){
      result.chosenRoute = 'setup';
      result.setupInfo = bestSetup;
      result.total = Math.max(1, Math.min(10, Math.round(setupScore)));
    } else {
      result.chosenRoute = 'no-setup';
    }
  } else {
    result.chosenRoute = 'no-setup';
  }

  // If setup was not chosen but a fast-OHKO candidate existed, prefer the fast-OHKO
  // result (this preserves the original fast-OHKO behavior when setup isn't selected).
  if (fastOhkoCandidate && result.chosenRoute !== 'setup'){
    // copy relevant fast-OHKO fields into result
    result.reason = fastOhkoCandidate.reason;
    result.total = fastOhkoCandidate.total;
    result.offense = fastOhkoCandidate.offense;
    result.defense = fastOhkoCandidate.defense;
    result.speed = fastOhkoCandidate.speed;
    result.userExpected = fastOhkoCandidate.userExpected;
    result.enemyExpected = fastOhkoCandidate.enemyExpected;
    result.hitsToKOUser = fastOhkoCandidate.hitsToKOUser;
    result.hitsToKOEnemy = fastOhkoCandidate.hitsToKOEnemy;
    result.userBestMove = fastOhkoCandidate.userBestMove;
    result.enemyBestDr = fastOhkoCandidate.enemyBestDr;
    result.enemyBestMove = fastOhkoCandidate.enemyBestMove;
  }

  return result;
}

async function evaluateMatchup(A, B, moveset, context = {}){
  // A,B: MonState-like { species, level, statsFinal }
  // moveset: array of move tokens
  const bestEval = { score:-Infinity };
  const enemyBest = await computeEnemyBestHit(B, A, context);
  const movesMap = await loadBattleMovesH();
  for (const mv of moveset || []){
    if (!mv) continue;
    // skip status
    if (isStatusMove(mv)) continue;
    const dmg = await calcDamageRange(
      A.species,
      A.level || A.lvl || 50,
      B.species,
      B.level || B.lvl || 50,
      mv,
      Object.assign({}, context, { attStats: A.statsFinal || A.stats || null, defStats: B.statsFinal || B.stats || null, applyBadgeBonuses: !!context.applyBadgeBonuses, attAbility: A.ability || null, defAbility: B.ability || null })
    );
    const koClass = classifyKO(dmg, dmg.defHP || (B.statsFinal && B.statsFinal.hp) || 1);
    const outspeed = compareSpeed(A.statsFinal.spe, B.statsFinal.spe, context.speedTiePolicy);
    const hitsTaken = computeHitsTaken(outspeed, koClass, context.speedTiePolicy);
    const enemyCanDamage = enemyBest.canDamage;
    const dmgMetric = (context.hpLossPolicy === 'conservative') ? enemyBest.maxDamage : enemyBest.expectedDamage;
    const hpLossPct = enemyCanDamage ? estimateHpLossPct(hitsTaken, dmgMetric, A.statsFinal.hp) : 0;
    const missRisk = ( (movesMap && movesMap[mv] && movesMap[mv].accuracy) ? (movesMap[mv].accuracy < 100) : false );
    const speedTieRisk = (outspeed === 'tie');
    const critRisk = false; // optional future
    const estimatedTurns = (koClass.startsWith('OHKO')) ? 1 : (koClass.startsWith('TWOHKO') ? 2 : 4);
    const mvPP = (movesMap && movesMap[mv]) ? (movesMap[mv].pp || 5) : (MOVE_POWER[mv] ? 10 : 5);
    const ppRisk = (hpLossPct === 0 && !enemyCanDamage) ? ppRiskForStallWin(mv, estimatedTurns, mvPP) : 0;
    const thisEval = { bestMoveId: mv, koClass, outspeeds: outspeed, hitsTaken, hpLossPct, ppRisk, riskFlags: { missRisk, speedTieRisk, critRisk } };
    const score = scoreMatchupFromEval(thisEval, context);
    if (score > bestEval.score || (score === bestEval.score && thisEval.hpLossPct < (bestEval.hpLossPct||1))){
      Object.assign(bestEval, thisEval);
      bestEval.score = score;
    }
  }
  return bestEval.score === -Infinity ? null : bestEval;
}

function scoreMatchupFromEval(evalObj, context = {}){
  if (!evalObj) return 1;
  let safety = 0;
  const rf = evalObj.riskFlags || {};
  if (evalObj.koClass === 'NO_DAMAGE') safety = 0;
  else if (evalObj.hitsTaken === 0){
    safety = 6;
    if (rf.missRisk) safety -= 1;
    if (rf.speedTieRisk) safety -= 2;
    if (evalObj.koClass === 'OHKO_LIKELY') safety -= 1;
  } else {
    if (evalObj.hpLossPct === 0) safety = 6;
    else if (evalObj.hpLossPct < 0.25) safety = 5;
    else if (evalObj.hpLossPct < 0.5) safety = 4;
    else if (evalObj.hpLossPct < 0.75) safety = 2;
    else safety = 1;
    if (rf.missRisk) safety -= 1;
    if (rf.speedTieRisk) safety -= 1;
  }
  safety = Math.max(0, Math.min(6, safety));

  let hpPres = 0;
  if (evalObj.hpLossPct === 0) hpPres = 3;
  else if (evalObj.hpLossPct < 0.25) hpPres = 2;
  else if (evalObj.hpLossPct < 0.5) hpPres = 1;
  else hpPres = 0;

  let speed = 0;
  if (evalObj.koClass === 'OHKO_GUAR') speed = 2;
  else if (['OHKO_LIKELY','TWOHKO_GUAR'].includes(evalObj.koClass)) speed = 1;
  else speed = 0;

  let ppPenalty = 0;
  if (evalObj.ppRisk === 1) ppPenalty = -1;
  if (evalObj.ppRisk === 2) ppPenalty = -2;

  const raw = safety + hpPres + speed + ppPenalty;
  const out = Math.max(1, Math.min(10, Math.round(raw)));
  return out;
}

function applyFatigue(perEnemyBest, context={}){
  const counts = new Map();
  for (const entry of perEnemyBest){
    const id = entry.chosenMon && entry.chosenMon.species ? entry.chosenMon.species : JSON.stringify(entry.chosenMon);
    counts.set(id, (counts.get(id)||0)+1);
    const c = counts.get(id);
    if (c >= 2 && entry.chosenEval && entry.chosenEval.hpLossPct >= (context.fatigueHpLossThreshold||0.15)){
      entry.score = Math.max(1, entry.score - (context.fatiguePenaltyPerExtraUse||1) * (c-1));
    }
  }
  return perEnemyBest.map(e=>{ e.score = Math.max(1, Math.min(10, e.score)); return e; });
}

async function scoreTeamVsTrainer(teamMons, trainerParty, context={}){
  // teamMons: array of MonState { species, level, statsFinal, moveset }
  const perEnemyBest = [];
  for (const enemy of trainerParty){
    let best = { score: -Infinity, chosenMon: null, chosenEval: null };
    for (const A of teamMons){
      const moveset = A.moveset || A.movePool || [];
      const evalRes = await evaluateMatchup(A, enemy, moveset, context);
      const s = scoreMatchupFromEval(evalRes, context);
      if (s > best.score){ best = { score: s, chosenMon: A, chosenEval: evalRes }; }
    }
    perEnemyBest.push(best);
  }
  if (context.enableFatigue){
    const withFatigue = applyFatigue(perEnemyBest, context);
    return withFatigue.reduce((a,b)=>a+b.score,0) / withFatigue.length;
  }
  return perEnemyBest.reduce((a,b)=>a+b.score,0) / perEnemyBest.length;
}

// expose for debugging
window.calcDamageRange = calcDamageRange;
window.classifyKO = classifyKO;
window.evaluateMatchup = evaluateMatchup;
window.scoreMatchupFromEval = scoreMatchupFromEval;
window.scoreTeamVsTrainer = scoreTeamVsTrainer;


async function computeDamage(attackerToken, attackerLevel, defenderToken, defenderLevel, trainer=null){
  const movesMap = await loadBattleMovesH();
  const lvlSets = await loadLevelUpLearnsetsH();
  const tmSets = await loadTMHMLearnsetsH();
  const atkInfo = await getSpeciesInfoByName(prettySpecies(attackerToken).toLowerCase()) || await getSpeciesInfoByName(attackerToken);
  const defInfo = await getSpeciesInfoByName(prettySpecies(defenderToken).toLowerCase()) || await getSpeciesInfoByName(defenderToken);
  if (!atkInfo || !atkInfo.info || !defInfo || !defInfo.info) return 0;
  const atkBase = atkInfo.info.baseStats;
  const defBase = defInfo.info.baseStats;
  const atkHP = computeStatFromBase(atkBase.hp,31,0,attackerLevel,true);
  const defHP = computeStatFromBase(defBase.hp,31,0,defenderLevel,true);
  const bestMove = await selectBestSTABMove(attackerToken, attackerLevel, trainer);
  if (!bestMove) return 0;
  if (!bestMove){
    console.debug('No best move found for', attackerToken, 'at', attackerLevel);
    return 0;
  }
  const m = movesMap[bestMove] || null;
  if (!m){
    console.debug('Move data missing for', bestMove, ' — movesMap keys sample:', Object.keys(movesMap).slice(0,5));
  }
  const mvdata = m || { power:50, type: null };
  const power = mvdata.power || 50;
  const mtype = (mvdata.type || null);
  const isSpecial = mtype ? SPECIAL_TYPES.has(mtype) : false;
  const A = isSpecial ? computeStatFromBase(atkBase.spa,31,0,attackerLevel,false) : computeStatFromBase(atkBase.atk,31,0,attackerLevel,false);
  const D = isSpecial ? computeStatFromBase(defBase.spd,31,0,defenderLevel,false) : computeStatFromBase(defBase.def,31,0,defenderLevel,false);
  const baseDamage = Math.floor(((((2*attackerLevel)/5 + 2) * power * A / D) / 50) + 2);
  let modifier = 1.0;
  // STAB
  if (mtype && atkInfo.info.types && atkInfo.info.types.includes(mtype)) modifier *= 1.5;
  // type effectiveness
  const defTypes = defInfo.info.types || [];
  modifier *= typeEffectiveness(mtype, defTypes);
  const dmg = Math.max(1, Math.floor(baseDamage * modifier));
  return { damage: dmg, damageFraction: dmg / defHP };
}

async function computeTrainerScore(trainer, plannedTeam){
  // Build team MonState objects from plannedTeam and evaluate using scoreTeamVsTrainer
  const battleLevel = computeBattleLevel(trainer);
  const playerLevelDefault = computePlayerDefaultLevel(trainer);
  const lvlSets = await loadLevelUpLearnsetsH();
  const tmSets = await loadTMHMLearnsetsH();
  const teamMons = [];
  if (!plannedTeam || plannedTeam.length === 0) return 0;
  // load saved natures for planned team (use in-memory planned natures)
  let savedNatures = [];
  try{ savedNatures = getPlannedNatures() || []; }catch(e){ savedNatures = []; }
  for (let i=0;i<6;i++){
    const name = plannedTeam[i];
    if (!name) continue;
    const chosenToken = await devolveSpeciesToLegalAtLevel(name, playerLevelDefault, trainer);
    const displayName = prettySpecies(chosenToken).toLowerCase();
    const si = await getSpeciesInfoByName(displayName) || await getSpeciesInfoByName(chosenToken);
    if (!si || !si.info || !si.info.baseStats){
      console.debug('computeTrainerScore: missing species info for planned slot', i, name, '-> token', chosenToken);
      continue;
    }
    if (!si || !si.info || !si.info.baseStats) continue;
    const base = si.info.baseStats;
    const statsFinal = {
      hp: computeStatFromBase(base.hp, 15, 0, playerLevelDefault, true),
      atk: computeStatFromBase(base.atk, 15, 0, playerLevelDefault, false),
      def: computeStatFromBase(base.def, 15, 0, playerLevelDefault, false),
      spa: computeStatFromBase(base.spa, 15, 0, playerLevelDefault, false),
      spd: computeStatFromBase(base.spd, 15, 0, playerLevelDefault, false),
      spe: computeStatFromBase(base.spe, 15, 0, playerLevelDefault, false)
    };
    // apply nature if present
    const chosenNature = savedNatures[i] || null;
    if (chosenNature && NATURE_MODS[chosenNature]){
      const mod = NATURE_MODS[chosenNature];
      if (mod.up && statsFinal[mod.up] != null) statsFinal[mod.up] = Math.floor(statsFinal[mod.up] * 1.1);
      if (mod.down && statsFinal[mod.down] != null) statsFinal[mod.down] = Math.floor(statsFinal[mod.down] * 0.9);
    }
    // Auto-apply Dynamo badge speed boost for trainers after Wattson (segment > 3)
    let dynamoApplied = false;
    try{
      const seg = trainerNameToSegment(trainer) || approximateSegmentForLevel(battleLevel);
      if (seg && seg > 3){
        if (statsFinal.spe != null){
          // preserve pre-boost speed for display
          statsFinal.speBeforeDynamo = statsFinal.spe;
          statsFinal.spe = Math.floor(statsFinal.spe * 1.1);
          dynamoApplied = true;
        }
      }
    }catch(e){ /* ignore */ }
    // (Badge boosts are applied later in calcDamageRange when computing damage)
    // assemble candidate moves (we'll finalize selection after we know enemy party types)
    const levelMoves = (lvlSets[chosenToken] || []).filter(m=>m.level <= battleLevel).map(m=>m.move);
    const tmMoves = (tmSets[chosenToken] || []);
    const types = (si.info.types || []);
    const availableTMs = getAvailableTMsForTrainer(trainer);
    const candidates = {};
    for (const mv of levelMoves){ if (!mv) continue; candidates[mv]=true; }
    for (const mv of tmMoves){ if (!mv) continue; if (availableTMs === null || availableTMs.has(mv)) candidates[mv]=true; }
    // store candidate move list on the planned team entry; we'll score them against the trainer party later
    // filter banned moves (e.g., Future Sight is impractical for single-turn scoring)
    const bannedKeywords = ['FUTURE_SIGHT','FUTURE'];
    const candidateMoveList = Object.keys(candidates).filter(Boolean).filter(mv=>{
      try{ for (const k of bannedKeywords) if (mv && mv.toUpperCase().includes(k)) return false; }catch(e){}
      return true;
    });
    teamMons.push({ species: chosenToken, level: battleLevel, statsFinal, candidateMoves: candidateMoveList, dynamoApplied });
  }

  // build trainer party monstates
  const partyStates = [];
  for (const enemy of trainer.pokemons){
    const lvl = enemy.lvl || enemy.level || 50;
    const si2 = await getSpeciesInfoByName(prettySpecies(enemy.species).toLowerCase()) || await getSpeciesInfoByName(enemy.species);
    if (!si2 || !si2.info || !si2.info.baseStats){
      // fallback: push a minimal state
      partyStates.push({ species: enemy.species, level: lvl, statsFinal: { hp: 100, atk:50, def:50, spa:50, spd:50, spe:50 }, moves: enemy.moves || [] });
      continue;
    }
    const b = si2.info.baseStats;
    const st = {
      hp: computeStatFromBase(b.hp, 31, 0, lvl, true),
      atk: computeStatFromBase(b.atk, 31, 0, lvl, false),
      def: computeStatFromBase(b.def, 31, 0, lvl, false),
      spa: computeStatFromBase(b.spa, 31, 0, lvl, false),
      spd: computeStatFromBase(b.spd, 31, 0, lvl, false),
      spe: computeStatFromBase(b.spe, 31, 0, lvl, false)
    };
    const enemyTypes = (si2 && si2.info && si2.info.types) ? si2.info.types : [];
    partyStates.push({ species: enemy.species, level: lvl, statsFinal: st, moves: enemy.moves || [], types: enemyTypes });
  }

  if (teamMons.length === 0){
    console.debug('computeTrainerScore: no valid teamMons built from plannedTeam', plannedTeam);
    return 0;
  }
  console.debug('computeTrainerScore: evaluating trainer', trainer.name, 'teamMons', teamMons.map(m=>m.species), 'partySize', partyStates.length);
  // Finalize movesets for planned team entries: prefer setup moves and moves that are
  // super-effective against the trainer party. We keep up to 4 moves per mon.
  const movesMap = await loadBattleMovesH();
  const movesIndexFallback = MOVE_POWER; // local table fallback
  for (const tm of teamMons){
    try{
      const cand = tm.candidateMoves || [];
      const si = await getSpeciesInfoByName(prettySpecies(tm.species).toLowerCase()) || await getSpeciesInfoByName(tm.species);
      const myTypes = (si && si.info && si.info.types) ? si.info.types : [];
      const scored = [];
      for (const mv of cand){
        if (!mv) continue;
        // determine power/type
        let power = MOVE_POWER[mv] || 0;
        let mtype = MOVE_TYPE[mv] || null;
        try{ const resolved = await resolveMoveToken(mv); const mm = movesMap && (movesMap[resolved] || movesMap[mv]) ? (movesMap[resolved] || movesMap[mv]) : null; if (mm){ power = (mm.power == null ? 0 : mm.power); if (mm.type) mtype = mm.type; } }catch(e){}
        const stab = (mtype && myTypes.includes(mtype)) ? 50 : 0;
        let score = (power || 0) + stab;
        // bonus for setup moves so they are always chosen if available
        if (isSetupMoveToken(mv)) score += 1000;
        // bonus for being super-effective against any member of the trainer party
        try{
          for (const en of partyStates){
            const eff = typeEffectiveness(mtype, (en.types || []));
            if (eff > 1) { score += 50; break; }
          }
        }catch(e){}
        scored.push({ move: mv, score, power, mtype });
      }
      scored.sort((a,b)=>b.score - a.score);
      // Selection rule: 1) prefer a setup move (Calm Mind, Swords Dance, etc.)
      // 2) then strongest STAB move, 3) then highest-power move with a different type
      const selected = [];
      const setupCandidates = scored.filter(s => isSetupMoveToken(s.move));
      if (setupCandidates.length > 0){
        // pick the top-scoring setup move
        selected.push(setupCandidates[0].move);
      }

      // find strongest STAB (by power) among damaging moves
      const damaging = scored.filter(s => (s.power || 0) > 0);
      let chosenStabMove = null;
      let chosenStabType = null;
      if (damaging.length > 0){
        const stabCandidates = damaging.filter(s => s.mtype && myTypes.includes(s.mtype));
        if (stabCandidates.length > 0){
          stabCandidates.sort((a,b)=> (b.power||0) - (a.power||0));
          chosenStabMove = stabCandidates[0].move;
          chosenStabType = stabCandidates[0].mtype || MOVE_TYPE[chosenStabMove] || null;
          if (selected.indexOf(chosenStabMove) === -1) selected.push(chosenStabMove);
        }
      }

      // pick highest-power move whose type != chosenStabType
      if (damaging.length > 0){
        // if no STAB found, treat chosenStabType as null and pick highest-power overall
        const candidatesForThird = damaging.slice().sort((a,b)=> (b.power||0) - (a.power||0));
        for (const c of candidatesForThird){
          if (selected.length >= 4) break;
          const mtype = c.mtype || MOVE_TYPE[c.move] || null;
          if (chosenStabType && mtype && chosenStabType === mtype) continue;
          if (selected.indexOf(c.move) !== -1) continue;
          selected.push(c.move);
          break; // only pick one for the "different type" preference
        }
      }

      // fill remaining slots with highest scored moves (avoid duplicates)
      for (const s of scored){
        if (selected.length >= 4) break;
        if (selected.indexOf(s.move) === -1) selected.push(s.move);
      }

      if (selected.length === 0){
        const fallback = await selectBestSTABMove(tm.species, tm.level, trainer);
        if (fallback) selected.push(fallback);
      }
      tm.moveset = selected.slice(0,4);
    }catch(e){ tm.moveset = tm.candidateMoves ? tm.candidateMoves.slice(0,4) : []; }
  }

  const score = await scoreTeamVsTrainer(teamMons, partyStates, { enableFatigue: true });
  console.debug('computeTrainerScore: score for', trainer.name, '->', score);
  return score; // 1..10
}

// Build planned team MonState objects (used by scoring and UI breakdown)
async function buildPlannedTeamMonStates(plannedTeam, trainer){
  const battleLevel = computeBattleLevel(trainer);
  const playerLevelDefault = computePlayerDefaultLevel(trainer);
  const lvlSets = await loadLevelUpLearnsetsH();
  const tmSets = await loadTMHMLearnsetsH();
  const teamMons = [];
  if (!plannedTeam || plannedTeam.length === 0) return teamMons;
  let savedNatures = [];
  try{ savedNatures = getPlannedNatures() || []; }catch(e){ savedNatures = []; }
  for (let i=0;i<6;i++){
    const name = plannedTeam[i];
    if (!name) continue;
    const chosenToken = await devolveSpeciesToLegalAtLevel(name, playerLevelDefault, trainer);
    const si = await getSpeciesInfoByName(prettySpecies(chosenToken).toLowerCase()) || await getSpeciesInfoByName(chosenToken);
    if (!si || !si.info || !si.info.baseStats) continue;
    const base = si.info.baseStats;
    const statsFinal = {
      hp: computeStatFromBase(base.hp, 31, 0, playerLevelDefault, true),
      atk: computeStatFromBase(base.atk, 31, 0, playerLevelDefault, false),
      def: computeStatFromBase(base.def, 31, 0, playerLevelDefault, false),
      spa: computeStatFromBase(base.spa, 31, 0, playerLevelDefault, false),
      spd: computeStatFromBase(base.spd, 31, 0, playerLevelDefault, false),
      spe: computeStatFromBase(base.spe, 31, 0, playerLevelDefault, false)
    };
    const chosenNature = savedNatures[i] || null;
    if (chosenNature && NATURE_MODS[chosenNature]){
      const mod = NATURE_MODS[chosenNature];
      if (mod.up && statsFinal[mod.up] != null) statsFinal[mod.up] = Math.floor(statsFinal[mod.up] * 1.1);
      if (mod.down && statsFinal[mod.down] != null) statsFinal[mod.down] = Math.floor(statsFinal[mod.down] * 0.9);
    }
    // assemble candidate moves
    const levelMoves = (lvlSets[chosenToken] || []).filter(m=>m.level <= battleLevel).map(m=>m.move);
    const tmMoves = (tmSets[chosenToken] || []);
    const types = (si.info.types || []);
    const availableTMs = getAvailableTMsForTrainer(trainer);
    const candidates = {};
    for (const mv of levelMoves) if (!isStatusMove(mv)) candidates[mv]=true;
    for (const mv of tmMoves) if (!isStatusMove(mv)){
      if (availableTMs === null || availableTMs.has(mv)) candidates[mv]=true;
    }
    const candArr = Object.keys(candidates).map(mv=>{
      const power = MOVE_POWER[mv] || 50;
      const mtype = MOVE_TYPE[mv] || null;
      const stab = (mtype && types.includes(mtype)) ? 50 : 0;
      return { move: mv, score: power+stab };
    });
    candArr.sort((a,b)=>b.score-a.score);
    let moveset = candArr.slice(0,4).map(x=>x.move);
    if (moveset.length === 0){
      const fallback = await selectBestSTABMove(chosenToken, battleLevel, null);
      if (fallback) moveset = [fallback];
    }
    teamMons.push({ species: chosenToken, level: battleLevel, statsFinal, moveset });
  }
  return teamMons;
}

async function buildTrainerPartyStates(trainer){
  const partyStates = [];
  for (const enemy of trainer.pokemons){
    const lvl = enemy.lvl || enemy.level || 50;
    // If the trainer JSON already includes precomputed stats, use them directly
    if (enemy.stats){
      partyStates.push({ species: enemy.species, level: lvl, statsFinal: enemy.stats, moves: enemy.moves || [], ability: (Array.isArray(enemy.abilities) && enemy.abilities.length) ? enemy.abilities[0] : (enemy.ability || null) });
      continue;
    }
    const si2 = await getSpeciesInfoByName(prettySpecies(enemy.species).toLowerCase()) || await getSpeciesInfoByName(enemy.species);
    if (!si2 || !si2.info || !si2.info.baseStats){
      partyStates.push({ species: enemy.species, level: lvl, statsFinal: { hp: 100, atk:50, def:50, spa:50, spd:50, spe:50 }, moves: enemy.moves || [] });
      continue;
    }
    const b = si2.info.baseStats;
    const st = {
      hp: computeStatFromBase(b.hp, 31, 0, lvl, true),
      atk: computeStatFromBase(b.atk, 31, 0, lvl, false),
      def: computeStatFromBase(b.def, 31, 0, lvl, false),
      spa: computeStatFromBase(b.spa, 31, 0, lvl, false),
      spd: computeStatFromBase(b.spd, 31, 0, lvl, false),
      spe: computeStatFromBase(b.spe, 31, 0, lvl, false)
    };
    partyStates.push({ species: enemy.species, level: lvl, statsFinal: st, moves: enemy.moves || [], ability: (Array.isArray(enemy.abilities) && enemy.abilities.length) ? enemy.abilities[0] : (enemy.ability || null) });
  }
  return partyStates;
}

// Compute per-enemy best answers with detailed eval for UI breakdown
async function computePerEnemyBest(teamMons, partyStates, context = {}){
  const perEnemy = [];
  for (const enemy of partyStates){
    let best = { score: -Infinity, chosenMon: null, chosenEval: null };
    for (const A of teamMons){
      const moveset = A.moveset || A.movePool || [];
      const evalRes = await evaluateMatchup(A, enemy, moveset, context);
      const s = scoreMatchupFromEval(evalRes, context);
      if (s > best.score){ best = { score: s, chosenMon: A, chosenEval: evalRes }; }
    }
    // collect damage details for display
    let damageInfo = null;
    if (best && best.chosenEval && best.chosenEval.bestMoveId){
      const dmg = await calcDamageRange(
        enemyMon.species,
        enemyMon.lvl || enemyMon.level || 50,
        ourMon.species,
        ourMon.level || ourMon.level || 50,
        mv,
        Object.assign({}, context, { attStats: enemyMon.statsFinal || enemyMon.stats || null, defStats: ourMon.statsFinal || ourMon.stats || null, attAbility: enemyMon.ability || null, defAbility: ourMon.ability || null })
      );
      damageInfo = dr;
    }
    perEnemy.push({ enemy, best, damageInfo });
  }
  return perEnemy;
}

window.computeTrainerScore = computeTrainerScore;
const trainerSlotControls = new Map();
const trainerScoreEls = new Map();

function createTrainerCard(trainer, speciesList){
  const card = document.createElement('div');
  card.className = 'panel';
  card.style.marginBottom = '12px';

  const h = document.createElement('h3');
  h.textContent = trainer.name.replace(/1$/, '');
  const scoreEl = document.createElement('span');
  scoreEl.style.float = 'right';
  scoreEl.style.fontSize = '13px';
  scoreEl.style.fontWeight = '600';
  scoreEl.textContent = 'Score: —';
  h.appendChild(scoreEl);
  // per-trainer calculate button removed — global Calculate will compute and render per-trainer matrices
  // register score element for external updates
  trainerScoreEls.set(trainer.name, scoreEl);
  card.appendChild(h);

  // enemy list
  const enemies = document.createElement('div');
  enemies.className = 'muted';
  enemies.style.marginBottom = '8px';
  enemies.textContent = 'Enemies: ' + trainer.pokemons.map(p=>prettySpecies(p.species)).join(', ');
  card.appendChild(enemies);

  // trainer Pokémon info (levels, moves, picture)
  const infoRow = document.createElement('div');
  // Use a fixed 6-column grid so trainer pokemon line up with the 6 builder slots
  infoRow.className = 'trainer-info-row';
  infoRow.style.gap = '8px';
  infoRow.style.marginBottom = '8px';

  // populate info cards for each trainer pokemon
  trainer.pokemons.forEach((p)=>{
    const id = prettyId(p.species);
    const speciesName = prettySpecies(p.species);
    const info = document.createElement('div');
    info.className = 'trainer-mon-card';
    info.style.border = '1px solid #eee';
    info.style.padding = '8px';
    info.style.borderRadius = '6px';
    info.style.background = '#fff';
    info.style.minWidth = '0';
    info.style.boxSizing = 'border-box';
    info.style.display = 'flex';
    info.style.flexDirection = 'column';
    info.style.overflow = 'hidden';

    // sprite wrapper (gender symbol will be placed inline next to nature)
    const spriteWrap = document.createElement('div');
    spriteWrap.style.position = 'relative';
    spriteWrap.style.width = '64px';
    spriteWrap.style.margin = '0 auto 6px';

    const img = document.createElement('img');
    img.alt = speciesName;
    img.style.width = '64px';
    img.style.height = '64px';
    img.style.objectFit = 'contain';
    img.style.background = '#f0f0f0';
    img.style.display = 'block';
    // choose sprite based on species numeric mapping (apply Gen3 offset)
    const spriteNum = getSpriteNumberForSpeciesName(speciesName);
    if (spriteNum) {
      img.src = `src/Sprites/Frame1Front/${spriteNum}.png`;
    } else {
      img.src = `src/assets/sprites/${id}.png`;
    }
    spriteWrap.appendChild(img);

    // compute trainer gender inference for inline use (no decorative circle)
    function inferTrainerGender(name){
      if (!name) return 'male';
      const s = name.toLowerCase();
      if (s.includes('tateandliza') || s.includes('tateandliza1')) return 'mixed';
      const female = ['roxanne','flannery','winona','phoebe','glacia','liza','dawn','candice'];
      const male = ['brawly','wattson','norman','juan','sidney','drake','wallace','tate','brendan','steven','may'];
      for (const f of female) if (s.includes(f)) return 'female';
      for (const m of male) if (s.includes(m)) return 'male';
      return 'male';
    }
    const _speciesKey = speciesName.toLowerCase().replace(/[^a-z]/g,'');
    const _genderless = new Set(['claydol','lunatone','solrock']);
    let _trainerGender = null;
    if (!_genderless.has(_speciesKey)){
      _trainerGender = inferTrainerGender(trainer.name);
      if (_speciesKey === 'xatu' && trainer.name && trainer.name.toLowerCase().includes('tate')) _trainerGender = 'male';
    }

    info.appendChild(spriteWrap);

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = speciesName + ` (Lv ${p.lvl})`;
    info.appendChild(title);


    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.style.fontSize = '12px';
    // build inline content: IV, optional nature, and simple gender symbol to the right
    const ivText = document.createTextNode(`IV: ${p.iv != null ? p.iv : '—'}`);
    meta.appendChild(ivText);
    if (p.nature){
      const natText = document.createTextNode(' • ' + p.nature);
      meta.appendChild(natText);
    }
    if (_trainerGender){
      const sym = document.createElement('span');
      sym.textContent = _trainerGender === 'female' ? '♀' : '♂';
      sym.style.marginLeft = '6px';
      sym.style.fontSize = '14px';
      sym.style.verticalAlign = 'middle';
      sym.style.lineHeight = '1';
      sym.style.color = _trainerGender === 'female' ? '#c21807' : '#0b63c7';
      meta.appendChild(sym);
    }
    info.appendChild(meta);

    // abilities: render on its own line under the IV/nature meta
    const abilitiesDiv = document.createElement('div');
    abilitiesDiv.className = 'muted trainer-abilities';
    abilitiesDiv.style.fontSize = '12px';
    abilitiesDiv.style.marginTop = '4px';
    if (Array.isArray(p.abilities) && p.abilities.length > 0){
      abilitiesDiv.textContent = p.abilities.map(a=>prettyAbility(a)).join(', ');
    } else if (p.ability){
      // fallback single ability key
      abilitiesDiv.textContent = prettyAbility(p.ability);
    } else {
      abilitiesDiv.textContent = '';
    }
    info.appendChild(abilitiesDiv);

    // Trainer stats are omitted on the trainer cards to keep layout stable.



    // moves: display as 2x2 colored grid
    const movesGrid = document.createElement('div');
    movesGrid.className = 'moves-grid';
    movesGrid.style.display = 'grid';
    movesGrid.style.gridTemplateColumns = '1fr 1fr';
    movesGrid.style.gap = '6px';
    movesGrid.style.marginTop = '6px';
    movesGrid.style.width = '100%';
    movesGrid.style.boxSizing = 'border-box';
    // create four cells
    const moveCells = [];
    for (let mi=0; mi<4; mi++){
      const cell = document.createElement('div');
      cell.style.minHeight = '36px';
      cell.style.maxHeight = '44px';
      cell.style.display = 'flex';
      cell.style.flexDirection = 'column';
      cell.style.justifyContent = 'center';
      cell.style.alignItems = 'center';
      cell.style.borderRadius = '6px';
      cell.style.border = '2px solid #eee';
      cell.style.background = '#fafafa';
      cell.style.fontSize = '12px';
      cell.style.padding = '6px';
      cell.style.overflow = 'hidden';
      cell.style.whiteSpace = 'nowrap';
      cell.style.textOverflow = 'ellipsis';
      cell.textContent = '';
      movesGrid.appendChild(cell);
      moveCells.push(cell);
    }
    info.appendChild(movesGrid);

    // color map for types
    const TYPE_COLORS = {
      fire:'#F08030', water:'#6890F0', grass:'#78C850', electric:'#F8D030', rock:'#B8A038', ground:'#E0C068', bug:'#A8B820', ghost:'#705898', steel:'#B8B8D0', ice:'#98D8D8', psychic:'#F85888', dark:'#705848', dragon:'#7038F8', normal:'#A8A878', fighting:'#C03028', poison:'#A040A0', flying:'#A890F0'
    };

    (async ()=>{
      try{
        const movesMap = await loadBattleMovesH();
        const mlist = Array.isArray(p.moves) ? p.moves.slice(0,4) : [];
        for (let idx=0; idx<4; idx++){
          const mv = mlist[idx];
          const cell = moveCells[idx];
          if (!mv){ cell.textContent = ''; cell.style.borderColor='#eee'; cell.style.background='#fafafa'; continue; }
          const label = prettyMove(mv);
          // normalize move token variants: allow plain names like 'Tackle' or 'RockThrow'
          const token = await resolveMoveToken(mv);
          let mm = movesMap && (movesMap[token] || movesMap[mv]) ? (movesMap[token] || movesMap[mv]) : null;
          let mtype = null;
          if (mm && mm.type) mtype = mm.type.toLowerCase();
          else {
            const alt = MOVE_TYPE[mv] || MOVE_TYPE[token] || null;
            mtype = alt ? String(alt).toLowerCase() : null;
          }
          const color = mtype ? (TYPE_COLORS[mtype] || '#ddd') : '#ddd';
          cell.textContent = '';
          const nameDiv = document.createElement('div'); nameDiv.textContent = label; nameDiv.style.fontSize='12px'; nameDiv.style.fontWeight='600'; nameDiv.style.color='#222';
          const typeDiv = document.createElement('div'); typeDiv.textContent = mtype ? mtype[0].toUpperCase()+mtype.slice(1) : ''; typeDiv.style.fontSize='11px'; typeDiv.style.marginTop='4px'; typeDiv.style.padding='2px 6px'; typeDiv.style.borderRadius='10px'; typeDiv.style.background = color; typeDiv.style.color='#fff';
          cell.appendChild(nameDiv);
          cell.appendChild(typeDiv);
          cell.style.borderColor = color;
          cell.style.background = '#fff';
        }
      }catch(e){ /* ignore */ }
    })();

    // Trainer cards do not show base stats (kept out of trainer info display)



    infoRow.appendChild(info);
  });

  card.appendChild(infoRow);

  // compute and display trainer score based on planned team
  (async ()=>{
    let planned = [];
    try{ planned = getPlannedTeam(); }catch(e){ planned = []; }
    const sc = await computeTrainerScore(trainer, planned);
    if (sc === 0){
      scoreEl.textContent = `Score: —`;
      console.debug('Trainer score computed as 0 for', trainer.name, 'planned', planned, ' — check learnsets/moves parsing.');
    } else {
      scoreEl.textContent = `Score: ${sc.toFixed(2)}/10`;
    }
    // per-enemy breakdown removed (matrix sheet used for scoring/explanation)
  })();

  // team builder area - fixed 6 columns to match trainer info row
  const builder = document.createElement('div');
  builder.className = 'trainer-builder-row';
  builder.style.display = 'grid';
  builder.style.gridTemplateColumns = 'repeat(6, 1fr)';
  builder.style.gap = '8px';
  // create 6 slots
  const slotControls = [];
  for (let i=0;i<6;i++){
    const slot = document.createElement('div');
    slot.style.border = '1px solid #eee';
    slot.style.padding = '8px';
    slot.style.borderRadius = '6px';
    slot.style.background = '#fafafa';
    slot.style.position = 'relative';

    // species search
    const { wrapper: spWrap, input: spInput } = createInput('Species');
    spInput.placeholder = 'Type to search species...';
    spInput.autocomplete = 'off';
    spWrap.style.position = 'relative';
    spWrap.style.width = '110px';
    spWrap.style.display = 'inline-block';
    // title and preview image for this slot
    const slotTitle = document.createElement('div');
    slotTitle.style.fontWeight = '600';
    slotTitle.style.marginBottom = '6px';
    slotTitle.textContent = '(none)';
    slot.appendChild(slotTitle);
    // small remove button (top-right) to clear this slot when a mon is not obtainable
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove this slot';
    removeBtn.style.position = 'absolute';
    removeBtn.style.top = '6px';
    removeBtn.style.right = '6px';
    removeBtn.style.border = 'none';
    removeBtn.style.background = 'transparent';
    removeBtn.style.fontSize = '16px';
    removeBtn.style.cursor = 'pointer';
    removeBtn.style.lineHeight = '1';
    removeBtn.style.padding = '2px 6px';
    removeBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      // Find this slot's index in the slotControls array
      const idx = slotControls.findIndex(c => c.computeAndRenderSlotStats === computeAndRenderSlotStats);
      if (idx === -1){
        // fallback: simply clear if something unexpected
        spInput.value = '';
        slotTitle.textContent = '(none)';
        if (typeof setSlotPreview === 'function') setSlotPreview('');
        lvInput.value = 50; ivInput.value = 15;
        for (const k in evInputs) evInputs[k].value = 0;
        if (moveSelects) moveSelects.forEach(ms=>ms.value='');
        try{ computeAndRenderSlotStats().catch(()=>{}); }catch(e){}
        return;
      }
      // Remove the slot DOM element so remaining slots "gravitate" (grid will reflow)
      try{ slot.remove(); }catch(e){ if (slot.parentNode) slot.parentNode.removeChild(slot); }
      // Remove the control entry from the array and update registry
      slotControls.splice(idx, 1);
      trainerSlotControls.set(trainer.name, slotControls);

      // Recompute stats on remaining slots to pick up shifted indices (nature lookup uses current index)
      for (const c of slotControls){ try{ if (typeof c.computeAndRenderSlotStats === 'function') c.computeAndRenderSlotStats(); }catch(e){} }

      // Recompute trainer score for visual feedback
      (async ()=>{
        try{
          let planned = [];
          try{ planned = getPlannedTeam(); }catch(e){ planned = []; }
          const sc = await computeTrainerScore(trainer, planned);
          const el = trainerScoreEls.get(trainer.name);
          if (el){ el.textContent = sc === 0 ? `Score: —` : `Score: ${sc.toFixed(2)}/10`; }
        }catch(e){ /* ignore */ }
      })();
    });
    slot.appendChild(removeBtn);
    const preview = document.createElement('img');
    preview.style.width = '48px';
    preview.style.height = '48px';
    preview.style.objectFit = 'contain';
    preview.style.background = '#f8f8f8';
    preview.style.display = 'block';
    preview.style.marginBottom = '6px';
    preview.alt = 'sprite';
    slot.appendChild(preview);
    // ability display for the user's slot (will show chosen or default ability)
    const userAbilityDiv = document.createElement('div');
    userAbilityDiv.className = 'muted user-slot-ability';
    userAbilityDiv.style.fontSize = '12px';
    userAbilityDiv.style.marginBottom = '6px';
    slot.appendChild(userAbilityDiv);
    // create and append level input directly under the sprite for quick access
    const { wrapper: lvWrap, input: lvInput } = createInput('Level (1-100)', { type: 'number', min:1, max:100, value:50 });
    slot.appendChild(lvWrap);
    const list = document.createElement('div');
    list.style.position = 'absolute';
    list.style.left = '0';
    list.style.right = '0';
    list.style.top = '36px';
    list.style.maxHeight = '160px';
    list.style.overflow = 'auto';
    list.style.background = 'white';
    list.style.border = '1px solid #eee';
    list.style.display = 'none';
    spWrap.appendChild(list);

    spInput.addEventListener('input', ()=>{
      const q = spInput.value.trim().toLowerCase();
      list.innerHTML = '';
      if (!q) { list.style.display = 'none'; return; }
      const matches = speciesList.filter(s=>s.toLowerCase().includes(q)).slice(0,20);
      for (const m of matches){
        const it = document.createElement('div');
        it.textContent = m;
        it.style.padding = '6px';
        it.style.cursor = 'pointer';
        it.addEventListener('click', ()=>{ spInput.value = m; list.style.display='none'; setSlotPreview(m); if (typeof populateMoveSelectsForSlot === 'function') populateMoveSelectsForSlot().catch(e=>console.debug('populateMoveSelectsForSlot error',e)); });
        list.appendChild(it);
      }
      list.style.display = matches.length? 'block':'none';
    });

    // move species selector into left column later to avoid it taking full-width top space
    // (we'll append it into `leftCol` after it's created)

    // (Per-slot base stats display removed — planned team retains base stats)

    function setSlotPreview(name){
      try{ slotTitle.textContent = prettySpecies(name); }catch(e){}
      const num = getSpriteNumberForSpeciesName(name);
      if (num){
        preview.src = `src/Sprites/Frame1Front/${num}.png`;
      } else {
        preview.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
      }
      // asynchronously resolve species default ability and show it unless an explicit ability is set on the control
      (async ()=>{
        try{
          const si = await getSpeciesInfoByName(name);
          const abs = (si && si.info && Array.isArray(si.info.abilities)) ? si.info.abilities.filter(a=>a && a !== 'ABILITY_NONE') : [];
          if (abs.length) userAbilityDiv.textContent = prettyAbility(abs[0]); else userAbilityDiv.textContent = '';
        }catch(e){ /* ignore */ }
      })();
    }

    // (Nature selector omitted from trainer slot - use Planned Team nature)

    // IV / EVs per stat / Level
    const { wrapper: ivWrap, input: ivInput } = createInput('IV (0-31)', { type: 'number', min:0, max:31, value:15 });
    slot.appendChild(ivWrap);

    const evContainer = document.createElement('div');
    evContainer.style.display = 'grid';
    evContainer.style.gridTemplateColumns = 'repeat(3, 1fr)';
    evContainer.style.gap = '6px';
    evContainer.style.marginBottom = '6px';
    const evInputs = {};
    ['HP','Atk','Def','SpA','SpD','Spe'].forEach((stat) => {
      const labelText = `${stat} EV`;
      const { wrapper: evWrapStat, input: evInputStat } = createInput(labelText, { type: 'number', min:0, max:252, value:0 });
      // allow grid children to shrink
      evWrapStat.style.minWidth = '0';
      // keep label compact
      const lbl = evWrapStat.querySelector('label');
      if (lbl) {
        lbl.style.whiteSpace = 'nowrap';
        lbl.style.fontSize = '12px';
      }
      evInputStat.style.width = '100%';
      evInputStat.style.boxSizing = 'border-box';
      evInputStat.title = '0-252';
      evContainer.appendChild(evWrapStat);
      evInputs[stat] = evInputStat;
    });
    slot.appendChild(evContainer);

    // level input already created above and appended under the sprite

    // exact computed stats (read-only) — will be inserted after moves

    

    // moves (selects populated from level-up learnset + TM/HM)
    const movesDiv = document.createElement('div');
    movesDiv.style.marginTop = '6px';
    movesDiv.className = 'muted';
    movesDiv.textContent = 'Moves';
    slot.appendChild(movesDiv);
    const moveSelects = [];
    for (let m=0;m<4;m++){
      const mvWrap = document.createElement('div');
      mvWrap.style.marginBottom = '6px';
      const label = document.createElement('label'); label.className = 'muted'; label.textContent = `Move ${m+1}`;
      const sel = document.createElement('select'); sel.style.width = '100%'; sel.style.boxSizing = 'border-box';
      // empty placeholder
      const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = '(none)'; sel.appendChild(emptyOpt);
      mvWrap.appendChild(label); mvWrap.appendChild(sel);
      slot.appendChild(mvWrap);
      moveSelects.push(sel);
    }

    // exact computed stats (read-only) shown between moves and nickname
    const exactStatsDiv = document.createElement('div');
    exactStatsDiv.style.marginTop = '6px';
    exactStatsDiv.style.fontSize = '12px';
    exactStatsDiv.textContent = 'Stats: —';
    slot.appendChild(exactStatsDiv);

    // gender & nickname removed from trainer slot (use Planned Team settings)

    // helper to populate move selects for this slot based on species+level
    async function populateMoveSelectsForSlot(){
      const speciesName = spInput.value;
      const lvl = parseInt(lvInput.value,10) || 1;
      if (!speciesName) return;
      // normalize to token
      let token = speciesName;
      if (!/^SPECIES_/.test(token)){
        const v = nameToTokenVariants(speciesName);
        token = v.length? v[0] : ('SPECIES_' + speciesName.toUpperCase().replace(/[^A-Z0-9]/g,'_'));
      }
      const lvlSets = await loadLevelUpLearnsetsH();
      const tmSets = await loadTMHMLearnsetsH();
      const levelMoves = (lvlSets[token] || []).filter(m=>m.level <= lvl).map(m=>m.move);
      const tmMoves = (tmSets[token] || []);
      const availableTMs = getAvailableTMsForTrainer(trainer);
      const candidates = new Set();
      for (const mv of levelMoves) candidates.add(mv);
      // include TM/HM moves in UI lists regardless of status; availability still enforced
      for (const mv of tmMoves){ if (availableTMs === null || availableTMs.has(mv)) candidates.add(mv); }
      const list = Array.from(candidates);
      // sort by power/stab heuristic
      const siForSort = await getSpeciesInfoByName(speciesName);
      const speciesTypes = (siForSort && siForSort.info && siForSort.info.types) ? siForSort.info.types : [];
      list.sort((a,b)=>{
        const pa = isStatusMove(a) ? 0 : (MOVE_POWER[a] || 50);
        const pb = isStatusMove(b) ? 0 : (MOVE_POWER[b] || 50);
        const ta = MOVE_TYPE[a] || null; const tb = MOVE_TYPE[b] || null;
        const stabA = (ta && speciesTypes.includes(ta)) ? 50 : 0;
        const stabB = (tb && speciesTypes.includes(tb)) ? 50 : 0;
        return (pb + stabB) - (pa + stabA);
      });
      // populate each select with same candidate list
      for (const sel of moveSelects){
        // clear extras but keep first (none)
        while (sel.options.length > 1) sel.remove(1);
        for (const mv of list){ const o = document.createElement('option'); o.value = mv; o.textContent = prettyMove(mv); sel.appendChild(o); }
      }
    }

    // re-populate when species or level changes
    spInput.addEventListener('change', ()=>{ populateMoveSelectsForSlot().catch(e=>console.debug('populateMoveSelectsForSlot error',e)); computeAndRenderSlotStats().catch(()=>{}); });
    lvInput.addEventListener('change', ()=>{ populateMoveSelectsForSlot().catch(e=>console.debug('populateMoveSelectsForSlot error',e)); computeAndRenderSlotStats().catch(()=>{}); });

    // compute and render exact stats for this slot using calcAllStatsGen3
    async function computeAndRenderSlotStats(){
      const speciesName = spInput.value;
      const lvlRaw = lvInput.value;
      let savedNatures = [];
      try{ savedNatures = getPlannedNatures() || []; }catch(e){ savedNatures = []; }
      // determine this slot's current index within the trainer's slotControls array (robust to deletions)
      const currentIdx = slotControls.findIndex(c => c.computeAndRenderSlotStats === computeAndRenderSlotStats);
      const natVal = savedNatures[currentIdx] || null;
      if (!speciesName || !lvlRaw){
        exactStatsDiv.textContent = 'Stats: waiting for species and level';
        return;
      }
      // resolve base stats
      let base = null;
      try{
        const si = await getSpeciesInfoByName(speciesName);
        if (si && si.info && si.info.baseStats) base = si.info.baseStats;
        else {
          const id = speciesName.toLowerCase().replace(/[^a-z0-9]/g,'');
          const sd = await loadSpeciesData(id);
          if (sd && sd.baseStats) base = sd.baseStats;
        }
      }catch(e){ base = null; }
      if (!base){ exactStatsDiv.textContent = 'Stats: —'; return; }
      const ivVal = parseInt(ivInput.value,10) || 15;
      const ivs = { hp: ivVal, atk: ivVal, def: ivVal, spa: ivVal, spd: ivVal, spe: ivVal };
      const evs = { hp: parseInt(evInputs.HP.value,10)||0, atk: parseInt(evInputs.Atk.value,10)||0, def: parseInt(evInputs.Def.value,10)||0, spa: parseInt(evInputs.SpA.value,10)||0, spd: parseInt(evInputs.SpD.value,10)||0, spe: parseInt(evInputs.Spe.value,10)||0 };
      const lvl = parseInt(lvInput.value,10) || 50;
      const nat = natVal || 'Hardy';
      try{
        const out = calcAllStatsGen3({ baseStats: base, ivs, evs, level: lvl, nature: nat });
        exactStatsDiv.innerHTML = '';
        const lines = [ `HP: ${out.hp}`, `Atk: ${out.atk}`, `Def: ${out.def}`, `SpA: ${out.spa}`, `SpD: ${out.spd}`, `Spe: ${out.spe}` ];
        for (const ln of lines){ const d = document.createElement('div'); d.textContent = ln; exactStatsDiv.appendChild(d); }
        spInput.computedStats = out;
      }catch(e){ exactStatsDiv.textContent = 'Stats: —'; }
    }

    // wire inputs to recompute
    ivInput.addEventListener('change', ()=>computeAndRenderSlotStats().catch(()=>{}));
    for (const k in evInputs) evInputs[k].addEventListener('change', ()=>computeAndRenderSlotStats().catch(()=>{}));
    // initial compute
    computeAndRenderSlotStats().catch(()=>{});

    // collect controls for programmatic filling (include slot DOM for visibility control)
    slotControls.push({ spInput, preview, setSlotPreview, lvInput, ivInput, evInputs, moveSelects, populateMoveSelectsForSlot, computeAndRenderSlotStats, slotEl: slot, abilityDiv: userAbilityDiv, ability: null });

    builder.appendChild(slot);
  }

  // register slot controls for external auto-fill
  trainerSlotControls.set(trainer.name, slotControls);

  card.appendChild(builder);
  return card;
}

document.addEventListener('DOMContentLoaded', async ()=>{
  const trainers = await loadTrainers();
  // Build searchable species list from national dex `SPECIES_NATIONAL`
  const speciesList = SPECIES_NATIONAL.map(([,name])=>name.toLowerCase()).sort();
  // Preload move data and build name index so rendering is consistent
  try{
    const movesMap = await loadBattleMovesH();
    await buildMoveNameIndex();
    // populate fallback MOVE_TYPE / MOVE_POWER entries from parsed moves if missing
    if (movesMap){
      for (const k in movesMap){
        try{
          const mm = movesMap[k];
          if (mm && mm.type){ if (!MOVE_TYPE[k]) MOVE_TYPE[k] = mm.type; }
          if (mm && mm.power != null){ if (!MOVE_POWER[k]) MOVE_POWER[k] = mm.power; }
        }catch(e){}
      }
    }
  }catch(e){ console.debug('Preload moves failed', e); }

  // preload TM/HM availability file so auto-fill can filter candidate TMs per trainer
  try{
    await loadTMAvailabilityJSON();
  }catch(e){ console.debug('TM availability load failed', e); }

  // add Planned Team UI at top
  const appContainer = document.getElementById('trainersContainer');
  appContainer.innerHTML = '';
  const plannedTeamEl = createPlannedTeamArea(speciesList);
  appContainer.appendChild(plannedTeamEl);

  // render badge controls area (if present in DOM)
  try{
    const badgeRoot = document.getElementById('badgeControls');
    if (badgeRoot){
      badgeRoot.innerHTML = '';
      const lbl = document.createElement('div'); lbl.textContent = 'Player Badges (Hoenn — Gen3 +10%):'; lbl.style.fontWeight = '600'; lbl.style.marginBottom = '6px'; badgeRoot.appendChild(lbl);
      const active = loadActiveBadges();
      for (const name of Object.keys(HOENN_BADGES)){
        const id = 'badge_' + HOENN_BADGES[name].key;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = id; cb.checked = active.has(name) || active.has(HOENN_BADGES[name].key);
        const lab = document.createElement('label'); lab.htmlFor = cb.id; lab.style.marginRight = '12px'; lab.style.display = 'inline-flex'; lab.style.alignItems = 'center';
        const span = document.createElement('span'); span.textContent = name; span.style.marginLeft = '6px'; lab.appendChild(cb); lab.appendChild(span);
        cb.addEventListener('change', ()=>{
          const set = loadActiveBadges();
          if (cb.checked) set.add(name); else set.delete(name);
          saveActiveBadges(set);
        });
        badgeRoot.appendChild(lab);
      }
    }
  }catch(e){/* ignore */}

  // NOTE: clear-saved-state button removed — planned-team is now non-persistent by default.

  // Auto-fill and Calculate buttons container
  const globalAuto = document.createElement('div');
  globalAuto.className = 'global-controls';
  globalAuto.style.margin = '8px 0';

  // Auto-fill button: fills species/moves/stats but does NOT compute scores
  const autofillBtn = document.createElement('button');
  autofillBtn.className = 'btn btn-primary';
  autofillBtn.textContent = 'Auto-fill team';
  autofillBtn.title = 'Auto-fill team against each trainer';
  autofillBtn.setAttribute('aria-label', 'Auto-fill team against each trainer');

  // Calculate button: initially disabled until autofill runs
  const calcBtn = document.createElement('button');
  calcBtn.className = 'btn btn-secondary';
  calcBtn.textContent = 'Calculate team score';
  calcBtn.title = 'Calculate team score';
  calcBtn.setAttribute('aria-label', 'Calculate team score');
  calcBtn.disabled = true;
  // help icon: show scoring explanation
  const calcHelpBtn = document.createElement('button');
  calcHelpBtn.className = 'btn btn-link';
  calcHelpBtn.style.marginLeft = '8px';
  calcHelpBtn.style.padding = '6px';
  calcHelpBtn.style.borderRadius = '50%';
  calcHelpBtn.style.width = '28px';
  calcHelpBtn.style.height = '28px';
  calcHelpBtn.style.display = 'inline-flex';
  calcHelpBtn.style.alignItems = 'center';
  calcHelpBtn.style.justifyContent = 'center';
  calcHelpBtn.style.border = '1px solid #ddd';
  calcHelpBtn.style.background = '#fff';
  calcHelpBtn.title = 'How is score calculated?';
  calcHelpBtn.setAttribute('aria-label', 'How is score calculated');
  calcHelpBtn.textContent = '?';
  calcHelpBtn.addEventListener('click', ()=>{
    const existing = document.querySelector('.score-explain-modal'); if (existing) existing.remove();
    const modal = document.createElement('div'); modal.className = 'score-explain-modal';
    modal.style.position = 'fixed'; modal.style.left = '0'; modal.style.top = '0'; modal.style.width = '100%'; modal.style.height = '100%'; modal.style.background = 'rgba(0,0,0,0.35)'; modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center'; modal.style.zIndex = '10000';
    const box = document.createElement('div'); box.style.background = '#fff'; box.style.borderRadius='8px'; box.style.padding='16px'; box.style.maxWidth='640px'; box.style.width='90%'; box.style.maxHeight='80%'; box.style.overflow='auto';
    const close = document.createElement('button'); close.textContent='Close'; close.style.float='right'; close.addEventListener('click', ()=> modal.remove()); box.appendChild(close);
    const title = document.createElement('h3'); title.textContent = 'How team score is calculated (temporary system)'; box.appendChild(title);
    const p = document.createElement('div'); p.style.fontSize='13px'; p.style.lineHeight='1.4';
    p.innerHTML = `
      <p>The team score is computed from simulated, per-mon matchups between each planned-team Pokémon and each trainer party Pokémon. Each pairwise matchup produces a small 0–10 point score which is then aggregated into the trainer and team scores.</p>

      <h4>Damage & move selection</h4>
      <ul>
        <li>For each matchup we compute exact stats for both Pokémon (including nature, EVs, badges, abilities) and evaluate each attacking move at the <em>mid randomness roll</em> (midpoint of the 85–100% damage variance, i.e. ~92.5%).</li>
        <li>The "best move" for each side is the damaging move that yields the highest mid-roll damage. Status/0-power moves are ignored when any damaging move exists.</li>
        <li>Damage is evaluated as percent of the target's HP at the mid-roll to compute expected hits-to-KO.</li>
      </ul>

      <h4>Point breakdown (per pairing)</h4>
      <ul>
        <li><strong>Offense (0–3 points)</strong>
          <ul>
            <li>3 points: your best move is a guaranteed OHKO (one hit KO at the mid-roll).</li>
            <li>2 points: guaranteed 2HKO (faints within two mid-roll hits).</li>
            <li>1 point: guaranteed 3HKO.</li>
            <li>0 points: 4HKO or worse.</li>
          </ul>
        </li>
        <li><strong>Defense (0–6 points)</strong>
          <ul>
            <li>6 points: your Pokémon can take 6 or more hits from the opponent's best damaging move before fainting.</li>
            <li>5 points: survives 5 hits; 4 points: survives 4 hits; 3 points: 3 hits; 2 points: 2 hits; 1 point: 1 hit; 0 points: cannot survive a single hit.</li>
          </ul>
        </li>
        <li><strong>Speed (0–1 points)</strong>
          <ul>
            <li>1.0 point: your Pokémon outspeeds the opponent.</li>
            <li>0.5 point: speed tie.</li>
            <li>0 points: opponent is faster.</li>
          </ul>
        </li>
      </ul>

      <h4>Exceptions (full-score shortcuts)</h4>
      <ul>
        <li>If your Pokémon both outspeeds the opponent <em>and</em> scores an OHKO, the pairing is awarded the full 10 points.</li>
        <li>If your Pokémon takes zero damage from the opponent (for example due to immunity/absorb) and you have at least one damaging move that can hit the opponent, the pairing is awarded the full 10 points.</li>
      </ul>

      <h4>Aggregation into trainer & team scores</h4>
      <ul>
        <li>Each planned-team Pokémon is scored against every Pokémon in the enemy trainer's party. These per-pairing point totals are displayed in the matchup matrix.</li>
        <li>For each enemy party slot we take the single best score across your planned Pokémon ("best score" column).</li>
        <li>The trainer score is the average of those best scores across the trainer's whole party. The team score shown in the UI is an aggregation (average) of trainer scores for the trainers you selected.</li>
      </ul>

      <p>Click any cell in the matchup matrix to see the numeric damage breakdowns used to compute hits-to-KO, applied abilities/notes (e.g. Thick Fat, Levitate, Absorb), and the intermediate numbers used to award offense/defense/speed points.</p>
      <p><em>Note:</em> This scoring system is temporary and simplified for now — it will be refined and expanded in future updates to better reflect full battle simulations and edge cases.</p>
    `;
    box.appendChild(p);
    modal.appendChild(box); document.body.appendChild(modal);
  });

  // progress element and team score banner (shared)
  const __autoFillProgressEl = document.createElement('div');
  __autoFillProgressEl.style.marginTop = '6px';
  __autoFillProgressEl.style.fontSize = '13px';
  __autoFillProgressEl.style.color = '#333';
  __autoFillProgressEl.style.display = 'none';
  const __teamScoreBanner = document.createElement('div');
  __teamScoreBanner.style.marginTop = '8px';
  __teamScoreBanner.style.display = 'none';
  __teamScoreBanner.style.padding = '10px';
  __teamScoreBanner.style.borderRadius = '8px';
  __teamScoreBanner.style.background = '#fff';
  __teamScoreBanner.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
  __teamScoreBanner.style.alignItems = 'center';
  __teamScoreBanner.style.gap = '8px';
  const __teamScoreText = document.createElement('div');
  __teamScoreText.style.fontSize = '18px';
  __teamScoreText.style.fontWeight = '700';
  __teamScoreText.textContent = '';
  const __teamScoreNote = document.createElement('div');
  __teamScoreNote.style.fontSize = '13px';
  __teamScoreNote.style.color = 'var(--muted)';
  __teamScoreNote.textContent = '';
  __teamScoreBanner.appendChild(__teamScoreText);
  __teamScoreBanner.appendChild(__teamScoreNote);

  globalAuto.appendChild(autofillBtn);
  globalAuto.appendChild(calcBtn);
  // place the small circular help icon immediately after the Calculate button
  calcHelpBtn.style.fontWeight = '700';
  calcHelpBtn.style.fontSize = '13px';
  calcHelpBtn.style.cursor = 'pointer';
  calcHelpBtn.style.lineHeight = '1';
  calcHelpBtn.style.marginLeft = '6px';
  globalAuto.appendChild(calcHelpBtn);
  globalAuto.appendChild(__autoFillProgressEl);
  globalAuto.appendChild(__teamScoreBanner);
  appContainer.appendChild(globalAuto);

  // Autofill handler: fills trainer slots but does not compute scores
  autofillBtn.addEventListener('click', async ()=>{
    console.debug('Auto-fill All Trainers clicked');
    console.log('Auto-fill All Trainers clicked');
    const trainersList = trainers;
    const lvlSets = await loadLevelUpLearnsetsH();
    const tmSets = await loadTMHMLearnsetsH();
    let planned = [];
    try{ planned = getPlannedTeam(); }catch(e){ planned = []; }
    let savedNatures = [];
    try{ savedNatures = getPlannedNatures(); }catch(e){ savedNatures = []; }
    let savedAbilities = [];
    try{ savedAbilities = getPlannedAbilities(); }catch(e){ savedAbilities = []; }
    for (const t of trainersList){
      const slotControls = trainerSlotControls.get(t.name);
      if (!slotControls) continue;
      const battleLevel = computeBattleLevel(t);
      const playerLevelDefault = computePlayerDefaultLevel(t);
      for (let i=0;i<slotControls.length;i++){
        const ctrl = slotControls[i];
        const plannedName = planned[i];
        if (!ctrl) continue;
        if (!plannedName){
          ctrl.spInput.value = '';
          if (typeof ctrl.setSlotPreview === 'function') ctrl.setSlotPreview(''); else ctrl.preview.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
          ctrl.lvInput.value = 50;
          if (ctrl.moveSelects) ctrl.moveSelects.forEach(mi=>mi.value='');
          continue;
        }
        const chosenToken = await devolveSpeciesToLegalAtLevel(plannedName, playerLevelDefault, t);
        const displayName = prettySpecies(chosenToken).toLowerCase();
        ctrl.spInput.value = displayName;
        if (typeof ctrl.setSlotPreview === 'function') ctrl.setSlotPreview(displayName); else {
          const num = getSpriteNumberForSpeciesName(displayName);
          if (num) ctrl.preview.src = `src/Sprites/Frame1Front/${num}.png`; else ctrl.preview.src = '';
        }
        ctrl.lvInput.value = playerLevelDefault;
        const levelMoves = (lvlSets[chosenToken] || []).filter(m=>m.level <= playerLevelDefault).map(m=>m.move);
        const tmMoves = (tmSets[chosenToken] || []);
        const si = await getSpeciesInfoByName(displayName);
        const types = (si && si.info && si.info.types) ? si.info.types : [];
        // assign ability for this user slot from planned-team abilities if available,
        // otherwise fall back to species default ability (first non-ABILITY_NONE)
        try{
          let desired = savedAbilities[i] || null;
          if (!desired){
            const si2 = si || await getSpeciesInfoByName(displayName);
            const sabs = (si2 && si2.info && Array.isArray(si2.info.abilities)) ? si2.info.abilities.filter(a=>a && a !== 'ABILITY_NONE') : [];
            if (sabs.length) desired = sabs[0];
          }
          ctrl.ability = desired || null;
          if (ctrl.abilityDiv) ctrl.abilityDiv.textContent = ctrl.ability ? prettyAbility(ctrl.ability) : '';
        }catch(e){ ctrl.ability = null; }
        const availableTMs = getAvailableTMsForTrainer(t);
        const candidates = {};
        for (const mv of levelMoves) {
          const up = String(mv).toUpperCase();
          if (!isStatusMove(mv) && !up.includes('FOCUS_PUNCH') && !up.includes('HYPER_BEAM') && !up.includes('HYPERBEAM') && !up.includes('FUTURE_SIGHT')) candidates[mv]=true;
        }
        for (const mv of tmMoves) {
          const up = String(mv).toUpperCase();
          if (!isStatusMove(mv) && !up.includes('FOCUS_PUNCH') && !up.includes('HYPER_BEAM') && !up.includes('HYPERBEAM') && !up.includes('FUTURE_SIGHT')){
            if (availableTMs === null || availableTMs.has(mv)) candidates[mv]=true;
          }
        }
        const candArr = Object.keys(candidates).map(mv=>{
          const power = MOVE_POWER[mv] || 50;
          const mtype = MOVE_TYPE[mv] || null;
          const stab = (mtype && types.includes(mtype)) ? 50 : 0;
          return { move: mv, score: power+stab, type: mtype };
        });
        candArr.sort((a,b)=>b.score-a.score);
        // Selection order for autofill: 1) setup move (e.g., Calm Mind), 2) strongest STAB, 3) highest-power move of a different type,
        // then fill remaining slots with top-scoring moves.
        const selectedMoves = [];
        // 1) setup
        const setupCandidates = candArr.filter(c => isSetupMoveToken(c.move));
        if (setupCandidates.length > 0){ selectedMoves.push(setupCandidates[0].move); }
        // 2) strongest STAB
        const damaging = candArr.filter(c => (MOVE_POWER[c.move] || 0) > 0);
        let chosenStabType = null;
        if (damaging.length > 0){
          const stabCands = damaging.filter(c => c.type && types.includes(c.type));
          if (stabCands.length > 0){
            stabCands.sort((a,b)=> (MOVE_POWER[b.move]||0) - (MOVE_POWER[a.move]||0));
            const stabMove = stabCands[0].move;
            chosenStabType = stabCands[0].type || MOVE_TYPE[stabMove] || null;
            if (selectedMoves.indexOf(stabMove) === -1) selectedMoves.push(stabMove);
          }
        }
        // 3) highest-power move with a different type than chosen STAB
        if (damaging.length > 0){
          const powerSorted = damaging.slice().sort((a,b)=> (MOVE_POWER[b.move]||0) - (MOVE_POWER[a.move]||0));
          for (const p of powerSorted){
            if (selectedMoves.length >= 4) break;
            const mtype = p.type || MOVE_TYPE[p.move] || null;
            if (chosenStabType && mtype && chosenStabType === mtype) continue;
            if (selectedMoves.indexOf(p.move) !== -1) continue;
            selectedMoves.push(p.move);
            break;
          }
        }
        // fill remaining slots with highest scoring remaining moves
        for (const c of candArr){ if (selectedMoves.length >= 4) break; if (selectedMoves.indexOf(c.move) === -1) selectedMoves.push(c.move); }
        // ensure selects populated then set selected values
        if (ctrl.populateMoveSelectsForSlot) await ctrl.populateMoveSelectsForSlot();
        for (let k=0;k<4;k++){
          let mv = selectedMoves[k] ? selectedMoves[k] : null;
          // attempt to resolve non-canonical tokens (e.g., 'WaterGun' -> 'MOVE_WATER_GUN')
          try{
            const resolved = await resolveMoveToken(mv || '');
            // prefer resolved if moves map contains it or if the select has an option matching it
            if (resolved && ctrl.moveSelects && ctrl.moveSelects[k]){
              const sel = ctrl.moveSelects[k];
              let found = false;
              for (const opt of sel.options){ if (opt.value === resolved){ found = true; break; } }
              if (found) mv = resolved;
            }
          }catch(e){}
          if (ctrl.moveSelects && ctrl.moveSelects[k]){
            try{ console.debug('AutoFill: setting move select', k, 'token=', mv); console.log('AutoFill: setting move select', k, 'token=', mv); }catch(e){}
            ctrl.moveSelects[k].value = mv || '';
          }
        }
        ctrl.ivInput.value = 15;
        // trainer slot uses planned-team nature; do not set a per-slot nature selector
        Object.values(ctrl.evInputs).forEach(ei=>ei.value=0);
        // compute stats for this trainer slot if inputs are populated
        try{ if (typeof ctrl.computeAndRenderSlotStats === 'function') await ctrl.computeAndRenderSlotStats(); }catch(e){ /* ignore */ }
      }
      // After filling slots, adjust visible slot count to match planned team size
      try{
        const activeCount = (planned || []).filter(x=>x && String(x).trim()).length || 0;
        for (let i=0;i<slotControls.length;i++){
          const ctrl = slotControls[i];
          try{ if (ctrl && ctrl.slotEl) ctrl.slotEl.style.display = (i < activeCount) ? 'block' : 'none'; }catch(e){}
        }
      }catch(e){}
    }
    // enable the Calculate button now that autofill ran
    try{ calcBtn.disabled = false; }catch(e){}
  });

  // Calculate handler: run sequential calculations and show progress + team banner
  calcBtn.addEventListener('click', async ()=>{
    try{ __teamScoreBanner.style.display = 'none'; __teamScoreText.textContent = ''; __teamScoreNote.textContent = ''; }catch(e){}
    __autoFillProgressEl.style.display = 'block';
    const trainersList = trainers;
    const panels = Array.from(document.querySelectorAll('#trainersContainer > .panel'));
    const total = trainersList.length;
    // helper: wait for a selector to appear within a parent element
    const waitForWithin = async (parent, selector, timeoutMs=5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs){
        try{ if (parent.querySelector(selector)) return parent.querySelector(selector); }catch(e){}
        await new Promise(r=>setTimeout(r, 120));
      }
      return null;
    };
    try{
      let idx = 0;
      for (const t of trainersList){
        idx++;
        try{
          __autoFillProgressEl.textContent = `Calculating trainer ${idx}/${total}: ${ (t.name||'').replace(/1$/,'') }`;
          // locate the trainer card by matching the H3 header text
          let card = null;
          for (const p of panels){
            const h = p.querySelector('h3'); if (!h) continue;
            if (h.textContent && h.textContent.trim().startsWith((t.name||'').replace(/1$/,''))) { card = p; break; }
          }
          if (!card) continue;
          // Build team from this card's slot controls
          const slotCtrls = trainerSlotControls.get(t.name) || [];
          const teamMons = [];
          for (const ctrl of slotCtrls){
            try{
              if (!ctrl || !ctrl.spInput) continue;
              if (typeof ctrl.computeAndRenderSlotStats === 'function') await ctrl.computeAndRenderSlotStats();
              const species = ctrl.spInput.value && ctrl.spInput.value.trim();
              if (!species) continue;
              const lvl = parseInt(ctrl.lvInput.value,10) || 50;
              let stats = ctrl.spInput.computedStats || null;
              const moveset = (ctrl.moveSelects || []).map(s=>s.value).filter(Boolean);
              const ability = ctrl.ability || null;
              try{
                const seg = trainerNameToSegment(t) || approximateSegmentForLevel(t.maxLevel || t.level || 50);
                if (seg && seg > 3 && stats && typeof stats.spe === 'number'){
                  stats = Object.assign({}, stats);
                  stats.speBeforeDynamo = stats.spe;
                  stats.spe = Math.floor(stats.spe * 1.1);
                  teamMons.push({ species, level: lvl, statsFinal: stats, moveset, dynamoApplied: true, ability });
                  continue;
                }
              }catch(e){}
              teamMons.push({ species, level: lvl, statsFinal: stats, moveset, ability });
            }catch(e){ /* ignore slot errors */ }
          }
          if (teamMons.length === 0){
            const el = trainerScoreEls.get(t.name);
            if (el) el.textContent = 'Score: —';
            continue;
          }
          // build trainer party states
          const partyStates = await buildTrainerPartyStates(t);
          // compute matrix
          const matrix = [];
          for (let ri=0; ri<teamMons.length; ri++){
            const row = [];
            // per-row setup boost state: if a safe setup is achieved against a column, then for subsequent columns
            // the user's mon should be evaluated with assumed +6 boosts (x4 multipliers) for stats the setup move affects.
            let boostedStatsForRow = null;
            let boostMeta = null;
            for (let ci=0; ci<partyStates.length; ci++){
              let userForEval = teamMons[ri];
              let computeContext = {};
              if (boostedStatsForRow){ userForEval = Object.assign({}, teamMons[ri], { statsFinal: boostedStatsForRow }); computeContext.assumedSetupApplied = true; }
              const res = await computePairScore(userForEval, partyStates[ci], computeContext);
              // if this cell was computed using assumed boosts, annotate it
              if (boostedStatsForRow && res) res.assumedSetupBoost = boostMeta;
              row.push(res);

              // If we haven't yet applied boosts and this pairing produced a safe setup route, enable assumed +6 boosts for following columns
              try{
                if (!boostedStatsForRow && res && res.chosenRoute === 'setup' && res.setupInfo && res.setupInfo.safetyTier === 'safe'){
                  const sd = (res.setupInfo && res.setupInfo.details && res.setupInfo.details.setupInfo) ? res.setupInfo.details.setupInfo : (res.setupInfo.setupInfo || null);
                  if (sd){
                    try{
                      const baseStats = teamMons[ri].statsFinal || {};
                      const boosted = Object.assign({}, baseStats);
                      if (sd.atk && boosted.atk) boosted.atk = Math.max(1, Math.floor(boosted.atk * 4));
                      if (sd.spa && boosted.spa) boosted.spa = Math.max(1, Math.floor(boosted.spa * 4));
                      // assume speed also x4 per spec when setup achieved (apply to all assumed-boost evaluations)
                      if (boosted.spe) boosted.spe = Math.max(1, Math.floor(boosted.spe * 4));
                      if (sd.hpDeltaPct && boosted.hp) boosted.hp = Math.max(1, Math.floor(boosted.hp * (1 + sd.hpDeltaPct)));
                      boostedStatsForRow = boosted;
                      boostMeta = { sourceMove: res.setupInfo.move || null, boostedFrom: ci, setupDetails: sd };
                    }catch(e){}
                  }
                }
              }catch(e){}
            }
            matrix.push(row);
          }
          // render matrix into card
          try{
            let existing = card.querySelector('.matchup-matrix'); if (existing) existing.remove();
            const wrap = document.createElement('div'); wrap.className = 'matchup-matrix'; wrap.style.marginTop = '8px'; wrap.style.borderTop='1px solid #f0f0f0'; wrap.style.paddingTop='8px';
            const table = document.createElement('table'); table.style.width='100%'; table.style.borderCollapse='collapse';
            const thead = document.createElement('thead');
            const hdrRow = document.createElement('tr');
            const thEmpty = document.createElement('th'); thEmpty.style.textAlign='left'; thEmpty.style.padding='6px'; hdrRow.appendChild(thEmpty);
            for (const en of partyStates){ const th = document.createElement('th'); th.textContent = prettySpecies(en.species) + ` (Lv ${en.level})`; th.style.padding='6px'; hdrRow.appendChild(th); }
            thead.appendChild(hdrRow); table.appendChild(thead);
            const tbody = document.createElement('tbody');
            for (let ri=0; ri<matrix.length; ri++){
              const tr = document.createElement('tr');
              const nameCell = document.createElement('td'); nameCell.textContent = prettySpecies(teamMons[ri].species); nameCell.style.fontWeight='600'; nameCell.style.padding='6px'; tr.appendChild(nameCell);
              for (let ci=0; ci<matrix[ri].length; ci++){
                const cell = document.createElement('td'); cell.style.padding='6px'; cell.style.textAlign='center';
                const v = matrix[ri][ci]; cell.textContent = v && v.total != null ? String(v.total) : '—';
                if (v && typeof v === 'object'){
                  cell.style.cursor = 'pointer';
                  // highlight cell when the setup-route was chosen
                  try{
                    if (v.chosenRoute === 'setup'){
                      cell.style.background = '#fff4e6';
                      cell.style.border = '1px solid #ffd699';
                      cell.style.fontWeight = '700';
                    }
                    // Also visually mark cells that were computed using an assumed prior setup
                    // (these are the remaining party members to the right after a safe setup).
                    if (v.assumedSetupBoost){
                      // use a dashed border and slightly different tint so users can distinguish
                      cell.style.background = '#fff8f0';
                      cell.style.border = '1px dashed #ffd699';
                      cell.style.fontWeight = '700';
                    }
                  }catch(e){}
                  cell.title = 'Click to view calculation details';
                  cell.addEventListener('click', (ev)=>{
                    const existing = document.querySelector('.pair-breakdown-modal'); if (existing) existing.remove();
                    const modal = document.createElement('div'); modal.className = 'pair-breakdown-modal';
                    modal.style.position = 'fixed'; modal.style.left = '0'; modal.style.top = '0'; modal.style.width = '100%'; modal.style.height = '100%'; modal.style.background = 'rgba(0,0,0,0.35)'; modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center'; modal.style.zIndex = '9999';
                    const box = document.createElement('div'); box.style.background = '#fff'; box.style.borderRadius='8px'; box.style.padding='12px'; box.style.maxWidth='720px'; box.style.width='90%'; box.style.maxHeight='80%'; box.style.overflow='auto';
                    const closeBtn = document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.style.float='right'; closeBtn.addEventListener('click', ()=> modal.remove()); box.appendChild(closeBtn);
                    const title = document.createElement('h4'); title.textContent = `${prettySpecies(teamMons[ri].species)} vs ${prettySpecies(partyStates[ci].species)}`; box.appendChild(title);
                    const content = document.createElement('div'); content.style.fontSize = '13px'; content.style.lineHeight = '1.35';
                    const summary = document.createElement('div'); summary.style.display = 'flex'; summary.style.justifyContent = 'space-between'; summary.style.gap = '12px'; summary.style.flexWrap = 'wrap';
                    const userLabel = document.createElement('div'); const userStrong = document.createElement('strong'); userStrong.textContent = `User: ${prettySpecies(teamMons[ri].species)} (Lv ${teamMons[ri].level})`; userLabel.appendChild(userStrong); summary.appendChild(userLabel);
                    const enemyLabel = document.createElement('div'); const enemyStrong = document.createElement('strong'); enemyStrong.textContent = `Enemy: ${prettySpecies(partyStates[ci].species)} (Lv ${partyStates[ci].level})`; enemyLabel.appendChild(enemyStrong); summary.appendChild(enemyLabel);
                    content.appendChild(summary);
                    const mlist = document.createElement('ul'); mlist.style.margin = '6px 0 8px 18px'; mlist.style.padding = '0'; mlist.style.listStyle = 'disc';
                    const pushMetric = (k,vv)=>{ const it = document.createElement('li'); it.textContent = `${k}: ${vv}`; mlist.appendChild(it); };
                    pushMetric('Total score', v.total);
                    // show chosen route (setup vs no-setup)
                    if (v.chosenRoute) pushMetric('Chosen route', v.chosenRoute);
                    if (v.chosenRoute === 'setup' && v.setupInfo){
                      try{
                        const si = v.setupInfo;
                        pushMetric('Setup move used', si.move || '(unknown)');
                        pushMetric('Safety tier', si.safetyTier || '(unknown)');
                        if (typeof si.dPercent === 'number') pushMetric('Max damage % used for thresholds', si.dPercent.toFixed(1) + '%');
                        // show boosts assumed and multipliers
                        const details = (si.details && si.details.setupInfo) ? si.details.setupInfo : null;
                        if (details){
                          const mk = (st)=>{ return Math.min(4.0, 1.0 + 0.5 * st); };
                          if (details.atk) pushMetric('Assumed Attack stages', `+${details.atk} -> x${mk(details.atk).toFixed(2)}`);
                          if (details.spa) pushMetric('Assumed Sp. Atk stages', `+${details.spa} -> x${mk(details.spa).toFixed(2)}`);
                          if (details.def) pushMetric('Assumed Defense stages', `+${details.def} -> x${mk(details.def).toFixed(2)}`);
                          if (details.spd) pushMetric('Assumed Sp. Def stages', `+${details.spd} -> x${mk(details.spd).toFixed(2)}`);
                          if (details.spe) pushMetric('Assumed Speed stages', `+${details.spe} -> x${mk(details.spe).toFixed(2)}`);
                          if (details.hpDeltaPct) pushMetric('HP change from move', `${(details.hpDeltaPct*100).toFixed(0)}%`);
                        }
                        if (si.sweepDetails && si.sweepDetails.dr){
                          // show the post-setup move used and its damage
                          try{ const sd = si.sweepDetails; pushMetric('Post-setup sweep move', sd.move || (sd.dr && sd.dr.move) || '(none)'); }catch(e){}
                        }
                      }catch(e){ }
                    }
                    // If this cell was calculated assuming a prior safe setup against an earlier party mon,
                    // display the assumed boost metadata (applied to remaining party members).
                    if (v.assumedSetupBoost){
                      try{
                        const a = v.assumedSetupBoost;
                        pushMetric('Assumed prior setup', `Applied from column ${a.boostedFrom} — move ${a.sourceMove || '(unknown)'}`);
                        const sd = a.setupDetails || null;
                        if (sd){ const mk = (st)=> Math.min(4.0, 1.0 + 0.5 * st); if (sd.atk) pushMetric('Assumed Attack multiplier', `x${mk(6).toFixed(2)} (assumed +6)`); if (sd.spa) pushMetric('Assumed Sp. Atk multiplier', `x${mk(6).toFixed(2)} (assumed +6)`); /* always show assumed speed multiplier for propagated boosts */ pushMetric('Assumed Speed multiplier', `x${mk(6).toFixed(2)} (assumed +6)`); if (sd.hpDeltaPct) pushMetric('Assumed HP change', `${(sd.hpDeltaPct*100).toFixed(0)}%`); }
                      }catch(e){}
                    }
                    if (v.reason) pushMetric('Reason', v.reason);
                    pushMetric('Offense points', v.offense);
                    pushMetric('Defense points', v.defense);
                    pushMetric('Speed points', v.speed);
                    try{ const tm = teamMons[ri]; if (tm){ const boosted = (tm.statsFinal && typeof tm.statsFinal.spe === 'number') ? tm.statsFinal.spe : null; const before = (tm.statsFinal && typeof tm.statsFinal.speBeforeDynamo === 'number') ? tm.statsFinal.speBeforeDynamo : null; if (before != null && boosted != null && tm.dynamoApplied){ pushMetric('Attacker speed', `${before} -> ${boosted} (Dynamo ×1.10 applied)`); } else if (boosted != null) pushMetric('Attacker speed', boosted); } }catch(e){}
                    if (v.hitsToKOUser != null) pushMetric('Hits to KO (user -> enemy)', v.hitsToKOUser);
                    if (v.hitsToKOEnemy != null) pushMetric('Hits to KO (enemy -> user)', v.hitsToKOEnemy);
                    if (v.userExpected != null) {
                      let txt = v.userExpected.toFixed(2);
                      try{
                        const dr = v.userBestMove && v.userBestMove.dr ? v.userBestMove.dr : null;
                        if (dr && dr.defender && dr.defender.hp){ const pct = (dr.expected / dr.defender.hp) * 100; txt += ` (${pct.toFixed(1)}%)`; }
                      }catch(e){}
                      pushMetric('User expected damage per best move', txt);
                    }
                    if (v.enemyExpected != null) {
                      let txt = v.enemyExpected.toFixed(2);
                      try{
                        const dr = v.enemyBestDr ? v.enemyBestDr : null;
                        if (dr && dr.defender && dr.defender.hp){ const pct = (dr.expected / dr.defender.hp) * 100; txt += ` (${pct.toFixed(1)}%)`; }
                      }catch(e){}
                      pushMetric('Enemy expected damage per best move', txt);
                    }
                    if (v.userBestMove) {
                      try{
                        const dr = v.userBestMove.dr || null;
                        let suffix = '';
                        if (dr && dr.defender && dr.defender.hp){ const pct = (dr.expected / dr.defender.hp) * 100; suffix = ` (${pct.toFixed(1)}%)`; }
                        pushMetric('User best move', `${v.userBestMove.id} (expected ${v.userBestMove.expected || 0}${v.userBestMove.max ? `, max ${v.userBestMove.max}` : ''}${suffix})`);
                      }catch(e){ pushMetric('User best move', `${v.userBestMove.id} (expected ${v.userBestMove.expected || 0}${v.userBestMove.max ? `, max ${v.userBestMove.max}` : ''})`); }
                    }
                    if (v.enemyBestMove) pushMetric('Enemy best move', v.enemyBestMove);
                    content.appendChild(mlist);
                    const appendBreakdown = (titleText, dr, showMoveName)=>{
                      const block = document.createElement('div');
                      block.style.marginTop = '10px';
                      const t = document.createElement('div');
                      t.style.fontWeight = '700';
                      t.textContent = titleText;
                      block.appendChild(t);
                      const p = document.createElement('pre');
                      p.style.whiteSpace = 'pre-wrap';
                      p.style.fontSize = '12px';
                      p.style.margin = '6px 0';
                      const lines = [];
                      if (showMoveName && dr && dr.move) lines.push(`Move: ${dr.move}`);
                      if (dr){
                        lines.push(`Power: ${dr.power}`);
                        if (dr.type) lines.push(`Type: ${dr.type}`);
                        if (dr.category) lines.push(`Category: ${dr.category}`);
                        if (dr.attacker){
                          if (dr.category === 'physical') lines.push(`Attacker stats used: Atk=${dr.attacker.atkStat}, Level=${dr.attacker.level}`);
                          else if (dr.category === 'special') lines.push(`Attacker stats used: SpA=${dr.attacker.spaStat||'N/A'}, Level=${dr.attacker.level}`);
                          else lines.push(`Attacker stats used: Atk=${dr.attacker.atkStat}, SpA=${dr.attacker.spaStat||'N/A'}, Level=${dr.attacker.level}`);
                        }
                        if (dr.defender){
                          if (dr.category === 'physical') lines.push(`Defender stats used: Def=${dr.defender.defStat}, HP=${dr.defender.hp}`);
                          else if (dr.category === 'special') lines.push(`Defender stats used: SpD=${dr.defender.spdStat||'N/A'}, HP=${dr.defender.hp}`);
                          else lines.push(`Defender stats used: Def=${dr.defender.defStat}, SpD=${dr.defender.spdStat||'N/A'}, HP=${dr.defender.hp}`);
                        }
                        lines.push(`Raw base (game formula): ${dr.rawBase}`);
                        lines.push(`STAB: ${dr.stab}`);
                        // Compute effectiveness display: include ability-driven modifiers like Thick Fat
                        try{
                          const effBase = (typeof dr.effectivenessBase !== 'undefined') ? dr.effectivenessBase : dr.effectiveness;
                          let effMultiplier = 1.0;
                          const effAbilityNames = [];
                          if (dr.appliedAbilities && Array.isArray(dr.appliedAbilities)){
                            for (const a of dr.appliedAbilities){
                              if (a && a.ability === 'ABILITY_THICK_FAT'){
                                effMultiplier *= 0.5;
                                effAbilityNames.push(prettyAbility(a.ability));
                              }
                            }
                          }
                          const finalEff = effBase * effMultiplier;
                          if (effAbilityNames.length){
                            const note = effAbilityNames.join(', ');
                            lines.push(`Effectiveness: ${finalEff} (${effBase} * ${note} ability)`);
                          } else {
                            lines.push(`Effectiveness: ${finalEff}`);
                          }
                          const combined = (dr.stab || 1) * finalEff;
                          lines.push(`Combined modifier (STAB * effectiveness): ${combined.toFixed(3)}`);
                        }catch(e){
                          lines.push(`Effectiveness: ${dr.effectiveness}`);
                          lines.push(`Combined modifier (STAB * effectiveness): ${dr.modifier.toFixed(3)}`);
                        }
                        if (dr.badgesApplied && dr.badgesApplied.length) lines.push(`Badge multiplier: ${dr.badgeMultiplier.toFixed(3)} (applied: ${dr.badgesApplied.join(', ')})`);
                        lines.push(`True base after modifiers (floored): ${dr.trueBase}`);
                        lines.push(`Rolls (85..100): ${dr.rolls.join(', ')}`);
                        try{
                          const pct = (dr.defender && dr.defender.hp) ? (dr.expected / dr.defender.hp) * 100 : null;
                          lines.push(`min: ${dr.min}, max: ${dr.max}, expected (mean): ${dr.expected.toFixed(2)}${pct!=null ? ` (${pct.toFixed(1)}%)` : ''}`);
                        }catch(e){
                          lines.push(`min: ${dr.min}, max: ${dr.max}, expected (mean): ${dr.expected.toFixed(2)}`);
                        }
                      }
                      p.textContent = lines.join('\n');
                      block.appendChild(p);
                      content.appendChild(block);
                    };
                    if (v.userBestMove && v.userBestMove.dr) appendBreakdown('User best move damage breakdown', v.userBestMove.dr, true);
                    if (v.enemyBestDr){ if (v.enemyBestMove) v.enemyBestDr.move = v.enemyBestMove; appendBreakdown('Enemy best move damage breakdown', v.enemyBestDr, true); }
                    box.appendChild(content); modal.appendChild(box); modal.addEventListener('click', (evt)=>{ if (evt.target === modal) modal.remove(); }); document.body.appendChild(modal);
                  });
                }
                tr.appendChild(cell);
              }
              tbody.appendChild(tr);
            }
            const bestRow = document.createElement('tr'); const bestLabel = document.createElement('td'); bestLabel.textContent = 'Best Score'; bestLabel.style.fontWeight='700'; bestLabel.style.padding='6px'; bestRow.appendChild(bestLabel);
            const bests = [];
            for (let ci=0; ci<partyStates.length; ci++){ let best = -Infinity; for (let ri=0; ri<matrix.length; ri++){ const v = matrix[ri][ci]; if (v && v.total > best) best = v.total; } if (!isFinite(best) || best === -Infinity) best = '—'; bests.push(best); const bc = document.createElement('td'); bc.style.padding='6px'; bc.style.textAlign='center'; bc.textContent = (best==='—')? '—' : String(best); bestRow.appendChild(bc); }
            tbody.appendChild(bestRow);
            table.appendChild(tbody); wrap.appendChild(table); card.appendChild(wrap);
            const numericBests = bests.filter(x=>typeof x === 'number'); const avg = numericBests.length ? (numericBests.reduce((a,b)=>a+b,0)/numericBests.length) : null;
            const scoreEl = trainerScoreEls.get(t.name);
            if (avg != null && scoreEl){ scoreEl.textContent = `Score: ${avg.toFixed(2)}/10`; trainerScoreEls.set(t.name, scoreEl); }
          }catch(e){ console.debug('Auto-Fill: failed to render matrix for', t.name, e); }
        }catch(err){ console.debug('Auto-Fill: error computing trainer via button for', t.name, err); }
      }
    }finally{
      __autoFillProgressEl.style.display = 'none';
      __autoFillProgressEl.textContent = '';
      // compute an aggregate team score from visible trainer score elements
      try{
        const nums = [];
        for (const t of trainersList){
          const el = trainerScoreEls.get(t.name);
          if (!el) continue;
          const m = String(el.textContent || '').match(/Score:\s*([0-9.]+)\/10/);
          if (m && m[1]) nums.push(parseFloat(m[1]));
        }
        if (nums.length){
          const avg = nums.reduce((a,b)=>a+b,0)/nums.length;
          __teamScoreText.textContent = `Team score: ${avg.toFixed(2)}/10`;
          __teamScoreNote.textContent = 'Set exact moves below and recalibrate score for a more precise score.';
          __teamScoreBanner.style.display = 'flex';
        } else {
          __teamScoreText.textContent = 'Team score: —';
          __teamScoreNote.textContent = 'No numeric scores were produced. Try recalculating an individual trainer.';
          __teamScoreBanner.style.display = 'flex';
        }
      }catch(e){ console.debug('Auto-Fill: failed to compute team score banner', e); }
    }
  });

  // then render trainers below
  for (const t of trainers){
    appContainer.appendChild(createTrainerCard(t, speciesList));
  }
});

// --- Planned Team (top-of-page team input) ---
function createPlannedTeamArea(speciesList){
  const wrapper = document.createElement('div');
  wrapper.className = 'panel';
  wrapper.style.marginBottom = '12px';

  const h = document.createElement('h3');
  h.textContent = 'Planned Team';
  wrapper.appendChild(h);

  const note = document.createElement('div');
  note.className = 'muted';
  note.textContent = 'Choose up to 6 Pokémon for your playthrough team. Base stats and typing shown for comparison.';
  note.style.marginBottom = '8px';
  wrapper.appendChild(note);

  const grid = document.createElement('div');
  grid.className = 'planned-grid';

  // Do NOT persist planned-team choices by default to avoid stale / cached user state.
  // Use transient in-memory arrays only.
  const storageKey = 'emerald_planned_team';
  let saved = [];
  const storageKeyNatures = 'emerald_planned_team_natures';
  let savedNatures = [];
  const storageKeyAbilities = 'emerald_planned_team_abilities';
  let savedAbilities = [];
  try{ savedAbilities = window.__emerald_planned_team_abilities || []; }catch(e){}

  for (let i=0;i<6;i++){
    const slot = document.createElement('div');
    slot.style.border = '1px solid #eee';
    slot.style.padding = '8px';
    slot.style.borderRadius = '6px';
    slot.style.background = '#fafafa';
    slot.style.minWidth = '0';

    const preview = document.createElement('img');
    preview.style.width = '64px';
    preview.style.height = '64px';
    preview.style.objectFit = 'contain';
    preview.style.background = '#fff';
    preview.style.display = 'block';
    preview.style.marginBottom = '6px';
    slot.appendChild(preview);

    const { wrapper: spWrap, input: spInput } = createInput('Species');
    spInput.placeholder = 'Type to search species...';
    spInput.autocomplete = 'off';
    spWrap.style.position = 'relative';
    spWrap.appendChild(document.createElement('div'));

    const list = document.createElement('div');
    list.style.position = 'absolute';
    list.style.left = '0';
    list.style.right = '0';
    list.style.top = '58px';
    list.style.maxHeight = '160px';
    list.style.overflow = 'auto';
    list.style.background = 'white';
    list.style.border = '1px solid #eee';
    list.style.display = 'none';
    spWrap.appendChild(list);

    spInput.addEventListener('input', ()=>{
      const q = spInput.value.trim().toLowerCase();
      list.innerHTML = '';
      if (!q) { list.style.display = 'none'; return; }
      const matches = speciesList.filter(s=>s.toLowerCase().includes(q)).slice(0,20);
      for (const m of matches){
        const it = document.createElement('div');
        it.textContent = m;
        it.style.padding = '6px';
        it.style.cursor = 'pointer';
        it.addEventListener('click', ()=>{ spInput.value = m; list.style.display='none'; setSlotSpecies(i,m); });
        list.appendChild(it);
      }
      list.style.display = matches.length? 'block':'none';
    });

    slot.appendChild(spWrap);

    const contentWrap = document.createElement('div');
    contentWrap.style.display = 'flex';
    contentWrap.style.gap = '8px';
    // left: preview + basic info
    const leftCol = document.createElement('div');
    leftCol.style.width = '36%';
    leftCol.style.minWidth = '120px';
    leftCol.style.display = 'flex';
    leftCol.style.flexDirection = 'column';
    // compact species selector - insert into left column
    spWrap.style.marginBottom = '4px';
    spWrap.style.width = '110px';
    const spLabel = spWrap.querySelector('label');
    if (spLabel) { spLabel.style.fontSize = '11px'; spLabel.style.marginBottom = '2px'; }
    spInput.style.fontSize = '13px';
    spInput.style.padding = '4px';
    spInput.style.width = '100%';
    leftCol.appendChild(spWrap);
    preview.style.marginTop = '4px';
    leftCol.appendChild(preview);
    const info = document.createElement('div');
    info.style.fontSize = '13px';
    info.style.marginTop = '6px';
    info.textContent = 'Type: —';
    leftCol.appendChild(info);

    // Nature selector (Planned Team slot)
    const { wrapper: natWrap, sel: natSel } = createSelect('Nature', ['(none)', ...NATURES]);
    natWrap.style.marginTop = '6px';
    natSel.style.fontSize = '13px';
    leftCol.appendChild(natWrap);

    // Ability selector (Planned Team slot) - will be populated when species is selected
    const { wrapper: abilityWrap, sel: abilitySel } = createSelect('Ability', []);
    abilityWrap.style.marginTop = '6px';
    abilitySel.style.fontSize = '13px';
    leftCol.appendChild(abilityWrap);

    // right: stat bars
    const statContainer = createStatBarsContainer();
    statContainer.style.width = '64%';
    statContainer.style.minWidth = '140px';

    // (exact computed stats for planned team removed - shown in trainer slots)

    contentWrap.appendChild(leftCol);
    contentWrap.appendChild(statContainer);
    slot.appendChild(contentWrap);

    grid.appendChild(slot);

    async function setSlotSpecies(idx, name){
      spInput.value = name;
      // set preview sprite
      const num = getSpriteNumberForSpeciesName(name);
      if (num) preview.src = `src/Sprites/Frame1Front/${num}.png`;
      else preview.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
      // load species data for base stats and typing
      const id = name.toLowerCase().replace(/[^a-z0-9]/g,'');
      const data = await loadSpeciesData(id);
      if (data && data.baseStats){
        const b = data.baseStats;
        const selNat = (savedNatures[idx] && savedNatures[idx] !== '(none)') ? savedNatures[idx] : null;
        renderStatBars(statContainer, b, selNat);
        // compute exact stats for planned slot using default IV=31, EVs=0, Level=50
        try{
          const out = calcAllStatsGen3({ baseStats: b, ivs: {hp:15,atk:15,def:15,spa:15,spd:15,spe:15}, evs: {hp:0,atk:0,def:0,spa:0,spd:0,spe:0}, level:50, nature: selNat||'Hardy' });
          // planned-team exact stats display intentionally omitted (use trainer slot view)
        }catch(e){ /* ignore */ }
      } else {
        // try species_info.h fallback
        const info = await getSpeciesInfoByName(name);
        if (info && info.info && info.info.baseStats){
          const b = info.info.baseStats;
          const selNat = (savedNatures[idx] && savedNatures[idx] !== '(none)') ? savedNatures[idx] : null;
          renderStatBars(statContainer, b, selNat);
          try{
            const out = calcAllStatsGen3({ baseStats: b, ivs: {hp:15,atk:15,def:15,spa:15,spd:15,spe:15}, evs: {hp:0,atk:0,def:0,spa:0,spd:0,spe:0}, level:50, nature: selNat||'Hardy' });
            // planned-team exact stats display intentionally omitted
          }catch(e){ /* ignore */ }
        } else {
          statContainer.textContent = 'Base: —';
        }
      }
      if (data && data.types){
        renderTypeBadges(info, data.types);
      } else {
        const info2 = await getSpeciesInfoByName(name);
        if (info2 && info2.info && info2.info.types){
          renderTypeBadges(info, info2.info.types);
        } else {
          info.textContent = 'Type: —';
        }
      }
      // planned-team exact stats UI intentionally omitted; no change handler needed
      // do NOT persist to localStorage by default; keep only in-memory
      saved[idx] = name;
      try{ window.__emerald_planned_team = saved; }catch(e){}

      // populate ability selector for this species using species JSON or species_info.h
      (async ()=>{
        try{
          let abilities = null;
          if (data && Array.isArray(data.abilities) && data.abilities.length>0) abilities = data.abilities;
          if (!abilities){
            const si = await getSpeciesInfoByName(name);
            if (si && si.info && Array.isArray(si.info.abilities)) abilities = si.info.abilities;
          }
          // clear current options
          abilitySel.innerHTML = '';
          // filter out ABILITY_NONE entries and add available abilities
          const clean = (abilities && abilities.length) ? abilities.filter(a=>a && a !== 'ABILITY_NONE') : [];
          if (clean.length){
            for (const a of clean){
              const opt = document.createElement('option'); opt.value = a; opt.textContent = prettyAbility(a); abilitySel.appendChild(opt);
            }
          }
          // choose default: prefer saved value if it exists in the new options,
          // otherwise select the first available ability (if any)
          let sv = savedAbilities[idx];
          if (sv && !clean.includes(sv)) sv = null;
          if (!sv) sv = (clean.length ? clean[0] : null);
          if (sv) abilitySel.value = sv;
          // persist default selection into savedAbilities/window global
          savedAbilities[idx] = sv || null;
          try{ window.__emerald_planned_team_abilities = savedAbilities; }catch(e){}
        }catch(e){ /* ignore */ }
      })();
    }

    // handle nature changes
    natSel.addEventListener('change', async ()=>{
      const val = natSel.value;
      if (!val || val === '(none)') savedNatures[i] = null; else savedNatures[i] = val;
      try{ window.__emerald_planned_team_natures = savedNatures; }catch(e){}
      // re-render stats with new nature coloring
      const cur = spInput.value;
      if (!cur) return;
      const id = cur.toLowerCase().replace(/[^a-z0-9]/g,'');
      const data = await loadSpeciesData(id);
      const selNat = (savedNatures[i] && savedNatures[i] !== '(none)') ? savedNatures[i] : null;
      if (data && data.baseStats){ renderStatBars(statContainer, data.baseStats, selNat); if (data.types) renderTypeBadges(info, data.types); return; }
      const si = await getSpeciesInfoByName(cur);
      if (si && si.info && si.info.baseStats) {
        renderStatBars(statContainer, si.info.baseStats, selNat);
        if (si.info.types) renderTypeBadges(info, si.info.types);
      }
    });

    // hydrate from saved
    if (saved[i]){
      setSlotSpecies(i, saved[i]);
      // restore nature selection if present
      const sn = savedNatures[i] || '(none)';
      natSel.value = sn;
      // restore ability selection if present (will be respected when species populates options)
      // (no immediate action here to avoid racing with async species parsing)
    }

    // handle ability changes for planned slot
    abilitySel.addEventListener('change', ()=>{
      const av = abilitySel.value;
      savedAbilities[i] = av || null;
      try{ window.__emerald_planned_team_abilities = savedAbilities; }catch(e){}
    });
  }

  wrapper.appendChild(grid);
  return wrapper;
}

