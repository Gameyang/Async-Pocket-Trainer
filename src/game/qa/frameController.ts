import { SeededRng } from "../rng";
import { shouldReplaceByPower } from "../scoring";
import type { AutoPlayStrategy, GameAction, ShopStatKey } from "../types";
import type { FrameAction, FrameEntity, GameFrame } from "../view/frame";

export function chooseFrameAction(
  frame: GameFrame,
  strategy: AutoPlayStrategy | undefined,
  rng: SeededRng,
): FrameAction | undefined {
  const enabledActions = frame.actions.filter((action) => action.enabled);

  if (enabledActions.length === 0) {
    return undefined;
  }

  if (frame.phase === "starterChoice") {
    return chooseStarterAction(frame, enabledActions, rng);
  }

  if (frame.phase === "gameOver") {
    return rng.pick(enabledActions.filter((action) => action.id.startsWith("start:")));
  }

  if (frame.phase === "ready") {
    return chooseReadyAction(frame, enabledActions, strategy);
  }

  if (frame.phase === "captureDecision") {
    return chooseCaptureAction(frame, enabledActions, strategy);
  }

  if (frame.phase === "teamDecision") {
    return chooseTeamDecisionAction(frame, enabledActions, strategy);
  }

  return enabledActions[0];
}

export function resolveFrameActionPayload(
  frame: GameFrame,
  action: FrameAction | undefined,
): GameAction | undefined {
  if (!action?.enabled) {
    return undefined;
  }

  if (action.action.type === "BUY_HEAL" && action.action.scope === "single") {
    const targetEntityId = chooseMostDamagedPlayerEntity(frame, action)?.id;
    return targetEntityId
      ? {
          type: "BUY_HEAL",
          scope: action.action.scope,
          tier: action.action.tier,
          targetEntityId,
        }
      : undefined;
  }

  if (action.action.type === "BUY_STAT_BOOST") {
    const targetEntityId = chooseStatBoostTarget(frame, action.action.stat, action)?.id;
    return targetEntityId
      ? {
          type: "BUY_STAT_BOOST",
          stat: action.action.stat,
          tier: action.action.tier,
          targetEntityId,
        }
      : undefined;
  }

  if (action.action.type === "BUY_STAT_REROLL") {
    const targetEntityId = chooseWeakestPlayerEntity(frame, action)?.id;
    return targetEntityId ? { type: "BUY_STAT_REROLL", targetEntityId } : undefined;
  }

  if (action.action.type === "BUY_TEACH_MOVE") {
    const targetEntityId = chooseStrongestPlayerEntity(frame, action)?.id;
    return targetEntityId
      ? { type: "BUY_TEACH_MOVE", element: action.action.element, targetEntityId }
      : undefined;
  }

  if (action.action.type === "BUY_PREMIUM_SHOP_ITEM" && action.requiresTarget) {
    const targetEntityId = action.id.includes(":heal:single")
      ? chooseMostDamagedPlayerEntity(frame, action)?.id
      : action.id.includes(":team-reroll")
        ? chooseWeakestPlayerEntity(frame, action)?.id
        : chooseStrongestPlayerEntity(frame, action)?.id;
    return targetEntityId
      ? {
          type: "BUY_PREMIUM_SHOP_ITEM",
          offerId: action.action.offerId,
          targetEntityId,
        }
      : undefined;
  }

  if (action.requiresTarget && !action.targetEntityId) {
    return undefined;
  }

  return action.action;
}

function chooseStarterAction(
  frame: GameFrame,
  actions: readonly FrameAction[],
  rng: SeededRng,
): FrameAction | undefined {
  const starterActions = actions.filter((action) => action.id.startsWith("start:"));
  const optionsBySpecies = new Map(
    frame.scene.starterOptions.map((option) => [option.speciesId, option]),
  );
  const scored = starterActions
    .map((action) => {
      const speciesId =
        action.action.type === "START_RUN" ? (action.action.starterSpeciesId ?? 0) : 0;
      return {
        action,
        power: optionsBySpecies.get(speciesId)?.power ?? 0,
        speciesId,
      };
    })
    .sort((left, right) => right.power - left.power || left.speciesId - right.speciesId);

  if (scored.length === 0) {
    return undefined;
  }

  const bestPower = scored[0].power;
  const tied = scored.filter((entry) => entry.power === bestPower);
  return rng.pick(tied).action;
}

