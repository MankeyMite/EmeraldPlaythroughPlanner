import { normalizeTrainerIVs, loadTrainer } from './lib/trainerLoader.js';
import { SPECIES_NATIONAL } from './lib/PokémonNationalDexNr.js';

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
    const res = await fetch('src/data/raw/species_info.h');
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
        const r = new RegExp('\\.'+k+'\\s*=\\s*(\\d+)', 'i');
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
  for (const [label,key] of order){
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
  const res = await fetch(TRAINERS_JSON);
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
    const res = await fetch('src/lib/speciesIndex.json');
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
    const res = await fetch(path);
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
    const res = await fetch('src/data/raw/level_up_learnsets.h');
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
    const res = await fetch('src/data/raw/tmhm_learnsets.h');
    if (!res.ok) return _tmhmLearnsets;
    const text = await res.text();
    const re = /\[\s*(SPECIES_[A-Z0-9_]+)\s*\]\s*=\s*\{\s*\.learnset\s*=\s*\{([\s\S]*?)\}\s*\}/g;
    let m;
    while((m = re.exec(text))){
      const token = m[1];
      const body = m[2];
      const moves = Array.from(body.matchAll(/\.([A-Z0-9_]+)\s*=\s*TRUE/g)).map(x=>x[1]);
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
    const res = await fetch('src/data/raw/evolution.h');
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
  return max;
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

async function devolveSpeciesToLegalAtLevel(nameOrToken, level){
  const evoTable = await loadEvolutions();
  const rev = buildReverseEvolutionMap(evoTable);
  // normalize incoming to a token if a name was provided
  let token = nameOrToken;
  if (!/^SPECIES_/.test(nameOrToken)){
    const variants = nameToTokenVariants(nameOrToken);
    token = variants.length ? variants[0] : ('SPECIES_' + nameOrToken.toUpperCase().replace(/[^A-Z0-9]/g,'_'));
  }
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
  return chosen;
}

// expose helpers for debugging in browser console
window.computeBattleLevel = computeBattleLevel;
window.devolveSpeciesToLegalAtLevel = devolveSpeciesToLegalAtLevel;

// --- STAB move selection and TM availability windows ---
let _tmAvailabilityMap = null; // { trainerName: Set([TM_NAME,...]) }
function setTMAvailabilityMap(map){ _tmAvailabilityMap = map; }
window.setTMAvailabilityMap = setTMAvailabilityMap;

function getAvailableTMsForTrainer(trainer){
  if (_tmAvailabilityMap && trainer && trainer.name && _tmAvailabilityMap[trainer.name]){
    return new Set(_tmAvailabilityMap[trainer.name]);
  }
  // default: all TMs available
  return null;
}

// small heuristic move power and move->type map for common Gen3 moves
const MOVE_POWER = {
  'MOVE_SOLAR_BEAM':120,'MOVE_FLAMETHROWER':90,'MOVE_FIRE_BLAST':110,'MOVE_SURF':95,'MOVE_HYDRO_PUMP':120,'MOVE_EARTHQUAKE':100,'MOVE_THUNDERBOLT':95,'MOVE_THUNDER':110,'MOVE_HYPER_BEAM':150,'MOVE_PSYCHIC':90,'MOVE_ICE_BEAM':90,'MOVE_BLIZZARD':110,'MOVE_SLUDGE_BOMB':90,'MOVE_ICE_PUNCH':75,'MOVE_THUNDER_PUNCH':75,'MOVE_RETURN':102,'MOVE_SHADOW_BALL':80,'MOVE_SLUDGE':55,'MOVE_BRICK_BREAK':75,'MOVE_SLASH':70,'MOVE_DRAGON_RAGE':0
};
const MOVE_TYPE = {
  'MOVE_SOLAR_BEAM':'grass','MOVE_FLAMETHROWER':'fire','MOVE_FIRE_BLAST':'fire','MOVE_SURF':'water','MOVE_HYDRO_PUMP':'water','MOVE_EARTHQUAKE':'ground','MOVE_THUNDERBOLT':'electric','MOVE_THUNDER':'electric','MOVE_PSYCHIC':'psychic','MOVE_ICE_BEAM':'ice','MOVE_BLIZZARD':'ice','MOVE_SLUDGE_BOMB':'poison','MOVE_DRAGON_RAGE':'dragon','MOVE_BRICK_BREAK':'fighting','MOVE_SLASH':'normal','MOVE_RETURN':'normal','MOVE_SHADOW_BALL':'ghost'
};

function isStatusMove(moveToken){
  const statusKeywords = ['GROWL','TAIL_WHIP','SYNTHESIS','GROWTH','SLEEP','POWDER','TOXIC','HYPER_BEAM','ROAR','REST','SAND_ATTACK','CONFUSION','AGILITY','SANDSTORM','DOUBLE_TEAM','TELEPORT','LOCK_ON','MORNING_SUN'];
  for (const k of statusKeywords){ if (moveToken.includes(k)) return true; }
  return false;
}

async function selectBestSTABMove(speciesNameOrToken, level, trainer=null){
  const lvlSets = await loadLevelUpLearnsetsH();
  const tmSets = await loadTMHMLearnsetsH();
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
  for (const mv of levelMoves){ if (!isStatusMove(mv)) candidates.push({ move: mv, source: 'level' }); }
  for (const mv of tmMoves){ if (!isStatusMove(mv)){
    if (availableTMs === null || availableTMs.has(mv) ) candidates.push({ move: mv, source: 'tm' });
  }}

  // score candidates: STAB moves get bonus; prefer higher power
  function scoreMove(moveToken){
    const power = MOVE_POWER[moveToken] || 50;
    const mtype = MOVE_TYPE[moveToken] || null;
    const stab = (mtype && types.includes(mtype)) ? 50 : 0;
    return power + stab;
  }

  if (candidates.length === 0){
    // fallback: allow status moves or any available level/tm move
    if (levelMoves.length) return levelMoves[0];
    if (tmMoves.length) return tmMoves[0];
    return null;
  }
  candidates.sort((a,b)=>scoreMove(b.move) - scoreMove(a.move));
  return candidates[0].move;
}

window.selectBestSTABMove = selectBestSTABMove;

// --- Load battle moves (power/type/accuracy/flags) ---
let _battleMoves = null;
async function loadBattleMovesH(){
  if (_battleMoves) return _battleMoves;
  _battleMoves = {};
  try{
    const res = await fetch('src/data/raw/battle_moves.h');
    if (!res.ok) return _battleMoves;
    const text = await res.text();
    const re = /\[\s*(MOVE_[A-Z0-9_]+)\s*\]\s*=\s*\{([\s\S]*?)\n\s*\},/g;
    let m;
    while((m = re.exec(text))){
      const move = m[1];
      const body = m[2];
      const getNum = (k) => { const mm = body.match(new RegExp('\\.'+k+'\s*=\s*([0-9]+)','i')); return mm? parseInt(mm[1],10): null; };
      const power = getNum('power');
      const accuracy = getNum('accuracy');
      const pp = getNum('pp');
      const sec = getNum('secondaryEffectChance');
      const typeMatch = body.match(/\.type\s*=\s*TYPE_([A-Z0-9_]+)/i);
      const type = typeMatch ? typeMatch[1].toLowerCase() : null;
      const flagsMatch = body.match(/\.flags\s*=\s*([^,}]+)/i);
      const flags = [];
      if (flagsMatch){ const f = flagsMatch[1]; const found = Array.from(f.matchAll(/FLAG_[A-Z0-9_]+/g)).map(x=>x[0]); found.forEach(x=>flags.push(x)); }
      _battleMoves[move] = { move, power, accuracy, pp, secondaryEffectChance: sec, type, flags };
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
const SPECIAL_TYPES = new Set(['fire','water','electric','grass','ice','psychic','dragon','dark','ghost']);

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
  const atkHP = computeStatFromBase(atkBase.hp, options.attIV||31, options.attEV||0, attackerLevel, true);
  const defHP = computeStatFromBase(defBase.hp, options.defIV||31, options.defEV||0, defenderLevel, true);

  // resolve move data
  const m = (movesMap && movesMap[moveToken]) ? movesMap[moveToken] : null;
  const fallbackPower = MOVE_POWER[moveToken] || (m? m.power : 50) || 50;
  const power = (m && m.power) || fallbackPower;
  const mtype = (m && m.type) || MOVE_TYPE[moveToken] || null;
  const isSpecial = mtype ? SPECIAL_TYPES.has(mtype) : false;

  const A = isSpecial ? computeStatFromBase(atkBase.spa, options.attIV||31, options.attEV||0, attackerLevel, false) : computeStatFromBase(atkBase.atk, options.attIV||31, options.attEV||0, attackerLevel, false);
  const D = isSpecial ? computeStatFromBase(defBase.spd, options.defIV||31, options.defEV||0, defenderLevel, false) : computeStatFromBase(defBase.def, options.defIV||31, options.defEV||0, defenderLevel, false);

  const base = Math.floor(((((2*attackerLevel)/5 + 2) * power * A / D) / 50) + 2);
  let modifier = 1.0;
  // STAB
  if (mtype && atkInfo.info.types && atkInfo.info.types.includes(mtype)) modifier *= 1.5;
  // type effectiveness
  const defTypes = defInfo.info.types || [];
  modifier *= typeEffectiveness(mtype, defTypes);

  const trueBase = Math.max(1, Math.floor(base * modifier));
  const mults = _gen3RandomMultipliers();
  const rolls = mults.map(mv => Math.max(1, Math.floor(trueBase * mv)));
  const min = Math.min(...rolls);
  const max = Math.max(...rolls);
  const expected = rolls.reduce((a,b)=>a+b,0)/rolls.length;
  return { rolls, min, max, expected, ohkoGuaranteed: min >= defHP, ohkoPossible: max >= defHP, power, type: mtype, defHP };
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
      const dmg = await calcDamageRange(enemyMon.species, enemyMon.lvl || enemyMon.level || 50, ourMon.species, ourMon.level || 50, mv, context);
      candidates.push({ move: mv, expected: dmg.expected, max: dmg.max });
    }
  }
  // fallback: use selectBestSTABMove if no explicit moves listed
  if (candidates.length === 0){
    const mv = await selectBestSTABMove(enemyMon.species, enemyMon.lvl || enemyMon.level || 50, null);
    if (mv){
      const dmg = await calcDamageRange(enemyMon.species, enemyMon.lvl || enemyMon.level || 50, ourMon.species, ourMon.level || 50, mv, context);
      candidates.push({ move: mv, expected: dmg.expected, max: dmg.max });
    }
  }
  if (candidates.length === 0) return { expectedDamage: 0, maxDamage: 0, canDamage: false };
  candidates.sort((a,b)=>b.expected - a.expected);
  const best = candidates[0];
  return { expectedDamage: best.expected, maxDamage: best.max, canDamage: best.max > 0 };
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
    const dmg = await calcDamageRange(A.species, A.level || A.lvl || 50, B.species, B.level || B.lvl || 50, mv, context);
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
  const lvlSets = await loadLevelUpLearnsetsH();
  const tmSets = await loadTMHMLearnsetsH();
  const teamMons = [];
  if (!plannedTeam || plannedTeam.length === 0) return 0;
  // load saved natures for planned team
  let savedNatures = [];
  try{ savedNatures = JSON.parse(localStorage.getItem('emerald_planned_team_natures') || '[]'); }catch(e){ savedNatures = []; }
  for (let i=0;i<6;i++){
    const name = plannedTeam[i];
    if (!name) continue;
    const chosenToken = await devolveSpeciesToLegalAtLevel(name, battleLevel);
    const displayName = prettySpecies(chosenToken).toLowerCase();
    const si = await getSpeciesInfoByName(displayName) || await getSpeciesInfoByName(chosenToken);
    if (!si || !si.info || !si.info.baseStats){
      console.debug('computeTrainerScore: missing species info for planned slot', i, name, '-> token', chosenToken);
      continue;
    }
    if (!si || !si.info || !si.info.baseStats) continue;
    const base = si.info.baseStats;
    const statsFinal = {
      hp: computeStatFromBase(base.hp, 31, 0, battleLevel, true),
      atk: computeStatFromBase(base.atk, 31, 0, battleLevel, false),
      def: computeStatFromBase(base.def, 31, 0, battleLevel, false),
      spa: computeStatFromBase(base.spa, 31, 0, battleLevel, false),
      spd: computeStatFromBase(base.spd, 31, 0, battleLevel, false),
      spe: computeStatFromBase(base.spe, 31, 0, battleLevel, false)
    };
    // apply nature if present
    const chosenNature = savedNatures[i] || null;
    if (chosenNature && NATURE_MODS[chosenNature]){
      const mod = NATURE_MODS[chosenNature];
      if (mod.up && statsFinal[mod.up] != null) statsFinal[mod.up] = Math.floor(statsFinal[mod.up] * 1.1);
      if (mod.down && statsFinal[mod.down] != null) statsFinal[mod.down] = Math.floor(statsFinal[mod.down] * 0.9);
    }
    // assemble candidate moves (top 4 by power+stab)
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
    // fallback: if no candidates found (learnsets/tm mismatch), try selectBestSTABMove
    if (moveset.length === 0){
      const fallback = await selectBestSTABMove(chosenToken, battleLevel, null);
      if (fallback){
        moveset = [fallback];
        console.debug('computeTrainerScore: fallback move for', chosenToken, '->', fallback);
      } else {
        console.debug('computeTrainerScore: no moves available for', chosenToken, 'at level', battleLevel);
      }
    }

    teamMons.push({ species: chosenToken, level: battleLevel, statsFinal, moveset });
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
    partyStates.push({ species: enemy.species, level: lvl, statsFinal: st, moves: enemy.moves || [] });
  }

  if (teamMons.length === 0){
    console.debug('computeTrainerScore: no valid teamMons built from plannedTeam', plannedTeam);
    return 0;
  }
  console.debug('computeTrainerScore: evaluating trainer', trainer.name, 'teamMons', teamMons.map(m=>m.species), 'partySize', partyStates.length);
  const score = await scoreTeamVsTrainer(teamMons, partyStates, { enableFatigue: true });
  console.debug('computeTrainerScore: score for', trainer.name, '->', score);
  return score; // 1..10
}

// Build planned team MonState objects (used by scoring and UI breakdown)
async function buildPlannedTeamMonStates(plannedTeam, trainer){
  const battleLevel = computeBattleLevel(trainer);
  const lvlSets = await loadLevelUpLearnsetsH();
  const tmSets = await loadTMHMLearnsetsH();
  const teamMons = [];
  if (!plannedTeam || plannedTeam.length === 0) return teamMons;
  let savedNatures = [];
  try{ savedNatures = JSON.parse(localStorage.getItem('emerald_planned_team_natures') || '[]'); }catch(e){ savedNatures = []; }
  for (let i=0;i<6;i++){
    const name = plannedTeam[i];
    if (!name) continue;
    const chosenToken = await devolveSpeciesToLegalAtLevel(name, battleLevel);
    const si = await getSpeciesInfoByName(prettySpecies(chosenToken).toLowerCase()) || await getSpeciesInfoByName(chosenToken);
    if (!si || !si.info || !si.info.baseStats) continue;
    const base = si.info.baseStats;
    const statsFinal = {
      hp: computeStatFromBase(base.hp, 31, 0, battleLevel, true),
      atk: computeStatFromBase(base.atk, 31, 0, battleLevel, false),
      def: computeStatFromBase(base.def, 31, 0, battleLevel, false),
      spa: computeStatFromBase(base.spa, 31, 0, battleLevel, false),
      spd: computeStatFromBase(base.spd, 31, 0, battleLevel, false),
      spe: computeStatFromBase(base.spe, 31, 0, battleLevel, false)
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
    partyStates.push({ species: enemy.species, level: lvl, statsFinal: st, moves: enemy.moves || [] });
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
      const dr = await calcDamageRange(best.chosenMon.species, best.chosenMon.level, enemy.species, enemy.level, best.chosenEval.bestMoveId, {});
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
  infoRow.style.display = 'grid';
  infoRow.style.gridTemplateColumns = 'repeat(6, 1fr)';
  infoRow.style.gap = '8px';
  infoRow.style.marginBottom = '8px';

  // populate info cards for each trainer pokemon
  trainer.pokemons.forEach((p)=>{
    const id = prettyId(p.species);
    const speciesName = prettySpecies(p.species);
    const info = document.createElement('div');
    info.style.border = '1px solid #eee';
    info.style.padding = '6px';
    info.style.borderRadius = '6px';
    info.style.background = '#fff';
    info.style.minWidth = '0';

    const img = document.createElement('img');
    img.alt = speciesName;
    img.style.width = '64px';
    img.style.height = '64px';
    img.style.objectFit = 'contain';
    img.style.background = '#f0f0f0';
    img.style.display = 'block';
    img.style.marginBottom = '6px';
    // choose sprite based on species numeric mapping (apply Gen3 offset)
    const spriteNum = getSpriteNumberForSpeciesName(speciesName);
    if (spriteNum) {
      img.src = `src/Sprites/Frame1Front/${spriteNum}.png`;
    } else {
      img.src = `src/assets/sprites/${id}.png`;
    }
    info.appendChild(img);

    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = speciesName + ` (Lv ${p.lvl})`;
    info.appendChild(title);


    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.style.fontSize = '12px';
    meta.textContent = `IV: ${p.iv != null ? p.iv : '—'}${p.nature ? ' • ' + p.nature : ''}`;
    info.appendChild(meta);

    // moves: display as 2x2 colored grid
    const movesGrid = document.createElement('div');
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
      cell.style.minHeight = '34px';
      cell.style.display = 'flex';
      cell.style.flexDirection = 'column';
      cell.style.justifyContent = 'center';
      cell.style.alignItems = 'center';
      cell.style.borderRadius = '6px';
      cell.style.border = '2px solid #eee';
      cell.style.background = '#fafafa';
      cell.style.fontSize = '12px';
      cell.style.padding = '4px';
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
    try{ planned = JSON.parse(localStorage.getItem('emerald_planned_team') || '[]'); }catch(e){ planned = []; }
    const sc = await computeTrainerScore(trainer, planned);
    if (sc === 0){
      scoreEl.textContent = `Score: —`;
      console.debug('Trainer score computed as 0 for', trainer.name, 'planned', planned, ' — check learnsets/moves parsing.');
    } else {
      scoreEl.textContent = `Score: ${sc.toFixed(2)}/10`;
    }
    // also render per-enemy breakdown under this card
    try{
      const teamMons = await buildPlannedTeamMonStates(planned, trainer);
      const partyStates = await buildTrainerPartyStates(trainer);
      const perEnemy = await computePerEnemyBest(teamMons, partyStates, { enableFatigue: true });
      // create breakdown container
      const breakdown = document.createElement('div');
      breakdown.style.marginTop = '8px';
      breakdown.style.borderTop = '1px solid #f0f0f0';
      breakdown.style.paddingTop = '8px';
      const title = document.createElement('div'); title.textContent = 'Per-Enemy Breakdown'; title.style.fontWeight = '600'; title.style.marginBottom = '6px';
      breakdown.appendChild(title);
      for (const item of perEnemy){
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.marginBottom = '8px';
        const enemyName = document.createElement('div'); enemyName.textContent = prettySpecies(item.enemy.species) + ` (Lv ${item.enemy.level})`; enemyName.style.width='140px'; row.appendChild(enemyName);
        if (item.best && item.best.chosenMon){
          const chosen = document.createElement('div'); chosen.textContent = prettySpecies(item.best.chosenMon.species); chosen.style.width='120px'; row.appendChild(chosen);
          const move = document.createElement('div'); move.textContent = item.best.chosenEval ? (prettyMove(item.best.chosenEval.bestMoveId) || '—') : '—'; move.style.width='160px'; row.appendChild(move);
          const info = document.createElement('div');
          const ko = item.best.chosenEval ? item.best.chosenEval.koClass : '—';
          const os = item.best.chosenEval ? item.best.chosenEval.outspeeds : '—';
          const hpLoss = item.best.chosenEval ? (Math.round((item.best.chosenEval.hpLossPct||0)*100)) + '%' : '—';
          info.textContent = `Score ${item.best.score} • ${ko} • ${os} • HP loss ${hpLoss}`;
          info.style.flex='1';
          row.appendChild(info);
        } else {
          const none = document.createElement('div'); none.textContent = 'No answer'; row.appendChild(none);
        }
        // damage summary
        const dmg = document.createElement('div');
        if (item.damageInfo){ dmg.textContent = `DMG ${item.damageInfo.min}-${item.damageInfo.max} (avg ${Math.round(item.damageInfo.expected)})`; }
        else dmg.textContent = '';
        dmg.style.width = '140px'; row.appendChild(dmg);
        breakdown.appendChild(row);
      }
      card.appendChild(breakdown);
    }catch(e){ console.debug('Error rendering per-enemy breakdown for', trainer.name, e); }
  })();

  // team builder area - fixed 6 columns to match trainer info row
  const builder = document.createElement('div');
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

    // species search
    const { wrapper: spWrap, input: spInput } = createInput('Species');
    spInput.placeholder = 'Type to search species...';
    spInput.autocomplete = 'off';
    spWrap.style.position = 'relative';
    spWrap.style.width = '110px';
    spWrap.style.display = 'inline-block';
    // preview image for this slot
    const preview = document.createElement('img');
    preview.style.width = '48px';
    preview.style.height = '48px';
    preview.style.objectFit = 'contain';
    preview.style.background = '#f8f8f8';
    preview.style.display = 'block';
    preview.style.marginBottom = '6px';
    preview.alt = 'sprite';
    slot.appendChild(preview);
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
        it.addEventListener('click', ()=>{ spInput.value = m; list.style.display='none'; showBaseStats(m, slot); setSlotPreview(m); if (typeof populateMoveSelectsForSlot === 'function') populateMoveSelectsForSlot().catch(e=>console.debug('populateMoveSelectsForSlot error',e)); });
        list.appendChild(it);
      }
      list.style.display = matches.length? 'block':'none';
    });

    // move species selector into left column later to avoid it taking full-width top space
    // (we'll append it into `leftCol` after it's created)

    // base stats area
    const stats = document.createElement('div');
    stats.className = 'muted';
    stats.style.fontSize = '12px';
    stats.style.margin = '6px 0';
    stats.textContent = 'Base stats: —';
    slot.appendChild(stats);

    function showBaseStats(name, slotEl){
      // load species info from species_info.h if available
      (async ()=>{
        const info = await getSpeciesInfoByName(name);
        if (info && info.info && info.info.baseStats){
          const b = info.info.baseStats;
          stats.textContent = `Base stats: (${name}) HP ${b.hp}  Atk ${b.atk}  Def ${b.def}  SpA ${b.spa}  SpD ${b.spd}  Spe ${b.spe}`;
        } else {
          stats.textContent = `Base stats: (${name}) HP: —  Atk: —  Def: —  SpA: —  SpD: —  Spe: —`;
        }
      })();
    }

    function setSlotPreview(name){
      const num = getSpriteNumberForSpeciesName(name);
      if (num){
        preview.src = `src/Sprites/Frame1Front/${num}.png`;
      } else {
        preview.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
      }
    }

    // nature select
    const { wrapper: natWrap, sel: natSel } = createSelect('Nature', ['(none)',...NATURES]);
    slot.appendChild(natWrap);

    // IV / EVs per stat / Level
    const { wrapper: ivWrap, input: ivInput } = createInput('IV (0-31)', { type: 'number', min:0, max:31, value:31 });
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

    const { wrapper: lvWrap, input: lvInput } = createInput('Level (1-100)', { type: 'number', min:1, max:100, value:50 });
    slot.appendChild(lvWrap);

    // gender & nickname
    const { wrapper: gWrap, sel: gSel } = (function(){ const w = document.createElement('div'); w.style.marginBottom='6px'; const l = document.createElement('label'); l.className='muted'; l.textContent='Gender'; const s = document.createElement('select'); ['Male','Female','Unknown'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; s.appendChild(o); }); s.style.width='100%'; w.appendChild(l); w.appendChild(s); return { wrapper:w, sel:s };})();
    slot.appendChild(gWrap);
    const { wrapper: nickWrap, input: nickInput } = createInput('Nickname', { type:'text' });
    slot.appendChild(nickWrap);

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
      for (const mv of tmMoves){ if (!isStatusMove(mv)){ if (availableTMs === null || availableTMs.has(mv)) candidates.add(mv); } }
      const list = Array.from(candidates);
      // sort by power/stab heuristic
      const siForSort = await getSpeciesInfoByName(speciesName);
      const speciesTypes = (siForSort && siForSort.info && siForSort.info.types) ? siForSort.info.types : [];
      list.sort((a,b)=>{
        const pa = MOVE_POWER[a] || 50; const pb = MOVE_POWER[b] || 50;
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
    spInput.addEventListener('change', ()=>{ populateMoveSelectsForSlot().catch(e=>console.debug('populateMoveSelectsForSlot error',e)); });
    lvInput.addEventListener('change', ()=>{ populateMoveSelectsForSlot().catch(e=>console.debug('populateMoveSelectsForSlot error',e)); });

    // collect controls for programmatic filling
    slotControls.push({ spInput, preview, stats, setSlotPreview, lvInput, natSel, ivInput, evInputs, moveSelects, nickInput, gSel, populateMoveSelectsForSlot });

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

  // add Planned Team UI at top
  const appContainer = document.getElementById('trainersContainer');
  appContainer.innerHTML = '';
  const plannedTeamEl = createPlannedTeamArea(speciesList);
  appContainer.appendChild(plannedTeamEl);

  // Single Auto-Fill All Trainers button
  const globalAuto = document.createElement('div');
  globalAuto.style.margin = '8px 0';
  const globalBtn = document.createElement('button');
  globalBtn.textContent = 'Auto-Fill All Trainers From Planned Team';
  globalBtn.addEventListener('click', async ()=>{
    console.debug('Auto-Fill All Trainers clicked');
    const trainersList = trainers;
    const lvlSets = await loadLevelUpLearnsetsH();
    const tmSets = await loadTMHMLearnsetsH();
    let planned = [];
    try{ planned = JSON.parse(localStorage.getItem('emerald_planned_team') || '[]'); }catch(e){ planned = []; }
    let savedNatures = [];
    try{ savedNatures = JSON.parse(localStorage.getItem('emerald_planned_team_natures') || '[]'); }catch(e){ savedNatures = []; }
    for (const t of trainersList){
      const slotControls = trainerSlotControls.get(t.name);
      if (!slotControls) continue;
      const battleLevel = computeBattleLevel(t);
      for (let i=0;i<6;i++){
        const ctrl = slotControls[i];
        const plannedName = planned[i];
        if (!ctrl) continue;
        if (!plannedName){
          ctrl.spInput.value = '';
          ctrl.preview.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
          ctrl.lvInput.value = 50;
          if (ctrl.moveSelects) ctrl.moveSelects.forEach(mi=>mi.value='');
          continue;
        }
        const chosenToken = await devolveSpeciesToLegalAtLevel(plannedName, battleLevel);
        const displayName = prettySpecies(chosenToken).toLowerCase();
        ctrl.spInput.value = displayName;
        const num = getSpriteNumberForSpeciesName(displayName);
        if (num) ctrl.preview.src = `src/Sprites/Frame1Front/${num}.png`; else ctrl.preview.src = '';
        ctrl.lvInput.value = battleLevel;
        const levelMoves = (lvlSets[chosenToken] || []).filter(m=>m.level <= battleLevel).map(m=>m.move);
        const tmMoves = (tmSets[chosenToken] || []);
        const si = await getSpeciesInfoByName(displayName);
        const types = (si && si.info && si.info.types) ? si.info.types : [];
        const availableTMs = getAvailableTMsForTrainer(t);
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
        // ensure selects populated then set selected values
        if (ctrl.populateMoveSelectsForSlot) await ctrl.populateMoveSelectsForSlot();
        for (let k=0;k<4;k++){
          const mv = candArr[k] ? candArr[k].move : null;
          if (ctrl.moveSelects && ctrl.moveSelects[k]) ctrl.moveSelects[k].value = mv || '';
        }
        ctrl.ivInput.value = 31;
        try{ ctrl.natSel.value = savedNatures[i] || '(none)'; }catch(e){ ctrl.natSel.value = '(none)'; }
        Object.values(ctrl.evInputs).forEach(ei=>ei.value=0);
      }
    }
    // after auto-fill, recompute scores for visible trainer cards
    (async ()=>{
      let planned = [];
      try{ planned = JSON.parse(localStorage.getItem('emerald_planned_team') || '[]'); }catch(e){ planned = []; }
      for (const t of trainersList){
        try{
          const sc = await computeTrainerScore(t, planned);
          const el = trainerScoreEls.get(t.name);
          if (el){
            if (sc === 0) el.textContent = `Score: —`;
            else el.textContent = `Score: ${sc.toFixed(2)}/10`;
          }
          console.debug('Auto-Fill: updated score for', t.name, '->', sc);
        }catch(err){ console.debug('Auto-Fill: error computing score for', t.name, err); }
      }
    })();
  });
  globalAuto.appendChild(globalBtn);
  appContainer.appendChild(globalAuto);

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
  grid.style.display = 'grid';
  // 3 columns x 2 rows layout for planned team
  grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  grid.style.gridAutoRows = 'auto';
  grid.style.gap = '8px';

  // load saved team from localStorage
  const storageKey = 'emerald_planned_team';
  let saved = [];
  try{ saved = JSON.parse(localStorage.getItem(storageKey) || '[]'); }catch(e){ saved = []; }
  // saved natures per slot
  const storageKeyNatures = 'emerald_planned_team_natures';
  let savedNatures = [];
  try{ savedNatures = JSON.parse(localStorage.getItem(storageKeyNatures) || '[]'); }catch(e){ savedNatures = []; }

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

    // right: stat bars
    const statContainer = createStatBarsContainer();
    statContainer.style.width = '64%';
    statContainer.style.minWidth = '140px';

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
      } else {
        // try species_info.h fallback
        const info = await getSpeciesInfoByName(name);
        if (info && info.info && info.info.baseStats){
          const b = info.info.baseStats;
          const selNat = (savedNatures[idx] && savedNatures[idx] !== '(none)') ? savedNatures[idx] : null;
          renderStatBars(statContainer, b, selNat);
        } else {
          statContainer.textContent = 'Base: —';
        }
      }
      if (data && data.types){
        info.textContent = 'Type: ' + data.types.map(t=>t[0].toUpperCase()+t.slice(1)).join(' / ');
      } else {
        const info2 = await getSpeciesInfoByName(name);
        if (info2 && info2.info && info2.info.types){
          info.textContent = 'Type: ' + info2.info.types.map(t=>t[0].toUpperCase()+t.slice(1)).join(' / ');
        } else {
          info.textContent = 'Type: —';
        }
      }
      // save
      saved[idx] = name;
      localStorage.setItem(storageKey, JSON.stringify(saved));
    }

    // handle nature changes
    natSel.addEventListener('change', async ()=>{
      const val = natSel.value;
      if (!val || val === '(none)') savedNatures[i] = null; else savedNatures[i] = val;
      localStorage.setItem(storageKeyNatures, JSON.stringify(savedNatures));
      // re-render stats with new nature coloring
      const cur = spInput.value;
      if (!cur) return;
      const id = cur.toLowerCase().replace(/[^a-z0-9]/g,'');
      const data = await loadSpeciesData(id);
      const selNat = (savedNatures[i] && savedNatures[i] !== '(none)') ? savedNatures[i] : null;
      if (data && data.baseStats){ renderStatBars(statContainer, data.baseStats, selNat); return; }
      const si = await getSpeciesInfoByName(cur);
      if (si && si.info && si.info.baseStats) renderStatBars(statContainer, si.info.baseStats, selNat);
    });

    // hydrate from saved
    if (saved[i]){
      setSlotSpecies(i, saved[i]);
      // restore nature selection if present
      const sn = savedNatures[i] || '(none)';
      natSel.value = sn;
    }
  }

  wrapper.appendChild(grid);
  return wrapper;
}

