import type {
  FrameAction,
  FrameBattleReplayEvent,
  FrameEntity,
  FrameVisualCue,
  GameFrame,
} from "../game/view/frame";
import {
  formatMoney,
  formatTrainerPoints,
  formatWave,
  localizeBall,
  localizeBattleStatus,
  withJosa,
} from "../game/localization";

export type FrameBattleEffect =
  | "attack"
  | "hit"
  | "critical-hit"
  | "super-effective"
  | "resisted-hit"
  | "miss"
  | "faint"
  | "status"
  | "";

export type DamageCueKind = "critical" | "super-effective" | "resisted" | "damage";

export interface ActiveBattleEntityIds {
  playerId?: string;
  opponentId?: string;
}

export interface BattleEventSummary {
  kind: string;
  turn: string;
  title: string;
  result: string;
  detail?: string;
}

export interface BattleCueText {
  kind: string;
  text: string;
}

export type CommandItem = { type: "action"; action: FrameAction };

export interface ShopActionProfile {
  kind: string;
  kicker: string;
  title: string;
  detail: string;
  meta: string;
}

const MAX_READY_SHOP_ACTIONS = 9;

export function getLatestVisualCue(frame: GameFrame): FrameVisualCue | undefined {
  return [...frame.visualCues].reverse().find((cue) => cue.type !== "phase.change");
}

export function findActiveVisualCue(
  frame: GameFrame,
  activeEvent: FrameBattleReplayEvent | undefined,
): FrameVisualCue | undefined {
  if (!activeEvent) {
    return undefined;
  }

  const activeSequence = activeEvent.sourceSequence ?? activeEvent.sequence;

  return frame.visualCues.find((cue) => {
    if (cue.sequence !== activeSequence) {
      return false;
    }

    if (activeEvent.type === "damage.apply") {
      return cue.type === "battle.hit";
    }

    if (activeEvent.type === "move.miss") {
      return cue.type === "battle.miss";
    }

    if (activeEvent.type === "creature.faint") {
      return cue.type === "creature.faint";
    }

    if (
      activeEvent.type === "move.effect" ||
      activeEvent.type === "status.apply" ||
      activeEvent.type === "status.immune"
    ) {
      return cue.type === "battle.support";
    }

    return false;
  });
}

export function resolveActiveBattleEntityIds(
  frame: GameFrame,
  entitiesById: ReadonlyMap<string, FrameEntity>,
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
): ActiveBattleEntityIds {
  let playerId: string | undefined;
  let opponentId: string | undefined;

  const setActive = (entityId: string | undefined) => {
    if (!entityId) {
      return;
    }

    const entity = entitiesById.get(entityId);
    if (!entity) {
      return;
    }

    if (entity.owner === "player") {
      playerId = playerId ?? entity.id;
      return;
    }

    opponentId = opponentId ?? entity.id;
  };

  if (activeEvent) {
    setActive(activeEvent.activePlayerId);
    setActive(activeEvent.activeEnemyId);
    setActive(activeEvent.sourceEntityId);
    setActive(activeEvent.targetEntityId);
    setActive(activeEvent.entityId);
  }

  if (
    activeCue?.type === "battle.hit" ||
    activeCue?.type === "battle.miss" ||
    activeCue?.type === "battle.support"
  ) {
    setActive(activeCue.sourceEntityId);
    setActive(activeCue.targetEntityId);
    if (activeCue.type === "battle.support") {
      setActive(activeCue.entityId);
    }
  } else if (activeCue?.type === "creature.faint") {
    setActive(activeCue.entityId);
  } else if (activeCue?.type === "capture.success" || activeCue?.type === "capture.fail") {
    setActive(activeCue.targetEntityId);
  }

  return {
    playerId:
      playerId ??
      frame.scene.playerSlots.find((id) => (entitiesById.get(id)?.hp.current ?? 0) > 0) ??
      frame.scene.playerSlots[0],
    opponentId:
      frame.scene.pendingCaptureId ??
      opponentId ??
      frame.scene.opponentSlots.find((id) => (entitiesById.get(id)?.hp.current ?? 0) > 0) ??
      frame.scene.opponentSlots[0],
  };
}

