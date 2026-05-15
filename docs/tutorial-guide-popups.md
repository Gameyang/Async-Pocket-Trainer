# 튜토리얼 가이드 팝업 설계

이 문서는 현재 게임 구현을 기준으로, 처음 접속한 유저에게 보여줄 큰 가이드 팝업의 등장 시점과 문구를 정리한다.

팝업 시점은 아래 7개로 고정한다.

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
- 전투 시작 뒤에는 전투 리플레이와 월드맵 인트로가 재생될 수 있다. "첫 인게임 전투 시작" 팝업은 `RESOLVE_NEXT_ENCOUNTER`를 실행하기 전에 보여줘야 월드맵보다 먼저 뜬다.
- 포획 실패는 별도 phase가 아니다. 실패하면 바로 다음 웨이브 `ready`로 가고, `frame.scene.capture.result === "failure"`가 오버레이로 남는다.
- 첫 트레이너전 성공 화면은 별도 phase가 아니다. `frame.phase === "ready"`이지만 `statusView.teamRecord`가 있으면 `checkpointVictory` 화면으로 렌더된다.

## 팝업 등장 시점 요약

| ID | 사용자 시점 | 실제 감지 조건 | 강조 대상 | 닫기 조건 |
| --- | --- | --- | --- | --- |
| `first-visit` | 게임 첫 접속 | 튜토리얼 기록 없음 + `frame.phase === "starterChoice"` | 선택 가능한 스타터 카드 | 스타터 선택 완료 |
| `first-shop` | 첫 상점 진입 | 첫 `ready` 렌더, `frame.hud.wave === 1`, `shop:*` 액션 존재 | 코인/보석, 팀 슬롯, 상점 카드, 전투 시작 버튼 | 확인 또는 첫 행동 |
| `first-battle-start` | 첫 인게임 전투 시작 전, 월드맵 이전 | `encounter:next` 첫 클릭, `RESOLVE_NEXT_ENCOUNTER` 실행 전 | `전투 시작` 버튼 | 확인 후 원래 전투 시작 실행 |
| `first-capture-success` | 첫 포켓몬 잡기 성공 | `frame.phase === "teamDecision"` + `frame.scene.capture.result === "success"` | 잡은 포켓몬, 팀 추가/놓아주기 버튼 | `ACCEPT_CAPTURE` 또는 `DISCARD_CAPTURE` |
| `first-capture-failure` | 첫 포켓몬 잡기 실패 | `frame.phase === "ready"` + `frame.scene.capture.result === "failure"` | 실패 오버레이, 볼 구매 카드, 전투 시작 버튼 | 다음 행동 |
| `first-trainer-win` | 첫 트레이너전 성공 | `frame.phase === "ready"` + `statusView.teamRecord` 존재 | 체크포인트 승리 카드, 기록 저장 폼 | 기록 저장 |
| `first-battle-loss` | 첫 전투 실패 | `frame.phase === "gameOver"` + 리플레이 종료 | 재출발 버튼, 스타터 화면 버튼 | 재시작 행동 |

## 팝업 상세 내용

### `first-visit` - 게임 첫 접속

- 제목: `첫 친구를 골라요`
- 본문:

```text
밝게 보이는 포켓몬만 고를 수 있어요.
처음에는 이상해씨, 파이리, 꼬부기를 고를 수 있어요.
마음에 드는 카드를 누르고 선택을 눌러요.
```

- 실제 화면: `data-screen="starterChoice"`
- 실제 액션: `start:1`, `start:4`, `start:7`
- 강조 대상:
  - `.starter-option[data-starter-state="unlocked"]`
  - 카드 선택 후 `.starter-confirm[data-action-id^="start:"]`

### `first-shop` - 첫 상점 진입

- 제목: `이곳에서 준비해요`
- 본문:

```text
여기는 전투 전에 쉬는 곳이에요.
코인으로 회복하거나 볼을 살 수 있어요.
준비가 끝나면 전투 시작을 눌러요.
```

- 실제 화면: `frame.phase === "ready"`인 상점 화면
- 실제 액션:
  - `encounter:next`
  - `shop:*`
  - `claim:skill:*`가 있을 수 있음
- 강조 대상:
  - `.shop-money`
  - `.shop-trainer-points`
  - `.shop-card-grid`
  - `.shop-start-action[data-action-id="encounter:next"]`
- 주의: 상점은 별도 메뉴 진입이 아니라 스타터 선택 직후 첫 `ready` 화면 자체다.

### `first-battle-start` - 첫 인게임 전투 시작 전, 월드맵 이전

- 제목: `이제 전투가 시작돼요`
- 본문:

```text
전투는 자동으로 진행돼요.
길을 지나 포켓몬을 만나러 가요.
잠깐 기다리면 결과가 나와요.
```

