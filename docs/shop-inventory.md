# 상점 상품 목록

기준일: 2026-05-14

이 문서는 현재 `src/game/headlessClient.ts`, `src/game/shopCatalog.ts`, `src/game/view/frame.ts`에 구현된 상점 상품 구성을 정리한다.

## 표시 규칙

- 상점 상품 영역은 항상 `3 x 3` 9칸을 사용한다.
- 9칸에는 실제 상품 8종과 `상점 재구성` 1종이 들어간다.
- `전투 시작`은 상품 9칸에 포함하지 않고 상단 보드에 별도 고정 버튼으로 표시한다.
- `상점 재구성` 비용은 `8 + rerollCount * 6` 코인이다.
- 정찰 상품과 선택 포켓몬 능력치 재추첨 상품은 더 이상 상점 추첨 풀에 포함되지 않는다.

## 추첨 그룹

상점은 아래 5개 기본 그룹에서 먼저 1개씩 뽑는다.

| 슬롯 | 그룹 | 선택 규칙 |
| --- | --- | --- |
| 1 | 회복 | 휴식과 HP 회복 상품 중 1개 |
| 2 | 볼 | 포획 볼 상품 중 1개 |
| 3 | 만남 보정 | 희귀도, 레벨, 모든 타입 고정 상품 중 1개 |
| 4 | 팀 강화 | 단일 능력치 강화 또는 모든 타입 기술 머신 중 1개 |
| 5 | 프리미엄 | 현재 웨이브의 활성 TP 전용 상품 후보 중 1개 |

그 다음 보너스 슬롯 3개를 추가로 뽑아 실제 상품 8종을 만든다.

| 보너스 슬롯 | 후보 풀 |
| --- | --- |
| 6 | 회복 또는 볼 |
| 7 | 만남 보정 |
| 8 | 만남 보정 또는 팀 강화 |

마지막 9번째 칸은 `shop:reroll` 상점 재구성 카드다.

## 회복 그룹

| Action ID | 효과 | 비용 | 가중치 | 재고 |
| --- | --- | ---: | ---: | ---: |
| `shop:rest` | 팀 전체 HP 완전 회복 | 현재 20 | 8 | 1 |
| `shop:heal:single:1` | 포켓몬 1마리 최대 HP의 20% 회복 | 4 | 14 | 1 |
| `shop:heal:single:2` | 포켓몬 1마리 최대 HP의 35% 회복 | 7 | 12 | 1 |
| `shop:heal:single:3` | 포켓몬 1마리 최대 HP의 50% 회복 | 10 | 8 | 1 |
| `shop:heal:single:4` | 포켓몬 1마리 최대 HP의 75% 회복 | 14 | 5 | 1 |
| `shop:heal:single:5` | 포켓몬 1마리 최대 HP의 100% 회복 | 20 | 3 | 1 |
| `shop:heal:team:1` | 팀 전체 최대 HP의 20% 회복 | 6 | 12 | 1 |
| `shop:heal:team:2` | 팀 전체 최대 HP의 35% 회복 | 10 | 10 | 1 |
| `shop:heal:team:3` | 팀 전체 최대 HP의 50% 회복 | 14 | 7 | 1 |
| `shop:heal:team:4` | 팀 전체 최대 HP의 75% 회복 | 18 | 4 | 1 |

## 볼 그룹

| Action ID | 상품 | 비용 | 가중치 | 재고 |
| --- | --- | ---: | ---: | ---: |
| `shop:pokeball` | 포켓볼 | 9 | 18 | 3 |
| `shop:greatball` | 그레이트볼 | 22 | 14 | 2 |
| `shop:ultraball` | 울트라볼 | 45 | 10 | 2 |
| `shop:hyperball` | 하이퍼볼 | 80 | 6 | 1 |
| `shop:masterball` | 마스터볼 | 160 | 2 | 1 |

## 만남 보정 그룹

| Action ID | 효과 | 비용 | 가중치 | 재고 |
| --- | --- | ---: | ---: | ---: |
| `shop:rarity-boost:1` | 다음 만남 희귀도 보너스 +10% | 12 | 8 | 1 |
| `shop:rarity-boost:2` | 다음 만남 희귀도 보너스 +25% | 22 | 5 | 1 |
| `shop:rarity-boost:3` | 다음 만남 희귀도 보너스 +50% | 40 | 2 | 1 |
| `shop:level-boost:1` | 다음 만남 레벨 보너스 1-2 | 6 | 8 | 1 |
| `shop:level-boost:2` | 다음 만남 레벨 보너스 1-3 | 11 | 6 | 1 |
| `shop:level-boost:3` | 다음 만남 레벨 보너스 2-4 | 18 | 4 | 1 |
| `shop:level-boost:4` | 다음 만남 레벨 보너스 3-6 | 30 | 2 | 1 |

타입 고정 상품은 모든 포켓몬 타입에 있다. Action ID는 `shop:type-lock:{type}` 형식이다.

