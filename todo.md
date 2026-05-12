# TODO - Game Implementation Remaining List

기준일: 2026-05-12

기존 headless/render/input/sync 완료 계획은 `docs/2026-05-12-headless-integration-todo-backup.md`로 백업했다.

## 기준

- 게임 규칙과 상태 변경의 원천은 `HeadlessGameClient`다.
- UI는 `GameFrame`을 읽고 `FrameAction.action`만 dispatch한다.
- 렌더러에는 전투 승패, 포획 성공, 보상 계산 같은 게임 규칙을 넣지 않는다.
- PokeRogue는 흐름/상태 경계 참고용으로만 사용하고 코드는 복사하지 않는다.
- 비주얼 기준은 `sandbox/index.html`의 handheld/screen/battlefield/command 패턴을 따른다.
- Google Sheets 설정과 URL은 브라우저 localStorage에만 저장하고 repo에는 민감값을 남기지 않는다.

## 1. 전투 연출

- [x] `GameFrame.battleReplay.events`를 순서대로 재생하는 렌더러 전용 animation queue를 만든다.
- [x] 공격자/피격자 흔들림, hit/miss, critical, effectiveness 상태를 CSS class로 표현한다.
- [x] 데미지 숫자와 faint 연출을 `FrameVisualCue` 기반으로 표시한다.
- [x] 전투 결과 로그가 한 번에 바뀌지 않고 턴 단위로 자연스럽게 진행되게 한다.
- [x] 애니메이션 중 입력 잠금과 빠른 진행/스킵 처리를 구현한다.

## 2. 포획 흐름

- [ ] Poke Ball / Great Ball 선택 후 투척, 흔들림, 성공/실패 연출을 추가한다.
- [ ] 포획 성공 시 `teamDecision`으로 넘어가기 전 짧은 획득 연출을 보여준다.
- [ ] 포획 실패 시 상대가 남아 있음을 화면에서 명확히 보여준다.
- [ ] 볼 개수 변화가 HUD와 버튼에 즉시 반영되는지 Playwright로 검증한다.

## 3. Phase별 실제 게임 화면

- [ ] `starterChoice`: 스타터 3종 선택 화면을 카드 나열이 아니라 선택 장면처럼 구성한다.
- [ ] `ready`: 다음 조우, 휴식, 구매가 가능한 캠프/웨이브 준비 화면을 만든다.
- [ ] `captureDecision`: 전투 후 포획 판단 화면을 전투 결과와 연결한다.
- [ ] `teamDecision`: 새 포켓몬과 기존 팀을 비교하고 교체 슬롯을 고르는 화면을 만든다.
- [ ] `gameOver`: 최종 웨이브, 팀, 재시작 액션을 게임 결과 화면으로 보여준다.

## 4. 팀 관리

- [ ] 접힌 Team drawer 안에 6마리 파티를 슬롯형 UI로 정리한다.
- [ ] 교체 판단 시 새 포켓몬과 선택 슬롯의 HP/stat/power 차이를 비교 표시한다.
- [ ] 빈 슬롯, 기절 슬롯, 교체 후보 상태를 색과 아이콘으로 구분한다.
- [ ] 모바일에서 팀 카드 텍스트가 버튼/HP바와 겹치지 않게 고정 크기를 검증한다.

## 5. Google Sheets 게임 연결

- [ ] 공개 시트에서 불러온 trainer encounter임을 battle screen에 배지로 표시한다.
- [ ] checkpoint wave 제출 성공/실패를 Sync drawer 요약에 짧게 반영한다.
- [ ] 실제 Apps Script `/exec` URL을 받으면 public CSV read + Apps Script submit을 end-to-end로 확인한다.
- [ ] 동기화 실패 시 게임 진행은 막지 않고 재시도 가능한 상태만 남긴다.

## 6. UX 정리

- [ ] 상단 HUD를 Wave, phase label, money, ball count 중심으로 다시 압축한다.
- [ ] 버튼 라벨을 phase별 명령처럼 정리하고 disabled reason은 title/보조 상태로만 둔다.
- [ ] Sync/Log/Team은 기본 접힘 상태를 유지하고 첫 화면에는 게임 플레이만 보이게 한다.
- [ ] 새 게임, 저장 삭제, 트레이너 이름 변경 같은 설정성 동작은 별도 drawer로 분리한다.

## 7. 검증

- [ ] Playwright screenshot 검증을 `starterChoice`, `ready`, `captureDecision`, `teamDecision`, `gameOver`로 확장한다.
- [ ] 모바일 390x844, 좁은 320px, 데스크톱 폭에서 텍스트 겹침/overflow를 확인한다.
- [x] `battleReplay` 재생 중 빠른 클릭이 headless state를 중복 변경하지 않는지 테스트한다.
- [ ] 실제 public sheet GET은 credentials 없이 동작하고, POST는 Apps Script URL이 있을 때만 실행되게 테스트한다.
- [ ] 최종 변경마다 `npm run verify`와 `npm run render:check`를 통과시킨다.

## 8. 오픈 자산 / 오디오 / 렌더링 완성도

- [ ] PokeRogue(`https://github.com/pagefaultgames/pokerogue`)는 게임 진행, phase queue, 전투 화면 구성, 오디오/효과 트리거 방식의 참고 레퍼런스로만 사용하고 코드는 복사하지 않는다.
- [ ] 원작 포켓몬 NPC 이미지, BGM, SFX는 repo에 포함하지 않고 CC0 또는 명확히 허용된 오픈 라이선스 자산만 사용한다.
- [ ] 사용한 이미지/오디오 자산의 출처 URL, 라이선스, 변환 방식, 게임 내 사용 위치를 `docs/assets.md`에 기록한다.
- [ ] 트레이너/NPC 이미지 자산을 확보해 `src/resources/trainers/*.webp`로 변환하고, trainer encounter 화면에서 결정적으로 선택해 표시한다.
- [ ] BGM 자산은 `src/resources/audio/bgm/*`에, SFX 자산은 `src/resources/audio/sfx/*`에 저장하고 Vite 번들 경로로 로드한다.
- [ ] `GameFrame.scene`에 trainer encounter 표시용 메타데이터를 추가하되, headless 규칙 계층에는 렌더링/오디오 재생 로직을 넣지 않는다.
- [ ] `FrameVisualCue.soundKey`를 실제 SFX 매핑에 연결해 hit, critical hit, miss, faint, phase change, capture success/fail 사운드를 재생한다.
- [ ] 브라우저 autoplay 제한을 고려해 첫 사용자 입력 이후 오디오를 활성화하고, mute 토글 상태를 `localStorage`에 저장한다.
- [ ] phase별 BGM 전환을 구현한다: starter/ready, battle/captureDecision, teamDecision, gameOver.
- [ ] Playwright에서 trainer portrait 렌더링, 오디오 토글 UI, 모바일/데스크톱 레이아웃 겹침 여부를 검증한다.
