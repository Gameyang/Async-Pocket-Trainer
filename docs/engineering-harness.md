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

게임 로직은 `src/game/` 아래의 headless 코어가 소유합니다. HTML은 `HeadlessGameClient`의 snapshot을 렌더링하고 버튼 클릭을 action으로 dispatch하는 얇은 어댑터입니다.

```text
HeadlessGameClient
  -> deterministic RNG
  -> encounter / battle / capture / team / shop state
  -> snapshot
  -> HTML renderer
```

LLM 또는 CI는 브라우저를 열지 않고 아래 명령으로 게임 진행을 검증합니다.

```bash
npm run headless -- --seed qa --runs 20 --waves 15 --strategy greedy
```

출력 JSON에는 run별 최종 웨이브, 전멸 여부, 팀 전투력, 체력 비율, invariant 오류가 포함됩니다. 밸런싱 변경 PR은 이 수치를 전후 비교합니다.

## 테스트 하네스 원칙

- 랜덤 생성은 seed 가능한 인터페이스로 감싸 테스트 재현성을 확보합니다.
- 전투 계산, 포획 확률, 팀 교체 평가는 DOM과 분리된 순수 함수로 둡니다.
- `localStorage`, `IndexedDB`, Google Calendar API는 얇은 어댑터로 분리합니다.
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
