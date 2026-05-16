# Pokemon Showdown 배틀 엔진 프레임워크 분석

## 분석 기준

- 대상 저장소: https://github.com/smogon/pokemon-showdown
- 확인 커밋: `10f9a5c0d27578c9aed8672494fb2571a3a106e2` (`2026-05-15 14:25:10 -0600`)
- 분석 날짜: `2026-05-16`
- 포함 범위: `sim/` 배틀 시뮬레이터, 배틀에 직접 연결되는 `data/`의 기술/특성/도구/상태/룰/모드 구조, `test/sim/` 테스트 구조 일부
- 제외 범위: 웹 클라이언트, SockJS 서버, 채팅/방/매치메이킹, 로그인 서버, 웹 API, UI 프로토콜 소비 로직

Pokemon Showdown은 서버와 클라이언트가 큰 프로젝트 안팎에 있지만, 실제 전투 계산의 중심은 독립적인 Node.js 시뮬레이터인 `sim/`이다. 배틀 엔진은 "상태 객체 + 액션 큐 + 이벤트 시스템 + 데이터 콜백"으로 구성되어 있고, 기술/특성/도구/상태의 세부 구현은 대부분 `data/`의 선언형 데이터와 `onX` 콜백으로 빠져 있다.

## 1. 배틀 엔진 전체 구조

핵심 파일은 다음처럼 나뉜다.

| 파일 | 역할 |
| --- | --- |
| `sim/battle.ts` | 배틀 전체 상태, 이벤트 시스템, 턴 루프, 요청/응답, 로그 출력, 승패 처리 |
| `sim/battle-actions.ts` | 교체, 기술 사용, 명중 판정, 데미지 계산, Z/Max/Tera/Mega 등 전투 행동 처리 |
| `sim/battle-queue.ts` | 선택된 행동을 우선순위/스피드 순서로 정렬하고 실행 순서를 관리 |
| `sim/side.ts` | 한 플레이어/사이드의 팀, 선택 파서, 요청 데이터, 사이드/슬롯 조건 |
| `sim/pokemon.ts` | 포켓몬 1마리의 능력치, HP, 상태, 랭크, 기술 슬롯, 아이템, 특성, 변신/폼 변화 |
| `sim/field.ts` | 날씨, 필드, 전체 필드 조건 |
| `sim/dex*.ts` | 세대/룰/기술/특성/도구/종족/상태 데이터 로딩 및 객체화 |
| `sim/battle-stream.ts` | 텍스트 스트림 기반 배틀 입출력 래퍼 |
| `sim/prng.ts` | 재현 가능한 난수 생성 |
| `sim/state.ts` | 배틀 상태 직렬화/역직렬화 |
| `data/*.ts` | 실제 기술, 특성, 도구, 상태, 룰, 세대별 스크립트 데이터 |
| `data/mods/**` | 세대별/커스텀 룰별 데이터 및 엔진 오버라이드 |

객체 소유 관계는 아래처럼 보면 된다.

```text
Battle
  - dex: ModdedDex
  - field: Field
  - sides: Side[]
      - pokemon: Pokemon[]
      - active: Pokemon[]
      - choice: Choice
      - sideConditions / slotConditions
  - queue: BattleQueue
  - actions: BattleActions
  - prng: PRNG
  - log / inputLog / messageLog
  - faintQueue
```

`Battle`은 전투의 루트 객체다. `Side`는 플레이어 또는 팀 한쪽을 나타내고, `Pokemon`은 전투 중 변하는 개별 포켓몬 상태를 가진다. `Field`는 날씨/지형/트릭룸 같은 전장 조건을 담당한다. `BattleActions`는 "행동이 실제로 어떤 효과를 내는가"를 담당하고, `BattleQueue`는 "언제 실행되는가"를 담당한다.

## 2. 진입점과 실행 방식

배틀 엔진을 쓰는 방법은 크게 두 가지다.

1. `new Battle(options)`로 직접 생성한다.
2. `BattleStream`에 텍스트 명령을 써서 배틀을 구동한다.

`sim/index.ts`는 패키지 외부 API로 `Battle`, `BattleStream`, `Pokemon`, `PRNG`, `Side`, `Dex`, `Teams`, `TeamValidator`를 export한다. 전투만 보면 `Battle`과 `BattleStream`이 핵심이다.

`BattleStream`은 다음 명령을 받는다.

```text
>start {"formatid":"gen9ou"}
>player p1 {"name":"Alice","team":"..."}
>player p2 {"name":"Bob","team":"..."}
>p1 move 1
>p2 switch 3
```

