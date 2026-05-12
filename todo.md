# TODO - 2026-05-12 Headless Integration Day Plan

오늘 목표는 이미 검증된 headless 코어를 실제 브라우저 경로에 연결해, 렌더링/input/Google Sheets 동기화가 같은 `GameFrame` 계약으로 동작하게 만드는 것이다.

기준 문서는 `docs/headless-goal-completed-archive.md`에 보관했다. 상세 기획안은 `docs/2026-05-12-headless-render-input-sync-plan.md`를 따른다.

참고 기준은 PokeRogue repo를 게임 흐름/상태 경계 참고로만 쓰고, 비주얼은 `sandbox/index.html`의 device/screen/battlefield/command 패턴을 따른다. 외부 코드와 에셋은 복사하지 않는다.

## 1. Guardrails

- [x] 게임 규칙은 `HeadlessGameClient`, `GameFrame`, sync adapter 뒤에만 둔다.
- [x] UI는 `FrameAction.action`만 dispatch한다.
- [x] PokeRogue는 구현 구조/흐름 참고로만 사용하고 코드와 에셋은 복사하지 않는다.
- [x] 브라우저 저장소와 Google Sheets 설정은 repo에 민감값을 남기지 않는다.
- [x] 실제 Google Sheets 네트워크 검증은 명시적 환경값이 있을 때만 실행한다.
- [x] 기본 품질 게이트는 `npm run verify`, 최종 렌더링 확인은 `npm run render:check`로 유지한다.

## 2. Rendering

- [x] Playwright가 starter, encounter, capture/skip, team decision, shop, game over/restart 화면을 실제 클릭으로 통과한다.
- [x] HTML renderer가 모든 phase에서 빈 화면 없이 `.app-shell`, `.dashboard`, `.command-band`를 표시한다.
- [x] 몬스터 이미지 로딩 실패, battlefield 미표시, 모바일 overflow, 버튼 겹침을 Playwright assertion으로 잡는다.
- [x] Canvas renderer smoke를 추가해 같은 `GameFrame`에서 entity와 command panel을 그릴 수 있는지 확인한다.

## 3. Input

- [x] 모든 visible button은 `data-action-id`로 현재 frame action을 찾아 `action.action`만 dispatch한다.
- [x] disabled action 클릭은 state/frame을 바꾸지 않는다.
- [x] 브라우저 E2E에서 `data-frame-id` 증가, HUD wave 변경, timeline 증가를 확인한다.
- [x] keyboard shortcut은 오늘 범위에서 제외하고 pointer/click input만 완성한다.

## 4. Browser Save

- [x] `HeadlessClientSnapshot`을 localStorage에 저장/복원하는 browser save adapter를 추가한다.
- [x] 새로고침 후 같은 seed/run이 이어지는지 Playwright로 검증한다.
- [x] 저장 데이터 schema version 불일치나 깨진 JSON은 새 run 시작 대신 명확한 recover path를 제공한다.

## 5. Google Sheets Sync

- [x] `SyncSettings` 타입을 추가한다: `enabled`, `spreadsheetId`, `range`, `apiKey` 또는 `accessToken`.
- [x] sync 설정은 localStorage에만 저장하고 repository에는 저장하지 않는다.
- [x] checkpoint wave에서 `TrainerSnapshot` append를 호출한다.
- [x] trainer encounter wave에서 sheet rows를 list/filter/pick해 상대 후보로 연결한다.
- [x] 자동 테스트는 mock fetch와 local/mock adapter를 기본으로 한다.

## 6. Verification

- [x] `npm run verify`
- [x] `npm run render:check`
- [x] `npm run qa:headless:100`
- [x] `npm run format`
- [x] 최종 완료 시 루트 `todo.md`의 체크박스를 모두 닫는다.