export function resolveBattleEffect(
  entity: FrameEntity,
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
): FrameBattleEffect {
  const cueEffect = resolveCueEffect(entity, activeCue);

  if (cueEffect) {
    return cueEffect;
  }

  if (!activeEvent) {
    return "";
  }

  if (activeEvent.type === "creature.faint" && activeEvent.entityId === entity.id) {
    return "faint";
  }

  if (activeEvent.sourceEntityId === entity.id) {
    return "attack";
  }

  if (activeEvent.targetEntityId === entity.id) {
    if (activeEvent.type === "move.miss") {
      return "miss";
    }

    if (activeEvent.type === "damage.apply") {
      if (activeEvent.critical) {
        return "critical-hit";
      }

      if ((activeEvent.effectiveness ?? 1) > 1) {
        return "super-effective";
      }

      if ((activeEvent.effectiveness ?? 1) > 0 && (activeEvent.effectiveness ?? 1) < 1) {
        return "resisted-hit";
      }

      return "hit";
    }

    return "status";
  }

  if (activeEvent.entityId === entity.id) {
    return "status";
  }

  return "";
}

export function resolveCueEffect(
  entity: FrameEntity,
  cue: FrameVisualCue | undefined,
): FrameBattleEffect {
  if (!cue) {
    return "";
  }

  if (cue.type === "creature.faint" && cue.entityId === entity.id) {
    return "faint";
  }

  if (cue.type === "battle.support") {
    if (cue.sourceEntityId === entity.id) {
      return "attack";
    }

    if (cue.targetEntityId === entity.id || cue.entityId === entity.id) {
      return "status";
    }

    return "";
  }

  if (cue.type === "battle.hit" || cue.type === "battle.miss") {
    if (cue.sourceEntityId === entity.id) {
      return "attack";
    }

    if (cue.targetEntityId !== entity.id) {
      return "";
    }

    if (cue.type === "battle.miss") {
      return "miss";
    }

    if (cue.critical) {
      return "critical-hit";
    }

    if (cue.effectiveness > 1) {
      return "super-effective";
    }

    if (cue.effectiveness > 0 && cue.effectiveness < 1) {
      return "resisted-hit";
    }

    return "hit";
  }

  return "";
}

export function visualCueReferencesEntity(cue: FrameVisualCue, entityId: string): boolean {
  if (cue.type === "battle.support") {
    return (
      cue.sourceEntityId === entityId ||
      cue.targetEntityId === entityId ||
      cue.entityId === entityId
    );
  }

  if (cue.type === "battle.hit" || cue.type === "battle.miss") {
    return cue.sourceEntityId === entityId || cue.targetEntityId === entityId;
  }

  if (cue.type === "creature.faint") {
    return cue.entityId === entityId;
  }

  if (cue.type === "capture.success" || cue.type === "capture.fail") {
    return cue.targetEntityId === entityId;
  }

  return false;
}