`BattleStream._writeLine()`은 명령 타입을 파싱해 `new Battle()`, `battle.setPlayer()`, `battle.choose()`로 전달한다. 스트림은 클라이언트가 아니며, 전투 엔진을 표준 입출력 또는 Node stream으로 감싸는 얇은 어댑터다.

## 3. Battle 생성과 초기화

`Battle` 생성자는 먼저 포맷을 읽는다.

1. `Dex.formats.get(formatid)`로 포맷을 찾는다.
2. `Dex.forFormat(format)`로 해당 세대/모드의 `ModdedDex`를 선택한다.
3. 룰 테이블을 만든다.
4. `dex.data.Scripts`와 `format.battle`에 있는 함수 오버라이드를 `Battle` 인스턴스에 주입한다.
5. `Field`, `BattleQueue`, `BattleActions`, `PRNG`, 로그 배열, 상태 플래그를 초기화한다.
6. 옵션에 `p1`, `p2` 등이 있으면 `setPlayer()`로 사이드를 만든다.

`setPlayer()`는 팀 문자열이면 `Teams.unpack()`, 팀이 없으면 랜덤 팀 생성기를 통해 팀을 만든 뒤 `new Side()`를 호출한다. 모든 필요한 사이드가 채워지면 `start()`가 자동 호출된다.

`start()`는 다음 일을 한다.

- `multi`/`freeforall`/일반 배틀에 맞게 `foe`, `allySide` 관계를 연결한다.
- `|gen|`, `|tier|`, `|rated|` 같은 초기 로그를 쌓는다.
- 포맷과 룰의 `onBegin`, `onBattleStart`, `onTeamPreview` 훅을 실행한다.
- 팀 프리뷰가 필요하면 `makeRequest('teampreview')`를 만든다.
- 아니면 큐에 `{ choice: 'start' }` 액션을 넣고 `turnLoop()`를 시작한다.

`start` 액션이 실행되면 양쪽 팀 크기를 기록하고, 각 사이드의 선두 포켓몬을 `BattleActions.switchIn()`으로 필드에 올린다.

## 4. 턴 루프와 선택 처리

선택 처리 흐름은 다음과 같다.

```text
Battle.choose(sideid, input)
  -> Side.choose(input)
     -> chooseMove / chooseSwitch / chooseTeam / choosePass
     -> choice.actions에 ChosenAction 저장
  -> 모든 사이드 선택 완료 확인
  -> Battle.commitChoices()
     -> 각 Side.commitChoices()
     -> BattleQueue.addChoice()
     -> queue.sort()
     -> turnLoop()
```

`Side.choose()`는 `move 1`, `move Thunderbolt +1 zmove`, `switch 3`, `team 123456`, `pass`, `default` 같은 문자열을 파싱한다. 더블/트리플에서는 콤마로 여러 포켓몬의 선택을 구분한다.

`chooseMove()`는 다음을 검증한다.

- 현재 요청 상태가 `move`인지
- 해당 포켓몬 차례인지
- 기술 이름/슬롯이 존재하는지
- Z-Move, Max Move, Mega, Ultra Burst, Terastal 선택이 가능한지
- 타깃 좌표가 기술 타깃 타입과 맞는지
- PP/Disable/Taunt/Encore/락 기술 때문에 사용 불가한지
- 정보 은닉 때문에 취소하면 안 되는 선택인지

`chooseSwitch()`는 교체 가능한 슬롯, 이미 선택된 동시 교체 중복, 기절 여부, trap 여부, 강제 교체 요청 여부를 확인한다.

`commitChoices()`는 중간 교체까지 고려한다. 예를 들어 U-turn처럼 턴 중간에 새 선택이 필요하면 기존 큐를 보존하고 새 교체 액션만 적절한 위치에 넣은 뒤 이어서 턴을 재개한다.

## 5. BattleQueue: 행동 정렬 모델

`BattleQueue`는 완전한 우선순위 큐라기보다, 포켓몬 게임 특유의 정렬 규칙을 반영한 액션 리스트다. `resolveAction()`은 불완전한 선택을 실제 실행 가능한 액션으로 확장한다.

대표 액션 순서는 다음과 같다.

| action | 기본 order |
| --- | ---: |
| `team` | 1 |
| `start` | 2 |
| `instaswitch` | 3 |
| `beforeTurn` | 4 |
| `beforeTurnMove` | 5 |
| `revivalblessing` | 6 |
| `runSwitch` | 101 |
| `switch` | 103 |
| `megaEvo` | 104 |
| `runDynamax` | 105 |
| `terastallize` | 106 |
| `priorityChargeMove` | 107 |
| `move` | 200 |
| `shift` | 200 |
| `residual` | 300 |

