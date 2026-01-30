#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

async function main(){
  const toolsDir = path.resolve(new URL(import.meta.url).pathname).replace(/%20/g,' ');
  const repoSrc = path.resolve(toolsDir, '..');
  const pokemonDir = path.join(repoSrc, 'data', 'pokemon');
  const outDir = path.join(repoSrc, 'lib');
  try{
    const files = await fs.readdir(pokemonDir);
    const ids = files.filter(f=>f.toLowerCase().endsWith('.json'))
      .map(f=>f.slice(0,-5).toLowerCase().replace(/[^a-z0-9]/g,''));
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, 'speciesIndex.json');
    await fs.writeFile(outPath, JSON.stringify(ids.sort(), null, 2), 'utf8');
    console.log('Wrote', outPath, 'with', ids.length, 'entries');
  }catch(e){
    console.error('Failed building species index:', e);
    process.exit(1);
  }
}

main();