function chooseReadyAction(
  frame: GameFrame,
  actions: readonly FrameAction[],
  strategy: AutoPlayStrategy | undefined,
): FrameAction | undefined {
  const claim = actions.find((action) => action.id.startsWith("claim:"));

  if (claim) {
    return claim;
  }

  const emergencyRecovery = chooseRecoveryAction(frame, actions, 0.55);

  if (emergencyRecovery) {
    return emergencyRecovery;
  }

  const ballPurchase = chooseBallPurchase(frame, actions, strategy);

  if (ballPurchase) {
    return ballPurchase;
  }

  const recovery = chooseRecoveryAction(frame, actions, 0.82);

  if (recovery) {
    return recovery;
  }

  const encounterBoost = chooseEncounterBoost(frame, actions);

  if (encounterBoost) {
    return encounterBoost;
  }

  const teamUpgrade = chooseTeamUpgrade(frame, actions, strategy);

  if (teamUpgrade) {
    return teamUpgrade;
  }

  return actions.find((action) => action.id === "encounter:next");
}

function chooseCaptureAction(
  frame: GameFrame,
  actions: readonly FrameAction[],
  strategy: AutoPlayStrategy | undefined,
): FrameAction | undefined {
  if (strategy === "conserveBalls" && frame.hud.wave < 4) {
    return actions.find((action) => action.id === "capture:skip");
  }

  const preferredIds =
    frame.hud.wave >= 10
      ? ["capture:masterball", "capture:hyperball", "capture:ultraball", "capture:greatball"]
      : frame.hud.wave >= 7
        ? ["capture:hyperball", "capture:ultraball", "capture:greatball", "capture:pokeball"]
        : ["capture:pokeball", "capture:greatball", "capture:ultraball"];

  return (
    preferredIds.map((id) => actions.find((action) => action.id === id)).find(Boolean) ??
    actions.find((action) => action.id === "capture:skip")
  );
}

function chooseTeamDecisionAction(
  frame: GameFrame,
  actions: readonly FrameAction[],
  strategy: AutoPlayStrategy | undefined,
): FrameAction | undefined {
  const keep = actions.find((action) => action.id === "team:keep");

  if (keep) {
    return keep;
  }

  const pendingCapture = frame.entities.find((entity) => entity.owner === "pendingCapture");
  const weakest = findWeakestPlayerEntity(frame.entities);

  if (
    pendingCapture &&
    weakest &&
    shouldReplaceByPower(weakest.scores.power, pendingCapture.scores.power, strategy ?? "greedy")
  ) {
    return actions.find((action) => action.id === `team:replace:${weakest.slot}`);
  }

  return actions.find((action) => action.id === "team:release");
}

function findWeakestPlayerEntity(entities: readonly FrameEntity[]): FrameEntity | undefined {
  return entities
    .filter((entity) => entity.owner === "player")
    .sort((left, right) => left.scores.power - right.scores.power)[0];
}

function chooseRecoveryAction(
  frame: GameFrame,
  actions: readonly FrameAction[],
  threshold: number,
): FrameAction | undefined {
  if (frame.hud.teamHpRatio >= threshold) {
    return undefined;
  }

  const damaged = frame.entities.some(
    (entity) => entity.owner === "player" && entity.hp.current < entity.hp.max,
  );

  if (!damaged) {
    return undefined;
  }

  return (
    findHighestTierAction(actions, "shop:heal:team:") ??
    actions.find((action) => action.id === "shop:rest") ??
    findHighestTierAction(actions, "shop:heal:single:")
  );
}