정렬 기준은 `Battle.comparePriority()`에 모여 있다.

1. `order`: 낮을수록 먼저
2. `priority`: 높을수록 먼저
3. `speed`: 높을수록 먼저
4. `subOrder`: 낮을수록 먼저
5. `effectOrder`: 낮을수록 먼저
6. 완전 동률은 `PRNG.shuffle()`로 무작위 결정

이 방식 덕분에 "교체가 일반 기술보다 먼저", "기술 우선도", "스피드 동률", "이벤트 생성 순서"가 같은 구조에서 처리된다.

## 6. turnLoop와 runAction

`turnLoop()`는 큐를 하나씩 꺼내 `runAction()`으로 실행한다.

```text
turnLoop()
  - 새 턴이면 beforeTurn, residual 액션 삽입
  - queue.shift() 반복
  - runAction(action)
  - 중간 요청 또는 배틀 종료가 생기면 중단
  - 큐가 비면 endTurn()
```

`runAction()`은 액션 타입별로 분기한다.

- `start`: 선두 포켓몬 switch-in
- `move`: `BattleActions.runMove()`
- `switch`/`instaswitch`: `BattleActions.switchIn()`
- `runSwitch`: switch-in 후 효과 실행
- `megaEvo`, `runDynamax`, `terastallize`: 폼/상태 변환
- `beforeTurn`: `BeforeTurn` 이벤트
- `residual`: 턴 종료 잔여 효과 처리

각 액션 뒤에는 공통 후처리가 붙는다.

- 강제 교체 플래그 처리
- faint queue 처리
- 기절 포켓몬 교체 요청 생성
- `Update` 이벤트 실행
- Gen 8 이상에서는 남은 큐의 스피드를 동적으로 갱신
- 필요한 경우 `makeRequest('switch')`로 턴 중간 요청 생성

`endTurn()`은 턴 번호 증가, Dynamax 종료, 이전 턴 결과 이동, Disable/Trap/MaybeTrap 재계산, 타입 공개 갱신, Endless Battle Clause 검사, 트리플 중앙 이동, `|turn|` 로그 추가, `makeRequest('move')`를 수행한다.

## 7. 이벤트 시스템

이 엔진의 가장 중요한 설계는 이벤트 시스템이다. 기술/특성/도구/상태/필드 효과는 직접 하드코딩되기보다 `onBeforeMove`, `onModifyAtk`, `onResidual`, `onTryHit` 같은 이벤트 핸들러로 구현된다.

### singleEvent

`singleEvent(eventid, effect, state, target, source, sourceEffect, relayVar)`는 특정 effect 하나의 `on${eventid}` 콜백만 실행한다. 예를 들어 기술 자체의 `onTryHit`, 상태 자체의 `onStart`, 아이템 자체의 `onEat` 같은 단일 효과 콜백에 쓴다.

호출 전에는 `this.effect`, `this.effectState`, `this.event`를 현재 이벤트 컨텍스트로 바꾸고, 콜백이 끝나면 부모 컨텍스트를 복원한다. 콜백 안에서 `this.damage()`, `this.boost()`, `this.add()`를 자연스럽게 호출할 수 있는 이유가 이것이다.

### runEvent

`runEvent(eventid, target, source, sourceEffect, relayVar)`는 target 주변의 모든 관련 효과를 모은 뒤 정렬해서 실행한다.

포켓몬 대상 이벤트라면 대략 다음 순서로 핸들러 후보를 찾는다.

- 대상 포켓몬의 status
- 대상 포켓몬의 volatiles
- 대상 포켓몬의 ability
- 대상 포켓몬의 item
- 대상 포켓몬의 species
- 대상 슬롯 조건
- ally/foe/any 접두 이벤트
- source 포켓몬의 source 이벤트
- side condition
- field condition, weather, terrain
- format/rule 이벤트

지원되는 접두 패턴은 `onAllyX`, `onFoeX`, `onSourceX`, `onAnyX`다. 예를 들어 Unnerve 같은 특성은 상대 전체에 영향을 주고, Magic Bounce 같은 효과는 ally/foe 관계와 이벤트 우선순위가 중요하다.

이벤트 반환값 관례는 엔진 전체에서 일관된다.

