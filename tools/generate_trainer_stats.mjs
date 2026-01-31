#!/usr/bin/env node
// Generate exact Gen3 stats for trainer Pokémon and write to trainers_parties_with_stats.json
// Usage: node tools/generate_trainer_stats.mjs

import fs from 'fs/promises';
import path from 'path';

async function loadSpeciesInfoH(){
  const p = path.resolve('src/data/raw/species_info.h');
  const text = await fs.readFile(p, 'utf8');
  const re = /\[\s*(SPECIES_[A-Z0-9_]+)\s*\]\s*=\s*\{([\s\S]*?)\n\s*\},/g;
  const map = {};
  let m;
  while((m = re.exec(text))){
    const token = m[1];
    const body = m[2];
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
    map[token] = { hp, atk, def, spa, spd, spe };
  }
  return map;
}

async function main(){
  const speciesMap = await loadSpeciesInfoH();
  const trainersPath = path.resolve('src/data/trainers/trainers_parties.json');
  const outPath = path.resolve('src/data/trainers/trainers_parties_with_stats.json');
  const txt = await fs.readFile(trainersPath, 'utf8');
  const trainers = JSON.parse(txt);

  // import calcAllStatsGen3 from app (ES module)
  const calcModule = await import(new URL('../src/stat calculation.js', import.meta.url));
  const { calcAllStatsGen3 } = calcModule;

  for (const t of trainers){
    if (!Array.isArray(t.pokemons)) continue;
    for (const p of t.pokemons){
      const token = p.species;
      const base = speciesMap[token] || null;
      if (!base){
        console.warn('Missing base stats for', token, '- skipping stats for this mon');
        p.stats = null;
        continue;
      }
      const ivVal = (p.iv != null) ? parseInt(p.iv,10) : 31;
      const ivs = { hp: ivVal, atk: ivVal, def: ivVal, spa: ivVal, spd: ivVal, spe: ivVal };
      const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      const lvl = (p.lvl != null) ? parseInt(p.lvl,10) : (p.level != null ? parseInt(p.level,10) : 50);
      const nat = p.nature || 'Hardy';
      try{
        const computed = calcAllStatsGen3({ baseStats: base, ivs, evs, level: lvl, nature: nat });
        p.stats = computed;
      }catch(e){
        console.warn('calcAllStatsGen3 failed for', token, e);
        p.stats = null;
      }
    }
  }

  await fs.writeFile(outPath, JSON.stringify(trainers, null, 2), 'utf8');
  console.log('Wrote', outPath);
}

main().catch(err=>{ console.error(err); process.exit(1); });
