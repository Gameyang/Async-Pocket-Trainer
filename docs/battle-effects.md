# 조립형 전투 이펙트 시스템 개발 가이드

> 본 문서는 전투 화면의 스킬 이펙트를 **카테고리 × 속성**에 따라 자동으로 조립해 표현하는 시스템의 설계·구현·유지보수 가이드입니다. 실제 코드 구현은 본 문서를 기반으로 별도 PR에서 진행합니다.

---

## 1. 개요

### 1.1 목표
- 211종 스킬 × 18속성 × 3카테고리의 전투 표현을 **심플하면서 다양하게** 끌어올린다.
- 원작 포켓몬스터처럼 스킬마다 수작업으로 이펙트를 만드는 대신, 작은 컴포넌트를 조합하는 **조립형(modular)** 시스템으로 간다.
- 속성(ElementType) 값에서 컬러를 자동 파생한다.

### 1.2 기본 원칙
1. **적층(stacking), 비교체(non-replacement)**: 기존 캐릭터 모션(`monster-use-*`, `monster-take-*`)은 그대로 두고, 그 위에 새 오버레이 레이어를 얹는다.
2. **데이터 주도(data-driven)**: 컬러는 속성 값에서, 형태는 (카테고리, 속성) 매트릭스에서 자동 결정. MoveDefinition을 손대지 않는다.
3. **레이어 분리**: 게임 로직(540ms 스텝)과 이펙트 루프(RAF 60fps)는 완전히 분리.
4. **단일 책임 컴포넌트**: shape는 형태만, motion은 움직임만, palette는 색만, modifier는 부가 장식만 담당.

### 1.3 기존 시스템과의 관계

| 레이어 | 위치 | 변경 여부 |
|---|---|---|
| 게임 로직 (battleEngine) | `src/game/battleEngine.ts` | 변경 없음 |
| FrameVisualCue 생성 | `src/game/view/frame.ts` | 변경 없음 (`moveType` 이미 존재) |
| 이펙트 결정 (resolveBattleEffect) | `src/ui/framePresentation.ts:164-216` | 변경 없음 |
| 캐릭터 모션 CSS keyframes | `src/style.css:3981-4330` | 유지 |
| `data-battle-effect` 속성 부착 | `src/ui/htmlRenderer.ts:1718` | 유지 |
| **새 오버레이 컨테이너** | `.fx-overlay` | **신규** |
| **새 이펙트 엔진** | `src/ui/effects/engine.ts` | **신규** |

---

## 2. 아키텍처

### 2.1 5축 직교 분해

이펙트는 다음 5개 축의 조합으로 표현됩니다.

```
EffectDescriptor {
  shape:     "strike" | "projectile" | "beam" | "burst" | "aura"
  motion:    "linear" | "arc" | "pulse" | "spin" | "shake"
  palette:   ElementPalette       // {primary, secondary, accent}
  modifiers: ("trail" | "flash" | "ring" | "sparks" | "shockwave")[]
  meta:      { durationMs, intensity, originSide, targetSide }
}
```

| 축 | 책임 | 구현 위치 |
|---|---|---|
| shape | DOM 구조와 기본 형태 | `src/ui/effects/shapes/{name}.ts` (TS 빌더) |
| motion | 시간에 따른 움직임 | `effects.css` `@keyframes fx-motion-*` |
| palette | 컬러 (속성에서 파생) | `src/ui/effects/palette.ts` + CSS `:root` |
| modifier | 부가 장식 (트레일·플래시 등) | `effects.css` `.fx-mod-*` + shape 빌더에서 자식 노드 추가 |
| meta | 인스턴스 파라미터 | EffectDescriptor 필드 |

### 2.2 데이터 흐름

```
battleEngine → BattleReplayEvent
            → FrameVisualCue (moveType 포함)
            → htmlRenderer.renderBattleMonster
            → effectEngine.spawn(descriptor, sourceEl, targetEl)
            → shape 빌더가 DOM 생성
            → .fx-overlay에 mount
            → RAF 루프가 durationMs 후 자동 제거
```

### 2.3 모듈 구조

