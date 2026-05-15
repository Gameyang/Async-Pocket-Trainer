# 튜토리얼 가이드 팝업 설계

이 문서는 현재 코드 구현을 기준으로, 처음 접속한 유저가 막히지 않도록 큰 가이드 팝업이 언제 뜨고 무엇을 말해야 하는지 정리한다.

## 실제 코드 기준 흐름

신규 저장 데이터가 없으면 `HeadlessGameClient`는 `starterChoice`에서 시작한다. 브라우저 런타임은 저장된 스냅샷이 있으면 해당 상태에서 바로 시작할 수 있으므로, 튜토리얼은 "첫 접속 순서"만 믿지 말고 현재 `GameFrame.phase`와 화면 상태를 기준으로 골라야 한다.

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

중요한 실제 구현 차이:

- `ready` 화면은 전투 준비 화면이자 상점 화면이다. 스타터 선택 직후 이미 `shopDeal`과 `shopInventory`가 생성되고, `전투 시작` 버튼과 상점 카드가 함께 표시된다.
- `starterChoice` 브라우저 화면은 3장 카드 화면이 아니라 151마리 도감형 카드 화면이다. 처음에는 `start:1`, `start:4`, `start:7`만 실제 선택 액션을 가진다.
- `captureDecision`은 별도 포획 화면이 아니라 전투 화면(`data-screen="battle"`) 위에 포획 선택 액션이 command band로 붙는 상태다.
- 전투 직후에는 리플레이가 먼저 재생된다. 튜토리얼 팝업은 `playback.isPlaying === false`가 된 뒤 띄워야 한다.
- 포획 실패는 별도 상태가 아니다. 실패 후 바로 다음 웨이브 `ready`로 이동하고, `frame.scene.capture.result === "failure"`가 ready 화면 오버레이로 남는다.
- 체크포인트 기록 화면은 별도 `GamePhase`가 아니다. `frame.phase === "ready"`이지만 `statusView.teamRecord`가 있으면 렌더러가 `checkpointVictory` 화면을 보여준다.
- 루트 선택 액션은 타입과 로직은 남아 있지만, 현재 `createFrameActions`에서는 `route:*` 액션을 만들지 않는다. 튜토리얼에서 루트 선택 팝업을 넣으면 실제 UI와 맞지 않는다.

## 팝업 등장 시점 요약

| ID | 실제 감지 조건 | 실제 화면/액션 | 팝업 목적 | 닫기 조건 |
| --- | --- | --- | --- | --- |
| `starter-dex` | `frame.phase === "starterChoice"` | `data-screen="starterChoice"`, `start:*` 액션 | 선택 가능한 첫 포켓몬을 고르게 함 | `START_RUN` 실행 |
| `starter-confirm` | 스타터 카드 선택 후 `.starter-option[data-starter-selected]` 존재 | `.starter-confirm[data-action-id="start:*"]` | 카드 선택 뒤 확인 버튼을 눌러야 함을 안내 | `START_RUN` 실행 또는 선택 취소 |
| `ready-first` | 첫 `ready`, `frame.hud.wave === 1` | `encounter:next`, `shop:*` | 전투 시작과 상점이 같은 화면임을 안내 | `RESOLVE_NEXT_ENCOUNTER` 또는 상점 구매 |
| `shop-first` | 첫 `ready`에서 `shop:*` 카드가 보임 | `.shop-card-grid`, 코인/보석 HUD | 회복, 볼 구매, 강화 카드 설명 | 상점 구매, 재구성, 전투 시작 |
| `shop-target` | `ready`에서 대상 필요 상점 액션 클릭 후 `shopTargetAction` 존재 | `data-shop-targeting="true"`, 팀 슬롯 | 회복/강화/기술머신 대상 선택 안내 | 대상 슬롯 선택 또는 취소 |
| `battle-replay` | `RESOLVE_NEXT_ENCOUNTER` 뒤 `playback.isPlaying === true` | `data-screen="battle"` | 전투가 자동으로 재생됨을 안내 | 리플레이 종료 |
| `capture-choice` | `frame.phase === "captureDecision"`이고 리플레이 종료 | `capture:*`, `capture:skip` | 볼을 던지거나 포기하게 함 | `ATTEMPT_CAPTURE` 또는 `DISCARD_CAPTURE` |
| `capture-failed` | `frame.phase === "ready"`이고 `frame.scene.capture.result === "failure"` | ready 화면의 capture overlay | 실패 후 다음 행동 안내 | 다음 액션 실행 |
| `team-decision` | `frame.phase === "teamDecision"`이고 팀 크기 `< 6` | `team:keep`, `team:release` | 잡은 포켓몬을 팀에 넣을지 안내 | `ACCEPT_CAPTURE` 또는 `DISCARD_CAPTURE` |
| `team-full` | `frame.phase === "teamDecision"`이고 팀 크기 `>= 6` | 추천 `team:replace:*`, `team:release` | 팀이 꽉 찼을 때 교체/놓아주기 안내 | 교체 또는 놓아주기 |
| `checkpoint-victory` | `frame.phase === "ready"` + `statusView.teamRecord` 존재 | `data-screen="checkpointVictory"` | 팀 기록 저장 화면 안내 | 기록 제출 |
| `game-over` | `frame.phase === "gameOver"`이고 리플레이 종료 | `restart:team:*`, `restart:starter-choice` | 재도전 방법 안내 | 재시작 액션 |

