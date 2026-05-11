# Contributing

이 저장소는 GitHub PR 중심으로 개발합니다. 모든 변경은 로컬 검증을 통과한 뒤 PR로 합칩니다.

## 로컬 준비

```bash
npm ci
npm run dev
```

## 품질 게이트

PR 전에는 다음 명령을 실행합니다.

```bash
npm run verify
```

`verify`는 다음 순서로 실행됩니다.

- `npm run lint`
- `npm run test`
- `npm run qa:headless`
- `npm run build`

## 브랜치와 PR

- 기능은 `feature/<short-name>` 브랜치에서 작업합니다.
- 버그 수정은 `fix/<short-name>` 브랜치에서 작업합니다.
- PR에는 변경 요약, 검증 결과, 남은 리스크를 적습니다.
- 게임 규칙이나 데이터 스키마를 바꾸는 PR은 README 또는 `docs/` 문서를 같이 갱신합니다.

## 테스트 기준

- 전투, 포획, 웨이브, 저장소처럼 결과가 중요한 로직은 단위 테스트를 먼저 추가합니다.
- 랜덤이 들어가는 로직은 seed를 주입할 수 있게 만들어 재현 가능한 테스트를 유지합니다.
- 브라우저 저장소와 Google Sheets 연동은 순수 직렬화 로직과 외부 API 호출을 분리합니다.
- 게임 기능 QA는 HTML 조작보다 `HeadlessGameClient` action과 snapshot 검증을 우선합니다.
- 렌더러는 `GameState`가 아니라 `GameFrame`을 소비합니다. 새 UI/WebGL 기능은 필요한 entity/action/cue가 frame 계약에 먼저 드러나야 합니다.