| 반환값 | 의미 |
| --- | --- |
| `undefined` | 아무 변경 없이 계속 진행 |
| `false` | 실패, 보통 실패 메시지 출력 |
| `null` | 조용한 실패, 이미 별도 메시지를 냈거나 메시지 없음 |
| 숫자/객체/문자열 | relayVar를 이 값으로 교체 |
| truthy | 계속 진행 |

데미지, 명중, 치유, 상태 변경 같은 거의 모든 절차가 이 관례를 공유한다.

### 이벤트 억제

`runEvent()`와 `singleEvent()`는 효과가 현재 유효한지도 검사한다.

- Mold Breaker류가 `breakable` ability 이벤트를 무시
- Gastro Acid, Neutralizing Gas가 ability 이벤트를 무시
- Embargo, Klutz, Magic Room이 item 이벤트를 무시
- Air Lock류가 weather 이벤트를 무시
- 이미 제거된 volatile/status/side condition의 핸들러는 건너뜀

이 구조 덕분에 복잡한 예외가 각 기술에 흩어지지 않고 이벤트 호출부에서 일괄 처리된다.

## 8. 기술 실행 흐름

기술 실행은 `BattleActions.runMove()`와 `BattleActions.useMove()`로 나뉜다.

### runMove: 기술 사용 바깥쪽

`runMove()`는 "포켓몬이 기술을 사용하려고 한다"는 외부 절차를 처리한다.

1. 목표를 계산한다.
2. `OverrideAction`으로 Sleep Talk, Encore류 대체 행동을 받을 수 있다.
3. Z/Max Move라면 active move를 변환한다.
4. `BeforeMove` 이벤트로 flinch, paralysis, sleep, recharge 등을 처리한다.
5. move 자체의 `beforeMoveCallback`을 실행한다.
6. PP를 차감한다.
7. `pokemon.moveUsed()`로 마지막 사용 기술과 타깃 위치를 기록한다.
8. Z-Move 메시지나 Illusion 종료 같은 특수 처리를 한다.
9. `useMove()`로 실제 효과를 실행한다.
10. `AfterMove` 이벤트를 실행한다.
11. Dancer처럼 다른 포켓몬이 같은 기술을 따라 쓰는 후속 처리를 한다.

`externalMove` 옵션은 Dancer, Instruct, Pursuit 같은 특수 호출에서 PP 차감/락 처리 일부를 건너뛰기 위해 사용된다.

### useMoveInner: 기술 효과 안쪽

`useMoveInner()`는 기술 자체의 효과를 처리한다.

1. `ModifyTarget`으로 타깃을 조정한다.
2. `ModifyType`, `ModifyMove`를 기술 자체와 주변 이벤트에 대해 실행한다.
3. `|move|` 로그를 기록한다.
4. 타깃이 없으면 실패 처리한다.
5. `pokemon.getMoveTargets()`로 실제 타격 대상 배열과 Pressure 대상 배열을 만든다.
6. Pressure 등 추가 PP 차감 이벤트를 실행한다.
7. `TryMove`, `UseMoveMessage`를 실행한다.
8. side/field 대상 기술은 `tryMoveHit()`, 포켓몬 대상 기술은 `trySpreadMoveHit()`로 보낸다.
9. self boost, self destruct, AfterMoveSecondary, Emergency Exit 등을 처리한다.

기술 데이터에 `target: "normal"`, `target: "allAdjacentFoes"`, `target: "allySide"`처럼 대상 타입이 들어 있으므로, 엔진은 target 타입에 맞는 대상 확장/검증을 공통으로 처리한다.

## 9. 명중 판정 파이프라인

`trySpreadMoveHit()`는 단일 대상 기술까지 포함하는 핵심 명중 파이프라인이다. 내부 단계는 배열로 구성되어 있고, 세대별로 일부 순서를 바꾼다.

기본 단계는 다음과 같다.

1. `Invulnerability`: Fly/Dig/Dive 같은 반무적 상태
2. `TryHit`: Protect, Magic Bounce, Volt Absorb 같은 차단/변환
3. 타입 면역
4. powder, Prankster 등 기타 면역
5. accuracy 계산
6. Protect 파괴 효과
7. Spectral Thief류 랭크 강탈
8. 실제 hit loop

Gen 6 이하, Gen 4는 타입 면역과 TryHit/Accuracy의 순서가 달라서 배열 순서를 교환한다. 이것은 "세대별 룰 차이를 데이터와 작은 분기 조합으로 유지한다"는 Showdown식 구현의 대표 사례다.

hit loop는 multi-hit 기술까지 처리한다.