```
src/ui/effects/
├─ types.ts          # EffectDescriptor, ShapeKind, MotionKind, ModifierKind, ElementPalette
├─ palette.ts        # 18속성 컬러 테이블 + getElementPalette()
├─ mapping.ts        # (category, type) → {shape, motion, modifiers} 매트릭스
├─ engine.ts         # RAF 루프, spawn/despawn, dedupe, .fx-overlay 보장
├─ effects.css       # 모든 .fx-* 클래스 + @keyframes + :root 변수
├─ shapes/
│   ├─ strike.ts     # 근접 충돌
│   ├─ projectile.ts # 투사체
│   ├─ beam.ts       # 광선 (source→target 길이 계산)
│   ├─ burst.ts      # 자기장·폭발
│   └─ aura.ts       # 상태기 오라
└─ __tests__/
    ├─ mapping.test.ts
    ├─ palette.test.ts
    └─ engine.test.ts
```

---

## 3. 5종 Shape 명세

각 shape는 `(descriptor, sourceRect, targetRect) → HTMLElement`를 반환하는 순수 함수.

### 3.1 Strike (근접 충돌)
- **용도**: physical 타격
- **DOM**: target 위에 짧은 슬래시 라인 1개 + 충돌점 플래시 + (옵션) 스파크 파편
- **모션**: 0~120ms 슬래시 그어짐 → 120~240ms 플래시 + 살짝 흔들림 → 240~360ms 페이드아웃
- **기본 duration**: 360ms
- **위치**: targetRect 중심

### 3.2 Projectile (투사체)
- **용도**: 원거리 special 일부 (ice/dragon 등)
- **DOM**: 진행 방향 머리 + 짧은 트레일 + 명중 시 산개 파티클(8~12개)
- **모션**: source→target 직선 또는 arc 이동, 명중 시 burst 호출
- **기본 duration**: 420ms (이동 240ms + 산개 180ms)
- **변형**: motion=arc일 때 `--fx-arc-curve` 변수로 곡률 조절

### 3.3 Beam (광선)
- **용도**: 지속형 special (fire/water/grass/electric 등)
- **DOM**: source→target 사이를 잇는 두꺼운 라인 + 양 끝 코어 + 잔상
- **모션**: 0~80ms 길이 늘어남(scaleX) → 80~360ms 펄스(opacity, width) → 360~480ms 페이드
- **기본 duration**: 480ms
- **길이 계산**: spawn 시점 `targetRect.x - sourceRect.x`로 1회 측정, CSS에서는 width 직접 지정

### 3.4 Burst (자기장·폭발)
- **용도**: 충격형 status, rock/ground/steel 보조
- **DOM**: 중앙 ring(scale 0→1) + 동심원 파동 2~3겹 + (옵션) shockwave 잔물결
- **모션**: 0~160ms ring 확장 + 동심원 0→max scale → 160~360ms 페이드 + 잔상
- **기본 duration**: 360ms

### 3.5 Aura (상태기 오라)
- **용도**: status 카테고리 기본, psychic/ghost/dark 보조
- **DOM**: 타깃 주변을 감싸는 부드러운 글로우 링 + 위로 솟구치는 파티클 4~6개
- **모션**: 0~180ms fade-in + 슬로우 펄스 → 180~600ms 유지 (motion=pulse 반복) → 600~720ms fade-out
- **기본 duration**: 720ms (상태기는 약간 길게)

---

## 4. 5종 Motion 명세

CSS class + `@keyframes`로 구현.

| Motion | 클래스 | 용도 | keyframes 핵심 |
|---|---|---|---|
| linear | `.fx-motion-linear` | 직선 이동 | `transform: translate(0,0) → translate(var(--fx-dx), var(--fx-dy))` |
| arc | `.fx-motion-arc` | 포물선 이동 | `cubic-bezier`로 곡률, `--fx-arc-curve` 변수 |
| pulse | `.fx-motion-pulse` | 크기·투명도 맥동 | `scale + opacity` 반복 |
| spin | `.fx-motion-spin` | 회전 | `rotate(0 → 360deg)` |
| shake | `.fx-motion-shake` | 잔진동 | `translate(±2~3px)` 빠른 반복 |

복수 motion 조합 가능 (예: beam은 linear + pulse).

---

## 5. 18속성 컬러 팔레트

### 5.1 컬러 테이블

