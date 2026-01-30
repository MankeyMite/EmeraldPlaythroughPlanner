# Pokémon Emerald Team Score Calculator (Playthrough-Oriented)

## Goal
Build a web-based tool that evaluates how strong a Pokémon Emerald playthrough team is, primarily under Hardcore Nuzlocke assumptions, by scoring the team’s performance against all major battles in the game (Gyms, Elite Four, Champion).

This is not a battle simulator. It is a matchup-based scoring system designed to identify the most reliable, safe, and consistent teams for completing the game.

## Core Concepts

1. Checkpoint-Based Team States
   - The team is evaluated at multiple checkpoints (e.g. before Roxanne, before Brawly, etc.).
   - Each checkpoint represents the realistic team state at that point: Pokémon available, moves unlocked, evolutions achieved, level caps enforced.
   - Checkpoints inherit from the previous one by default but can be customized.

2. Matchup Scoring System (1–10)
   - Each of the player’s Pokémon is scored against each enemy Pokémon in a major fight.
   - Scores reflect safety, HP preservation, speed/tempo, reliability, and immunity-based wins.

3. Team Score vs a Trainer
   - For each enemy Pokémon in a fight: select the highest-scoring team member matchup.
   - Average those “best answers” to produce the team score for that fight.
   - Penalize only when the plan requires unsafe hard switches or forced damage.

4. Damage Calculator (Gen 3 Accurate)
   - Uses Emerald-accurate mechanics: physical/special split by type, correct stat formulas, type effectiveness, STAB, crit toggle, and random damage rolls (85–100).
   - Trainer Pokémon use `.iv` from trainer parties and deterministic simulated natures derived from trainer name + species.
   - EVs assumed 0 by default. Supports free vs hard switch contexts.

5. UI / Presentation Goals
   - Scoreboard-style table with Pokémon on the left and major fights as columns.
   - Per-Pokémon scores per fight, best score per fight row, overall team score.
   - Drill-down views for fights and matchups showing stats, damage rolls, KO odds, and assumptions.

6. Customizable Assumptions
   - Hardcore Nuzlocke defaults (no items in battle, level caps enforced).
   - Toggles for crit risk, EV assumptions, setup allowed, TM availability, and switch context.

7. Output and Purpose
   - Heuristic, consistent scores (not RNG simulations) for comparison, optimization, and reasoning: "Why is this team good?" and "Where is this team fragile?"

## Next Steps (implementation roadmap)
- Create a minimal HTML UI for team input and scoreboard.
- Implement a Gen 3-accurate damage calculation module (JS) and trainer-party parser.
- Implement checkpoint system and matchup scorer.
- Add progressive disclosure UI for advanced details.

---

Place this file in the repo root as a single source of truth for project goals and implementation direction.
