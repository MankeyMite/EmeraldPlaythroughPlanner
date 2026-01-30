# Emerald Team Builder (scaffold)

This repository contains scaffolding for a Pokemon Emerald team builder and damage calculator.
https://github.com/pret/pokeemerald/blob/master/src/data/trainer_parties.h - for finding moves

Project layout created:
- src/
  - data/trainers/  (trainer JSON files)
  - data/pokemon/   (pokemon base JSON files)
  - lib/            (loader + calculation modules)
  - main.js         (entry helper)

Next steps:
- Fill `src/data/trainers` with real trainer JSON exported from a parser or manual entry.
- Implement full Gen 3 damage formula in `src/lib/damageCalc.js`.
- Hook `src/main.js` into `index.html` UI and build interactive controls.


find natures for each trainer's pokemon by finding the trainer characteristics. 