| 타입 | 비용 | 가중치 |
| --- | ---: | ---: |
| normal | 16 | 4 |
| fire | 20 | 4 |
| water | 18 | 4 |
| grass | 18 | 4 |
| electric | 22 | 4 |
| poison | 18 | 4 |
| ground | 22 | 4 |
| flying | 20 | 4 |
| bug | 16 | 4 |
| fighting | 24 | 4 |
| psychic | 28 | 3 |
| rock | 22 | 4 |
| ghost | 28 | 2 |
| ice | 30 | 2 |
| dragon | 42 | 2 |
| dark | 30 | 3 |
| steel | 32 | 3 |
| fairy | 32 | 3 |

## 팀 강화 그룹

능력치 강화 상품은 선택한 포켓몬의 능력치 1가지만 올린다. Action ID는 `shop:stat-boost:{stat}:{tier}` 형식이다.

| stat | 표시 | 1단계 | 2단계 | 3단계 |
| --- | --- | ---: | ---: | ---: |
| hp | HP | +3 / 8코인 | +6 / 14코인 | +9 / 22코인 |
| attack | 공 | +3 / 8코인 | +6 / 14코인 | +9 / 22코인 |
| defense | 방 | +3 / 8코인 | +6 / 14코인 | +9 / 22코인 |
| special | 특 | +3 / 8코인 | +6 / 14코인 | +9 / 22코인 |
| speed | 스 | +3 / 8코인 | +6 / 14코인 | +9 / 22코인 |

기술 머신은 모든 포켓몬 타입에 있다. Action ID는 `shop:teach-move:{type}` 형식이다.

| 타입 | 비용 | 가중치 |
| --- | ---: | ---: |
| normal | 24 | 4 |
| fire | 32 | 4 |
| water | 30 | 4 |
| grass | 28 | 4 |
| electric | 34 | 4 |
| poison | 26 | 4 |
| ground | 30 | 4 |
| flying | 28 | 4 |
| bug | 24 | 4 |
| fighting | 30 | 4 |
| psychic | 34 | 3 |
| rock | 30 | 4 |
| ghost | 34 | 2 |
| ice | 36 | 2 |
| dragon | 42 | 2 |
| dark | 34 | 3 |
| steel | 36 | 3 |
| fairy | 36 | 3 |

## 프리미엄 그룹

기존 프리미엄 상품인 `premium:masterball`, `premium:revive`, `premium:coin-bag`, `premium:team-reroll`, `premium:dex-unlock`은 상점 추첨 풀에서 삭제했다.

프리미엄 상품은 모두 `shop:premium:...` 형식이며 TP로만 구매한다. 활성 후보 1-2개를 먼저 뽑고, 그 후보 안에서 프리미엄 슬롯 1개가 선택된다.

| Action ID 패턴 | 효과 | TP 비용 |
| --- | --- | ---: |
| `shop:premium:heal:single:3` | 포켓몬 1마리 HP 50% 회복 | 3 |
| `shop:premium:heal:team:3` | 팀 전체 HP 50% 회복 | 4 |
| `shop:premium:ball:ultraball` | 울트라볼 +1 | 5 |
| `shop:premium:ball:masterball:2` | 마스터볼 +2 | 16 |
| `shop:premium:ball:masterball:3` | 마스터볼 +3 | 24 |
| `shop:premium:rarity-boost:2` | 희귀도 +25% | 4 |
| `shop:premium:rarity-boost:4` | 희귀도 +75% | 8 |
| `shop:premium:rarity-boost:5` | 희귀도 +100% | 12 |
| `shop:premium:level-boost:2` | 레벨 +1~3 | 3 |
| `shop:premium:level-boost:5` | 레벨 +4~8 | 8 |
| `shop:premium:level-boost:6` | 레벨 +6~10 | 12 |
| `shop:premium:stat-boost:{stat}:2` | 선택 포켓몬 단일 능력치 +6 | 3 |
| `shop:premium:stat-boost:{stat}:4` | 선택 포켓몬 단일 능력치 +12 | 6 |
| `shop:premium:stat-boost:{stat}:5` | 선택 포켓몬 단일 능력치 +15 | 8 |
| `shop:premium:type-lock:{type}` | 다음 만남 타입 고정 | 4 |
| `shop:premium:teach-move:{type}:1` | 일반 기술 머신과 동일 등급 | 4 |
| `shop:premium:teach-move:{type}:2` | 상급 타입 기술 머신 | 7 |
| `shop:premium:teach-move:{type}:3` | 최상급 타입 기술 머신 | 10 |

`{stat}`는 `hp`, `attack`, `defense`, `special`, `speed` 중 하나다. `{type}`은 모든 포켓몬 타입 18종 중 하나다.

## 관련 동작

- HP 회복 상품 사용 후 상단 팀 패널은 현재 HP를 즉시 표시한다.
- 새로 포획해 팀에 합류하는 포켓몬은 최대 HP의 50% 상태로 합류한다.
- 상품 재고는 구매가 성공했을 때만 차감된다.
- 재고가 0이 된 상품은 해당 상점 재고가 유지되는 동안 비활성 카드로 남는다.
