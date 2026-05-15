# 튜토리얼 가이드 팝업 설계

이 문서는 현재 게임 구현을 기준으로, 처음 접속한 유저에게 보여줄 큰 가이드 팝업의 등장 시점과 내용을 정리한다.

각 팝업은 단순 알림이 아니라 1~2페이지짜리 작은 가이드북처럼 구성한다. 유저가 닫은 직후 바로 마주칠 화면, 버튼, 시스템을 한 번에 이해해서 "방금 본 가이드가 이걸 말한 거구나"라고 느끼게 하는 것이 목표다.

## 고정 팝업 시점

1. 게임 첫 접속
2. 첫 상점 진입
3. 첫 인게임 전투 시작 전, 월드맵 이전
4. 첫 포켓몬 잡기 성공
5. 첫 포켓몬 잡기 실패
6. 첫 트레이너전 성공
7. 첫 전투 실패

## 실제 코드 흐름

```text
starterChoice
  -> START_RUN
ready
  -> RESOLVE_NEXT_ENCOUNTER
    -> 야생전 승리: captureDecision
    -> 트레이너전 승리: ready + checkpointVictory 화면
    -> 패배: gameOver
captureDecision
  -> ATTEMPT_CAPTURE 성공: teamDecision
  -> ATTEMPT_CAPTURE 실패: ready
  -> DISCARD_CAPTURE: ready
teamDecision
  -> ACCEPT_CAPTURE 또는 DISCARD_CAPTURE: ready
gameOver
  -> START_RUN 또는 RETURN_TO_STARTER_CHOICE
```

구현상 중요한 점:

- `ready`는 전투 준비 화면이자 상점 화면이다. 스타터 선택 직후 바로 상점 카드와 `전투 시작` 버튼이 함께 보인다.
- 브라우저의 `starterChoice` 화면은 151마리 도감형 화면이다. 처음에는 `start:1`, `start:4`, `start:7`만 선택 가능하다.
- 첫 전투 시작 가이드는 `RESOLVE_NEXT_ENCOUNTER` 실행 전, 즉 월드맵 인트로와 전투 리플레이가 나오기 전에 보여줘야 한다.
- 포획 실패는 별도 phase가 아니다. 실패하면 바로 다음 웨이브 `ready`로 가고, `frame.scene.capture.result === "failure"`가 오버레이로 남는다.
- 첫 트레이너전 성공 화면은 별도 phase가 아니다. `frame.phase === "ready"`이지만 `statusView.teamRecord`가 있으면 `checkpointVictory` 화면으로 렌더된다.

## 가이드북 형식

각 팝업은 다음 구조를 따른다.

- 페이지 수: 1~2페이지
- 페이지당 본문: 짧은 문장 3~5개
- 페이지 1: 지금 화면에서 무엇을 보고 있는지 설명
- 페이지 2: 곧 누를 버튼과 그 결과 설명
- 마지막 버튼: `알겠어요`, `시작하기`, `다음`, `저장하기`처럼 유저 행동과 연결

팝업은 시스템 설명을 길게 늘어놓지 않는다. 대신 곧바로 볼 UI와 연결되는 말만 쓴다.

## 비주얼 기준

- 팝업마다 대표 아이콘과 주제색을 둔다. 예: 도감 `📜`, 상점 `🪙`, 전투 `⚔️`, 포획은 실제 볼 SVG.
- 본문 각 줄 앞에는 내용에 맞는 작은 아이콘을 붙인다.
- `코인`, `보석`, `팀`, `HP`, `전투`, `포획`, `PREMIUM` 같은 핵심 단어는 색 있는 강조 배지로 표시한다.
- 강조색은 실제 게임 UI에서 쓰는 코인/보석/전투/포획 색과 맞춘다.
- 모바일에서 스크롤 없이 읽을 수 있도록 줄당 문장은 짧게 유지한다.

예:

```text
상점 카드에는 코인이 필요해요.
코인이 부족한 카드는 어둡게 보여요.
준비가 끝나면 전투 시작을 눌러요.
```

## 팝업 등장 시점 요약