- 2~5회 기술 확률 분포
- Loaded Dice 보정
- Sleep 중 multi-hit 중단
- smart target 재지정
- Triple Kick류 multiaccuracy
- 각 hit마다 `spreadMoveHit()`
- recoil/drain/Struggle recoil
- hit count 메시지
- `DamagingHit`, `AfterHit`, `AfterMoveSecondary`

## 10. spreadMoveHit와 기술 효과 적용

`spreadMoveHit()`는 실제 한 번의 hit에서 다음 절차를 수행한다.

1. moveData의 `TryHitField`, `TryHitSide`, `TryHit` 실행
2. Substitute/primary hit 처리
3. `getSpreadDamage()`로 대상별 데미지 계산
4. `battle.spreadDamage()`로 HP 감소 및 데미지 로그 기록
5. `runMoveEffects()`로 boosts/status/volatile/sideCondition/weather/terrain/onHit 적용
6. self drop 처리
7. secondary effects 처리
8. force switch 처리
9. `DamagingHit` 및 `AfterHit` 이벤트 실행

`runMoveEffects()`는 move data의 속성을 공통 처리한다.

- `boosts`: 랭크 변화
- `heal`: 회복
- `status`: 주요 상태 이상
- `forceStatus`: 면역을 덜 타는 강제 상태
- `volatileStatus`: 혼란, 씨뿌리기, 대타출동 등
- `sideCondition`: 리플렉터, 스텔스록 등
- `slotCondition`: 특정 active slot에 붙는 조건
- `weather`, `terrain`, `pseudoWeather`
- `onHit`, `onHitSide`, `onHitField`
- `selfSwitch`: U-turn, Volt Switch류 교체 플래그

이 구조 때문에 `data/moves.ts`의 많은 기술은 "기본 수치 + flags + 부가 효과 데이터"만으로 구현되고, 정말 특수한 경우에만 `onHit` 같은 콜백을 가진다.

## 11. 데미지 계산

데미지 계산은 `BattleActions.getDamage()`와 `modifyDamage()`가 담당한다.

흐름은 다음과 같다.

1. 타입 면역 확인
2. OHKO, 고정 데미지, level 데미지, `damageCallback` 처리
3. 카테고리 결정
4. basePower와 `basePowerCallback`
5. 급소 확률 계산 및 `CriticalHit` 이벤트
6. `BasePower` 이벤트로 위력 보정
7. Tera 관련 최소 위력 보정
8. 공격/방어 스탯 선택
9. 급소 시 불리한 공격 랭크/유리한 방어 랭크 무시
10. `ModifyAtk`, `ModifyDef`, `ModifySpA`, `ModifySpD` 이벤트
11. 기본 데미지 공식 적용
12. `modifyDamage()`에서 최종 보정

`modifyDamage()`는 다음 요소를 순서대로 반영한다.

- +2 기본 보정
- spread move 보정
- Parental Bond 보정
- weather damage modifier
- critical multiplier
- 랜덤 85~100% 계수
- STAB, Tera STAB, Stellar Tera
- 타입 상성 및 메시지
- burn 물리 데미지 감소
- `ModifyDamage` 이벤트
- Z/Max protect 관통 보정
- 최소 1 데미지와 16-bit truncation

수치 계산은 실제 게임의 정수 절삭을 맞추기 위해 `Battle.trunc()`, `Battle.modify()`, `Battle.chainModify()`, `Battle.finalModify()`를 사용한다. 단순한 실수 곱셈을 끝까지 유지하지 않고, 포켓몬 본가의 단계별 절삭을 흉내낸다.

## 12. 포켓몬 상태 모델

`Pokemon`은 단순 데이터 객체가 아니라 전투 중 변하는 거의 모든 상태의 집합이다.

중요 필드:

- `set`: 원본 팀 세트
- `baseSpecies`, `species`: 원래 종족과 현재 폼
- `baseMoveSlots`, `moveSlots`: 원래 기술과 현재 기술
- `hp`, `maxhp`, `baseMaxhp`
- `status`, `statusState`
- `volatiles`: 혼란, 대타, 잠김, Dynamax 등 임시 상태
- `boosts`: 랭크 변화
- `ability`, `abilityState`
- `item`, `itemState`, `lastItem`
- `types`, `addedType`, `teraType`, `terastallized`
- `trapped`, `maybeTrapped`, `maybeDisabled`, `maybeLocked`
- `lastMove`, `moveThisTurn`, `moveThisTurnResult`, `moveLastTurnResult`
- `attackedBy`, `hurtThisTurn`, `timesAttacked`

상태 변경 메서드는 전부 이벤트를 통과한다.

