# 1세대 자동 배틀 엔진 완성도 리뷰

작성일: 2026-05-16

## 결론

현재 전투 엔진은 모바일 자동 1v1 MVP 기준으로는 동작 가능한 수준까지 올라왔지만, 원작 1세대 또는 Pokemon Showdown Gen1 전체 기술/룰 기준의 100% 구현은 아니다.

- MVP 자동전투 기준 완성도: 약 75-80%
- 현재 로컬 데이터 147개 기술 기준 완성도: 약 70-75%
- 원작 Gen1 전체 165개 기술/룰 기준 완성도: 약 55-60%

## 현재 잘 구현된 부분

- 1세대 151마리 포켓몬 데이터와 타입 상성 기반 전투가 동작한다.
- 레벨 기반 스탯, HP, 속도 순서, STAB, 타입 상성, 급소, 데미지 변동이 구현되어 있다.
- 주요 상태이상인 화상, 마비, 독, 수면, 빙결이 구현되어 있다.
- 랭크 변화, 명중/회피, 대타, 혼란, 씨뿌리기, 풀죽음, 부분구속 상태가 구현되어 있다.
- 자동전투 선택 규칙인 공격기 70%, 보조기 30%가 유지된다.
- fallback 기술은 1공격 + 1보조 자동전투 보장을 위해 유지된다.
- 주요 예외 기술 처리가 추가되었다.

주요 예외 기술:

- `Counter`
- `Dream Eater`
- `Rest`
- `Recover`
- `Dig`
- `Jump Kick`
- `High Jump Kick`
- `Substitute`
- `Haze`
- `Transform`
- `Conversion`
- `Hyper Beam`
- `Bind`, `Wrap`, `Clamp`, `Fire Spin`
- `Thrash`, `Petal Dance`
- `Rage`

## 현재 테스트 상태

검증 완료:

- `npm run test`: 통과, 21 tests
- `npm run build`: 통과

테스트에 포함된 주요 항목:

- 151마리 데이터 및 이미지 존재 검증
- 1공격 + 1보조 기술 선택 검증
- 타입 상성 검증
- 시드 재현성 검증
- 랜덤 배틀 종료 검증
- Thunder Wave 대 Ground 무효
- Body Slam의 같은 타입 2차 마비 방지
- Hyper Beam recharge
- Rest 상태 교체 및 회복
- Dig 충전 중 무적
- Jump Kick 빗나감 반동
- Dream Eater 실패 조건
- Counter 성공/실패 조건
- 부분구속 기본 동작
- Substitute의 능력 감소 차단
- Haze 초기화
- Transform 복사

## 주요 리스크

### High: 부분구속 지속시간 처리

`Wrap`, `Bind`, `Clamp`, `Fire Spin` 성공 후 매번 `applyVolatile`이 다시 호출되면 duration이 다시 뽑히고 `lockedTurns`가 덮어써질 수 있다. 이 경우 부분구속이 원작보다 오래 지속되거나 사실상 무한처럼 보일 위험이 있다.

관련 파일:

- `src/core/battle.ts`

우선 수정 방향:

- 부분구속 첫 성공 시에만 duration을 설정한다.
- 이미 `partialtrap` lock 상태인 반복 타격에서는 기존 duration과 저장 데미지만 사용한다.
- Showdown Gen1의 `partialtrappinglock` / `partiallytrapped` 관계에 맞춰 source lock과 target trapped duration을 분리한다.

### High: Gen1 전체 기술 165개 중 147개만 로컬 데이터에 포함

현재 데이터 생성기는 1세대 레벨업 기술과 fallback 기술만 포함한다. Showdown Gen1 전체 기술 165개 중 18개가 누락되어 있다.

누락 확인된 기술:

- `bide`
- `bubblebeam`
- `cut`
- `eggbomb`
- `fireblast`
- `fissure`
- `flash`
- `fly`
- `megadrain`
- `mimic`
- `psywave`
- `razorwind`
- `rockslide`
- `softboiled`
- `strength`
- `struggle`
- `surf`
- `toxic`