## 상세 팝업 문구

### `starter-dex`

- 제목: `첫 친구를 골라요`
- 본문:

```text
밝게 보이는 포켓몬만 고를 수 있어요.
처음에는 이상해씨, 파이리, 꼬부기를 고를 수 있어요.
마음에 드는 카드를 눌러요.
```

- 강조 대상: `.starter-option[data-starter-state="unlocked"]`
- 주의: 151개 카드가 보이므로 "셋 중 하나"라고만 말하면 실제 화면과 맞지 않는다.

### `starter-confirm`

- 제목: `선택 버튼을 눌러요`
- 본문:

```text
카드를 고르면 선택 버튼이 나와요.
선택을 누르면 모험이 시작돼요.
```

- 강조 대상: `.starter-confirm[data-action-id^="start:"]`
- 닫기: `START_RUN` 실행 또는 `취소`

### `ready-first`

- 제목: `전투를 시작해요`
- 본문:

```text
이곳에서 준비하고 전투를 시작해요.
전투 시작을 누르면 다음 포켓몬을 만나요.
전투는 자동으로 진행돼요.
```

- 강조 대상: `.shop-start-action[data-action-id="encounter:next"]`

### `shop-first`

- 제목: `상점 카드도 볼 수 있어요`
- 본문:

```text
코인으로 회복하거나 볼을 살 수 있어요.
강화 카드는 다음 만남을 도와줘요.
잘 모르겠으면 전투 시작을 눌러도 괜찮아요.
```

- 강조 대상: `.shop-card-grid`, `.shop-money`
- 실제 구현: `selectReadyShopActions`가 최대 9개 상점 카드만 골라 보여준다.

### `shop-target`

- 제목: `누구에게 쓸까요?`
- 본문:

```text
몇몇 카드는 팀 친구를 골라야 해요.
강화하거나 회복할 포켓몬을 눌러요.
그만하려면 X를 눌러요.
```

- 강조 대상: `.shop-team-slot[data-shop-target-id]`, `[data-shop-target-cancel]`
- 트리거 예: 단일 회복, 능력치 강화, 능력치 재추첨, 기술머신

### `battle-replay`

- 제목: `전투는 자동이에요`
- 본문:

```text
포켓몬들이 자동으로 싸워요.
잠깐 보고 있으면 결과가 나와요.
버튼은 전투가 끝나면 누를 수 있어요.
```

- 강조 대상: `.battle-log`, `.replay-row`
- 주의: 이 팝업은 화면을 막는 큰 팝업보다 짧은 안내 배너가 적합하다. 리플레이 중 액션 버튼은 잠긴다.

### `capture-choice`

- 제목: `잡아볼까요?`
- 본문:

```text
이기면 잡을 기회가 생겨요.
볼을 누르면 잡기를 시도해요.
잡고 싶지 않으면 포획 포기를 눌러요.
```

- 강조 대상: `.command-band [data-action-id^="capture:"]`
- 실제 상태: `frame.phase === "captureDecision"`, `frame.scene.capture.result === "choosing"`

### `capture-failed`

- 제목: `실패해도 괜찮아요`
- 본문:

```text
포켓몬이 볼에서 나올 때도 있어요.
다음 웨이브로 바로 이동했어요.
볼이 부족하면 상점에서 사요.
```

- 강조 대상: `.capture-overlay[data-capture-result="failure"]`, 볼 구매 카드, 전투 시작 버튼
- 실제 상태: `frame.phase === "ready"`이고 `frame.scene.capture.result === "failure"`

### `team-decision`

- 제목: `팀에 넣을까요?`
- 본문:

