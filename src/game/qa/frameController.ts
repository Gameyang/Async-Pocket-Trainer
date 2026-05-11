import { SeededRng } from "../rng";
import type { AutoPlayOptions } from "../types";
import type { FrameAction, FrameEntity, GameFrame } from "../view/frame";

export function chooseFrameAction(
  frame: GameFrame,
  strategy: AutoPlayOptions["strategy"],
  rng: SeededRng,
): FrameAction | undefined {
  const enabledActions = frame.actions.filter((action) => action.enabled);

  if (enabledActions.length === 0) {
    return undefined;
  }

  if (frame.phase === "starterChoice" || frame.phase === "gameOver") {
    return rng.pick(enabledActions.filter((action) => action.id.startsWith("start:")));
  }

  if (frame.phase === "ready") {
    return chooseReadyAction(frame, enabledActions, strategy);
  }

  if (frame.phase === "captureDecision") {
    return chooseCaptureAction(frame, enabledActions, strategy);
  }

  if (frame.phase === "teamDecision") {
    return chooseTeamDecisionAction(frame, enabledActions);
  }

  return enabledActions[0];
}

function chooseReadyAction(
  frame: GameFrame,
  actions: readonly FrameAction[],
  strategy: AutoPlayOptions["strategy"],
): FrameAction | undefined {
  const rest = actions.find((action) => action.id === "shop:rest");

  if (rest && frame.hud.teamHpRatio < 0.98) {
    return rest;
  }

  const buyPokeBall = actions.find((action) => action.id === "shop:pokeball");

  if (strategy === "greedy" && buyPokeBall && frame.hud.balls.pokeBall <= 1) {
    return buyPokeBall;
  }

  const buyGreatBall = actions.find((action) => action.id === "shop:greatball");

  if (
    strategy === "greedy" &&
    buyGreatBall &&
    frame.hud.wave >= 6 &&
    frame.hud.balls.greatBall === 0
  ) {
    return buyGreatBall;
  }

  return actions.find((action) => action.id === "encounter:next");
}

function chooseCaptureAction(
  frame: GameFrame,
  actions: readonly FrameAction[],
  strategy: AutoPlayOptions["strategy"],
): FrameAction | undefined {
  if (strategy === "conserveBalls" && frame.hud.wave < 4) {
    return actions.find((action) => action.id === "capture:skip");
  }

  if (frame.hud.wave >= 7) {
    const greatBall = actions.find((action) => action.id === "capture:greatball");

    if (greatBall) {
      return greatBall;
    }
  }

  return (
    actions.find((action) => action.id === "capture:pokeball") ??
    actions.find((action) => action.id === "capture:greatball") ??
    actions.find((action) => action.id === "capture:skip")
  );
}

function chooseTeamDecisionAction(
  frame: GameFrame,
  actions: readonly FrameAction[],
): FrameAction | undefined {
  const keep = actions.find((action) => action.id === "team:keep");

  if (keep) {
    return keep;
  }

  const pendingCapture = frame.entities.find((entity) => entity.owner === "pendingCapture");
  const weakest = findWeakestPlayerEntity(frame.entities);

  if (pendingCapture && weakest && pendingCapture.scores.power > weakest.scores.power) {
    return actions.find((action) => action.id === `team:replace:${weakest.slot}`);
  }

  return actions.find((action) => action.id === "team:release");
}

function findWeakestPlayerEntity(entities: readonly FrameEntity[]): FrameEntity | undefined {
  return entities
    .filter((entity) => entity.owner === "player")
    .sort((left, right) => left.scores.power - right.scores.power)[0];
}