- `setStatus()`: 면역 확인, `SetStatus`, status `Start`, `AfterSetStatus`
- `addVolatile()`: `TryAddVolatile`, volatile `Start`
- `removeVolatile()`: volatile `End`
- `setItem()`: 기존 item `End`, 새 item `Start`
- `useItem()`/`eatItem()`/`takeItem()`: `UseItem`, `Eat`, `AfterUseItem`, `TakeItem`
- `setAbility()`: `SetAbility`, 기존 ability `End`, 새 ability `Start`
- `formeChange()`: 종족/스탯/타입/특성 변경과 프로토콜 메시지
- `transformInto()`: Transform 전용 스탯/기술/타입/랭크 복사

`Pokemon.faint()`는 즉시 완전 기절 처리하지 않고 `battle.faintQueue`에 넣는다. 실제 메시지 출력, ability/item end, volatile 정리, 승패 확인은 `Battle.faintMessages()`에서 처리된다. 이 지연 큐가 있어야 동시 기절, 다중 타격, Gen 1~3의 특수한 기절 순서를 맞출 수 있다.

## 13. Side와 선택 요청 데이터

`Side`는 플레이어 한 명의 전투 관점이다. `multi` 배틀에서는 플레이어, 팀, half-field 개념이 달라지므로 `side.ts` 상단에서 용어를 구분한다.

`getRequestData()`와 `pokemon.getMoveRequestData()`는 플레이어에게 보낼 선택 요청 JSON을 만든다. 이 요청은 다음 정보를 담는다.

- active 포켓몬별 사용 가능한 기술
- PP, maxPP, target type, disabled 상태
- trapped/maybeTrapped, maybeDisabled, maybeLocked
- canMegaEvo, canZMove, canDynamax, canTerastallize
- 전체 팀의 현재 HP/상태/기술/아이템/특성 정보

Showdown은 정보 은닉을 중요하게 다룬다. 예를 들어 "어떤 기술이 실제로 disabled인지" 또는 "상대가 trapping ability를 가졌는지"는 선택 취소를 허용하면 누출될 수 있다. 그래서 `choice.cantUndo`, `maybeTrapped`, `maybeDisabled` 같은 필드가 존재하고, 불법 선택 시에는 request를 업데이트해서 플레이어에게 새 정보를 제공한다.

## 14. Field, Side Condition, Slot Condition

`Field`는 세 종류의 전장 효과를 관리한다.

- `weather`: Rain, Sun, Sandstorm 등
- `terrain`: Electric Terrain 등
- `pseudoWeather`: Trick Room, Gravity 같은 전체 필드 조건

각 변경은 `FieldStart`, `FieldEnd`, `WeatherChange`, `TerrainChange`, `PseudoWeatherChange` 이벤트를 통과한다. 지속시간은 `EffectState.duration`에 저장되고, residual 단계에서 줄어든다.

`Side`는 두 종류의 조건을 관리한다.

- `sideConditions`: Stealth Rock, Reflect, Tailwind처럼 사이드 전체에 붙는 효과
- `slotConditions`: 특정 active position에 붙는 효과

추가/제거 시 `SideStart`, `SideRestart`, `SideEnd`, `Start`, `End` 같은 이벤트를 호출한다.

## 15. Dex와 data/mods 구조

`ModdedDex`는 배틀 엔진과 데이터 파일 사이의 로더다.

주요 특징:

- 데이터는 필요할 때 lazy load 된다.
- `Dex.forFormat(format)`이 포맷의 `mod`를 보고 세대별 Dex를 고른다.
- 기본 데이터는 `data/`에 있고, 세대/커스텀 모드는 `data/mods/{mod}/`에 있다.
- 모드는 `scripts.ts`의 `inherit`으로 부모 모드 데이터를 상속한다.
- `{ inherit: true }` 데이터는 부모 항목 일부만 덮어쓴다.
- `Scripts`는 엔진 객체에 직접 주입되어 세대별 계산 차이를 오버라이드할 수 있다.

전투 데이터 객체들은 모두 `BasicEffect` 계열이다.

- `Move`: 기술
- `Ability`: 특성
- `Item`: 도구
- `Condition`: 상태, volatile, weather, terrain, side condition
- `Species`: 종족
- `Format`: 룰/포맷

데이터는 단순 수치와 이벤트 콜백을 함께 가진다. 예를 들어 기술은 `basePower`, `accuracy`, `category`, `type`, `target`, `flags`, `secondary`, `condition`, `onHit`, `onModifyMove` 등을 가질 수 있다. 특성과 도구도 `onStart`, `onModifyAtk`, `onResidual`, `onTryHit` 같은 같은 이벤트 이름을 사용한다.