export function createBattleEventSummary(
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
  entities: readonly FrameEntity[],
): BattleEventSummary | undefined {
  if (!activeEvent) {
    return undefined;
  }

  const source = resolveEntityName(activeEvent.sourceEntityId, entities);
  const target = resolveEntityName(activeEvent.targetEntityId, entities);
  const entity = resolveEntityName(activeEvent.entityId, entities);
  const turn = activeEvent.turn > 0 ? `${activeEvent.turn}턴` : "개시";

  if (activeEvent.ceremonyStage) {
    return {
      kind: activeEvent.ceremonyStage,
      turn,
      title:
        activeEvent.ceremonyStage === "outro"
          ? "트레이너 마무리"
          : activeEvent.ceremonyStage === "summon"
            ? "포켓몬 소환"
            : activeEvent.ceremonyStage === "throw"
              ? "볼 투척"
              : "트레이너 등장",
      result:
        activeEvent.winner === "player" ? "승리" : activeEvent.winner === "enemy" ? "패배" : "준비",
      detail: activeEvent.label,
    };
  }

  if (activeEvent.type === "battle.start") {
    return {
      kind: "start",
      turn,
      title: "전투 시작",
      result: "대기",
      detail: "양쪽 선봉이 나왔습니다.",
    };
  }

  if (activeEvent.type === "turn.start") {
    return {
      kind: "turn",
      turn,
      title: "새 턴",
      result: "선봉 확인",
      detail: "이번 턴의 행동 순서를 계산합니다.",
    };
  }

  if (activeEvent.type === "move.select") {
    return {
      kind: "move",
      turn,
      title: `${source} -> ${target}`,
      result: "기술 준비",
      detail: activeEvent.move ?? "기술",
    };
  }

  if (activeEvent.type === "move.miss") {
    return {
      kind: "miss",
      turn,
      title: `${source} -> ${target}`,
      result: "빗나감",
      detail: activeEvent.move,
    };
  }

  if (activeEvent.type === "move.effect") {
    return {
      kind: "status",
      turn,
      title: source !== "???" ? source : entity,
      result: activeEvent.move ?? "?④낵",
      detail: activeEvent.label,
    };
  }

  if (activeEvent.type === "damage.apply") {
    const kind = resolveDamageCueKind(activeEvent, activeCue);
    return {
      kind,
      turn,
      title: `${source}의 ${activeEvent.move ?? "기술"}`,
      result: `${activeEvent.damage ?? 0} 피해`,
      detail: `${target} HP ${activeEvent.targetHpBefore ?? "?"} -> ${activeEvent.targetHpAfter ?? "?"}${formatDamageSummaryNotes(
        activeEvent,
      )}`,
    };
  }

  if (activeEvent.type === "turn.skip") {
    return {
      kind: "status",
      turn,
      title: entity,
      result: localizeBattleStatus(activeEvent.status),
      detail: "상태 이상으로 행동하지 못했습니다.",
    };
  }

  if (activeEvent.type === "status.apply" || activeEvent.type === "status.immune") {
    return {
      kind: "status",
      turn,
      title: target,
      result: localizeBattleStatus(activeEvent.status),
      detail: activeEvent.type === "status.immune" ? "면역" : "상태 변화",
    };
  }

  if (activeEvent.type === "status.tick") {
    return {
      kind: "status",
      turn,
      title: entity,
      result: `${activeEvent.damage ?? 0} 피해`,
      detail: `${localizeBattleStatus(activeEvent.status)} HP ${activeEvent.hpBefore ?? "?"} -> ${activeEvent.hpAfter ?? "?"}`,
    };
  }

  if (activeEvent.type === "status.clear") {
    return {
      kind: "status",
      turn,
      title: entity,
      result: "회복",
      detail: localizeBattleStatus(activeEvent.status),
    };
  }

  if (activeEvent.type === "creature.faint") {
    return {
      kind: "faint",
      turn,
      title: entity,
      result: "기절",
      detail: "다음 포켓몬을 확인합니다.",
    };
  }

  return {
    kind: activeEvent.winner === "player" ? "win" : "loss",
    turn,
    title: "전투 종료",
    result: activeEvent.winner === "player" ? "승리" : "패배",
    detail: `남은 HP 우리 ${activeEvent.playerRemainingHp ?? 0} / 상대 ${
      activeEvent.enemyRemainingHp ?? 0
    }`,
  };
}

export function createBattleCueText(
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
): BattleCueText | undefined {
  if (!activeEvent) {
    return activeCue ? createVisualCueText(activeCue) : undefined;
  }

  if (activeEvent.type === "damage.apply") {
    const kind = resolveDamageCueKind(activeEvent, activeCue);
    const prefix =
      kind === "critical"
        ? "급소 "
        : kind === "super-effective"
          ? "효과 굉장 "
          : kind === "resisted"
            ? "효과 약함 "
            : "";
    const suffix =
      activeEvent.effectiveness && activeEvent.effectiveness > 1
        ? "!"
        : activeEvent.effectiveness && activeEvent.effectiveness < 1
          ? "..."
          : "";
    return {
      kind,
      text: `${prefix}-${activeEvent.damage ?? 0}${suffix}`,
    };
  }

  if (activeEvent.type === "move.miss") {
    return { kind: "miss", text: "빗나감" };
  }

  if (activeEvent.type === "creature.faint") {
    return { kind: "faint", text: "기절" };
  }

  if (activeEvent.type === "status.apply" || activeEvent.type === "status.tick") {
    return { kind: "status", text: localizeBattleStatus(activeEvent.status) };
  }

  if (activeEvent.type === "move.effect") {
    return { kind: "status", text: activeEvent.move ?? "?④낵" };
  }

  return activeCue ? createVisualCueText(activeCue) : undefined;
}

