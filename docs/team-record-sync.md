# Team Record Sync

상대 팀 전적은 `APT_TEAM_RECORDS` 탭에 append-only 이벤트 로그로 저장한다. 팀 스냅샷은 기존
`APT_WAVE_TEAMS` 탭에 남기고, 전적 탭은 전투가 끝날 때마다 상대 팀 기준 결과를 한 줄씩 추가한다.

## Columns

`APT_TEAM_RECORDS!A:S`

```text
version, recordId, createdAt, opponentTeamId, opponentPlayerId, opponentTrainerName,
opponentWave, opponentCreatedAt, opponentSeed, opponentTeamPower, challengerPlayerId,
challengerTrainerName, challengerSeed, battleWave, battleWinner, opponentResult,
challengerTeamPower, turns, source
```

`opponentResult`는 상대 팀 관점이다. 유저가 이기면 `loss`, 유저가 지면 `win`이 된다.

## Local Cache

브라우저는 전투 종료 직후 먼저 `localStorage`에 기록한다.

- key: `apt:team-battle-records:v1:<playerId>`
- pending: 아직 Google Sheets 또는 Apps Script에 올라가지 않은 행
- synced: 업로드되었거나 공개 CSV에서 내려받은 행

네트워크가 실패해도 게임 진행은 막지 않고 pending 행을 남긴다. 다음 전적 flush 때 다시 업로드한다.

## Merge Policy

정확한 락 대신 append-only 병합을 사용한다.

- `recordId`가 같은 행은 같은 전투로 본다.
- 같은 `recordId`가 여러 번 있으면 가장 이른 `createdAt` 행 하나만 집계한다.
- 서로 다른 `recordId`는 모두 살린다. 결과가 조금 부정확해도 전투 로그가 남는 쪽을 우선한다.
- Google Sheets 최종 승률은 `opponentTeamId`로 그룹화하고 `recordId`를 unique 처리한 뒤,
  `opponentResult = win/loss`를 카운트해서 계산한다.

이 정책이면 업로드 중 새로고침, no-cors Apps Script의 불확실한 응답, 여러 브라우저의 동시 업로드가
있어도 데이터 손실보다 중복 가능성을 선택한다. 중복은 시트 집계식에서 제거한다.
