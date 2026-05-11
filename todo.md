# TODO - Headless Goal Driven Development

이 문서는 Async Pocket Trainer를 장시간 headless QA와 공격적 자동개발 방식으로 완성하기 위한 운영 지침이다. 기준 구현은 `HeadlessGameClient`이며, HTML/WebGL/Canvas 렌더러는 `GameFrame`만 소비한다.

## 1. 최종 목표

- 그래픽스 없이 게임 로직을 먼저 완성한다.
- 렌더링을 제외한 모든 구현을 먼저 진행하고, 그 구현이 headless QA에서 검증된 뒤에만 렌더링 모듈을 붙인다.
- 전투, 포획, 팀 교체, 상점, 웨이브, 저장/로드, 비동기 트레이너 데이터를 headless에서 검증 가능하게 만든다.
- 플레이어가 특정 wave에 도달했을 때 외부 동기화할 팀/런 데이터 구조를 먼저 완성한다. 나중에는 Google Sheets adapter만 추가하면 실제 공유 동기화가 끝나는 상태를 목표로 한다.
- 구현 중간마다 headless QA를 반복 실행해 현재 단계가 실제 플레이 입력 흐름으로 동작하는지 확인한다.
- 장시간 QA로 밸런스, 회귀, 프레임 계약, 자동 진행 가능성을 계속 측정한다.
- 렌더러는 `GameState`를 직접 해석하지 않고 `GameFrame.entities`, `GameFrame.actions`, `GameFrame.visualCues`, `GameFrame.timeline`만 사용한다.
- 프로토타입 단계에서는 현재 포켓몬풍 데이터와 자산을 유지한다.

## 2. Goal 운영 방식

장시간 작업을 시작할 때 goal은 다음 형태로 둔다.

```text
headless 게임 로직 자동 QA/개선으로 30~100 wave 장시간 진행이 가능한 코어를 만든다.
```

이 goal의 완료 기준은 실제 렌더링 모듈을 붙이기 직전까지 필요한 모든 게임 로직 구현이 headless 환경에서 마무리된 상태다. 렌더링은 표현 계층일 뿐이며, 전투/포획/팀 편성/상점/웨이브/저장/비동기 대전/밸런스 검증은 `HeadlessGameClient`와 `GameFrame` 계약만으로 먼저 완성되어야 한다. 렌더링 작업은 headless 기준 구현과 QA가 충분히 통과한 뒤의 후속 단계로만 취급한다.

Headless 진행은 실제 유저 게임 플레이와 최대한 동일해야 한다. 자동 QA는 내부 상태를 직접 조작하지 않고, 매 frame마다 `GameFrame.actions`에 노출된 입력 후보를 선택해 dispatch하는 방식으로 스타터 선택, 다음 전투 진입, 포획 시도, 포획 포기, 팀 교체, 상점 구매, 회복, 재시작 같은 모든 입력 상황을 시뮬레이션한다.

비동기 대전 동기화도 같은 원칙을 따른다. 먼저 headless에서 wave checkpoint snapshot, sheet row payload, schema version, local/mock sheet adapter, import/export 검증을 끝내고, 실제 Google Sheets API 인증과 네트워크 호출은 마지막 adapter 작업으로만 남긴다.

반복 루프:

1. 측정: `npm run verify`와 long-run headless QA를 실행한다.
2. 분류: invariant, frame contract, deterministic 재현성, 밸런스, UX/action 누락으로 문제를 나눈다.
3. 수정: 가장 근본 원인에 가까운 headless 코어부터 수정한다.
4. 검증: 같은 seed로 재실행해 회귀 여부를 확인한다.
5. 기록: 변경 전후 평균 웨이브, gameOver 분포, 팀 파워, 오류 수를 남긴다.

우선순위:

1. invariant/frame contract 오류 0개
2. deterministic seed 재현성
3. headless 자동 진행 가능성
4. 렌더링 제외 게임 기능 구현 완성도
5. Google Sheets-ready 동기화 데이터 구조
6. 밸런스 곡선
7. 렌더링 표현 품질

## 3. 자동 QA 루프

기본 검증:

```bash
npm run verify
npm run qa:headless
```

장시간 QA:

```bash
npm run headless -- --seed long-run --runs 100 --waves 30 --strategy greedy
npm run headless -- --seed conserve --runs 100 --waves 30 --strategy conserveBalls
npm run headless -- --seed stress --runs 200 --waves 50 --strategy greedy
```

QA 결과에서 반드시 볼 항목:

- `invariantErrors`가 비어 있는가
- headless 자동 진행이 `GameFrame.actions` 기반 input simulation으로만 이루어졌는가
- `completedTargetWave`가 목표 대비 너무 낮지 않은가
- `averageFinalWave`가 변경 전보다 악화되지 않았는가
- `gameOvers`가 특정 wave나 특정 상대에 과도하게 몰리지 않는가
- `averageTeamPower`와 `averageHealthRatio`가 난이도 의도와 맞는가
- 같은 seed를 재실행했을 때 결과가 동일한가

## 4. 공격적 자동개발 TODO

### Core

- [x] `HeadlessGameClient` 저장/로드 스냅샷 추가
- [ ] battle log를 replay 가능한 event stream으로 확장
- [ ] 상태 이상, 급소, 명중률, 타입 상성의 테스트 케이스 강화
- [ ] 포획 후 팀 비교 정책을 전략별로 분리
- [ ] 상점 행동을 `FrameAction` 기반으로 확장
- [ ] 5 wave 트레이너 스냅샷 생성과 로컬 더미 PvP 추가
- [x] Google Sheets 연동 전용 직렬화 타입 추가

### Async Sync / Google Sheets 준비

- [x] wave checkpoint 도달 시 저장할 `TrainerSnapshot` 도메인 타입 정의
- [x] Google Sheets row로 바로 변환 가능한 `SheetTrainerRow` DTO 정의
- [x] schema version, player id, trainer name, wave, createdAt, seed, team power, team JSON, run summary 필드 고정
- [x] team JSON은 creature id, species id, stats, current HP, moves, power score, rarity score를 포함
- [x] `TrainerSnapshot` -> `SheetTrainerRow` serializer와 parser 구현
- [x] parser는 schema version 불일치, 필수 필드 누락, 깨진 JSON을 명확히 거부
- [x] 실제 API 대신 local/mock sheet adapter를 먼저 구현
- [x] headless QA에서 mock sheet에 업로드/조회/랜덤 상대 선택까지 검증
- [x] wave별 상대 후보 필터링과 오래된 데이터 제외 정책 준비
- [ ] 실제 Google Sheets adapter는 인증, spreadsheet id, range, append/read만 나중에 추가
- [ ] 게임 코어는 Google Sheets API를 직접 import하지 않고 sync adapter interface만 호출

### QA

- [x] run report에 wave별 사망 원인 추가
- [x] run report에 capture success rate 추가
- [x] run report에 wave별 팀 파워 분포 추가
- [ ] wave checkpoint snapshot 생성/직렬화/역직렬화 invariant 추가
- [x] frame action 기반 input simulation controller 추가
- [ ] 스타터 선택/전투 진입/포획/방출/교체/상점/회복/재시작 입력 경로 커버리지 추가
- [x] 30/50/100 wave 장시간 QA 프로파일 추가
- [ ] seed replay 명령 추가
- [ ] 밸런스 변경 전후 비교용 JSON summary 추가

### Frame API

- [ ] `GameFrame`에 battle replay tick 또는 sequence index 추가
- [ ] visual cue에 sound/effect hook을 추가할지 검토
- [ ] entity owner/slot 규칙을 WebGL 배치가 바로 쓰기 좋게 고정
- [ ] asset key를 오리지널 몬스터 전환에도 유지 가능한 형태로 일반화
- [ ] frame contract 테스트를 새 cue/action 추가 때마다 확장

### Renderer

- [ ] HTML 렌더러가 raw `GameState`를 참조하지 않는지 주기적으로 점검
- [ ] Canvas/WebGL 렌더러도 `GameFrame`만 소비하도록 구현
- [ ] 렌더러 이벤트는 `FrameAction.action`만 dispatch
- [ ] 렌더링 비주얼은 `sandbox/index.html`의 모바일 게임기 프레임, 픽셀풍 UI, 배틀필드, 플랫폼, 상태 카드, 하단 커맨드 패널 스타일을 기준으로 맞춘다.
- [ ] 몬스터 이미지는 `src/resources/pokemon/*.webp` 리소스를 사용하고, `GameFrame.entities[].assetPath` 또는 asset resolver를 통해 연결한다.
- [ ] Playwright는 최종 렌더링 확인용으로만 사용