| Type | Primary | Secondary | Accent |
|---|---|---|---|
| normal | #bfb3a4 | #e3d9c8 | #f7f1e3 |
| fire | #ff7044 | #ffba4a | #fff2c2 |
| water | #3aa6ff | #6fd8ff | #d6f1ff |
| grass | #6fc24a | #b6e07a | #eaf9c5 |
| electric | #ffd83a | #fff48a | #fffadf |
| poison | #9c5cc4 | #c290da | #ecd9f4 |
| ground | #c69a5b | #e2c089 | #f5e8cc |
| flying | #8fb6e8 | #c0d6f3 | #e8f0fb |
| bug | #9ec23a | #c8db70 | #ecf3c2 |
| fighting | #c64a4a | #e08080 | #f5cccc |
| psychic | #ff5c9a | #ffa5c8 | #ffe2ee |
| rock | #a8946a | #cdb88e | #ece2c8 |
| ghost | #7a5cff | #b59cff | #efe6ff |
| ice | #6fd5e0 | #a8e8ee | #def6f8 |
| dragon | #4a6cff | #7e9bff | #d8e1ff |
| dark | #5a4a66 | #8c7a98 | #d6cfdc |
| steel | #8fa8b8 | #b8c9d4 | #e2eaef |
| fairy | #ff8fc8 | #ffb8dc | #ffe1f0 |

### 5.2 적용 방식

CSS `:root`에 `--type-{type}-primary / -secondary / -accent` 18×3=54개 변수 정의.

TS 측 `palette.ts`:
```ts
export interface ElementPalette {
  primary: string;
  secondary: string;
  accent: string;
}

export const ELEMENT_PALETTE: Record<ElementType, ElementPalette> = {
  fire: { primary: "#ff7044", secondary: "#ffba4a", accent: "#fff2c2" },
  // ...
};

export function getElementPalette(type: ElementType): ElementPalette {
  return ELEMENT_PALETTE[type] ?? ELEMENT_PALETTE.normal;
}
```

이펙트 인스턴스 mount 시 root 엘리먼트에 인라인 변수 주입:
```ts
rootEl.style.setProperty("--fx-primary", palette.primary);
rootEl.style.setProperty("--fx-secondary", palette.secondary);
rootEl.style.setProperty("--fx-accent", palette.accent);
```

→ shape CSS는 항상 `var(--fx-primary)` 같은 형태만 참조하므로 **한 클래스셋이 18속성을 모두 커버**.

### 5.3 컬러 톤 가이드 (속성 추가·변경 시)
- **primary**: 가장 진한 메인 컬러. 라인, 코어, 외곽선.
- **secondary**: primary의 라이트닝 톤. 글로우, 중간 영역.
- **accent**: 거의 흰색에 가까운 가장 밝은 톤. 하이라이트, 명중 플래시.
- 채도와 밝기는 18종이 한 눈에 구분되도록 충분히 다르게.

---

## 6. 카테고리 × 속성 매핑 매트릭스 (54조합)

`src/ui/effects/mapping.ts`에 코드 상수로 정의. 매핑 규칙은 다음 표를 따른다.

### 6.1 기본 규칙

| Category | 기본 shape | 기본 motion | 기본 modifiers |
|---|---|---|---|
| physical | strike | shake | flash |
| special | beam | pulse | trail |
| status | aura | pulse | ring |

### 6.2 속성별 변형 (기본 규칙을 덮어쓰는 케이스만)

| Type | physical 오버라이드 | special 오버라이드 | status 오버라이드 |
|---|---|---|---|
| normal | (기본) | projectile / linear | (기본) |
| fire | strike + sparks | beam + pulse + trail | aura + sparks |
| water | (기본) | beam + pulse | aura + ring |
| grass | (기본) | beam + sparks | aura + sparks |
| electric | strike + flash + sparks | beam + pulse + flash | aura + flash |
| poison | (기본) | projectile + arc + trail | burst + trail (drip 느낌) |
| ground | burst + shockwave | burst + shockwave | (기본) |
| flying | strike + arc | projectile + arc | aura + spin |
| bug | (기본) | projectile + arc + trail | aura + sparks |
| fighting | strike + flash + shockwave | strike + flash | (기본) |
| psychic | (기본) | aura + spin + ring | aura + spin + ring |
| rock | burst + shockwave | burst + shockwave | (기본) |
| ghost | strike + spin | aura + spin + trail | aura + spin + ring |
| ice | (기본) | projectile + arc + trail | aura + ring |
| dragon | strike + arc | projectile + arc + trail | (기본) |
| dark | strike + spin | aura + spin | aura + spin + ring |
| steel | strike + flash + shockwave | beam + flash | (기본) |
| fairy | (기본) | projectile + arc + sparks | aura + sparks + ring |

> 빈 셀("기본")은 6.1의 카테고리 기본값 그대로.

### 6.3 매핑 시그니처

