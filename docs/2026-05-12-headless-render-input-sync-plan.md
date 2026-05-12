# 2026-05-12 Headless Render/Input/Sync Plan

## Summary

오늘 작업은 headless 코어의 완성도를 실제 브라우저 경로로 끌어올리는 통합 작업이다. 핵심 성공 조건은 사용자가 브라우저에서 클릭만으로 run을 진행하고, 그 진행이 `GameFrame` 계약과 `HeadlessGameClient` snapshot/sync adapter를 통해 검증되는 것이다.

## Current State

- `HeadlessGameClient`는 전투, 포획, 팀 교체, 상점, 웨이브 진행, 저장/로드 snapshot을 제공한다.
- HTML renderer와 Canvas renderer는 `GameFrame`을 소비하고, HTML input은 `FrameAction.action`을 dispatch한다.
- local/mock sheet adapter와 Google Sheets adapter는 headless 테스트에서 검증되어 있다.
- 아직 브라우저 실사용 관점에서는 localStorage save, sync 설정 UI, checkpoint append/list/pick 연결, 긴 input E2E가 부족하다.

## References

- Code flow reference: `https://github.com/pagefaultgames/pokerogue`. Use it only for high-level browser game structure, state boundaries, and input flow ideas. Do not copy source code or assets.
- Visual reference: `sandbox/index.html`. The implementation should keep the compact device frame, topbar/HUD, battlefield/platform composition, monster placement, and command panel feel from that file.
- If an external reference conflicts with this repository's `HeadlessGameClient`, `GameFrame`, or sync adapter contracts, the local contract wins.

## Implementation Plan

### Rendering

- Extend Playwright coverage in `e2e/rendering.playwright.ts` from smoke test to an input-driven run path.
- Required path: starter selection -> wild encounter -> capture attempt or skip -> team decision when available -> shop/rest/ball purchase -> wave 5 trainer checkpoint -> restart from game over when a deterministic seed reaches it.
- Assert stable layout at mobile viewport: `.app-shell`, `.dashboard`, `.encounter-panel`, `.command-band`, team cards, and monster image must be visible and non-overlapping.
- Add a Canvas smoke unit or browser test that calls `createCanvasFrameRenderer(...).render(frame)` and verifies no throw plus non-empty pixels.

### Input

- Keep `FrameClient` as the UI boundary: `getFrame()` and `dispatch(action)`.
- Do not expose raw `GameState` or `HeadlessGameClient` methods to renderer modules.
- For enabled buttons, click must dispatch only the matching `FrameAction.action`.
- For disabled buttons, click must not increment `data-frame-id`, wave, money, balls, or timeline length.
- Add E2E assertions for frame id increase after valid actions and no change after disabled actions.

### Browser Save

- Add a browser-only save adapter around `localStorage` for `HeadlessClientSnapshot`.
- Storage key: `apt:headless-client-snapshot:v1`.
- API shape:
  - `loadClientSnapshot(): HeadlessClientSnapshot | undefined`
  - `saveClientSnapshot(snapshot: HeadlessClientSnapshot): void`
  - `clearClientSnapshot(): void`
- On app startup, load snapshot if valid; otherwise create a new `HeadlessGameClient`.
- After every successful dispatch, save the latest client snapshot.
- Corrupt or incompatible storage should be cleared and surfaced as a timeline/UI notice, not thrown into a blank app.

### Google Sheets Sync

- Add `SyncSettings` as browser-local configuration:
  - `enabled: boolean`
  - `mode: "publicCsv" | "googleApi"`
  - `spreadsheetId: string`
  - `range: string`
  - `publicCsvUrl?: string`
  - `appsScriptSubmitUrl?: string`
  - `apiKey?: string`
  - `accessToken?: string`
- Storage key: `apt:sync-settings:v1`.
- Default state: sync disabled.
- Default configured public sheet id: `14ra0Y0zLORpru3nmT-obu3yD1UuO2kAJP4aJ5IIA0M4`.
- Public CSV mode reads `https://docs.google.com/spreadsheets/d/{spreadsheetId}/gviz/tq?tqx=out:csv&sheet={sheetName}` without API key or token.
- Public CSV mode can submit checkpoint snapshots through an optional Apps Script Web App `/exec` URL. It uses an opaque `no-cors` POST and verifies success through the sheet/read path rather than reading the POST response.
- Public CSV mode without `appsScriptSubmitUrl` is read-only; checkpoint append is skipped with a visible read-only status.
- UI should expose a compact sync panel for enabled/offline/error/last synced state.
- On checkpoint-ready wave, create `TrainerSnapshot` and append through configured adapter.
- On trainer encounter wave, list candidates for the current wave and inject the picked snapshot into `HeadlessGameClient` before resolving the encounter.
- Use mock fetch in tests; do not require real Google credentials in CI.

## Test Plan

- Unit tests:
  - Browser save adapter handles valid snapshot, missing key, corrupt JSON, and clear.
  - Sync settings adapter handles default disabled state, valid settings, missing credentials, and corrupt JSON.
  - Google Sheets bridge uses mock fetch for append/list/pick and never imports Google adapter into game core.
- Playwright:
  - Browser click path reaches at least wave 6.
  - Reload preserves current wave, money, balls, and team size.
  - Disabled actions do not mutate state.
  - Sync panel can save settings with mock credentials and display mock sync success/error.
- Regression:
  - `npm run verify`
  - `npm run render:check`
  - `npm run qa:headless:100`
  - `npm run format`

## Acceptance Criteria

- The browser app can be played from starter choice through a trainer checkpoint using visible button clicks only. Done in `e2e/rendering.playwright.ts`.
- Reload restores the same run from localStorage. Done through `src/browser/clientStorage.ts`.
- Sync settings are stored only in localStorage and are disabled by default. Done through `src/browser/syncSettings.ts`.
- Public Google Sheet CSV sync can read trainer candidates without API key or token. Done through `src/game/sync/publicCsvSheetAdapter.ts`.
- Apps Script Web App submit can send checkpoint snapshots without API key or token. Done through `src/game/sync/appsScriptSubmitAdapter.ts`.
- Mocked Google Sheets sync can append through API mode and pick a snapshot from the browser integration path. Done through `src/browser/browserSync.ts` and Playwright route mocks.
- Headless invariants remain at 0 and renderer contract tests still forbid raw `GameState` renderer usage. Confirmed by `npm run verify` and `npm run qa:headless:100`.
- When this day plan is complete, all checkboxes in root `todo.md` are checked. Done.

## Out Of Scope

- OAuth login flow.
- Real credential storage beyond localStorage prototype settings.
- WebGL advanced animation.
- New balance tuning.
- Public/commercial IP readiness.