| ID | 사용자 시점 | 실제 감지 조건 | 페이지 | 닫기 조건 |
| --- | --- | --- | --- | --- |
| `first-visit` | 게임 첫 접속 | 튜토리얼 기록 없음 + `frame.phase === "starterChoice"` | 2 | 스타터 선택 완료 |
| `first-shop` | 첫 상점 진입 | 첫 `ready` 렌더, `frame.hud.wave === 1`, `shop:*` 액션 존재 | 2 | 확인 또는 첫 행동 |
| `first-battle-start` | 첫 인게임 전투 시작 전, 월드맵 이전 | `encounter:next` 첫 클릭, `RESOLVE_NEXT_ENCOUNTER` 실행 전 | 2 | 확인 후 원래 전투 시작 실행 |
| `first-capture-success` | 첫 포켓몬 잡기 성공 | `frame.phase === "teamDecision"` + `frame.scene.capture.result === "success"` | 2 | `ACCEPT_CAPTURE` 또는 `DISCARD_CAPTURE` |
| `first-capture-failure` | 첫 포켓몬 잡기 실패 | `frame.phase === "ready"` + `frame.scene.capture.result === "failure"` | 1 | 다음 행동 |
| `first-trainer-win` | 첫 트레이너전 성공 | `frame.phase === "ready"` + `statusView.teamRecord` 존재 | 2 | 기록 저장 |
| `first-battle-loss` | 첫 전투 실패 | `frame.phase === "gameOver"` + 리플레이 종료 | 2 | 재시작 행동 |

## 팝업 상세 내용

### `first-visit` - 게임 첫 접속

- 실제 화면: `data-screen="starterChoice"`
- 실제 액션: `start:1`, `start:4`, `start:7`
- 강조 대상:
  - `.starter-option[data-starter-state="unlocked"]`
  - 카드 선택 후 `.starter-confirm[data-action-id^="start:"]`

페이지 1 - 도감 화면 보기:

```text
밝은 카드는 지금 고를 수 있는 포켓몬이에요.
어두운 카드는 아직 잠긴 포켓몬이에요.
전투에서 포켓몬을 잡고 팀에 데려오면 도감이 열려요.
처음에는 이상해씨, 파이리, 꼬부기부터 시작해요.
```

페이지 2 - 첫 친구 선택:

```text
밝은 카드를 누르면 아래에 선택 버튼이 나와요.
선택을 누르면 그 포켓몬이 첫 팀원이 돼요.
보상 표시가 있으면 카드를 눌러 보석을 먼저 받아요.
도감이 늘수록 다음 도전에서 고를 친구가 많아져요.
```

- 마지막 버튼: `첫 친구 고르기`

### `first-shop` - 첫 상점 진입

- 실제 화면: `frame.phase === "ready"`인 상점 화면
- 실제 액션:
  - `encounter:next`
  - `shop:*`
  - `claim:skill:*`가 있을 수 있음
- 강조 대상:
  - `.shop-money`
  - `.shop-trainer-points`
  - `.shop-team-grid`
  - `.shop-card-grid`
  - `.shop-start-action[data-action-id="encounter:next"]`

페이지 1 - 준비 화면 이해:

```text
위쪽 팀 칸에는 포켓몬을 최대 6마리까지 둘 수 있어요.
빈 칸은 다음에 잡은 포켓몬이 들어갈 자리예요.
포켓몬 카드를 누르면 HP, 능력치, 기술을 자세히 볼 수 있어요.
아이템을 쓰기 전에 누가 다쳤는지 먼저 확인해요.
```

페이지 2 - 상점에서 할 수 있는 일:

```text
코인은 전투에서 벌고 이번 모험 안에서만 써요.
보석은 도감, 기술, 웨이브 보상으로 얻고 계속 남아요.
단일 대상 카드는 한 마리를 고르고, 전체 카드는 팀 모두에게 써요.
기술 학습처럼 맞는 팀원이 있어야 살 수 있는 카드도 있어요.
PREMIUM 카드는 보석으로 사는 강한 상품이에요.
```

- 마지막 버튼: `상점 둘러보기`
- 주의: 상점은 별도 메뉴가 아니라 스타터 선택 직후 첫 `ready` 화면 자체다.

### `first-battle-start` - 첫 인게임 전투 시작 전, 월드맵 이전

- 실제 트리거: `encounter:next` 버튼을 처음 눌렀을 때
- 구현 위치: `RESOLVE_NEXT_ENCOUNTER` dispatch 전에 인터셉트해서 1회 표시
- 강조 대상: `.shop-start-action[data-action-id="encounter:next"]`