현재 MVP 범위가 “레벨업 기술만”이라면 이 누락은 허용 가능하다. 그러나 “모든 Gen1 기술 100%”가 목표라면 데이터 생성 범위부터 확장해야 한다.

관련 파일:

- `scripts/generate-showdown-data.mjs`
- `src/data/showdown-gen1.json`

### Medium: 런타임 검증의 한계

현재 `runtimeValidation`은 데이터 필드가 지원 가능한 형태인지 검증한다. 하지만 단순 필드로 표현되지 않는 특수 기술 로직까지 검증하지는 못한다.

예를 들어 다음 기술은 단순 필드 검증만으로는 충분하지 않다.

- `Mimic`
- `Psywave`
- `Toxic`
- `Bide`
- `Fly`
- `Struggle`

수정 방향:

- `supportedMoveIds` 또는 `moveImplementationMap`을 만들고, 기술 ID별로 구현 상태를 명시한다.
- 데이터에 존재하지만 구현 상태가 `complete`가 아닌 기술은 앱 시작 시 실패하도록 한다.
- 특수 기술은 기술별 테스트를 반드시 추가한다.

관련 파일:

- `src/core/runtimeValidation.ts`

### Medium: 상태 실패 시 마지막 기술 추적

수면, 빙결, 마비, 혼란, Disable 등으로 행동이 실패할 때 `lastMove`, `lastSelectedMove`, `lastDamage`가 Showdown Gen1과 완전히 동일하게 정리되지 않을 수 있다.

영향 기술:

- `Counter`
- `Mirror Move`
- `Bide`
- 부분구속 기술

수정 방향:

- `beforeMove`에서 행동 실패 사유별로 Showdown Gen1의 `lastMove` 처리와 대조한다.
- Counter/Mirror Move/Bide 전용 테스트를 더 추가한다.

관련 파일:

- `src/core/battle.ts`

### Low: 원작 세부 글리치 미구현

현재는 MVP 전투 경험을 우선한 구현이며, 원작 1세대의 모든 버그성 판정까지 포함하지 않는다.

아직 단순화된 영역:

- PP
- 교체
- 아이템
- TM/HM 전체 기술
- `Struggle`
- Toxic 카운터와 Leech Seed 상호작용
- Transform의 PP/세부 복사
- 일부 stat overflow/rollover 세부
- 일부 실패 메시지 및 `lastDamage` 엣지

## 완성도 판단

### MVP 자동전투

현재 상태로 랜덤 2마리 자동 1v1 배틀은 가능하다. 시드 재현성, UI 이벤트, 주요 공격/보조 기술 흐름도 작동한다.

판정: 사용 가능

### 원작 151 레벨업 기술 기반 자동전투

대부분의 일반 기술과 주요 상태 기술은 동작한다. 다만 부분구속, Bide 데이터 누락, 일부 마지막 기술 참조 룰 때문에 “정확히 원작”이라고 말하기는 어렵다.

판정: 추가 보정 필요

### Showdown Gen1 전체 기술 100%

현재 범위 밖이다. 전체 165개 기술 데이터를 포함하고 기술별 구현 매핑과 테스트를 추가해야 한다.

판정: 미완성

## 다음 작업 우선순위

1. 부분구속 duration 리셋 문제 수정
2. 목표 범위 확정: “현재 147개 레벨업/fallback 기술” 또는 “Gen1 전체 165개 기술”
3. 기술별 구현 상태 매핑 추가
4. 미구현 기술이 앱 시작 시 실패하도록 검증 강화
5. Showdown Gen1과 대조하는 고정 시나리오 테스트 추가
6. 누락 기술 포함이 필요하면 데이터 생성기를 전체 Gen1 기술 기준으로 확장

## 추천 기준

MVP 출시 목표라면 먼저 부분구속 버그와 기술 구현 상태 검증을 고치는 것이 우선이다. 전체 Gen1 165개 기술을 목표로 잡으면 범위가 크게 늘어나므로, 별도 마일스톤으로 분리하는 편이 안전하다.
