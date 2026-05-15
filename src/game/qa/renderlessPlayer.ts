import type { BrowserGameRuntime } from "../../browser/gameRuntime";
import type { SeededRng } from "../rng";
import type { AutoPlayStrategy, GameState } from "../types";
import type { GameFrame } from "../view/frame";
import { chooseFrameAction, resolveFrameActionPayload } from "./frameController";

export type RenderlessTerminalReason =
  | "targetWaveCompleted"
  | "gameOver"
  | "maxSteps"
  | "noEnabledAction"
  | "noDispatchablePayload";

export interface RenderlessActionTraceEntry {
  step: number;
  wave: number;
  phase: GameFrame["phase"];
  frameId: number;
  actionId: string;
  actionType: string;
}

export interface RenderlessPlayOptions {
  maxWaves: number;
  maxSteps?: number;
  strategy: AutoPlayStrategy;
  rng: SeededRng;
  onFrame?: (step: number, frame: GameFrame, state: GameState) => void;
  onState?: (step: number, state: GameState) => void;
}

export interface RenderlessPlayResult {
  state: GameState;
  steps: number;
  terminalReason: RenderlessTerminalReason;
  actionTrace: RenderlessActionTraceEntry[];
}

export async function playRenderlessGame(
  runtime: BrowserGameRuntime,
  options: RenderlessPlayOptions,
): Promise<RenderlessPlayResult> {
  const maxSteps = options.maxSteps ?? options.maxWaves * 20 + 120;
  const actionTrace: RenderlessActionTraceEntry[] = [];
  const limitedReadyActionsByWave = new Map<number, Set<string>>();
  let state = runtime.getSnapshot();

  for (let step = 0; step < maxSteps; step += 1) {
    const frame = runtime.getFrame();
    state = runtime.getSnapshot();
    options.onFrame?.(step, frame, state);

    if (state.phase === "gameOver") {
      return { state, steps: step, terminalReason: "gameOver", actionTrace };
    }

    if (state.currentWave > options.maxWaves) {
      return { state, steps: step, terminalReason: "targetWaveCompleted", actionTrace };
    }

    const frameForChoice = filterRepeatedLimitedReadyActions(frame, limitedReadyActionsByWave);
    const action = chooseFrameAction(frameForChoice, options.strategy, options.rng);

    if (!action) {
      return { state, steps: step, terminalReason: "noEnabledAction", actionTrace };
    }

    const payload = resolveFrameActionPayload(frame, action);

    if (!payload) {
      return { state, steps: step, terminalReason: "noDispatchablePayload", actionTrace };
    }

    actionTrace.push({
      step,
      wave: frame.hud.wave,
      phase: frame.phase,
      frameId: frame.frameId,
      actionId: action.id,
      actionType: payload.type,
    });
    recordLimitedReadyAction(frame, action, limitedReadyActionsByWave);
    state = await runtime.dispatch(payload);
    options.onState?.(step, state);
  }

  return {
    state,
    steps: maxSteps,
    terminalReason: "maxSteps",
    actionTrace,
  };
}

function filterRepeatedLimitedReadyActions(
  frame: GameFrame,
  usedByWave: ReadonlyMap<number, ReadonlySet<string>>,
): GameFrame {
  if (frame.phase !== "ready") {
    return frame;
  }

  const used = usedByWave.get(frame.hud.wave);
  if (!used?.size) {
    return frame;
  }

  return {
    ...frame,
    actions: frame.actions.filter(
      (action) => !isLimitedReadyShopAction(action.id) || !used.has(action.id),
    ),
  };
}

function recordLimitedReadyAction(
  frame: GameFrame,
  action: { id: string },
  usedByWave: Map<number, Set<string>>,
): void {
  if (frame.phase !== "ready" || !isLimitedReadyShopAction(action.id)) {
    return;
  }

  const used = usedByWave.get(frame.hud.wave) ?? new Set<string>();
  used.add(action.id);
  usedByWave.set(frame.hud.wave, used);
}

function isLimitedReadyShopAction(actionId: string): boolean {
  return (
    actionId.startsWith("shop:stat-boost:") ||
    actionId.startsWith("shop:teach-move:") ||
    actionId.startsWith("shop:premium:stat-boost:") ||
    actionId.startsWith("shop:premium:teach-move:")
  );
}
