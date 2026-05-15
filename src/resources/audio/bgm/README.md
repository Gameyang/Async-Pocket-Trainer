Scene BGM folders
=================

Put browser-playable `.m4a` BGM files in the scene folders below.

- `starter-ready/`: starter selection, ready, and shop preparation screens
- `battle-capture/`: encounter battle and capture decision screens
- `team-decision/`: captured creature keep/replace decision screen
- `game-over/`: game over and restart screen

Runtime order:

1. Prefer `.m4a` files inside the matching scene folder.
2. If the scene folder is empty, fall back to the downloaded Pokemon Showdown BGM rotation in `showdown/`.

The root-level `starter-ready.m4a`, `battle-capture.m4a`, `team-decision.m4a`, and
`game-over.m4a` files are kept for legacy asset checks.

Importing local files
---------------------

Place legally owned source files in this local input structure:

```text
tmp/scene-bgm/starter-ready/
tmp/scene-bgm/battle-capture/
tmp/scene-bgm/team-decision/
tmp/scene-bgm/game-over/
```

Then run:

```sh
npm run assets:audio:scene-bgm
```

Supported input formats are `.mp3`, `.flac`, `.wav`, `.ogg`, `.m4a`, and `.aac`. The importer
re-encodes them to 44.1 kHz stereo AAC `.m4a` files in the matching scene folder.