페이지 1 - 길을 떠나기 전:

```text
전투 시작을 누르면 길을 떠나요.
먼저 월드맵처럼 이동 장면이 보여요.
그다음 야생 포켓몬이나 트레이너를 만나요.
웨이브 숫자가 올라갈수록 더 어려워져요.
```

페이지 2 - 전투 방식:

```text
전투는 자동으로 진행돼요.
기술은 포켓몬이 알아서 사용해요.
유저는 전투 중 버튼을 고르지 않아요.
이기면 보상과 다음 선택이 나와요.
```

- 마지막 버튼: `전투 시작`
- 닫기 동작: 확인 버튼을 누르면 기존 `RESOLVE_NEXT_ENCOUNTER` 액션을 그대로 실행한다.
- 주의: 이미 전투 리플레이가 시작된 뒤에는 이 팝업을 띄우지 않는다.

### `first-capture-success` - 첫 포켓몬 잡기 성공

- 실제 조건:
  - `frame.phase === "teamDecision"`
  - `frame.scene.capture?.result === "success"`
- 실제 액션:
  - `team:keep`
  - `team:replace:*`가 있을 수 있음
  - `team:release`
- 강조 대상:
  - `.candidate-panel`
  - `.team-compare-panel`
  - `.command-band [data-action-id="team:keep"]`
  - `.command-band [data-action-id^="team:replace:"]`
  - `.command-band [data-action-id="team:release"]`

페이지 1 - 잡은 포켓몬 확인:

```text
포켓몬을 잡았어요.
왼쪽에는 새로 잡은 포켓몬이 보여요.
전투력, HP, 능력치, 기술을 볼 수 있어요.
지금 팀과 비교해서 데려갈지 고르면 돼요.
```

페이지 2 - 팀에 넣는 방법:

```text
팀에 자리가 있으면 팀에 추가할 수 있어요.
팀은 최대 6마리까지 데려갈 수 있어요.
팀이 꽉 차면 한 마리와 바꿔야 해요.
데려가지 않으려면 놓아주기를 눌러요.
```

- 마지막 버튼: `팀 정하기`
- 팀이 6마리 미만이면 `팀에 추가`를 우선 강조한다.
- 팀이 6마리면 교체 버튼과 `놓아주기`를 강조한다.

### `first-capture-failure` - 첫 포켓몬 잡기 실패

- 실제 조건:
  - `frame.phase === "ready"`
  - `frame.scene.capture?.result === "failure"`
- 강조 대상:
  - `.capture-overlay[data-capture-result="failure"]`
  - 볼 구매 상점 카드
  - `.shop-start-action[data-action-id="encounter:next"]`

페이지 1 - 실패 후 다음 행동:

```text
포켓몬이 볼에서 나올 때도 있어요.
사용한 볼은 하나 줄어들어요.
실패해도 게임은 계속 진행돼요.
이미 다음 웨이브 준비 화면으로 이동했어요.
볼이 부족하면 상점에서 새로 사요.
```

- 마지막 버튼: `다시 준비하기`
- 주의: 실패 직후에는 이미 다음 웨이브 `ready` 상태다.

### `first-trainer-win` - 첫 트레이너전 성공

- 실제 조건:
  - 체크포인트 웨이브에서 `RESOLVE_NEXT_ENCOUNTER` 승리
  - `frame.phase === "ready"`
  - `statusView.teamRecord` 존재
- 실제 화면: `data-screen="checkpointVictory"`
- 강조 대상:
  - `.checkpoint-victory-card`
  - `[data-team-record-form]`
  - 정산 저장 버튼
- 기본 체크포인트: `defaultBalance.checkpointInterval === 5`

페이지 1 - 트레이너전 이해:

```text
트레이너에게 이겼어요.
트레이너전은 보통 야생 포켓몬보다 더 중요해요.
몇 웨이브마다 강한 팀이 등장해요.
이기면 지금 팀을 기록으로 남길 수 있어요.
```

페이지 2 - 기록 저장:

```text
팀 이름은 다른 유저가 볼 수 있어요.
인사말은 짧게 남길 수 있어요.
정산 저장을 누르면 현재 팀 기록이 저장돼요.
저장된 팀은 나중에 다른 전투에 등장할 수 있어요.
```

