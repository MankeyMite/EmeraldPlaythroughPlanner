#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const IN = path.resolve('src/data/raw/trainers_parties.h');
const OUT_DIR = path.resolve('src/data/trainers');
const OUT = path.join(OUT_DIR, 'trainers_parties.json');

function parseMoves(movesBlock) {
  if (!movesBlock) return [];
  return movesBlock
    .split(',')
    .map(s => s.replace(/[,}]/g, '').trim())
    .filter(Boolean);
}

async function main() {
  const src = await fs.readFile(IN, 'utf8');

  const blockRegex = /static const struct TrainerMonItemCustomMoves\s+(\w+)\s*\[\]\s*=\s*\{([\s\S]*?)\n\};/g;
  function extractEntries(body) {
    const entries = [];
    let i = 0;
    while (i < body.length) {
      const start = body.indexOf('{', i);
      if (start === -1) break;
      let depth = 0;
      let j = start;
      for (; j < body.length; j++) {
        const ch = body[j];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= body.length) break;
      const inner = body.slice(start + 1, j);
      entries.push(inner);
      i = j + 1;
    }
    return entries;
  }

  const trainers = [];
  let blk;
  while ((blk = blockRegex.exec(src))) {
    const varName = blk[1];
    const body = blk[2];
    const name = varName.replace(/^sParty_/, '');

    const pokemons = [];
    const entryBlocks = extractEntries(body);
    for (const entry of entryBlocks) {
      const ivM = entry.match(/\.iv\s*=\s*(\d+)/);
      const lvlM = entry.match(/\.lvl\s*=\s*(\d+)/);
      const speciesM = entry.match(/\.species\s*=\s*(\w+)/);
      const heldM = entry.match(/\.heldItem\s*=\s*(\w+)/);
      const movesM = entry.match(/\.moves\s*=\s*\{([\s\S]*?)\}/);

      pokemons.push({
        iv: ivM ? Number(ivM[1]) : null,
        lvl: lvlM ? Number(lvlM[1]) : null,
        species: speciesM ? speciesM[1] : null,
        heldItem: heldM ? heldM[1] : null,
        moves: parseMoves(movesM ? movesM[1] : ''),
      });
    }

    trainers.push({ name, pokemons });
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(trainers, null, 2), 'utf8');
  console.log('Wrote', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