export function createVisualCueText(cue: FrameVisualCue): BattleCueText {
  if (cue.type === "battle.miss") {
    return { kind: "miss", text: "빗나감" };
  }

  if (cue.type === "battle.hit") {
    if (cue.critical) {
      return { kind: "critical", text: `급소 -${cue.damage}` };
    }

    if (cue.effectiveness > 1) {
      return { kind: "super-effective", text: `효과 굉장 -${cue.damage}` };
    }

    if (cue.effectiveness > 0 && cue.effectiveness < 1) {
      return { kind: "resisted", text: `효과 약함 -${cue.damage}` };
    }

    return { kind: "damage", text: `-${cue.damage}` };
  }

  if (cue.type === "creature.faint") {
    return { kind: "faint", text: "기절" };
  }

  if (cue.type === "battle.support") {
    return { kind: "status", text: cue.label };
  }

  if (cue.type === "capture.success") {
    return { kind: "capture-success", text: "포획 성공" };
  }

  return { kind: "capture-fail", text: "포획 실패" };
}

export function resolveDamageCueKind(
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
): DamageCueKind {
  if (
    activeCue?.type === "battle.hit" &&
    (activeCue.effectKey === "battle.criticalHit" || activeCue.critical)
  ) {
    return "critical";
  }

  if (activeEvent?.critical) {
    return "critical";
  }

  if (
    (activeCue?.type === "battle.hit" &&
      (activeCue.effectKey === "battle.superEffective" || activeCue.effectiveness > 1)) ||
    (activeEvent?.effectiveness ?? 1) > 1
  ) {
    return "super-effective";
  }

  if (
    (activeCue?.type === "battle.hit" &&
      (activeCue.effectKey === "battle.resisted" ||
        (activeCue.effectiveness > 0 && activeCue.effectiveness < 1))) ||
    ((activeEvent?.effectiveness ?? 1) > 0 && (activeEvent?.effectiveness ?? 1) < 1)
  ) {
    return "resisted";
  }

  return "damage";
}

export function formatDamageSummaryNotes(activeEvent: FrameBattleReplayEvent): string {
  const notes = [
    ...(activeEvent.critical ? ["급소"] : []),
    ...(activeEvent.effectiveness && activeEvent.effectiveness > 1 ? ["효과 굉장"] : []),
    ...(activeEvent.effectiveness && activeEvent.effectiveness > 0 && activeEvent.effectiveness < 1
      ? ["효과 약함"]
      : []),
  ];

  return notes.length > 0 ? ` / ${notes.join(", ")}` : "";
}

export function formatBattleEventLabel(
  activeEvent: FrameBattleReplayEvent,
  entities: readonly FrameEntity[],
): string {
  const source = resolveEntityName(activeEvent.sourceEntityId, entities);
  const target = resolveEntityName(activeEvent.targetEntityId, entities);
  const entity = resolveEntityName(activeEvent.entityId, entities);

  if (activeEvent.ceremonyStage) {
    return activeEvent.label;
  }

  if (activeEvent.type === "battle.start") {
    return "전투가 시작되었습니다.";
  }

  if (activeEvent.type === "turn.start") {
    return `${activeEvent.turn}턴`;
  }

  if (activeEvent.type === "move.select") {
    return `${withJosa(source, "이/가")} ${withJosa(activeEvent.move ?? "기술", "을/를")} 준비했습니다.`;
  }

  if (activeEvent.type === "move.miss") {
    return `${withJosa(`${source}의 ${activeEvent.move ?? "기술"}`, "이/가")} ${target}에게 빗나갔습니다.`;
  }

  if (activeEvent.type === "move.effect") {
    return activeEvent.label;
  }

  if (activeEvent.type === "damage.apply") {
    const notes = formatDamageSummaryNotes(activeEvent).replace(" / ", "");
    return `${source}의 ${activeEvent.move ?? "기술"}! ${target}에게 ${activeEvent.damage ?? 0} 피해.${
      notes ? ` ${notes}.` : ""
    }`;
  }

  if (activeEvent.type === "turn.skip") {
    return `${withJosa(entity, "은/는")} 움직일 수 없습니다.`;
  }

  if (activeEvent.type === "status.apply") {
    return `${withJosa(target, "이/가")} ${localizeBattleStatus(activeEvent.status)} 상태가 되었습니다.`;
  }

  if (activeEvent.type === "status.immune") {
    return `${withJosa(target, "은/는")} ${localizeBattleStatus(activeEvent.status)}에 면역입니다.`;
  }

  if (activeEvent.type === "status.tick") {
    return `${withJosa(entity, "이/가")} ${localizeBattleStatus(activeEvent.status)} 피해 ${withJosa(
      String(activeEvent.damage ?? 0),
      "을/를",
    )} 받았습니다.`;
  }

  if (activeEvent.type === "status.clear") {
    return `${entity}의 ${localizeBattleStatus(activeEvent.status)} 상태가 풀렸습니다.`;
  }

  if (activeEvent.type === "creature.faint") {
    return `${withJosa(entity, "이/가")} 쓰러졌습니다.`;
  }

  return activeEvent.winner === "player" ? "우리 팀이 승리했습니다." : "상대가 승리했습니다.";
}