```text
잡은 포켓몬을 팀에 넣을 수 있어요.
처음에는 팀에 추가해도 좋아요.
원하지 않으면 놓아주기를 눌러요.
```

- 강조 대상: `.candidate-panel`, `.command-band [data-action-id="team:keep"]`, `.command-band [data-action-id="team:release"]`
- 실제 상태: `frame.phase === "teamDecision"`이고 팀 크기 6 미만

### `team-full`

- 제목: `팀 자리가 꽉 찼어요`
- 본문:

```text
팀은 최대 6마리예요.
새 포켓몬을 데려오려면 한 마리와 바꿔요.
바꾸기 싫으면 놓아주기를 눌러요.
```

- 강조 대상: `.team-compare-panel`, command band의 추천 `team:replace:*`, `team:release`
- 실제 구현 주의: `frame.actions`에는 6개 교체 액션이 있지만, 현재 command band는 추천 교체 1개와 놓아주기만 보여준다.

### `checkpoint-victory`

- 제목: `팀 기록을 남겨요`
- 본문:

```text
트레이너에게 이겼어요.
지금 팀 이름과 인사말을 남길 수 있어요.
정산 저장을 누르면 기록돼요.
```

- 강조 대상: `.checkpoint-victory-card`, `[data-team-record-form]`
- 실제 조건: `RESOLVE_NEXT_ENCOUNTER`가 체크포인트 웨이브에서 승리했고, `BrowserGameRuntime.getStatusView().teamRecord`가 존재한다.
- 기본 체크포인트: `defaultBalance.checkpointInterval === 5`

### `game-over`

- 제목: `다시 도전해요`
- 본문:

```text
져도 끝이 아니에요.
함께했던 포켓몬으로 다시 시작할 수 있어요.
처음 화면으로 돌아가 새로 골라도 돼요.
```

- 강조 대상: `.command-band [data-action-id^="restart:team:"]`, `.command-band [data-action-id="restart:starter-choice"]`
- 주의: 패배 직후 전투 리플레이가 먼저 보일 수 있으므로, `playback.isPlaying === false` 이후 표시한다.

## 저장 정책

튜토리얼 진행 기록은 브라우저 저장소에 저장한다.

- 추천 키: `apt:tutorial:v1`
- 팝업 ID별 `seen` 값을 저장한다.
- 저장된 게임이 `ready`, `teamDecision`, `gameOver` 등 중간 상태에서 시작할 수 있으므로, 아직 보지 않은 팝업 중 현재 조건에 맞는 것만 보여준다.
- 닫기 버튼을 누르거나 해당 액션을 실행하면 본 것으로 저장한다.
- 개발/설정용 초기화 버튼은 `apt:tutorial:v1`만 지운다.

예시:

```json
{
  "seen": {
    "starter-dex": true,
    "starter-confirm": true,
    "ready-first": true,
    "shop-first": true,
    "shop-target": true,
    "battle-replay": true,
    "capture-choice": true,
    "capture-failed": true,
    "team-decision": true,
    "team-full": true,
    "checkpoint-victory": true,
    "game-over": true
  }
}
```

## 구현 기준

- 팝업 선택은 `GameFrame.phase`, `frame.scene.capture`, `statusView.teamRecord`, `playback.isPlaying`, 현재 DOM의 `data-screen`을 함께 본다.
- 큰 팝업은 한 번에 하나만 표시한다.
- 전투 리플레이 중에는 큰 팝업을 띄우지 않는다. 필요한 경우 `battle-replay`만 짧은 배너로 표시한다.
- 액션 실행 전 seen 처리를 먼저 하고, 기존 `bindActions` 흐름을 막지 않는다.
- 강조 대상 DOM이 없으면 팝업은 띄우되 하이라이트는 생략한다.

## 확인 기준

- 신규 저장 데이터에서 도감형 스타터 화면의 선택 가능 카드만 안내한다.
- 스타터 선택 후 첫 `ready` 화면에서 전투 시작과 상점이 같은 화면임을 설명한다.
- 야생전 승리 후 리플레이가 끝난 뒤 포획 안내가 뜬다.
- 포획 실패는 `ready` 화면 오버레이 기준으로 안내한다.
- 포획 성공 후 `teamDecision` 안내가 command band 액션과 맞는다.
- 5웨이브 같은 체크포인트 승리 후 `checkpointVictory` 기록 화면 안내가 뜬다.
- 패배 후 리플레이가 끝난 뒤 `gameOver` 재도전 안내가 뜬다.