```ts
export function resolveEffectShape(
  category: MoveCategory,
  type: ElementType,
): { shape: ShapeKind; motion: MotionKind; modifiers: ModifierKind[] };

export function resolveEffectDescriptor(
  move: MoveDefinition,
  cue: FrameVisualCue,
): EffectDescriptor {
  const { shape, motion, modifiers } = resolveEffectShape(move.category, move.type);
  return {
    shape,
    motion,
    modifiers,
    palette: getElementPalette(move.type),
    meta: {
      durationMs: defaultDurationFor(shape),
      intensity: cue.critical ? 1 : cue.effectiveness > 1 ? 0.85 : 0.7,
      originSide: cue.sourceEntityId ? sideOf(cue.sourceEntityId) : "player",
      targetSide: cue.targetEntityId ? sideOf(cue.targetEntityId) : "enemy",
    },
  };
}
```

---

## 7. 이펙트 엔진 (RAF 루프)

### 7.1 책임
- 활성 이펙트 인스턴스 큐 관리
- `requestAnimationFrame` 루프 운영
- `durationMs` 만료 시 DOM 제거
- 같은 `(cueId, effectKey)` 중복 spawn 방지 (dedupe)
- `.fx-overlay` 컨테이너 보장 (없으면 lazy 생성)

### 7.2 핵심 인터페이스

```ts
export interface EffectInstance {
  id: string;
  cueId: string;
  effectKey: string;
  rootEl: HTMLElement;
  startedAt: number;
  durationMs: number;
}

export interface EffectEngine {
  spawn(
    descriptor: EffectDescriptor,
    sourceEl: HTMLElement,
    targetEl: HTMLElement,
    cueId: string,
    effectKey: string,
  ): void;
  clear(): void;
}
```

### 7.3 동작 흐름
1. `spawn` 호출 → `(cueId, effectKey)` 중복 체크 → 중복이면 무시
2. `sourceEl.getBoundingClientRect()`, `targetEl.getBoundingClientRect()` 측정 (1회)
3. shape 빌더 호출 → HTMLElement 반환
4. root에 `--fx-primary/-secondary/-accent` 인라인 변수 주입
5. `.fx-overlay`에 append
6. 인스턴스를 active 큐에 push
7. RAF 루프가 idle이면 시작
8. 매 프레임: 만료된 인스턴스(`now - startedAt >= durationMs`)는 `rootEl.remove()` + 큐에서 제거
9. 큐가 비면 RAF 정지

### 7.4 dedupe 키
- `${cueId}::${effectKey}` 단순 문자열
- 같은 키로 재호출 시 기존 인스턴스 유지(재시작 안 함)

### 7.5 540ms 스텝과의 관계
- 게임 로직의 `BATTLE_REPLAY_STEP_MS = 540` (`src/ui/htmlRenderer.ts:31`)은 그대로 유지
- 이펙트 인스턴스의 `durationMs`는 보통 360~720ms로, 다음 스텝의 새 cue가 도착하기 전에 자연 종료되거나 겹치게 됨
- 겹쳐도 dedupe 키가 다르면 인스턴스가 추가될 뿐이므로 시각적으로 자연스러움

---

## 8. 트리거 통합 지점

### 8.1 컨테이너 마운트
[src/ui/htmlRenderer.ts](../src/ui/htmlRenderer.ts)의 `renderScreen` 출력 최상단에 다음 한 줄 추가:
```html
<div class="fx-overlay" aria-hidden="true"></div>
```

