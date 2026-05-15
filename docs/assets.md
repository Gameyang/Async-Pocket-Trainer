# Assets

This project includes generated assets and selected third-party Pokemon-adjacent assets. Verify the
target release context has permission to ship Pokemon Showdown-derived sprites and audio before
public distribution.

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
- Additional source URL: <https://huggingface.co/sWizad/pokemon-trainer-sprite-pixelart>
- License: `bespoke-lora-trained-license`; the model card links to
  <https://multimodal.art/civitai-licenses?allowNoCredit=True&allowCommercialUse=Image&allowDerivatives=True&allowDifferentLicense=True>.
- Transform: `scripts/build-hf-trainer-assets.mjs` downloads the repository's 16 JPEG sample
  trainer sprites into `tmp/hf-trainer-sprites/`, flood-fills the simple background to alpha,
  crops around the opaque sprite, downscales to 96x96 with nearest-neighbor sampling, and writes
  lossless transparent WebP files to `src/resources/trainers/hf-trainer-*.webp`.
- Used in: generated trainer encounter portrait rotation.
- Additional source URL: <https://play.pokemonshowdown.com/sprites/trainers/>
- Credit and restriction notice from source: many sprites are not from the games, appropriate artist
  credit is required if used elsewhere, and editing without permission is disallowed.
- Distribution note: verify the target release context has permission to ship these sprites before
  public distribution.
- Transform: `scripts/build-showdown-trainer-assets.mjs` reads the source index, caches the source
  PNG files in `tmp/showdown-trainer-sprites/`, preserves source transparency, crops transparent
  padding, resizes to 96x96 with nearest-neighbor sampling, and writes lossless transparent WebP
  files to `src/resources/trainers/ps-trainer-*.webp`.
- Metadata: `src/resources/trainers/pokemon-showdown-trainers.json` records source file, output file,
  source URL, and listed artist where the index provides one.
- Manifest: `src/resources/trainers/trainerPortraitManifest.json` drives generated trainer portrait
  rotation, portrait shop offers, selected trainer portraits, and asset tests.

## Audio - Pokemon Showdown Pack

- Source URL: <https://play.pokemonshowdown.com/audio/>
- Cry source URL: <https://play.pokemonshowdown.com/audio/cries/>
- Distribution note: these files are Pokemon Showdown-derived audio assets. They should only be
  shipped in contexts where the project has permission to redistribute them.
- Transform: `scripts/build-showdown-audio-assets.mjs` reads both source indexes, selects one source
  per stem with `.ogg` preferred over `.mp3` over `.wav`, caches originals in
  `tmp/showdown-audio/`, and re-encodes selected files to AAC/M4A with ffmpeg.
- Output:
  - Root audio and `notification.wav`: `src/resources/audio/bgm/showdown/*.m4a`
  - Pokemon cries: `src/resources/audio/cries/showdown/*.m4a`
  - Manifest: `src/resources/audio/showdownAudioManifest.json`
- Used in: all runtime BGM and SFX resolution. Phase music maps to Showdown battle themes; battle,
  capture, phase, and faint cues resolve to Showdown notification audio or Pokemon cries.

## Audio - Legacy OpenGameArt SFX

Status: retained as legacy local assets, but runtime audio now resolves to the Pokemon Showdown
audio pack.

- Source URL: <https://opengameart.org/content/512-sound-effects-8-bit-style>
- Author: Juhani Junkala (file: `The Essential Retro Video Game Sound Effects Collection [512 sounds].zip`)
- License: CC0 (Public Domain Dedication) — no attribution required, retained voluntarily.
- Transform: source `.wav` (44.1 kHz mono) re-encoded to AAC/M4A at 72 kbps via ffmpeg. Longer
  samples are trimmed to ~1.5 s with an 80 ms tail fade-out.
