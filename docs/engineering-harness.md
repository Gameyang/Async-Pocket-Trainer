# Engineering Harness

이 문서는 코드 개발을 시작하기 전에 고정할 개발 하네스 기준입니다. 목표는 작은 변경도 로컬과 GitHub에서 같은 방식으로 검증하는 것입니다.

## 구성 요소

- Vite: 정적 웹 앱 개발 서버와 GitHub Pages용 빌드
- TypeScript: 게임 로직과 데이터 스키마의 정적 검증
- Vitest: 전투, 포획, 웨이브, 저장 로직 단위 테스트
- ESLint: TypeScript/JavaScript 코드 품질 검사
- Prettier: 문서와 코드 포맷 통일
- Headless client: DOM 없이 게임 진행, 전투, 포획, 팀 교체, 상점 행동을 실행
- Headless QA CLI: 여러 seed를 실행해 invariant와 밸런스 지표를 JSON으로 출력
- GitHub Actions CI: PR과 `main` push마다 `npm run verify`
- GitHub Pages workflow: `main` 빌드 결과를 `dist/`에서 배포
- Dependabot: npm 패키지와 Actions 버전 갱신 PR 생성

## 품질 게이트

모든 PR은 아래 명령을 통과해야 합니다.

```bash
npm run verify
```

이 명령은 lint, test, build를 한 번에 실행합니다. 기능 구현 중에는 더 작은 명령을 직접 실행할 수 있습니다.

```bash
npm run lint
npm run test
npm run qa:headless
npm run build
```

## Headless 우선 구조

게임 로직은 `src/game/` 아래의 headless 코어가 소유합니다. HTML/WebGL/Canvas는 `HeadlessGameClient`가 만든 `GameFrame`을 렌더링하고, frame의 action descriptor를 다시 dispatch하는 얇은 어댑터입니다.

```text
HeadlessGameClient
  -> deterministic RNG
  -> encounter / battle / capture / team / shop state
  -> GameFrame
     -> entities with assetKey / assetPath / owner / slot
     -> available actions
     -> timeline
     -> visual cues
  -> HTML / WebGL / Canvas renderer
```

LLM 또는 CI는 브라우저를 열지 않고 아래 명령으로 게임 진행을 검증합니다.

```bash
npm run headless -- --seed qa --runs 20 --waves 15 --strategy greedy
npm run replay:seed -- --seed qa --runs 20 --waves 15
npm run qa:summary -- --seed qa --runs 20 --waves 15
npm run qa:compare -- --before before.json --after after.json
npm run qa:headless:30
npm run qa:headless:50
npm run qa:headless:100
npm run render:check
```

`qa:headless:100` enforces the current long-run balance target: 100 deterministic runs must average at least wave 35 and at least 5 runs must clear the 100-wave target. `render:check` is intentionally separate from `verify`; Playwright is only used for final browser rendering confirmation.

출력 JSON에는 run별 최종 웨이브, 전멸 여부, 팀 전투력, 체력 비율, invariant 오류가 포함됩니다. `waveBalance`에는 wave별 사망 원인, 포획 성공률, 팀 파워 분포, 휴식/구매 횟수가 포함됩니다. 밸런싱 변경 PR은 이 수치를 전후 비교합니다.

## Graphics API 계약

렌더러는 `GameState`를 직접 해석하지 않습니다. `src/game/view/frame.ts`의 `createGameFrame` 결과만 사용합니다.

- `entities`: 렌더링 가능한 모든 전투 개체. `id`, `owner`, `slot`, WebGL 배치용 `layout`, 오리지널 몬스터 전환을 고려한 `monster:*` 형식의 `assetKey`, `assetPath`, HP, 스탯, 기술을 포함합니다.
- `actions`: 현재 프레임에서 누를 수 있는 게임 명령. UI는 `action.id`와 `action.label`을 표시하고 `action.action`만 dispatch합니다.
- `battleReplay`: 전투 시작, 턴 시작, 기술 선택, 명중/피해, 상태 이상 적용/면역/지속 피해/행동 불능, 기절, 전투 종료를 순번 있는 event stream으로 제공합니다.
- `visualCues`: 공격, 빗나감, 기절, phase 변경 같은 그래픽스/사운드 트리거이며 `effectKey`와 선택적 `soundKey`를 포함합니다.
- `timeline`: 로그 UI 또는 리플레이 디버깅에 쓰는 안정적인 이벤트 목록입니다.

이 계약은 headless QA에서 `validateFrameContract`로 검사합니다. 따라서 그래픽스 없이도 WebGL 렌더러가 필요한 id, asset, cue 누락을 먼저 잡습니다.

## 테스트 하네스 원칙

- 랜덤 생성은 seed 가능한 인터페이스로 감싸 테스트 재현성을 확보합니다.
- 전투 계산, 포획 확률, 팀 교체 평가는 DOM과 분리된 순수 함수로 둡니다.
- `localStorage`, `IndexedDB`, Google Sheets API는 얇은 어댑터로 분리합니다.
- 외부 API 테스트는 실제 네트워크 대신 fixture와 mock을 기본값으로 사용합니다.
- 데이터 JSON은 로드 테스트를 추가해 필수 필드 누락을 빠르게 잡습니다.
- 화면 테스트는 마지막 단계로 두고, 기본 기능 검증은 headless action과 snapshot으로 수행합니다.

## GitHub 개발 흐름

1. 이슈에 목표와 완료 기준을 기록합니다.
2. 기능 또는 수정 브랜치를 만듭니다.
3. 코드, 테스트, 문서를 함께 갱신합니다.
4. `npm run verify`를 로컬에서 실행합니다.
5. PR을 열고 CI 결과를 확인합니다.
6. `main`에 병합되면 Pages workflow가 정적 빌드를 배포합니다.

## 향후 확장 후보

- Playwright 기반 브라우저 E2E 테스트
- 데이터 스키마 검증용 Zod 또는 JSON Schema
- GitHub Pages preview 배포
- 테스트 커버리지 리포트
- 릴리스 노트 자동 생성