이 설계의 핵심은 "엔진은 공통 절차를 알고, 개별 효과는 데이터가 알려준다"는 점이다.

## 16. PRNG와 재현성

`PRNG`는 배틀 재현성을 위해 독립 구현되어 있다.

- 기본은 `sodium` seed 기반 Chacha20 RNG
- 과거 input log 호환을 위해 Gen 5 LCG seed도 지원
- `random()`, `randomChance()`, `sample()`, `shuffle()` API 제공
- speed tie는 Fisher-Yates shuffle로 처리

`Battle.inputLog`는 seed, 플레이어 등록, 선택 입력을 기록한다. 같은 seed와 같은 input log를 재생하면 같은 배틀 결과를 얻는 구조다.

## 17. 로그와 프로토콜 출력

배틀 엔진은 UI를 직접 다루지 않는다. 대신 `Battle.add()`로 protocol line을 `log`에 쌓고, `sendUpdates()`가 `send('update', lines)`로 내보낸다.

중요한 출력 구조:

- `update`: 전체 공개 배틀 로그
- `sideupdate`: 특정 플레이어에게만 보내는 request/error
- `end`: 승자, seed, turn 수, 팀, inputLog 등 종료 JSON

`addSplit()`은 `|split|p1` 형태로 한 플레이어에게는 정확한 정보, 다른 플레이어에게는 공개 정보만 보낸다. HP 표시가 정확한 값/퍼센트/48픽셀로 달라지는 것도 `Pokemon.getHealth()`와 split 메시지 구조를 통해 처리된다.

## 18. 상태 저장과 복원

`sim/state.ts`는 `Battle`을 JSON으로 직렬화하고 다시 복원한다.

난점은 객체 그래프가 순환 구조라는 점이다.

- `Battle -> Side -> Pokemon -> Battle`
- `EffectState.target -> Pokemon/Side/Field`
- queue 안 action이 pokemon 참조를 가짐

`State`는 참조 가능한 객체를 `[Type]` 형태의 ref로 저장하고, 불필요하거나 재구성 가능한 필드는 제외한다. 복원 시에는 먼저 `new Battle()`로 기본 객체를 만들고, 팀 순서를 맞춘 뒤 필드를 덮어쓴다. 실서비스 재현에는 input log가 더 단순하지만, 중간 상태 스냅샷이 필요할 때 이 구조를 쓴다.

## 19. 세대 차이 처리 방식

Pokemon Showdown은 Gen 1부터 Gen 9까지 지원하므로 세대별 차이가 많다. 구현 방식은 세 가지가 섞여 있다.

1. 공통 엔진의 작은 분기  
   예: Gen 4 이하 accuracy/Type/TryHit 순서, Gen 8 동적 스피드 재정렬, Gen 1 기절 시 큐 클리어.

2. `data/mods/{gen}/` 데이터 오버라이드  
   예: 특정 세대의 기술 수치, 아이템, 특성, 상태 로직 변경.

3. `Scripts` 오버라이드  
   예: `Battle`, `BattleActions`, `Side`, `Pokemon`, `Field`, `Queue`의 일부 동작을 모드별로 바꾼다.

엔진 전체를 세대별 클래스로 나누지 않고, 공통 흐름 위에 데이터와 스크립트로 차이를 얹는 방식이다.

## 20. 테스트 구조

`test/sim/` 아래에는 전투 메커닉별 테스트가 매우 세분화되어 있다.

- `misc/accuracy.js`, `misc/critical.js`, `misc/faint-order.js`, `misc/turn-order.js`
- `misc/terastal.js`, `misc/dynamax.js`, `misc/megaevolution.js`
- `items/*`, `abilities/*`
- `team-validator/*`
- `events.js`, `decisions.js`, `dex.js`

이는 이 엔진의 특성상 필수다. 로직이 이벤트와 데이터 콜백으로 분산되어 있기 때문에, 단일 함수 테스트보다 "실제 배틀을 작은 시나리오로 돌려 검증"하는 테스트가 중요하다.

## 21. 구현 스타일 평가

장점:

- 공통 전투 흐름과 개별 효과 구현이 잘 분리되어 있다.
- 기술/특성/도구/상태가 같은 이벤트 시스템을 공유한다.
- 세대/포맷 모드를 데이터 상속과 스크립트 주입으로 처리한다.
- input log와 seed 기반 재현성이 강하다.
- 숨겨진 정보와 공개 정보를 프로토콜 단계에서 분리한다.