- 실제 트리거: `encounter:next` 버튼을 처음 눌렀을 때
- 구현 위치: `RESOLVE_NEXT_ENCOUNTER` dispatch 전에 인터셉트해서 1회 표시
- 강조 대상: `.shop-start-action[data-action-id="encounter:next"]`
- 닫기 동작:
  - 확인 버튼을 누르면 기존 `RESOLVE_NEXT_ENCOUNTER` 액션을 그대로 실행한다.
- 주의:
  - 이 팝업은 전투 화면이나 월드맵 인트로가 나오기 전에 떠야 한다.
  - 이미 전투 리플레이가 시작된 뒤에는 이 팝업을 띄우지 않는다.

### `first-capture-success` - 첫 포켓몬 잡기 성공

- 제목: `잡았어요`
- 본문:

```text
새 포켓몬을 잡았어요.
팀에 넣으면 함께 싸울 수 있어요.
원하지 않으면 놓아주기를 눌러요.
```

- 실제 조건:
  - `frame.phase === "teamDecision"`
  - `frame.scene.capture?.result === "success"`
- 실제 액션:
  - `team:keep`
  - `team:replace:*`가 있을 수 있음
  - `team:release`
- 강조 대상:
  - `.candidate-panel`
  - `.command-band [data-action-id="team:keep"]`
  - `.command-band [data-action-id^="team:replace:"]`
  - `.command-band [data-action-id="team:release"]`
- 팀이 6마리 미만이면 `팀에 추가`를 우선 안내한다.
- 팀이 6마리면 교체 또는 놓아주기를 안내한다.

### `first-capture-failure` - 첫 포켓몬 잡기 실패

- 제목: `실패해도 괜찮아요`
- 본문:

```text
포켓몬이 볼에서 나올 때도 있어요.
다음 웨이브로 이동했어요.
볼이 부족하면 상점에서 사요.
```

- 실제 조건:
  - `frame.phase === "ready"`
  - `frame.scene.capture?.result === "failure"`
- 강조 대상:
  - `.capture-overlay[data-capture-result="failure"]`
  - 볼 구매 상점 카드
  - `.shop-start-action[data-action-id="encounter:next"]`
- 주의: 실패 직후에는 이미 다음 웨이브 `ready` 상태다.

### `first-trainer-win` - 첫 트레이너전 성공

- 제목: `트레이너에게 이겼어요`
- 본문:

```text
강한 트레이너를 이겼어요.
지금 팀 기록을 남길 수 있어요.
정산 저장을 누르면 기록돼요.
```

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

### `first-battle-loss` - 첫 전투 실패

- 제목: `다시 도전해요`
- 본문:

```text
져도 끝이 아니에요.
함께했던 포켓몬으로 다시 시작할 수 있어요.
처음 화면으로 돌아가 새로 골라도 돼요.
```

- 실제 조건:
  - `frame.phase === "gameOver"`
  - `playback.isPlaying === false`
- 실제 액션:
  - `restart:team:*`
  - `restart:starter-choice`
- 강조 대상:
  - `.command-band [data-action-id^="restart:team:"]`
  - `.command-band [data-action-id="restart:starter-choice"]`
- 주의: 패배 직후 전투 리플레이가 남아 있을 수 있으므로 리플레이 종료 뒤 표시한다.

## 저장 정책

튜토리얼 진행 기록은 브라우저 저장소에 저장한다.

- 추천 키: `apt:tutorial:v1`
- 7개 팝업 ID별 `seen` 값을 저장한다.
- 저장된 게임이 중간 상태에서 시작할 수 있으므로, 현재 조건에 맞고 아직 보지 않은 팝업만 보여준다.
- 팝업을 닫거나 해당 핵심 액션이 실행되면 본 것으로 저장한다.
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
- `first-battle-start`는 액션 실행 전 팝업이므로 `bindActions`에서 `encounter:next` 첫 클릭을 가로채야 한다.
- 나머지 팝업은 렌더된 `GameFrame`, `statusView`, `playback` 상태를 기준으로 선택한다.
- 전투 리플레이 중에는 `first-battle-loss` 같은 큰 팝업을 띄우지 않는다.
- 강조 대상 DOM이 없으면 팝업은 띄우되 하이라이트는 생략한다.

## 확인 기준

- 신규 저장 데이터에서 첫 접속 팝업이 스타터 도감 화면에 뜬다.
- 스타터 선택 후 첫 `ready` 화면에서 첫 상점 진입 팝업이 뜬다.
- 첫 `전투 시작` 클릭 시 월드맵/전투 리플레이보다 먼저 전투 시작 팝업이 뜬다.
- 첫 포획 성공은 `teamDecision` 화면에서 안내한다.
- 첫 포획 실패는 다음 웨이브 `ready` 화면의 실패 오버레이에서 안내한다.
- 첫 체크포인트 트레이너 승리는 `checkpointVictory` 화면에서 안내한다.
- 첫 패배는 `gameOver` 화면에서 리플레이 종료 후 안내한다.
