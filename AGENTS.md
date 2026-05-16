# AGENTS.md

## Project

Async Pocket Trainer is a Vite + TypeScript static web game. The MVP goal is to expand the current automatic 1v1 battle prototype into a three-scene game loop:

1. Pokedex starter selection
2. Shop/team management
3. Battle with capture and trainer-result flows

Read these documents before non-trivial work:

- `todo.md`
- `docs/game-direction-plan.md`
- `docs/game-visual-plan.md`
- `docs/development-hardening-guide.md`

When documents conflict, prefer `docs/game-direction-plan.md` for game rules, `docs/game-visual-plan.md` for UI behavior, and `docs/development-hardening-guide.md` for code structure, testing, security, and failure handling.

## Commands

- Install dependencies: `npm install`
- Run tests: `npm run test`
- Build: `npm run build`
- Dev server: `npm run dev`

Before finishing implementation work, run `npm run test` and `npm run build` unless the change is documentation-only.

## Architecture Rules

- Keep `core/` pure: no DOM, no `localStorage`, no `fetch`.
- Keep `ui/` render-only: state in, HTML string out. Do not calculate game rules in render functions.
- Keep `app/` responsible for state machine, event routing, persistence, and API orchestration.
- Access `localStorage`, Apps Script, clocks, and randomness through small adapter/helper layers.
- Prefer `type -> pure function -> render` when adding features.
- Use stable `data-action`, `data-id`, and `data-slot` attributes for UI events.

## State Rules

- TypeScript state objects are the single source of truth.
- Do not infer game state from DOM classes, button text, or HTML.
- All persisted keys must include `version`.
- Parse external JSON as `unknown`, validate/narrow it, then use it.
- Recover safely from missing keys, invalid JSON, version mismatch, and required-field loss.
- Current planned localStorage keys:
  - `apt.player.v1`
  - `apt.dex.v1`
  - `apt.wallet.v1`
  - `apt.run.v1`
  - `apt.settings.v1`
  - `apt.syncQueue.v1`

## UI Rules

- Reuse one team panel component for shop/team management and battle scenes.
- Reuse shop list/detail components for both buying products and using capture items.
- Do not duplicate similar team/shop markup per scene.
- Keep the existing `battle-frame` structure and visual language unless the user explicitly asks to replace it.
- Mobile 360px must not have overlapping text, buttons, team cards, or battle panels.
- The default mobile team layout is 2 columns x 3 rows.
- Use existing static assets. Do not add external image/CDN dependencies.

## Game Rule Guardrails

- Content scope is Gen1 151 Pokemon and Gen1 moves/types.
- Internal battle stats remain `hp`, `atk`, `def`, `spa`, `spd`, `spe`.
- Trainer matching is random among same-wave snapshots excluding the same `playerId`; do not use `teamPower` as a filter.
- Wave 50 is the final wave; after clearing it, continue by repeating wave-50 trainer battles.
- After wave 50, do not grant coin rewards and do not auto-heal HP.
- In waves 5-50, heal the player team to full only after trainer battle victory.
- Defeat does not show a separate game-over screen. Finish the required trainer result edit, then return to the Pokedex starter scene.
- Pokeball inventory belongs to `apt.run.v1`, is created on adventure start, and resets when the adventure ends.

## Sync and Failure Rules

- Google Apps Script sync must never block user flow.
- Failed snapshot saves, trainer result records, and reward claims go to `apt.syncQueue.v1`.
- Queue items should be retryable and include kind, id, created time, attempts, and payload.
- A broken sync queue must not make the current run unrecoverable.

## Security Rules

- Always escape user-provided text before rendering.
- Do not write raw user input into `innerHTML`.
- Do not commit Apps Script URLs, tokens, secrets, or credentials.
- Keep clickable actions on an explicit whitelist.
- Limit and sanitize trainer name, team name, and greeting text.

## Testing Rules

Add or update tests for new rules and state transitions.

Important test targets:

- localStorage defaults, migration/recovery, version mismatch
- starter creation, dex unlock, gem reward
- run reset and Pokeball inventory reset
- shop purchases, target selection, cancel refund
- Pokemon sale and slot clearing
- team battle auto-switching and win/loss
- trainer victory healing, defeat no-heal, post-50 no-heal
- post-50 no coin reward
- capture chance and Master Ball success
- sync failure enqueues work and does not block scene transition

Test public behavior and state results rather than private implementation details. Inject seeded RNG and clock values when randomness or time is involved.

## Do Not

- Do not add React, Vue, Svelte, Redux, or a router.
- Do not introduce new packages unless there is a clear, small, justified need.
- Do not access persistence or network APIs from UI components.
- Do not mix battle, capture, shop, or storage calculations into render strings.
- Do not manually hardcode the 151 Pokemon list; derive it from dex data and image helpers.
- Do not add game-over screen flow.
- Do not add `teamPower`-based matchmaking.
- Do not refactor unrelated files just to clean up style.
