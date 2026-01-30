import fs from 'fs';
import path from 'path';
const root = path.resolve('d:/Coding/Pokemon/EmeraldTeamBuilder');
const spfile = path.join(root,'src','lib','species.gen3.js');
const trainfile = path.join(root,'src','data','trainers','trainers_parties.json');
const spritesDir = path.join(root,'src','Sprites','Frame1Front');
const text = fs.readFileSync(spfile,'utf8');
const species = [];
const re = /\[\s*(\d+)\s*,\s*\"([^\"]+)\"\s*\]/g;
let m;
while((m=re.exec(text))){ species.push([parseInt(m[1],10), m[2]]); }
function norm(s){ return (s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
const speciesMap = new Map();
for(const [num,name] of species){ speciesMap.set(norm(name), num); }
const trainers = JSON.parse(fs.readFileSync(trainfile,'utf8'));
console.log('Trainer,SpeciesToken,SpeciesName,SpecNum,AdjNum,FileExists');
for(const t of trainers){
  for(const p of (t.pokemons||[])){
    const token = p.species || '';
    const name = token.replace(/^SPECIES_/,'');
    const pretty = name.replace(/_/g,' ').toLowerCase().replace(/(^|\s)([a-z])/g,(m,p,c)=>c.toUpperCase());
    const key = norm(pretty);
    const num = speciesMap.get(key) || null;
    let adj = null;
    let fn = '';
    if (num != null){ adj = num>251 ? num-21 : num; fn = String(adj||'').padStart(4,'0') + '.png'; }
    const exists = fs.existsSync(path.join(spritesDir, fn || ''));
    console.log(`${t.name},${token},${pretty},${num},${adj},${exists?fn:'MISSING'}`);
  }
}
console.log('\nDone');