주의점:

- 상태가 매우 mutable하다. 순수 함수형 엔진이 아니므로 추적은 어렵다.
- 이벤트 반환값 관례를 모르면 `false`, `null`, `undefined`, `0`의 의미를 헷갈리기 쉽다.
- 많은 구현이 `data/` 콜백에 흩어져 있어 `sim/`만 읽으면 전체 효과를 알 수 없다.
- 세대별 예외가 많아 작은 변경도 테스트 없이 안전하게 판단하기 어렵다.
- 배틀 엔진만 써도 `Dex`, `Teams`, `data/mods` 의존성이 크다.

## 22. Async Pocket Trainer에 참고할 점

이 프로젝트에서 Showdown을 참고해 경량 배틀 엔진을 만들 경우, 그대로 복제하기보다 아래 구조만 가져오는 편이 현실적이다.

1. `Battle` 루트 상태  
   전투 전체 로그, 턴 번호, RNG, active 포켓몬, 승패를 한 곳에서 관리한다.

2. `BattleQueue`  
   교체/공격/잔여효과를 같은 큐에 넣고 `order + priority + speed`로 정렬한다.

3. `Pokemon` 상태 객체  
   HP, 능력치, 랭크, 상태 이상, 임시 상태, 기술 슬롯을 명확히 나눈다.

4. 데이터 기반 기술 정의  
   `basePower`, `accuracy`, `type`, `category`, `target`, `effects` 정도를 JSON/TS 데이터로 분리한다.

5. 작은 이벤트 시스템  
   MVP에서는 `BeforeMove`, `ModifyDamage`, `AfterHit`, `Residual`, `SwitchIn` 정도만 있어도 충분하다.

6. seed 기반 RNG  
   비동기/리플레이/검증을 생각하면 Math.random 직접 사용보다 seed RNG가 낫다.

Showdown 전체 이벤트 시스템은 매우 강력하지만, MVP 자동 전투에는 과하다. 초기에는 "큐 + 데미지 공식 + 상태 이상 + 간단한 이벤트 훅"으로 시작하고, 필요한 효과만 데이터 콜백으로 늘리는 방식이 적합하다.

## 23. 핵심 흐름 요약

```text
BattleStream or direct API
  -> Battle 생성
  -> Side/Pokemon 생성
  -> start()
  -> team preview 또는 start action
  -> makeRequest('move')
  -> Side.choose()
  -> BattleQueue.addChoice()
  -> turnLoop()
     -> runAction()
        -> switchIn() or runMove()
        -> useMoveInner()
        -> trySpreadMoveHit()
        -> spreadMoveHit()
        -> getDamage() / spreadDamage()
        -> runMoveEffects()
     -> faintMessages()
     -> residual
     -> endTurn()
  -> 다음 request 또는 win/tie
```

한 문장으로 정리하면, Pokemon Showdown의 배틀 엔진은 **선택 문자열을 액션 큐로 바꾸고, 큐의 각 액션을 이벤트 시스템을 통과시키며, 데이터 파일에 정의된 콜백들이 그 이벤트에 끼어들어 실제 포켓몬 룰을 완성하는 구조**다.

## 참고한 주요 소스

- https://github.com/smogon/pokemon-showdown/tree/10f9a5c0d27578c9aed8672494fb2571a3a106e2/sim
- https://github.com/smogon/pokemon-showdown/blob/10f9a5c0d27578c9aed8672494fb2571a3a106e2/sim/battle.ts
- https://github.com/smogon/pokemon-showdown/blob/10f9a5c0d27578c9aed8672494fb2571a3a106e2/sim/battle-actions.ts
- https://github.com/smogon/pokemon-showdown/blob/10f9a5c0d27578c9aed8672494fb2571a3a106e2/sim/battle-queue.ts
- https://github.com/smogon/pokemon-showdown/blob/10f9a5c0d27578c9aed8672494fb2571a3a106e2/sim/side.ts
- https://github.com/smogon/pokemon-showdown/blob/10f9a5c0d27578c9aed8672494fb2571a3a106e2/sim/pokemon.ts
- https://github.com/smogon/pokemon-showdown/blob/10f9a5c0d27578c9aed8672494fb2571a3a106e2/sim/field.ts
- https://github.com/smogon/pokemon-showdown/blob/10f9a5c0d27578c9aed8672494fb2571a3a106e2/sim/dex.ts
- https://github.com/smogon/pokemon-showdown/tree/10f9a5c0d27578c9aed8672494fb2571a3a106e2/data