export function resolveEntityName(
  id: string | undefined,
  entities: readonly FrameEntity[],
): string {
  if (!id) {
    return "대상";
  }

  return entities.find((entity) => entity.id === id)?.name ?? "대상";
}

export function resolveHpState(hpRatio: number): "high" | "mid" | "low" | "empty" {
  if (hpRatio <= 0) {
    return "empty";
  }

  if (hpRatio <= 0.25) {
    return "low";
  }

  if (hpRatio <= 0.5) {
    return "mid";
  }

  return "high";
}

export function selectReadyShopActions(
  frame: GameFrame,
  playerEntities: readonly FrameEntity[],
): FrameAction[] {
  const needsRest =
    frame.hud.teamHpRatio < 0.75 || playerEntities.some((entity) => entity.hp.current <= 0);
  const totalBalls = Object.values(frame.hud.balls).reduce((total, count) => total + count, 0);
  const shopActions = frame.actions
    .filter((action) => action.id.startsWith("shop:"))
    .sort((left, right) => {
      const leftScore = scoreReadyShopAction(left, frame.hud.money, needsRest, totalBalls);
      const rightScore = scoreReadyShopAction(right, frame.hud.money, needsRest, totalBalls);
      return rightScore - leftScore;
    });
  const picks: FrameAction[] = [];
  const add = (action: FrameAction | undefined, allowDisabled = false) => {
    if (
      !action ||
      (!allowDisabled && !action.enabled) ||
      picks.some((existing) => existing.id === action.id)
    ) {
      return;
    }

    picks.push(action);
  };

  for (const action of shopActions) {
    if (picks.length >= MAX_READY_SHOP_ACTIONS) {
      break;
    }

    add(action, true);
  }

  return picks.slice(0, MAX_READY_SHOP_ACTIONS);
}

function scoreReadyShopAction(
  action: FrameAction,
  money: number,
  needsRest: boolean,
  totalBalls: number,
): number {
  const cost = action.cost ?? 0;
  const overBudget = Math.max(0, cost - money);
  const budgetFit = cost <= money ? cost : money - overBudget * 0.65 - 24;
  const availability = action.enabled ? 40 : 0;
  const onSale =
    action.originalCost !== undefined &&
    action.cost !== undefined &&
    action.originalCost > action.cost
      ? 45
      : 0;

  if (action.tpCost !== undefined) {
    return 220 + (action.enabled ? 60 : 0);
  }

  if (action.action.type === "REST_TEAM") {
    return budgetFit + availability + onSale + (needsRest ? 140 : 30);
  }

  if (action.action.type === "BUY_HEAL") {
    const scopeBonus = action.action.scope === "team" ? 18 : 10;
    return budgetFit + availability + onSale + (needsRest ? 110 : 20) + scopeBonus;
  }

  if (action.action.type === "BUY_BALL") {
    return budgetFit + availability + onSale + (totalBalls <= 2 ? 100 : 45);
  }

  if (action.action.type === "BUY_SCOUT") {
    const kindBonus = action.action.kind === "power" ? 8 : 12;
    return budgetFit + availability + onSale + 25 + kindBonus;
  }

  if (action.action.type === "BUY_RARITY_BOOST") {
    return budgetFit + availability + onSale + 15 + action.action.tier * 4;
  }

  if (action.action.type === "BUY_LEVEL_BOOST") {
    return budgetFit + availability + onSale + 12 + action.action.tier * 4;
  }

  if (action.action.type === "BUY_STAT_BOOST") {
    return budgetFit + availability + onSale + 20 + action.action.tier * 6;
  }

  if (action.action.type === "BUY_STAT_REROLL") {
    return budgetFit + availability + onSale + 14;
  }

  if (action.action.type === "BUY_TEACH_MOVE") {
    return budgetFit + availability + onSale + 24;
  }

  if (action.action.type === "BUY_TYPE_LOCK") {
    return budgetFit + availability + onSale + 18;
  }

  if (action.action.type === "SORT_TEAM") {
    return budgetFit + availability + onSale + 16;
  }

  if (action.action.type === "REROLL_SHOP_INVENTORY") {
    return 200 + (action.enabled ? 30 : 0);
  }

  if (action.action.type === "BUY_TRAINER_PORTRAIT") {
    return 215 + (action.enabled ? 40 : 0);
  }

  return budgetFit + onSale;
}

