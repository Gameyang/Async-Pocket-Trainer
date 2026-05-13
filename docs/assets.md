# Assets

This project does not include original Pokemon NPC portraits, BGM, or SFX.

## Data and Pokemon Battle Sprites

- Source URL: <https://github.com/veekun/pokedex/tree/master/pokedex/data/csv>
- License: veekun/pokedex is MIT licensed. Its README notes Pokemon game data remains the
  intellectual property of Nintendo, Creatures, inc., and GAME FREAK, inc.
- Transform: local battle data is reduced into `src/game/data/pokemonBattleRuntimeData.json`; monster
  image paths are resolved through `GameFrame.entities[].assetPath`.
- Used in: battle, starter, ready, capture, team, and game-over screens.

## Trainer Portraits

- Source URL: local procedural generator, `scripts/generate-local-assets.mjs`.
- License: project-owned generated placeholder art.
- Transform: the script draws small pixel-art trainer portraits and writes them to
  `src/resources/trainers/*.webp` bundle paths.
- Used in: trainer encounter badges. Sheet-sourced encounters use `sheet-rival.webp`; generated
  checkpoint trainers use `field-scout.webp` or `checkpoint-captain.webp`.

## Audio

- Source URL: local procedural generator, `scripts/generate-local-assets.mjs`.
- License: project-owned generated placeholder audio.
- Transform: the script synthesizes short mono tones and encodes browser-playable AAC/M4A files.
- Used in:
  - `src/resources/audio/sfx/battle-hit.m4a`
  - `src/resources/audio/sfx/battle-critical-hit.m4a`
  - `src/resources/audio/sfx/battle-type-*.m4a`
  - `src/resources/audio/sfx/battle-type-*-critical.m4a`
  - `src/resources/audio/sfx/battle-support-type-*.m4a`
  - `src/resources/audio/sfx/battle-miss.m4a`
  - `src/resources/audio/sfx/creature-faint.m4a`
  - `src/resources/audio/sfx/phase-change.m4a`
  - `src/resources/audio/sfx/capture-success.m4a`
  - `src/resources/audio/sfx/capture-fail.m4a`
  - `src/resources/audio/bgm/starter-ready.m4a`
  - `src/resources/audio/bgm/battle-capture.m4a`
  - `src/resources/audio/bgm/team-decision.m4a`
  - `src/resources/audio/bgm/game-over.m4a`

## Reference Only

- PokeRogue URL: <https://github.com/pagefaultgames/pokerogue>
- Use: high-level reference for browser game flow, phase boundaries, battle screen composition, and
  audio/effect trigger ideas.
- Restriction: no PokeRogue source code or assets are copied into this repository.