- 마지막 버튼: `기록 보기`
- 주의: 동기화가 꺼졌거나 실패하면 기록 화면의 메시지를 같이 보여준다.

### `first-battle-loss` - 첫 전투 실패

- 실제 조건:
  - `frame.phase === "gameOver"`
  - `playback.isPlaying === false`
- 실제 액션:
  - `restart:team:*`
  - `restart:starter-choice`
- 강조 대상:
  - `.result-board`
  - `.final-team-slot`
  - `.command-band [data-action-id^="restart:team:"]`
  - `.command-band [data-action-id="restart:starter-choice"]`

페이지 1 - 도전 종료 화면:

```text
전투에서 지면 도전이 끝나요.
가운데에는 몇 웨이브까지 갔는지 보여요.
아래에는 함께했던 팀이 보여요.
져도 저장된 도감과 보상은 사라지지 않아요.
```

페이지 2 - 다시 시작하는 방법:

```text
팀에 있던 포켓몬으로 다시 시작할 수 있어요.
처음 화면으로 돌아가 새 친구를 골라도 돼요.
다음 도전에서는 상점과 포획을 더 잘 써봐요.
다시 시작하면 1웨이브부터 출발해요.
```

- 마지막 버튼: `다시 도전하기`
- 주의: 패배 직후 전투 리플레이가 남아 있을 수 있으므로 리플레이 종료 뒤 표시한다.

## 저장 정책

튜토리얼 진행 기록은 브라우저 저장소에 저장한다.

- 추천 키: `apt:tutorial:v1`
- 7개 팝업 ID별 `seen` 값을 저장한다.
- 저장된 게임이 중간 상태에서 시작할 수 있으므로, 현재 조건에 맞고 아직 보지 않은 팝업만 보여준다.
- 모든 팝업 하단에는 `다시 보지 않기` 체크박스를 둔다.
- 체크박스는 기본 체크 상태다.
- 체크된 상태에서 팝업을 닫거나 마지막 페이지까지 넘기면 본 것으로 저장한다.
- 체크를 해제한 상태에서 닫거나 마지막 페이지까지 넘기면 현재 접속 세션에서만 다시 띄우지 않고, 브라우저 저장소에는 저장하지 않는다.
- 개발/설정용 초기화 버튼은 `apt:tutorial:v1`만 지운다.

예시:

```json
{
  "seen": {
    "first-visit": true,
    "first-shop": true,
    "first-battle-start": true,
    "first-capture-success": true,
    "first-capture-failure": true,
    "first-trainer-win": true,
    "first-battle-loss": true
  }
}
```

## 구현 기준

- 큰 팝업은 한 번에 하나만 표시한다.
- 각 팝업은 `pages` 배열로 구현한다. 페이지가 1개면 넘김 버튼 없이 확인 버튼만 둔다.
- 2페이지 팝업은 `다음` 버튼으로 넘기고, 마지막 페이지에서 실제 행동 버튼을 보여준다.
- `first-battle-start`는 액션 실행 전 팝업이므로 `bindActions`에서 `encounter:next` 첫 클릭을 가로챈다.
- 나머지 팝업은 렌더된 `GameFrame`, `statusView`, `playback` 상태를 기준으로 선택한다.
- 전투 리플레이 중에는 `first-battle-loss` 같은 큰 팝업을 띄우지 않는다.
- 강조 대상 DOM이 없으면 팝업은 띄우되 하이라이트는 생략한다.

## 확인 기준

- 신규 저장 데이터에서 첫 접속 팝업이 스타터 도감 화면에 뜬다.
- 각 팝업은 1~2페이지 가이드북처럼 넘길 수 있다.
- 각 페이지는 닫은 직후 바로 볼 UI, 버튼, 결과를 설명한다.
- 스타터 선택 후 첫 `ready` 화면에서 첫 상점 진입 팝업이 뜬다.
- 첫 `전투 시작` 클릭 시 월드맵/전투 리플레이보다 먼저 전투 시작 팝업이 뜬다.
- 첫 포획 성공은 `teamDecision` 화면에서 안내한다.
- 첫 포획 실패는 다음 웨이브 `ready` 화면의 실패 오버레이에서 안내한다.
- 첫 체크포인트 트레이너 승리는 `checkpointVictory` 화면에서 안내한다.
- 첫 패배는 `gameOver` 화면에서 리플레이 종료 후 안내한다.