export function selectCommandItems(
  frame: GameFrame,
  playerEntities: readonly FrameEntity[],
  pendingCapture: FrameEntity | undefined,
): CommandItem[] {
  if (frame.phase === "ready") {
    const next = findAction(frame.actions, "encounter:next");
    return [next, ...selectReadyShopActions(frame, playerEntities)]
      .filter((action): action is FrameAction => Boolean(action))
      .map((action) => ({
        type: "action",
        action,
      }));
  }

  if (frame.phase === "teamDecision") {
    const keep = findAction(frame.actions, "team:keep");
    const release = findAction(frame.actions, "team:release");

    if (keep) {
      return [keep, release]
        .filter((action): action is FrameAction => Boolean(action))
        .map((action) => ({ type: "action", action }));
    }

    const replace = selectRecommendedReplaceAction(frame.actions, playerEntities, pendingCapture);
    return [
      ...(replace ? [{ type: "action" as const, action: replace }] : []),
      ...(release ? [{ type: "action" as const, action: release }] : []),
    ];
  }

  if (frame.phase === "captureDecision") {
    return frame.actions.map((action) => ({ type: "action", action }));
  }

  if (frame.phase === "gameOver") {
    return frame.actions.map((action) => ({ type: "action", action }));
  }

  return frame.actions.slice(0, 3).map((action) => ({ type: "action", action }));
}

export function selectRecommendedReplaceAction(
  actions: readonly FrameAction[],
  playerEntities: readonly FrameEntity[],
  pendingCapture: FrameEntity | undefined,
): FrameAction | undefined {
  const replaceActions = actions.filter((action) => action.id.startsWith("team:replace:"));

  if (replaceActions.length === 0) {
    return undefined;
  }

  const scored = replaceActions.map((action) => {
    const index = Number(action.id.split(":").at(-1) ?? -1);
    const entity = playerEntities[index];
    const faintedPenalty = entity && entity.hp.current <= 0 ? -10_000 : 0;
    const power = entity?.scores.power ?? 0;
    const captureGain = pendingCapture ? pendingCapture.scores.power - power : 0;

    return {
      action,
      score: faintedPenalty + power - captureGain,
    };
  });

  scored.sort((left, right) => left.score - right.score);
  return scored[0]?.action;
}