function chooseBallPurchase(
  frame: GameFrame,
  actions: readonly FrameAction[],
  strategy: AutoPlayStrategy | undefined,
): FrameAction | undefined {
  if (strategy === "conserveBalls" && frame.hud.wave < 4) {
    return undefined;
  }

  const desired = [
    frame.hud.wave >= 12 && frame.hud.balls.hyperBall < 1 ? "shop:hyperball" : undefined,
    frame.hud.wave >= 8 && frame.hud.balls.ultraBall < 1 ? "shop:ultraball" : undefined,
    frame.hud.wave >= 5 && frame.hud.balls.greatBall < 2 ? "shop:greatball" : undefined,
    frame.hud.balls.pokeBall < 3 ? "shop:pokeball" : undefined,
  ].filter((id): id is string => Boolean(id));

  return desired.map((id) => actions.find((action) => action.id === id)).find(Boolean);
}

function chooseEncounterBoost(
  frame: GameFrame,
  actions: readonly FrameAction[],
): FrameAction | undefined {
  if (frame.hud.encounterBoost) {
    return undefined;
  }

  return (
    findHighestTierAction(actions, "shop:level-boost:") ??
    findHighestTierAction(actions, "shop:rarity-boost:") ??
    actions.find((action) => action.id.startsWith("shop:type-lock:"))
  );
}

function chooseTeamUpgrade(
  frame: GameFrame,
  actions: readonly FrameAction[],
  strategy: AutoPlayStrategy | undefined,
): FrameAction | undefined {
  if (strategy === "conserveBalls" || frame.hud.teamHpRatio < 0.75) {
    return undefined;
  }

  return (
    findHighestTierAction(actions, "shop:stat-boost:attack:") ??
    findHighestTierAction(actions, "shop:stat-boost:special:") ??
    findHighestTierAction(actions, "shop:stat-boost:hp:") ??
    actions.find((action) => action.id.startsWith("shop:teach-move:")) ??
    actions.find((action) => action.id === "shop:team-sort:power:desc") ??
    actions.find((action) => action.id.startsWith("shop:premium:stat-boost:")) ??
    actions.find((action) => action.id.startsWith("shop:premium:teach-move:"))
  );
}

function findHighestTierAction(
  actions: readonly FrameAction[],
  prefix: string,
): FrameAction | undefined {
  return actions
    .filter((action) => action.id.startsWith(prefix))
    .sort((left, right) => parseTrailingTier(right.id) - parseTrailingTier(left.id))[0];
}

function parseTrailingTier(id: string): number {
  const value = Number.parseInt(id.split(":").at(-1) ?? "", 10);
  return Number.isFinite(value) ? value : 0;
}

function chooseMostDamagedPlayerEntity(
  frame: GameFrame,
  action: FrameAction,
): FrameEntity | undefined {
  return eligiblePlayerEntities(frame, action)
    .filter((entity) => entity.hp.current < entity.hp.max)
    .sort(
      (left, right) =>
        left.hp.ratio - right.hp.ratio ||
        left.hp.current - right.hp.current ||
        right.scores.power - left.scores.power,
    )[0];
}

function chooseStatBoostTarget(
  frame: GameFrame,
  stat: ShopStatKey,
  action: FrameAction,
): FrameEntity | undefined {
  if (stat === "hp" || stat === "defense") {
    return (
      chooseMostDamagedPlayerEntity(frame, action) ?? chooseStrongestPlayerEntity(frame, action)
    );
  }

  return chooseStrongestPlayerEntity(frame, action);
}

function chooseStrongestPlayerEntity(
  frame: GameFrame,
  action: FrameAction,
): FrameEntity | undefined {
  return eligiblePlayerEntities(frame, action).sort(
    (left, right) => right.scores.power - left.scores.power || left.slot - right.slot,
  )[0];
}

function chooseWeakestPlayerEntity(frame: GameFrame, action: FrameAction): FrameEntity | undefined {
  return eligiblePlayerEntities(frame, action).sort(
    (left, right) => left.scores.power - right.scores.power || left.slot - right.slot,
  )[0];
}

function eligiblePlayerEntities(frame: GameFrame, action: FrameAction): FrameEntity[] {
  const eligibleIds = action.eligibleTargetIds ? new Set(action.eligibleTargetIds) : undefined;
  return frame.entities.filter(
    (entity) => entity.owner === "player" && (!eligibleIds || eligibleIds.has(entity.id)),
  );
}
