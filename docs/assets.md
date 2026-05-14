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

## Audio — Element Battle SFX (procedural chiptune synth)

- Source URL: local procedural generator, `scripts/generate-local-assets.mjs`.
- License: project-owned generated placeholder audio.
- Transform: the script synthesizes short mono tones and encodes browser-playable AAC/M4A files.
- Used in:
  - `src/resources/audio/sfx/battle-type-*.m4a`
  - `src/resources/audio/sfx/battle-type-*-critical.m4a`
  - `src/resources/audio/sfx/battle-support-type-*.m4a`

## Audio — Common SFX (OpenGameArt)

- Source URL: <https://opengameart.org/content/512-sound-effects-8-bit-style>
- Author: Juhani Junkala (file: `The Essential Retro Video Game Sound Effects Collection [512 sounds].zip`)
- License: CC0 (Public Domain Dedication) — no attribution required, retained voluntarily.
- Transform: source `.wav` (44.1 kHz mono) re-encoded to AAC/M4A at 72 kbps via ffmpeg.
- Used in:
  - `src/resources/audio/sfx/battle-hit.m4a` ← `General Sounds/Simple Damage Sounds/sfx_damage_hit3.wav`
  - `src/resources/audio/sfx/battle-critical-hit.m4a` ← `Explosions/Short/sfx_exp_short_hard5.wav`
  - `src/resources/audio/sfx/battle-miss.m4a` ← `General Sounds/Neutral Sounds/sfx_sound_neutral6.wav`
  - `src/resources/audio/sfx/creature-faint.m4a` ← `Death Screams/Robot/sfx_deathscream_robot2.wav`
  - `src/resources/audio/sfx/capture-success.m4a` ← `General Sounds/Positive Sounds/sfx_sounds_powerup3.wav`
  - `src/resources/audio/sfx/capture-fail.m4a` ← `General Sounds/Negative Sounds/sfx_sounds_negative2.wav`
  - `src/resources/audio/sfx/phase-change.m4a` ← `General Sounds/Fanfares/sfx_sounds_fanfare1.wav`

## Audio — BGM (OpenGameArt)

- Source URL: <https://opengameart.org/content/15-melodic-rpg-chiptunes>
- Author: Aureolus_Omicron
- License: CC0 (Public Domain Dedication) — no credit required, retained voluntarily.
- Transform: source `.ogg` re-encoded to AAC/M4A stereo at 96 kbps / 44.1 kHz via ffmpeg.
- Used in:
  - `src/resources/audio/bgm/starter-ready.m4a` ← `rpgchip03_town.ogg`
  - `src/resources/audio/bgm/battle-capture.m4a` ← `rpgchip13_battle_1.ogg`
  - `src/resources/audio/bgm/team-decision.m4a` ← `rpgchip04_in_the_royal_court.ogg`
  - `src/resources/audio/bgm/game-over.m4a` ← `rpgchip15_game_over.ogg`

## Reference Only

- PokeRogue URL: <https://github.com/pagefaultgames/pokerogue>
- Use: high-level reference for browser game flow, phase boundaries, battle screen composition, and
  audio/effect trigger ideas.
- Restriction: no PokeRogue source code or assets are copied into this repository.