export function createShopActionProfile(action: FrameAction, frame: GameFrame): ShopActionProfile {
  if (action.id === "encounter:next") {
    return {
      kind: "battle",
      kicker: "전투",
      title: "다음 만남",
      detail: action.label,
      meta: `${formatWave(frame.hud.wave)} 출발`,
    };
  }

  if (action.action.type === "REST_TEAM") {
    return {
      kind: "rest",
      kicker: "정비",
      title: "전체 회복 5단계",
      detail: `팀 HP ${Math.round(frame.hud.teamHpRatio * 100)}%`,
      meta: action.cost === undefined ? action.label : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_HEAL") {
    return {
      kind: "rest",
      kicker: action.action.scope === "team" ? "전체" : "단일",
      title: `회복 ${action.action.tier}단계`,
      detail:
        action.action.scope === "team"
          ? `팀 HP ${Math.round(frame.hud.teamHpRatio * 100)}%`
          : "가장 다친 포켓몬",
      meta: action.cost === undefined ? action.label : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_BALL") {
    const ball = action.action.ball;
    return {
      kind: "item",
      kicker: "볼",
      title: localizeBall(ball),
      detail: `보유 ${frame.hud.balls[ball]}`,
      meta: action.cost === undefined ? action.label : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_SCOUT") {
    return {
      kind: "scout",
      kicker: action.action.kind === "rarity" ? "희귀" : "강도",
      title: `탐지 ${action.action.tier}단계`,
      detail: action.action.kind === "rarity" ? "희귀도 리포트" : "전투력 리포트",
      meta: action.cost === undefined ? action.label : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_RARITY_BOOST") {
    return {
      kind: "rarity-boost",
      kicker: "희귀도",
      title: "희귀도 보정",
      detail: "다음 만남 종족값 상승",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_LEVEL_BOOST") {
    return {
      kind: "level-boost",
      kicker: "숙련도",
      title: "숙련도 보정",
      detail: "다음 만남 레벨 상승",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_STAT_BOOST") {
    return {
      kind: "stat-boost",
      kicker: formatShopStatLabel(action.action.stat),
      title: `${formatShopStatLabel(action.action.stat)} 강화`,
      detail: "선택 포켓몬 단일 능력치 상승",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_STAT_REROLL") {
    return {
      kind: "stat-reroll",
      kicker: "재추첨",
      title: "능력치 재추첨",
      detail: "선택 포켓몬 능력치 재계산",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_TEACH_MOVE") {
    return {
      kind: "teach-move",
      kicker: "기술 머신",
      title: "기술 머신",
      detail: "선택 포켓몬에 강한 기술 학습",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_TYPE_LOCK") {
    return {
      kind: "type-lock",
      kicker: "타입 고정",
      title: "타입 고정",
      detail: "다음 만남 속성 고정",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  if (action.action.type === "SORT_TEAM") {
    return {
      kind: "team-sort",
      kicker: "팀 정렬",
      title: formatTeamSortLabel(action.action.sortBy, action.action.direction),
      detail: "상단 팀 6마리 순서 정리",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  if (action.action.type === "REROLL_SHOP_INVENTORY") {
    return {
      kind: "reroll",
      kicker: "재구성",
      title: "상점 재구성",
      detail: "모든 카드 새로 추첨",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  if (action.action.type === "BUY_PREMIUM_SHOP_ITEM") {
    return {
      kind: "premium",
      kicker: "보석 전용",
      title: action.label.replace(/^TP\s+/, "").replace(/\s💎\s*\d+$/, ""),
      detail: "보석으로만 구매",
      meta: action.tpCost !== undefined ? formatTrainerPoints(action.tpCost) : action.label,
    };
  }

  if (action.action.type === "BUY_TRAINER_PORTRAIT") {
    return {
      kind: "portrait",
      kicker: action.portrait?.owned ? "Owned portrait" : "Portrait shop",
      title: action.portrait?.label ?? "Trainer portrait",
      detail: action.portrait?.owned ? "Equip this portrait" : "Unlock and equip",
      meta: action.tpCost !== undefined ? formatTrainerPoints(action.tpCost) : "Owned",
    };
  }

  if (action.id.startsWith("route:")) {
    return {
      kind: "route",
      kicker: "루트",
      title: action.label.replace(" 선택됨", ""),
      detail: action.id === "route:elite" ? "보상 증가" : "이번 웨이브 조정",
      meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
    };
  }

  return {
    kind: "action",
    kicker: renderPhaseLabel(frame.phase),
    title: action.label,
    detail: frame.scene.subtitle,
    meta: action.cost === undefined ? "선택" : formatMoney(action.cost),
  };
}

export function resolveSelectedRouteLabel(actions: readonly FrameAction[]): string {
  const selected = actions.find(
    (action) => action.id.startsWith("route:") && action.role === "primary" && !action.enabled,
  );

  return selected ? selected.label.replace(" 선택됨", "") : "일반 모험";
}

export function renderPhaseLabel(phase: GameFrame["phase"]): string {
  switch (phase) {
    case "starterChoice":
      return "스타터";
    case "ready":
      return "준비";
    case "captureDecision":
      return "포획";
    case "teamDecision":
      return "편성";
    case "gameOver":
      return "게임 오버";
  }
}

function findAction(actions: readonly FrameAction[], id: string): FrameAction | undefined {
  return actions.find((action) => action.id === id);
}

function formatShopStatLabel(stat: unknown): string {
  switch (stat) {
    case "hp":
      return "HP";
    case "attack":
      return "공";
    case "defense":
      return "방";
    case "special":
      return "특";
    case "speed":
      return "스";
    default:
      return "능력치";
  }
}

function formatTeamSortLabel(sortBy: unknown, direction: unknown): string {
  const sortLabel = sortBy === "power" ? "전투력" : "건강상태";
  const directionLabel = direction === "asc" ? "오름차순" : "내림차순";
  return `${sortLabel} ${directionLabel}`;
}