### Balance

- [x] wave 1~5 초반 전멸률 조정
- [x] wave 5/10/15 트레이너 체크포인트 난이도 조정
- [ ] 포획 확률과 볼 가격의 경제 곡선 조정
- [ ] 좋은 개체를 얻었을 때 팀 파워가 체감되도록 score 공식 조정
- [ ] 100-run 기준 평균 진행도 목표를 정하고 회귀 감지

## 5. 금지사항

- 렌더러에서 게임 규칙을 계산하지 않는다.
- `Math.random()`을 직접 사용하지 않는다. 모든 랜덤은 seed 가능한 RNG를 통한다.
- seed 없는 테스트를 추가하지 않는다.
- `GameFrame`을 우회해 UI가 `GameState`를 직접 해석하지 않는다.
- headless QA에서 private 메서드나 내부 상태를 직접 조작해 유저 입력 경로를 건너뛰지 않는다.
- 게임 코어에서 Google Sheets API를 직접 호출하지 않는다. 외부 동기화는 adapter interface 뒤로만 둔다.
- API key, OAuth token, spreadsheet id 같은 민감값을 저장소에 커밋하지 않는다.
- invariant 또는 frame contract 실패 상태에서 새 기능을 얹지 않는다.
- `npm run verify` 실패 상태를 방치하지 않는다.
- 사용자가 만든 변경을 되돌리지 않는다.
- 원인 파악 없이 밸런스 숫자만 임의로 바꾸지 않는다.
- 프로토타입 데이터를 공개 배포 안전 자산이라고 주장하지 않는다.
- 공개/상업 배포 품질을 논할 때 현재 포켓몬풍 명칭과 자산의 IP 리스크를 무시하지 않는다.

## 6. 목표 퀄리티 기준

- `npm run verify`가 항상 통과한다.
- headless QA의 invariant/frame contract 오류가 0개다.
- 100-run QA 결과가 같은 seed에서 재현된다.
- 신규 게임 기능은 headless 테스트를 먼저 추가한다.
- 신규 렌더링 기능은 `GameFrame` 계약 테스트를 먼저 추가한다.
- 비동기 대전 데이터는 Google Sheets 없이도 local/mock adapter로 업로드/조회/선택 테스트가 가능해야 한다.
- 밸런스 변경은 변경 전후 QA JSON을 비교한다.
- HTML/WebGL/Canvas는 같은 frame에서 같은 게임 의미를 표시한다.
- 렌더링 단계의 기본 비주얼 방향은 `sandbox/index.html`을 참고하며, 실제 몬스터 표시는 `src/resources/pokemon` 자산을 사용한다.
- 장시간 자동 진행 중 수동 조작이 필요한 phase가 고립되지 않는다.

## 7. 참고 자료

- Vite: <https://vite.dev/guide/>
- Vitest: <https://vitest.dev/guide/>
- TypeScript: <https://www.typescriptlang.org/docs/>
- ESLint: <https://eslint.org/docs/latest/>
- GitHub Actions: <https://docs.github.com/actions>
- GitHub Pages custom workflows: <https://docs.github.com/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
- Playwright: <https://playwright.dev/docs/intro>
- Google Sheets API overview: <https://developers.google.com/workspace/sheets/api/guides/concepts>
- Google Sheets API values guide: <https://developers.google.com/workspace/sheets/api/guides/values>
- veekun Pokédex data: <https://github.com/veekun/pokedex>

## 8. 현재 우선순위 체크리스트

- [x] `HeadlessGameClient` 저장/로드 스냅샷 구현
- [x] long-run QA 명령을 CI에서 선택 실행 가능하게 분리
- [x] wave별 밸런스 리포트 추가
- [ ] battle replay event stream 설계
- [ ] capture/team decision 정책 테스트 강화
- [x] Google Sheets-ready checkpoint snapshot schema 설계
- [x] local/mock sheet adapter 구현
- [x] 30/50/100 wave 장시간 QA 프로파일 추가
- [ ] WebGL/Canvas 렌더러 전에 `GameFrame` 계약 확장
- [ ] Google Sheets 연동 전 로컬 더미 PvP 스냅샷 구현