### 8.2 Spawn 호출
[htmlRenderer.ts:1718](../src/ui/htmlRenderer.ts#L1718) 근방, `renderBattleMonster` 내부에서 새 cue가 감지된 직후:
```ts
import { effectEngine } from "./effects/engine";
import { resolveEffectDescriptor } from "./effects/mapping";

if (activeCue && move && (activeCue.type === "battle.hit" || activeCue.type === "battle.support")) {
  const descriptor = resolveEffectDescriptor(move, activeCue);
  const sourceEl = document.querySelector(`[data-entity-id="${activeCue.sourceEntityId}"]`);
  const targetEl = document.querySelector(`[data-entity-id="${activeCue.targetEntityId}"]`);
  if (sourceEl && targetEl) {
    effectEngine.spawn(descriptor, sourceEl, targetEl, activeCue.id, activeCue.effectKey);
  }
}
```

> 정확한 변수명·위치는 구현 시점에 `renderBattleMonster` 시그니처를 확인하여 조정.

### 8.3 CSS 포함
[src/style.css](../src/style.css) 최상단에 한 줄 추가:
```css
@import "./ui/effects/effects.css";
```

---

## 9. CSS 구조 (effects.css)

```css
:root {
  --type-fire-primary: #ff7044;
  --type-fire-secondary: #ffba4a;
  --type-fire-accent: #fff2c2;
  /* ... 18종 × 3색 = 54개 ... */
}

.fx-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  overflow: hidden;
}

/* shape 기본 */
.fx-shape-strike { /* ... */ }
.fx-shape-projectile { /* ... */ }
.fx-shape-beam {
  position: absolute;
  height: 6px;
  background: linear-gradient(90deg, var(--fx-primary), var(--fx-secondary), var(--fx-accent));
  transform-origin: left center;
  animation: fx-beam-life var(--fx-duration, 480ms) ease-out forwards;
}
.fx-shape-burst { /* ... */ }
.fx-shape-aura { /* ... */ }

/* motion */
@keyframes fx-motion-pulse { /* ... */ }
@keyframes fx-motion-arc { /* ... */ }
@keyframes fx-motion-shake { /* ... */ }
@keyframes fx-motion-spin { /* ... */ }

/* modifier */
.fx-mod-trail { /* ... */ }
.fx-mod-flash { /* ... */ }
.fx-mod-ring { /* ... */ }
.fx-mod-sparks { /* ... */ }
.fx-mod-shockwave { /* ... */ }
```

---

## 10. 확장 방법

### 10.1 새 속성 추가
1. [src/game/types.ts](../src/game/types.ts) `ElementType` 유니온에 추가
2. `palette.ts`의 `ELEMENT_PALETTE`에 3색 추가
3. `effects.css` `:root`에 `--type-{name}-*` 3개 추가
4. `mapping.ts` 변형 표에 해당 행 추가 (없으면 기본 규칙)

### 10.2 새 shape 추가
1. `src/ui/effects/types.ts` `ShapeKind`에 추가
2. `src/ui/effects/shapes/{name}.ts` 빌더 작성 (descriptor → HTMLElement)
3. `effects.css`에 `.fx-shape-{name}` 클래스 + 관련 keyframes
4. `mapping.ts`의 `defaultDurationFor`에 기본 시간 추가
5. `engine.ts`의 shape dispatch에 등록
6. `__tests__/mapping.test.ts` 보강

### 10.3 새 motion 추가
1. `types.ts` `MotionKind`에 추가
2. `effects.css`에 `@keyframes fx-motion-{name}` + `.fx-motion-{name}` 클래스
3. 필요 시 매핑 매트릭스 갱신

### 10.4 새 modifier 추가
1. `types.ts` `ModifierKind`에 추가
2. `effects.css`에 `.fx-mod-{name}` 클래스
3. shape 빌더에서 modifier 처리 분기 추가 (자식 노드 append)

### 10.5 특정 스킬만 다른 이펙트
**원칙적으로 권장하지 않음** (조립형의 취지를 깨므로). 그래도 필요하면:
- `mapping.ts`에 `MOVE_OVERRIDE: Record<string, EffectDescriptor>` 추가
- `resolveEffectDescriptor`에서 `MOVE_OVERRIDE[move.id]` 우선 반환

---

## 11. 검증

### 11.1 단위 테스트

**`__tests__/mapping.test.ts`**
- `MoveCategory` 3종 × `ElementType` 18종 = 54조합 모두 유효한 `{shape, motion, modifiers}` 반환
- 알 수 없는 type 입력 시 normal fallback

**`__tests__/palette.test.ts`**
- 18속성 모두 primary/secondary/accent 정의
- 각 색이 유효한 hex 문자열 (정규식 검사)
- CSS `:root` 변수명 충돌 없음 (실제 CSS 파싱 또는 알려진 키 매칭)

**`__tests__/engine.test.ts`** (jsdom + fake timer + RAF polyfill)
- 같은 `(cueId, effectKey)`로 spawn 2회 → 인스턴스 1개
- `durationMs` 경과 후 rootEl이 DOM에서 제거됨
- 인스턴스 0개 시 RAF 정지 (내부 플래그로 검증)
- 다른 키로 동시 spawn → 인스턴스 누적

### 11.2 회귀 방지
- [src/ui/rendererContract.test.ts](../src/ui/rendererContract.test.ts) — `data-battle-effect` 속성 출력만 검사. 새 시스템은 이 속성에 손대지 않으므로 자동 통과.
- 기존 `monster-use-*` / `monster-take-*` / `battle-*` CSS 셀렉터는 유지.

### 11.3 시각 검증 체크리스트

`npm run dev` 실행 후 전투 진입하여 확인:

- [ ] physical 기술(예: 몸통박치기) 사용 시 strike 오버레이 + 충돌 플래시
- [ ] special 기술(예: 불꽃세례) 사용 시 beam 또는 projectile + fire 컬러
- [ ] status 기술(예: 잠자기) 사용 시 aura + 펄스
- [ ] 18속성 컬러가 각각 구분되어 보임 (가능한 한 다양한 속성 스킬 사용)
- [ ] 캐릭터 모션(monster-use-strike 등)이 기존대로 함께 재생됨
- [ ] 급소 / 효과굉장 / 효과약함 텍스트 표시 정상
- [ ] 빠른 연속 공격 시 이펙트 중첩 자연스러움
- [ ] 540ms 스텝 안에서 이펙트가 모두 마무리되거나 자연스럽게 다음 스텝으로 이어짐
- [ ] 콘솔에 RAF / DOM 관련 에러·경고 없음
- [ ] `vitest run` 전체 통과

### 11.4 속성 × 카테고리 일괄 확인
실제 게임에서 54조합을 다 보긴 어려우므로 다음 두 방법 중 하나 사용:
1. **시드 고정 테스트 시나리오**: 디버그 빌드에서 특정 시드로 18속성 스킬을 순차 사용하는 자동 시퀀스
2. **devtools 콘솔 helper**: `effectEngine.previewAll()` 같은 디버그 메서드로 54조합을 1초 간격으로 재생 (개발 중에만 노출)

---

## 12. 단계별 구현 순서

코드 구현 시 다음 순서를 따르면 중간중간 확인 가능:

1. `types.ts`, `palette.ts` 작성 (18속성 컬러 테이블 확정)
2. `effects.css`에 `:root` 변수 + shape 기본 클래스 + motion keyframes 작성
3. `shapes/strike.ts`, `shapes/burst.ts` 빌더 작성 (가장 단순한 두 형태부터)
4. `engine.ts` 작성 (RAF 루프 + dedupe + `.fx-overlay` 보장)
5. `htmlRenderer.ts`에 `.fx-overlay` 마운트 + `effectEngine.spawn` 트리거 추가
6. 실 전투 화면에서 strike/burst가 뜨는지 확인
7. `shapes/projectile.ts`, `shapes/beam.ts`, `shapes/aura.ts` 추가
8. `mapping.ts`에 54조합 매트릭스 채움
9. modifier(trail/flash/ring/sparks/shockwave) 구현
10. `__tests__/` 작성
11. (선택) devtools preview helper 추가

---

## 13. 변경 영향 요약

### 신규 파일
- `src/ui/effects/types.ts`
- `src/ui/effects/palette.ts`
- `src/ui/effects/mapping.ts`
- `src/ui/effects/engine.ts`
- `src/ui/effects/effects.css`
- `src/ui/effects/shapes/strike.ts`
- `src/ui/effects/shapes/projectile.ts`
- `src/ui/effects/shapes/beam.ts`
- `src/ui/effects/shapes/burst.ts`
- `src/ui/effects/shapes/aura.ts`
- `src/ui/effects/__tests__/mapping.test.ts`
- `src/ui/effects/__tests__/palette.test.ts`
- `src/ui/effects/__tests__/engine.test.ts`

### 최소 수정
- [src/style.css](../src/style.css) — `@import "./ui/effects/effects.css";` 한 줄
- [src/ui/htmlRenderer.ts](../src/ui/htmlRenderer.ts) — `.fx-overlay` 마운트 + `effectEngine.spawn` 호출 추가

### 손대지 않음
- [src/ui/framePresentation.ts](../src/ui/framePresentation.ts)
- [src/game/types.ts](../src/game/types.ts)
- [src/game/view/frame.ts](../src/game/view/frame.ts)
- [src/game/battleEngine.ts](../src/game/battleEngine.ts)
- 기존 CSS keyframes (`monster-*`, `battle-*`)

### 선택 수정
- [src/ui/canvasRenderer.ts:711-733](../src/ui/canvasRenderer.ts#L711-L733) `visualCueColors` — 캔버스 폴백에서 `getElementPalette()` 사용해 색상 통일 (별도 PR 가능)