- Used in:
  - Common SFX:
    - `battle-hit.m4a` ← `General Sounds/Simple Damage Sounds/sfx_damage_hit3.wav`
    - `battle-critical-hit.m4a` ← `Explosions/Short/sfx_exp_short_hard5.wav`
    - `battle-miss.m4a` ← `General Sounds/Neutral Sounds/sfx_sound_neutral6.wav`
    - `creature-faint.m4a` ← `Death Screams/Robot/sfx_deathscream_robot2.wav`
    - `capture-success.m4a` ← `General Sounds/Positive Sounds/sfx_sounds_powerup3.wav`
    - `capture-fail.m4a` ← `General Sounds/Negative Sounds/sfx_sounds_negative2.wav`
    - `phase-change.m4a` ← `General Sounds/Fanfares/sfx_sounds_fanfare1.wav`
  - Element battle SFX (`battle-type-{element}.m4a` / `-critical.m4a` / `battle-support-type-{element}.m4a`):
    - `normal` ← `Impacts/sfx_sounds_impact3.wav`, `Impacts/sfx_sounds_impact12.wav`, `Neutral Sounds/sfx_sound_neutral4.wav`
    - `grass` (support only) ← `Neutral Sounds/sfx_sound_neutral7.wav`
    - `electric` ← `Lasers/sfx_wpn_laser4.wav`, `Lasers/sfx_wpn_laser9.wav`, `Bleeps/sfx_sounds_Blip5.wav`
    - `poison` (critical/support) ← `Weird Sounds/sfx_sound_nagger1.wav`, `Weird Sounds/sfx_sound_depressurizing.wav`
    - `ground` ← `Explosions/Medium Length/sfx_exp_medium5.wav`, `Explosions/Long/sfx_exp_long2.wav`, `Falling Sounds/sfx_sounds_falling4.wav`
    - `flying` ← `Jumping/sfx_movement_jump10.wav`, `Portals/sfx_movement_portal4.wav`, `Falling/sfx_sounds_falling6.wav`
    - `bug` ← `Weird Sounds/sfx_sound_mechanicalnoise{1,5,3}.wav`
    - `fighting` ← `Melee/sfx_wpn_punch{2,4,1}.wav`
    - `psychic` (critical/support) ← `Portals/sfx_movement_portal2.wav`, `Weird Sounds/sfx_sound_bling.wav`
    - `ghost` ← `Weird Sounds/sfx_sound_shutdown1.wav`, `sfx_sound_vaporizing.wav`, `sfx_sound_refereewhistle.wav`
    - `ice` (impact/critical) ← `High Pitched Sounds/sfx_sounds_high2.wav`, `Shotgun/sfx_weapon_shotgun2.wav`
    - `fairy` (critical) ← `Fanfares/sfx_sounds_fanfare2.wav`

## Audio — SFX from "80 CC0 RPG SFX"

- Source URL: <https://opengameart.org/content/80-cc0-rpg-sfx>
- Author: rubberduck (file: `80-CC0-RPG-SFX.zip`)
- License: CC0 (Public Domain Dedication).
- Transform: source `.ogg` re-encoded to AAC/M4A mono at 72 kbps.
- Used in element battle SFX (`battle-type-{element}.m4a` / `-critical.m4a` / `battle-support-type-{element}.m4a`):
  - `fire` ← `spell_fire_01.ogg`, `spell_fire_07.ogg`, `spell_fire_03.ogg`
  - `water` ← `creature_slime_{03,01,04}.ogg`
  - `grass` (impact/critical) ← `spell_01.ogg`, `spell_02.ogg`
  - `poison` (impact) ← `creature_slime_02.ogg`
  - `psychic` (impact) ← `book_02.ogg`
  - `rock` ← `stones_{01,03,04}.ogg`
  - `ice` (support) ← `item_gem_02.ogg`
  - `dragon` ← `creature_roar_{02,03,01}.ogg`
  - `dark` ← `creature_monster_04.ogg`, `creature_monster_02.ogg`, `creature_misc_03.ogg`
  - `steel` ← `metal_02.ogg`, `blade_03.ogg`, `metal_01.ogg`
  - `fairy` (impact/support) ← `item_gem_01.ogg`, `item_gem_03.ogg`

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
