import {
  ballTypes,
  type BallType,
  type BattleStatus,
  type ElementType,
  type GameAction,
  type MoveCategory,
} from "../game/types";
import type {
  FrameAction,
  FrameBattleReplayEvent,
  FrameBgmKey,
  FrameCaptureScene,
  FrameEntity,
  FrameStarterOption,
  FrameTimelineEntry,
  FrameTrainerScene,
  FrameVisualCue,
  GameFrame,
} from "../game/view/frame";
import {
  formatMoney,
  formatTrainerPoints,
  formatWave,
  localizeBall,
  localizeBattleStatus,
  localizeType,
} from "../game/localization";
import {
  createBattleCueText,
  createBattleEventSummary,
  createShopActionProfile,
  findActiveVisualCue,
  formatBattleEventLabel,
  getLatestVisualCue,
  resolveActiveBattleEntityIds,
  resolveBattleEffect,
  resolveHpState,
  selectCommandItems,
  selectReadyShopActions,
  visualCueReferencesEntity,
  type CommandItem,
  type ShopActionProfile,
} from "./framePresentation";
import { effectEngine } from "./effects/engine";
import { resolveEffectDescriptor } from "./effects/mapping";
import { getElementPalette } from "./effects/palette";

const BATTLE_REPLAY_STEP_MS = 540;
const FEEDBACK_TOAST_DURATION_MS = 3600;
const CURRENCY_BURST_DURATION_MS = 980;
const CURRENCY_BURST_PARTICLES = [
  { x: -58, y: 76, rotation: -190, delay: 0, duration: 840 },
  { x: -34, y: 94, rotation: -120, delay: 35, duration: 900 },
  { x: -12, y: 82, rotation: -70, delay: 15, duration: 820 },
  { x: 18, y: 98, rotation: 95, delay: 25, duration: 930 },
  { x: 46, y: 78, rotation: 165, delay: 5, duration: 860 },
  { x: 68, y: 104, rotation: 230, delay: 45, duration: 960 },
  { x: -72, y: 118, rotation: -250, delay: 80, duration: 920 },
  { x: -44, y: 132, rotation: -180, delay: 105, duration: 980 },
  { x: -6, y: 126, rotation: 140, delay: 70, duration: 910 },
  { x: 34, y: 138, rotation: 210, delay: 95, duration: 970 },
  { x: 74, y: 124, rotation: 285, delay: 75, duration: 940 },
  { x: 4, y: 156, rotation: 360, delay: 120, duration: 980 },
] as const;

const pokemonAssetUrls = import.meta.glob<string>("../resources/pokemon/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});
const trainerAssetUrls = import.meta.glob<string>("../resources/trainers/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});
const sfxAssetUrls = import.meta.glob<string>("../resources/audio/sfx/*.m4a", {
  eager: true,
  import: "default",
  query: "?url",
});
const bgmAssetUrls = import.meta.glob<string>("../resources/audio/bgm/*.m4a", {
  eager: true,
  import: "default",
  query: "?url",
});

export interface FrameClient {
  getFrame(): GameFrame;
  dispatch(action: GameAction): unknown | Promise<unknown>;
}

export interface HtmlRendererStatusView {
  teamRecord?: HtmlRendererTeamRecordView;
}

export interface HtmlRendererTeamRecordView {
  wave: number;
  opponentName: string;
  trainerName: string;
  message?: string;
}

export interface HtmlRendererOptions {
  getStatusView?: () => HtmlRendererStatusView;
  onTeamRecordSubmit?: (trainerName: string) => unknown | Promise<unknown>;
  onStarterReroll?: () => unknown | Promise<unknown>;
}

interface BattlePlaybackState {
  initialized: boolean;
  replayKey: string;
  cursor: number;
  timerId?: number;
}

interface BattlePlaybackView {
  activeEvent?: FrameBattleReplayEvent;
  visibleEvents: readonly FrameBattleReplayEvent[];
  isPlaying: boolean;
  replayKey: string;
}

interface AppLifecycleState {
  suspended: boolean;
}

interface TransientFeedbackState {
  shownReadyCaptureKeys: Set<string>;
  shownToastKeys: Set<string>;
  queuedToasts: ScheduledFeedbackToast[];
  activeToast?: ActiveFeedbackToast;
  toastTimerId?: number;
  toastBaselineReady: boolean;
}

interface ScheduledFeedbackToast {
  key: string;
  kind: "reward" | "currency" | "item" | "warning";
  title: string;
  message: string;
  tone: "success" | "warning" | "neutral";
}

interface ActiveFeedbackToast extends ScheduledFeedbackToast {
  expiresAt: number;
}

interface AudioState {
  unlocked: boolean;
  currentBgmKey?: FrameBgmKey;
  bgm?: HTMLAudioElement;
  playedCueIds: Set<string>;
  lastReplayKey: string;
  activeSfx: Set<HTMLAudioElement>;
}

type BattleMotionClip =
  | "use-strike"
  | "use-launch"
  | "use-beam"
  | "use-burst"
  | "use-aura"
  | "take-hit"
  | "take-heavy"
  | "take-guard"
  | "take-status"
  | "evade";

interface BattleMotionTemplate {
  clip: BattleMotionClip;
  role: "user" | "target";
}

type BattleHitVisualCue = Extract<FrameVisualCue, { type: "battle.hit" | "battle.miss" }> & {
  type: "battle.hit";
};
type BattleEffectVisualCue =
  | BattleHitVisualCue
  | Extract<FrameVisualCue, { type: "battle.support" }>;

interface ShopTargetState {
  action?: FrameAction;
  currencyBurstOrigin?: CurrencyBurstOrigin;
}

type SpendCurrencyKind = "coin" | "gem";

interface CurrencyBurstOrigin {
  x: number;
  y: number;
  kind: SpendCurrencyKind;
}

export function mountHtmlRenderer(
  root: HTMLElement,
  client: FrameClient,
  options: HtmlRendererOptions = {},
): void {
  const battlePlayback: BattlePlaybackState = {
    initialized: false,
    replayKey: "",
    cursor: 0,
  };
  const audioState: AudioState = {
    unlocked: false,
    playedCueIds: new Set(),
    lastReplayKey: "",
    activeSfx: new Set(),
  };
  const lifecycle: AppLifecycleState = {
    suspended: isPageSuspended(),
  };
  const transientFeedback: TransientFeedbackState = {
    shownReadyCaptureKeys: new Set(),
    shownToastKeys: new Set(),
    queuedToasts: [],
    toastBaselineReady: false,
  };
  const shopTarget: ShopTargetState = {};

  const render = () => {
    const frame = client.getFrame();
    if (frame.phase !== "ready") {
      shopTarget.action = undefined;
      shopTarget.currencyBurstOrigin = undefined;
    }
    updateBattlePlayback(battlePlayback, frame);
    const playbackView = createBattlePlaybackView(battlePlayback, frame);
    root.innerHTML = renderFrame(
      frame,
      options.getStatusView?.() ?? {},
      playbackView,
      Boolean(options.onStarterReroll),
      shopTarget.action,
      transientFeedback,
    );
    positionActiveMoveVfx(root, playbackView.activeEvent);
    spawnActiveBattleEffect(
      root,
      playbackView.activeEvent,
      findActiveVisualCue(frame, playbackView.activeEvent),
    );
    bindActions(root, client, frame, playbackView, audioState, shopTarget, render);
    bindShopTargetSelection(root, client, shopTarget, render);
    bindTeamDetailPopup(root);
    bindTeamRecord(root, options, render);
    bindStarterReroll(root, options, render);
    bindStarterDexSelection(root);
    syncAudio(audioState, frame, playbackView, lifecycle);
    scheduleBattlePlayback(battlePlayback, frame, render, lifecycle);
    scheduleFeedbackToast(transientFeedback, render, lifecycle);
  };

  render();
  bindAppLifecycle(lifecycle, audioState, battlePlayback, render);
}

function bindAppLifecycle(
  lifecycle: AppLifecycleState,
  audioState: AudioState,
  playback: BattlePlaybackState,
  render: () => void,
): void {
  const suspend = () => {
    const changed = !lifecycle.suspended;
    lifecycle.suspended = true;
    clearBattlePlaybackTimer(playback);
    pauseAudio(audioState);

    if (changed) {
      render();
    }
  };

  const resumeIfVisible = () => {
    if (isPageSuspended()) {
      suspend();
      return;
    }

    if (!lifecycle.suspended) {
      return;
    }

    lifecycle.suspended = false;
    render();
  };

  document.addEventListener("visibilitychange", resumeIfVisible);
  document.addEventListener("freeze", suspend);
  document.addEventListener("resume", resumeIfVisible);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resumeIfVisible);
}

function isPageSuspended(): boolean {
  return document.hidden || document.visibilityState === "hidden";
}

function bindActions(
  root: HTMLElement,
  client: FrameClient,
  frame: GameFrame,
  playback: BattlePlaybackView,
  audioState: AudioState,
  shopTarget: ShopTargetState,
  render: () => void,
): void {
  let busy = false;

  root.querySelectorAll<HTMLButtonElement>("[data-action-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (busy) {
        return;
      }

      const action = frame.actions.find((candidate) => candidate.id === button.dataset.actionId);

      if (action?.enabled && !playback.isPlaying) {
        if (requiresShopTarget(action)) {
          shopTarget.action = action;
          shopTarget.currencyBurstOrigin = captureCurrencyBurstOrigin(action, button);
          render();
          return;
        }

        const currencyBurstOrigin = captureCurrencyBurstOrigin(action, button);
        unlockAudio(audioState);
        busy = true;
        root.dataset.busy = "true";
        let dispatched = false;

        try {
          await client.dispatch(action.action);
          dispatched = true;
        } finally {
          busy = false;
          delete root.dataset.busy;
          shopTarget.action = undefined;
          shopTarget.currencyBurstOrigin = undefined;
          render();
          if (dispatched && currencyBurstOrigin) {
            spawnCurrencySpendBurst(currencyBurstOrigin);
          }
        }
      }
    });
  });
}

function bindShopTargetSelection(
  root: HTMLElement,
  client: FrameClient,
  shopTarget: ShopTargetState,
  render: () => void,
): void {
  root
    .querySelector<HTMLButtonElement>("[data-shop-target-cancel]")
    ?.addEventListener("click", () => {
      shopTarget.action = undefined;
      shopTarget.currencyBurstOrigin = undefined;
      render();
    });

  root.querySelectorAll<HTMLButtonElement>("[data-shop-target-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetEntityId = button.dataset.shopTargetId;
      const action = shopTarget.action;

      if (!targetEntityId || !action) {
        return;
      }

      const payload = buildTargetedPayload(action, targetEntityId);
      if (!payload) {
        return;
      }

      root.dataset.busy = "true";
      const currencyBurstOrigin =
        shopTarget.currencyBurstOrigin ?? captureCurrencyBurstOrigin(action, button);
      let dispatched = false;

      try {
        await client.dispatch(payload);
        dispatched = true;
      } finally {
        delete root.dataset.busy;
        shopTarget.action = undefined;
        shopTarget.currencyBurstOrigin = undefined;
        render();
        if (dispatched && currencyBurstOrigin) {
          spawnCurrencySpendBurst(currencyBurstOrigin);
        }
      }
    });
  });
}

function captureCurrencyBurstOrigin(
  action: FrameAction,
  element: Element,
): CurrencyBurstOrigin | undefined {
  const currency = getSpendCurrencyKind(action);
  if (!currency) {
    return undefined;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    kind: currency,
  };
}

function getSpendCurrencyKind(action: FrameAction): SpendCurrencyKind | undefined {
  if (action.cost !== undefined && action.cost > 0) {
    return "coin";
  }

  if (action.tpCost !== undefined && action.tpCost > 0) {
    return "gem";
  }

  return undefined;
}

function spawnCurrencySpendBurst(origin: CurrencyBurstOrigin): void {
  const burst = document.createElement("div");
  burst.className = "currency-spend-burst coin-spend-burst";
  burst.dataset.currency = origin.kind;
  burst.setAttribute("aria-hidden", "true");
  burst.style.left = `${Math.round(origin.x)}px`;
  burst.style.top = `${Math.round(origin.y)}px`;

  for (let index = 0; index < CURRENCY_BURST_PARTICLES.length; index += 1) {
    const particle = CURRENCY_BURST_PARTICLES[index];
    const item = document.createElement("span");
    item.textContent = origin.kind === "gem" ? "💎" : "🪙";
    item.style.setProperty("--currency-x", `${particle.x}px`);
    item.style.setProperty("--currency-y", `${particle.y}px`);
    item.style.setProperty("--currency-rot", `${particle.rotation}deg`);
    item.style.setProperty("--currency-delay", `${particle.delay}ms`);
    item.style.setProperty("--currency-duration", `${particle.duration}ms`);
    burst.append(item);
  }

  document.body.append(burst);
  window.setTimeout(() => burst.remove(), CURRENCY_BURST_DURATION_MS);
}

function buildTargetedPayload(action: FrameAction, targetEntityId: string): GameAction | undefined {
  if (action.action.type === "BUY_HEAL") {
    return {
      type: "BUY_HEAL",
      scope: action.action.scope,
      tier: action.action.tier,
      targetEntityId,
    };
  }
  if (action.action.type === "BUY_STAT_BOOST") {
    return {
      type: "BUY_STAT_BOOST",
      stat: action.action.stat,
      tier: action.action.tier,
      targetEntityId,
    };
  }
  if (action.action.type === "BUY_STAT_REROLL") {
    return { type: "BUY_STAT_REROLL", targetEntityId };
  }
  if (action.action.type === "BUY_TEACH_MOVE") {
    return { type: "BUY_TEACH_MOVE", element: action.action.element, targetEntityId };
  }
  if (action.action.type === "BUY_PREMIUM_SHOP_ITEM") {
    return { type: "BUY_PREMIUM_SHOP_ITEM", offerId: action.action.offerId, targetEntityId };
  }
  return undefined;
}

function requiresShopTarget(action: FrameAction): boolean {
  if (action.action.type === "BUY_HEAL") {
    return action.action.scope === "single";
  }
  return (
    action.requiresTarget ||
    action.action.type === "BUY_STAT_BOOST" ||
    action.action.type === "BUY_STAT_REROLL" ||
    action.action.type === "BUY_TEACH_MOVE"
  );
}

function bindTeamDetailPopup(root: HTMLElement): void {
  const closeAll = () => {
    root.querySelectorAll<HTMLElement>(".team-detail-popup[data-open]").forEach((popup) => {
      delete popup.dataset.open;
    });
  };

  root.querySelectorAll<HTMLButtonElement>("[data-team-detail-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const entityId = button.dataset.teamDetailId;
      const popup = entityId
        ? root.querySelector<HTMLElement>(
            `.team-detail-popup[data-entity-id="${cssEscape(entityId)}"]`,
          )
        : undefined;

      if (!popup) {
        return;
      }

      closeAll();
      popup.dataset.open = "true";
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-team-detail-close]").forEach((button) => {
    button.addEventListener("click", closeAll);
  });

  root.querySelectorAll<HTMLElement>(".team-detail-popup").forEach((popup) => {
    popup.addEventListener("click", (event) => {
      if (event.target === popup) {
        closeAll();
      }
    });
  });
}

function bindTeamRecord(root: HTMLElement, options: HtmlRendererOptions, render: () => void): void {
  const form = root.querySelector<HTMLFormElement>("[data-team-record-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!options.onTeamRecordSubmit) {
      return;
    }

    const data = new FormData(form);
    await options.onTeamRecordSubmit(String(data.get("trainerName") ?? ""));
    render();
  });
}

function bindStarterReroll(
  root: HTMLElement,
  options: HtmlRendererOptions,
  render: () => void,
): void {
  root
    .querySelector<HTMLButtonElement>("[data-starter-reroll]")
    ?.addEventListener("click", async () => {
      await options.onStarterReroll?.();
      render();
    });
}

function bindStarterDexSelection(root: HTMLElement): void {
  const row = root.querySelector<HTMLElement>(".starter-choice-row");

  if (!row) {
    return;
  }

  const clearSelection = () => {
    delete row.dataset.selectionActive;
    row
      .querySelectorAll<HTMLElement>(".starter-option[data-starter-selected]")
      .forEach((option) => {
        delete option.dataset.starterSelected;
      });
  };

  row.querySelectorAll<HTMLButtonElement>("[data-starter-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const option = button.closest<HTMLElement>(".starter-option");

      if (!option || option.dataset.starterState !== "unlocked") {
        return;
      }

      clearSelection();
      option.dataset.starterSelected = "true";
      option.scrollIntoView({ block: "center", inline: "nearest" });
      row.dataset.selectionActive = "true";
    });
  });

  row.querySelectorAll<HTMLButtonElement>("[data-starter-cancel]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      clearSelection();
    });
  });
}

function renderFrame(
  frame: GameFrame,
  statusView: HtmlRendererStatusView,
  playback: BattlePlaybackView,
  canRerollStarter: boolean,
  shopTargetAction?: FrameAction,
  transientFeedback?: TransientFeedbackState,
): string {
  const entityView = createEntityPlaybackView(frame, playback);
  const playerEntities = frame.scene.playerSlots
    .map((id) => entityView.entitiesById.get(id))
    .filter((entity): entity is FrameEntity => Boolean(entity));
  const opponentEntities = frame.scene.opponentSlots
    .map((id) => entityView.entitiesById.get(id))
    .filter((entity): entity is FrameEntity => Boolean(entity));
  const pendingCapture = frame.scene.pendingCaptureId
    ? entityView.entitiesById.get(frame.scene.pendingCaptureId)
    : undefined;
  const latestCue = getLatestVisualCue(frame);
  const activeCue = findActiveVisualCue(frame, playback.activeEvent);
  const activeIds = resolveActiveBattleEntityIds(
    frame,
    entityView.entitiesById,
    playback.activeEvent,
    activeCue ?? latestCue,
  );
  const activePlayer =
    (activeIds.playerId ? entityView.entitiesById.get(activeIds.playerId) : undefined) ??
    playerEntities.find((entity) => entity.hp.current > 0) ??
    playerEntities[0];
  const activeOpponent =
    pendingCapture ??
    (activeIds.opponentId ? entityView.entitiesById.get(activeIds.opponentId) : undefined) ??
    opponentEntities.find((entity) => entity.hp.current > 0) ??
    opponentEntities[0];
  const latestLine = frame.timeline[0]?.text ?? latestCue?.label ?? frame.scene.subtitle;
  const logLine =
    playback.isPlaying && playback.activeEvent
      ? formatBattleEventLabel(playback.activeEvent, entityView.entities)
      : latestLine;
  const screen = renderScreen({
    frame,
    playerEntities,
    opponentEntities,
    pendingCapture,
    activePlayer,
    activeOpponent,
    playback,
    logLine,
    activeCue,
    canRerollStarter,
    shopTargetAction,
    teamRecord: statusView.teamRecord,
    transientFeedback,
  });
  const feedbackToasts = renderFeedbackToastStack(frame, playback, transientFeedback);
  return `
    <main class="app-shell" data-frame-id="${frame.frameId}" data-protocol="${frame.protocolVersion}" data-phase="${frame.phase}" data-wave="${frame.hud.wave}" data-money="${frame.hud.money}" data-trainer-points="${frame.hud.trainerPoints}" ${renderBallDataAttributes(frame)} data-team-size="${playerEntities.length}" data-team-hp-ratio="${frame.hud.teamHpRatio}" data-timeline-count="${frame.timeline.length}" data-battle-playback="${playback.isPlaying ? "playing" : "idle"}" data-battle-sequence="${playback.activeEvent?.sequence ?? 0}" data-battle-event-type="${escapeHtml(playback.activeEvent?.type ?? "")}">
      ${screen}
      ${feedbackToasts}

      ${
        frame.phase === "starterChoice" || frame.phase === "ready"
          ? ""
          : renderCommandBand(frame, playback.isPlaying, playerEntities, pendingCapture)
      }
    </main>
  `;
}

function renderBallDataAttributes(frame: GameFrame): string {
  return ballTypes
    .map((ball) => `data-${ballDataAttributeName(ball)}-balls="${frame.hud.balls[ball]}"`)
    .join(" ");
}

function renderFeedbackToastStack(
  frame: GameFrame,
  playback: BattlePlaybackView,
  transientFeedback: TransientFeedbackState | undefined,
): string {
  const toast = updateFeedbackToastSchedule(frame, playback, transientFeedback);

  if (!toast) {
    return "";
  }

  return `
    <div class="feedback-toast-rail" aria-live="polite" aria-atomic="true">
      <div class="feedback-toast" data-toast-kind="${toast.kind}" data-toast-tone="${toast.tone}" data-toast-key="${escapeHtml(toast.key)}">
        <span>${feedbackToastKindLabel(toast.kind)}</span>
        <strong>${escapeHtml(toast.title)}</strong>
        <p>${escapeHtml(toast.message)}</p>
      </div>
    </div>
  `;
}

function updateFeedbackToastSchedule(
  frame: GameFrame,
  playback: BattlePlaybackView,
  transientFeedback: TransientFeedbackState | undefined,
): ActiveFeedbackToast | undefined {
  if (!transientFeedback) {
    return undefined;
  }

  const now = Date.now();

  if (!transientFeedback.toastBaselineReady) {
    frame.timeline.forEach((entry) => transientFeedback.shownToastKeys.add(entry.id));
    transientFeedback.toastBaselineReady = true;
    return transientFeedback.activeToast;
  }

  if (!playback.isPlaying) {
    enqueueNewFeedbackToasts(frame, transientFeedback);
  }

  if (transientFeedback.activeToast && transientFeedback.activeToast.expiresAt <= now) {
    transientFeedback.activeToast = undefined;
  }

  if (!transientFeedback.activeToast) {
    const nextToast = transientFeedback.queuedToasts.shift();
    transientFeedback.activeToast = nextToast
      ? {
          ...nextToast,
          expiresAt: now + FEEDBACK_TOAST_DURATION_MS,
        }
      : undefined;
  }

  return transientFeedback.activeToast;
}

function enqueueNewFeedbackToasts(
  frame: GameFrame,
  transientFeedback: TransientFeedbackState,
): void {
  const newEntries = frame.timeline
    .slice()
    .reverse()
    .filter((entry) => !transientFeedback.shownToastKeys.has(entry.id));

  for (const entry of newEntries) {
    transientFeedback.shownToastKeys.add(entry.id);
    const toast = createFeedbackToast(entry);
    if (toast) {
      transientFeedback.queuedToasts.push(toast);
    }
  }
}

function scheduleFeedbackToast(
  transientFeedback: TransientFeedbackState,
  render: () => void,
  lifecycle: AppLifecycleState,
): void {
  if (
    lifecycle.suspended ||
    transientFeedback.toastTimerId !== undefined ||
    !transientFeedback.activeToast
  ) {
    return;
  }

  const delay = Math.max(80, transientFeedback.activeToast.expiresAt - Date.now());
  transientFeedback.toastTimerId = window.setTimeout(() => {
    transientFeedback.toastTimerId = undefined;
    if (!lifecycle.suspended) {
      render();
    }
  }, delay);
}

function createFeedbackToast(entry: FrameTimelineEntry): ScheduledFeedbackToast | undefined {
  const data = entry.data ?? {};
  const reward = readNumber(data.reward);
  const trainerPoints = readNumber(data.trainerPoints);
  const cost = readNumber(data.cost);
  const targetName = readString(data.target);
  const toastBase = {
    key: entry.id,
  };

  if (entry.type === "battle_resolved" && reward > 0) {
    return {
      ...toastBase,
      kind: "reward",
      tone: "success",
      title: `${formatMoney(reward)} 획득`,
      message: "전투 승리 보상",
    };
  }

  if (entry.type === "tp_earned" && trainerPoints > 0) {
    return {
      ...toastBase,
      kind: "currency",
      tone: "success",
      title: `${formatTrainerPoints(trainerPoints)} 획득`,
      message: "보석 획득",
    };
  }

  if (entry.type === "ball_bought") {
    const ball = readBallType(data.ball);
    const quantity = readNumber(data.quantity);
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: ball ? `${localizeBall(ball)} +${quantity || 1}` : "볼 구매 완료",
      message: cost > 0 ? `${formatMoney(cost)} 사용` : "인벤토리에 추가되었습니다",
    };
  }

  if (entry.type === "team_rested") {
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "팀 휴식 완료",
      message: cost > 0 ? `${formatMoney(cost)} 사용` : "팀 HP가 회복되었습니다",
    };
  }

  if (entry.type === "team_healed" || entry.type === "creature_healed") {
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: entry.type === "team_healed" ? "전체 회복 사용" : "단일 회복 사용",
      message: cost > 0 ? `${formatMoney(cost)} 사용` : "HP를 회복했습니다",
    };
  }

  if (entry.type === "boost_applied") {
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "만남 보정 적용",
      message: formatBoostToastMessage(data),
    };
  }

  if (entry.type === "type_lock_applied") {
    const element = readElementType(data.element);
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "타입 고정 적용",
      message: element ? `${localizeType(element)} 타입으로 고정` : "다음 만남에 적용됩니다",
    };
  }

  if (entry.type === "stat_boost_applied") {
    const stat = formatShopStatLabel(data.stat);
    const bonus = readNumber(data.bonus);
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "능력치 강화 완료",
      message: `${targetName ? `${targetName} ` : ""}${stat}${bonus > 0 ? ` +${bonus}` : ""}`,
    };
  }

  if (entry.type === "stat_reroll_applied") {
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "능력치 재구성 완료",
      message: targetName ? `${targetName} 능력치 갱신` : "대상 능력치가 갱신되었습니다",
    };
  }

  if (entry.type === "teach_move_applied") {
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "기술 머신 사용",
      message: targetName ? `${targetName} 기술 갱신` : "새 기술을 익혔습니다",
    };
  }

  if (entry.type === "premium_purchased") {
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "보석 상품 사용 완료",
      message: "프리미엄 효과가 적용되었습니다",
    };
  }

  if (entry.type === "shop_rerolled") {
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "상점 재구성 완료",
      message: cost > 0 ? `${formatMoney(cost)} 사용` : "상품 목록을 갱신했습니다",
    };
  }

  if (entry.type === "team_sorted") {
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "팀 정렬 완료",
      message: cost > 0 ? `${formatMoney(cost)} 사용` : "팀 순서를 정리했습니다",
    };
  }

  if (entry.type === "supply_resolved") {
    const healedHp = readNumber(data.healedHp);
    return {
      ...toastBase,
      kind: "item",
      tone: "success",
      title: "보급 처리 완료",
      message: healedHp > 0 ? `HP ${healedHp} 회복` : "보급 상태를 확인했습니다",
    };
  }

  if (entry.type === "capture_no_ball") {
    return {
      ...toastBase,
      kind: "warning",
      tone: "warning",
      title: "사용 실패",
      message: "선택한 볼이 없습니다",
    };
  }

  if (entry.type.endsWith("_denied")) {
    return {
      ...toastBase,
      kind: "warning",
      tone: "warning",
      title: "사용 실패",
      message: createDeniedToastMessage(entry.type),
    };
  }

  return undefined;
}

function feedbackToastKindLabel(kind: ActiveFeedbackToast["kind"]): string {
  switch (kind) {
    case "reward":
      return "보상";
    case "currency":
      return "재화";
    case "item":
      return "아이템";
    case "warning":
      return "안내";
  }
}

function formatBoostToastMessage(data: Record<string, unknown>): string {
  if (data.kind === "rarity") {
    const bonus = readNumber(data.bonus);
    return bonus > 0 ? `희귀도 +${Math.round(bonus * 100)}%` : "희귀도 보정 적용";
  }

  if (data.kind === "level") {
    const min = readNumber(data.min);
    const max = readNumber(data.max);
    return max > 0 ? `숙련도 +${min}~${max}` : "숙련도 보정 적용";
  }

  return "다음 만남에 적용됩니다";
}

function createDeniedToastMessage(type: string): string {
  if (type.includes("premium")) {
    return "보석 또는 조건이 부족합니다";
  }

  if (type.includes("heal") || type.includes("rest")) {
    return "회복 조건을 확인하세요";
  }

  if (type.includes("ball") || type.includes("buy")) {
    return "코인 또는 재고를 확인하세요";
  }

  if (type.includes("boost") || type.includes("type_lock")) {
    return "보정 아이템 조건을 확인하세요";
  }

  if (type.includes("teach_move")) {
    return "기술 머신 조건을 확인하세요";
  }

  if (type.includes("stat")) {
    return "대상 또는 코인을 확인하세요";
  }

  if (type.includes("team_sort")) {
    return "팀 정렬 조건을 확인하세요";
  }

  return "사용 조건을 확인하세요";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBallType(value: unknown): BallType | undefined {
  return ballTypes.includes(value as BallType) ? (value as BallType) : undefined;
}

function readElementType(value: unknown): ElementType | undefined {
  return typeof value === "string" && value in ELEMENT_KO ? (value as ElementType) : undefined;
}

function ballDataAttributeName(ball: (typeof ballTypes)[number]): string {
  switch (ball) {
    case "pokeBall":
      return "poke";
    case "greatBall":
      return "great";
    case "ultraBall":
      return "ultra";
    case "hyperBall":
      return "hyper";
    case "masterBall":
      return "master";
  }
}

interface ScreenRenderContext {
  frame: GameFrame;
  playerEntities: readonly FrameEntity[];
  opponentEntities: readonly FrameEntity[];
  pendingCapture?: FrameEntity;
  activePlayer?: FrameEntity;
  activeOpponent?: FrameEntity;
  playback: BattlePlaybackView;
  logLine: string;
  activeCue?: FrameVisualCue;
  canRerollStarter: boolean;
  shopTargetAction?: FrameAction;
  teamRecord?: HtmlRendererTeamRecordView;
  transientFeedback?: TransientFeedbackState;
}

function renderScreen(context: ScreenRenderContext): string {
  const { frame, playback } = context;

  if (shouldRenderBattleScreen(frame, playback)) {
    return renderBattleScreen(context);
  }

  if (frame.phase === "starterChoice") {
    return renderStarterScreen(frame.scene.starterOptions, frame.actions, context.canRerollStarter);
  }

  if (frame.phase === "teamDecision") {
    return renderTeamDecisionScreen(context);
  }

  if (frame.phase === "gameOver") {
    return renderGameOverScreen(context);
  }

  if (frame.phase === "ready" && context.teamRecord && !playback.isPlaying) {
    return renderCheckpointVictoryScreen(context.teamRecord, context.playerEntities);
  }

  return renderReadyScreen(context);
}

function shouldRenderBattleScreen(frame: GameFrame, playback: BattlePlaybackView): boolean {
  return (
    frame.phase === "captureDecision" ||
    (frame.battleReplay.events.length > 1 && playback.isPlaying)
  );
}

function shouldShowBattleCaptureOverlay(frame: GameFrame, playback: BattlePlaybackView): boolean {
  return Boolean(frame.scene.capture) && !playback.isPlaying;
}

interface EntityPlaybackView {
  entities: FrameEntity[];
  entitiesById: Map<string, FrameEntity>;
}

function createEntityPlaybackView(
  frame: GameFrame,
  playback: BattlePlaybackView,
): EntityPlaybackView {
  if (frame.battleReplay.events.length === 0 || !playback.isPlaying) {
    return createRawEntityView(frame);
  }

  const initialHp = new Map<string, number>();
  for (const event of frame.battleReplay.events) {
    if (
      event.type === "damage.apply" &&
      event.targetEntityId &&
      event.targetHpBefore !== undefined &&
      !initialHp.has(event.targetEntityId)
    ) {
      initialHp.set(event.targetEntityId, event.targetHpBefore);
    }

    if (
      event.type === "status.tick" &&
      event.entityId &&
      event.hpBefore !== undefined &&
      !initialHp.has(event.entityId)
    ) {
      initialHp.set(event.entityId, event.hpBefore);
    }
  }

  const currentHp = new Map(initialHp);
  for (const event of playback.visibleEvents) {
    if (
      event.type === "damage.apply" &&
      event.targetEntityId &&
      event.targetHpAfter !== undefined
    ) {
      currentHp.set(event.targetEntityId, event.targetHpAfter);
    }

    if (event.type === "status.tick" && event.entityId && event.hpAfter !== undefined) {
      currentHp.set(event.entityId, event.hpAfter);
    }

    if (event.type === "creature.faint" && event.entityId) {
      currentHp.set(event.entityId, 0);
    }
  }

  const entities = frame.entities.map((entity) => {
    const current = Math.max(
      0,
      Math.min(entity.hp.max, currentHp.get(entity.id) ?? entity.hp.current),
    );
    const flags = new Set(entity.flags.filter((flag) => flag !== "fainted"));

    if (current <= 0) {
      flags.add("fainted");
    }

    return {
      ...entity,
      hp: {
        ...entity.hp,
        current,
        ratio: entity.hp.max === 0 ? 0 : Number((current / entity.hp.max).toFixed(4)),
      },
      flags: [...flags],
    };
  });

  return {
    entities,
    entitiesById: new Map(entities.map((entity) => [entity.id, entity])),
  };
}

function createRawEntityView(frame: GameFrame): EntityPlaybackView {
  return {
    entities: frame.entities,
    entitiesById: new Map(frame.entities.map((entity) => [entity.id, entity])),
  };
}

function renderBattleScreen({
  frame,
  playerEntities,
  opponentEntities,
  activePlayer,
  activeOpponent,
  playback,
  logLine,
  activeCue,
}: ScreenRenderContext): string {
  const battleEntities = playerEntities.concat(opponentEntities);
  const activeCueAttribute = activeCue
    ? ` data-active-cue="${escapeHtml(activeCue.effectKey)}"`
    : "";

  return `
    <section class="screen encounter-panel" data-screen="battle"${activeCueAttribute} aria-label="전투 화면">
      <div class="battlefield" aria-hidden="true"></div>
      <div class="platform enemy" aria-hidden="true"></div>
      <div class="platform hero" aria-hidden="true"></div>
      <div class="fx-overlay" aria-hidden="true"></div>
      ${renderTrainerBadge(frame.scene.trainer)}
      ${renderBattleMonster(activeOpponent, "enemy-mon", playback.activeEvent, activeCue)}
      ${renderBattleMonster(activePlayer, "hero-mon", playback.activeEvent, activeCue)}
      ${renderMoveVfx(playback.activeEvent, activeCue, battleEntities)}
      ${renderBattleCard(activeOpponent, "enemy", frame.scene.title, frame.scene.subtitle)}
      ${renderBattleCard(activePlayer, "hero", frame.hud.trainerName, `전투력 ${frame.hud.teamPower}`)}
      ${renderCaptureOverlay(
        shouldShowBattleCaptureOverlay(frame, playback) ? frame.scene.capture : undefined,
      )}
      ${renderBattleCue(playback.activeEvent, activeCue, battleEntities)}
      <div class="battle-log log-panel" aria-label="전투 로그">
        ${renderBattleEventSummary(playback.activeEvent, activeCue, battleEntities)}
        <p class="log-line">${escapeHtml(logLine)}</p>
        ${renderReplayMeter(playback)}
        ${playback.isPlaying ? "" : renderTeamDots(playerEntities)}
      </div>
    </section>
  `;
}

function renderStarterScreen(
  options: readonly FrameStarterOption[],
  actions: readonly FrameAction[],
  canReroll: boolean,
): string {
  const unlockedCount = options.filter((option) =>
    actions.some((action) => action.id === `start:${option.speciesId}`),
  ).length;
  const rerollButton =
    canReroll && options.length <= 12
      ? '<button type="button" class="starter-reroll" data-starter-reroll aria-label="스타터 후보 다시 뽑기"><span aria-hidden="true">🎲</span><span class="starter-reroll-label">다시 뽑기</span></button>'
      : "";

  return `
    <section class="screen starter-screen" data-screen="starterChoice" aria-label="스타터 선택">
      <div class="starter-stage" aria-hidden="true"></div>
      <div class="starter-dex-header">
        <h2>포켓몬 도감</h2>
        <span>${unlockedCount}/${options.length}</span>
      </div>
      <div class="starter-choice-row" data-starter-count="${options.length}" data-starter-density="dex">
        ${options.map((option) => renderStarterOption(option, actions)).join("")}
      </div>
      ${rerollButton}
    </section>
  `;
}

function renderStarterOption(option: FrameStarterOption, actions: readonly FrameAction[]): string {
  const action = actions.find((candidate) => candidate.id === `start:${option.speciesId}`);
  const claimAction = actions.find((candidate) => candidate.id === `claim:dex:${option.speciesId}`);
  const disabled = action ? "" : " disabled";
  const state = action || claimAction ? "unlocked" : "locked";
  const dexNumber = option.speciesId.toString().padStart(3, "0");
  const displayName = action || claimAction ? option.name : "???";
  const typeLine = action || claimAction ? option.typeLabels.join(" / ") : "미발견";
  const cardActionAttribute = claimAction
    ? ` data-action-id="${escapeHtml(claimAction.id)}"`
    : ` data-starter-pick="${option.speciesId}"`;
  const cardDisabled = action || claimAction ? "" : disabled;

  return `
    <article class="starter-option" data-starter-id="${option.speciesId}" data-starter-state="${state}">
      <button type="button" class="starter-option-card"${cardActionAttribute}${cardDisabled}>
        ${action ? renderActionIcon(action, "starter-option-icon") : ""}
        ${claimAction ? renderRewardAlertBadge(claimAction) : ""}
        <span class="starter-dex-number">#${dexNumber}</span>
        <img src="${resolveAssetPath(option.assetPath)}" alt="${escapeHtml(`${displayName} 포켓몬`)}" />
        <h2>${escapeHtml(displayName)}</h2>
        <p>${escapeHtml(typeLine)}</p>
        ${claimAction ? "<span>💎 REWARD</span>" : action ? "<span>선택 가능</span>" : "<span>LOCKED</span>"}
      </button>
      ${
        action && !claimAction
          ? `<div class="starter-option-actions" aria-label="${escapeHtml(`${option.name} 선택 확인`)}">
              <button type="button" class="starter-confirm" data-action-id="${escapeHtml(action.id)}">선택</button>
              <button type="button" class="starter-cancel" data-starter-cancel>취소</button>
            </div>`
          : ""
      }
    </article>
  `;
}

function renderRewardAlertBadge(source: FrameAction | string, amountOverride?: string): string {
  const label = typeof source === "string" ? source : source.label;
  const amount = amountOverride ?? label.match(/💎\s*\d+/)?.[0] ?? "!";

  return `<span class="reward-alert-badge" aria-label="${escapeHtml(label)}"><strong>!</strong><em>${escapeHtml(amount)}</em></span>`;
}

function renderReadyScreen({
  frame,
  playerEntities,
  shopTargetAction,
  transientFeedback,
}: ScreenRenderContext): string {
  const shopActions = selectReadyShopActions(frame, playerEntities);
  const nextAction = frame.actions.find((action) => action.id === "encounter:next");
  const captureFeedback = shouldRenderReadyCaptureFeedback(frame, transientFeedback)
    ? frame.scene.capture
    : undefined;

  return `
    <section class="screen ready-screen shop-screen" data-screen="ready" data-shop-actions="${shopActions.length}" data-shop-targeting="${shopTargetAction ? "true" : "false"}" aria-label="관리 단계">
      <div class="camp-sky" aria-hidden="true"></div>
      <div class="camp-ground" aria-hidden="true"></div>
      ${renderTeamRecordShift(frame.scene.trainer, "toast")}
      <div class="shop-top-panel">
        <div class="shop-board">
          <span class="shop-money">${formatMoney(frame.hud.money)}</span>
          <span class="shop-trainer-points" aria-label="보석">${formatTrainerPoints(frame.hud.trainerPoints)}</span>
          ${
            shopTargetAction
              ? `<strong>${escapeHtml(createShopTargetLabel(shopTargetAction))}</strong><button type="button" class="shop-target-cancel" data-shop-target-cancel aria-label="대상 선택 취소">✕</button>`
              : ""
          }
        </div>
        ${renderShopTeamGrid(playerEntities, shopTargetAction, frame.scene.teamEffect)}
      </div>
      ${nextAction ? `<div class="shop-start-row">${renderShopStartAction(nextAction, frame)}</div>` : ""}
      <div class="shop-card-grid" data-shop-card-count="${shopActions.length}">
        ${shopActions.map((action) => renderShopActionCard(action, frame)).join("")}
      </div>
      ${captureFeedback ? renderCaptureOverlay(captureFeedback) : ""}
      ${renderTeamDetailPopups(playerEntities, frame.actions)}
    </section>
  `;
}

function shouldRenderReadyCaptureFeedback(
  frame: GameFrame,
  transientFeedback: TransientFeedbackState | undefined,
): boolean {
  if (
    frame.phase !== "ready" ||
    (frame.scene.capture?.result !== "failure" && frame.scene.capture?.result !== "success")
  ) {
    return false;
  }

  if (!transientFeedback) {
    return true;
  }

  const key = createReadyCaptureFeedbackKey(frame);
  if (transientFeedback.shownReadyCaptureKeys.has(key)) {
    return false;
  }

  transientFeedback.shownReadyCaptureKeys.add(key);
  return true;
}

function createReadyCaptureFeedbackKey(frame: GameFrame): string {
  const cue = frame.visualCues.find(
    (candidate) => candidate.type === "capture.fail" || candidate.type === "capture.success",
  );

  return cue?.id ?? `${frame.stateKey}:capture:${frame.scene.capture?.result ?? "none"}`;
}

function createShopTargetLabel(action: FrameAction): string {
  return action.action.type === "BUY_HEAL" ? `${action.label} 대상 선택` : action.label;
}

function renderShopStartAction(action: FrameAction, frame: GameFrame): string {
  const disabled = action.enabled ? "" : " disabled";
  const reason = action.reason ? ` title="${escapeHtml(action.reason)}"` : "";
  const ariaLabel = createShopActionProfile(action, frame).title;

  return `
    <button type="button" class="shop-start-action" data-action-id="${escapeHtml(action.id)}" aria-label="${escapeHtml(ariaLabel)}"${disabled}${reason}>
      ${renderActionIcon(action, "shop-start-icon")}
      <span class="shop-start-label">${escapeHtml(action.label)}</span>
      ${renderEncounterBoostBadges(frame)}
    </button>
  `;
}

function renderShopTeamGrid(
  playerEntities: readonly FrameEntity[],
  targetAction: FrameAction | undefined,
  teamEffect?: { entityId: string; kind: string; key: string },
  options: { interactive?: boolean; showRewardBadges?: boolean } = {},
): string {
  const slots = Array.from({ length: 6 }, (_, index) => playerEntities[index]);
  const interactive = options.interactive ?? true;
  const showRewardBadges = options.showRewardBadges ?? true;

  return `
    <div class="shop-team-grid" data-targeting="${targetAction ? "true" : "false"}" data-interactive="${interactive ? "true" : "false"}">
      ${slots.map((entity, index) => renderShopTeamSlot(entity, index, targetAction, teamEffect, { interactive, showRewardBadges })).join("")}
    </div>
  `;
}

function renderShopTeamSlot(
  entity: FrameEntity | undefined,
  index: number,
  targetAction: FrameAction | undefined,
  teamEffect?: { entityId: string; kind: string; key: string },
  options: { interactive?: boolean; showRewardBadges?: boolean } = {},
): string {
  if (!entity) {
    return `
      <div class="shop-team-slot empty" data-team-slot="${index + 1}" data-slot-state="empty">
        <span class="shop-slot-number">${index + 1}</span>
      </div>
    `;
  }

  const hpState = resolveHpState(entity.hp.ratio);
  const requiresHealable =
    targetAction?.action.type === "BUY_HEAL" && targetAction.action.scope === "single";
  const targetAllowed =
    !targetAction?.eligibleTargetIds || targetAction.eligibleTargetIds.includes(entity.id);
  const selectable =
    Boolean(targetAction) &&
    targetAllowed &&
    (!requiresHealable || entity.hp.current < entity.hp.max);
  const interactive = options.interactive ?? true;
  const disabled = interactive && targetAction && !selectable ? " disabled" : "";
  const tag = interactive ? "button" : "div";
  const typeAttribute = interactive ? ' type="button"' : "";
  const targetAttribute =
    interactive && targetAction ? ` data-shop-target-id="${escapeHtml(entity.id)}"` : "";
  const detailAttribute =
    interactive && !targetAction ? ` data-team-detail-id="${escapeHtml(entity.id)}"` : "";
  const moves = entity.moves.map((move) => `<span>${escapeHtml(move.name)}</span>`).join("");
  const effectAttribute =
    teamEffect && teamEffect.entityId === entity.id
      ? ` data-team-effect="${escapeHtml(teamEffect.kind)}" data-team-effect-key="${escapeHtml(teamEffect.key)}"`
      : "";
  const rewardBadge = (options.showRewardBadges ?? true) ? renderShopTeamRewardBadge(entity) : "";

  return `
    <${tag}${typeAttribute} class="shop-team-slot" data-team-slot="${index + 1}" data-slot-state="${hpState}"${targetAttribute}${detailAttribute}${effectAttribute}${disabled}>
      <span class="shop-slot-number">${index + 1}</span>
      ${rewardBadge}
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
      <div class="shop-slot-main">
        <strong>${escapeHtml(entity.name)}</strong>
        <p>${escapeHtml(entity.typeLabels.join(" / "))}</p>
      </div>
      <dl class="shop-slot-stats">
        <div><dt>HP</dt><dd>${entity.hp.current}/${entity.hp.max}</dd></div>
        <div><dt>공</dt><dd>${entity.stats.attack}</dd></div>
        <div><dt>방</dt><dd>${entity.stats.defense}</dd></div>
        <div><dt>특</dt><dd>${entity.stats.special}</dd></div>
        <div><dt>스</dt><dd>${entity.stats.speed}</dd></div>
      </dl>
      <div class="shop-slot-moves">${moves}</div>
      <span class="slot-meter" data-hp-state="${hpState}"><span style="width: ${Math.round(entity.hp.ratio * 100)}%"></span></span>
    </${tag}>
  `;
}

function renderShopTeamRewardBadge(entity: FrameEntity): string {
  const pendingRewards = entity.moveDex.filter((entry) => entry.rewardClaimable);
  if (pendingRewards.length === 0) {
    return "";
  }

  const totalReward = pendingRewards.reduce((sum, entry) => sum + entry.rewardTrainerPoints, 0);

  return renderRewardAlertBadge(
    `${entity.name} 스킬 언락 보상 ${formatTrainerPoints(totalReward)}`,
    formatTrainerPoints(totalReward),
  );
}

function renderTeamDetailPopups(
  playerEntities: readonly FrameEntity[],
  actions: readonly FrameAction[],
): string {
  return playerEntities.map((entity) => renderTeamDetailPopup(entity, actions)).join("");
}

function renderTeamDetailPopup(entity: FrameEntity, actions: readonly FrameAction[]): string {
  const moves = entity.moveDex.map((entry) => renderTeamDetailMove(entry, actions)).join("");

  return `
    <div class="team-detail-popup" data-entity-id="${escapeHtml(entity.id)}" role="dialog" aria-modal="true" aria-label="${escapeHtml(`${entity.name} 상세 보기`)}">
      <article class="team-detail-card">
        <button type="button" class="team-detail-close" data-team-detail-close aria-label="상세 보기 닫기">✕</button>
        <header>
          <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
          <div>
            <span>${escapeHtml(entity.typeLabels.join(" / "))}</span>
            <h2>${escapeHtml(entity.name)}</h2>
            <p>HP ${entity.hp.current}/${entity.hp.max}</p>
          </div>
        </header>
        <dl class="team-detail-stats">
          <div><dt>HP</dt><dd>${entity.hp.max}</dd></div>
          <div><dt>공격</dt><dd>${entity.stats.attack}</dd></div>
          <div><dt>방어</dt><dd>${entity.stats.defense}</dd></div>
          <div><dt>특수</dt><dd>${entity.stats.special}</dd></div>
          <div><dt>스피드</dt><dd>${entity.stats.speed}</dd></div>
          <div><dt>전투력</dt><dd>${entity.scores.power}</dd></div>
        </dl>
        <section class="team-detail-moves" aria-label="스킬">
          <h3>스킬</h3>
          <ul>${moves}</ul>
        </section>
      </article>
    </div>
  `;
}

function renderTeamDetailMove(
  entry: FrameEntity["moveDex"][number],
  actions: readonly FrameAction[],
): string {
  const move = entry.move;
  const claimAction = entry.rewardClaimable
    ? actions.find((candidate) => candidate.id === `claim:skill:${entry.moveId}`)
    : undefined;
  const contentTag = claimAction ? "button" : "div";
  const actionAttribute = claimAction
    ? ` type="button" data-action-id="${escapeHtml(claimAction.id)}"`
    : "";

  return `
    <li class="team-detail-move-card" data-move-state="${entry.unlocked ? "unlocked" : "locked"}" data-reward-state="${claimAction ? "claimable" : entry.rewardClaimed ? "claimed" : "none"}">
      <${contentTag}${actionAttribute} class="move-detail-content">
        ${claimAction ? renderRewardAlertBadge(claimAction) : ""}
      <div class="move-detail-head">
          <strong>${escapeHtml(move?.name ?? "???")}</strong>
          <span class="move-detail-type">${escapeHtml(move?.type ?? "LOCKED")}</span>
      </div>
      <dl class="move-detail-grid">
          <div class="move-detail-level"><dt>습득</dt><dd>Lv. ${entry.level}</dd></div>
          ${
            move
              ? `<div class="move-detail-category"><dt>분류</dt><dd>${escapeHtml(localizeMoveCategory(move.category))}</dd></div>
                <div class="move-detail-power"><dt>위력</dt><dd>${escapeHtml(formatMovePower(move))}</dd></div>
                <div class="move-detail-accuracy"><dt>명중</dt><dd>${escapeHtml(move.accuracyLabel)}</dd></div>
                <div class="move-detail-priority"><dt>우선도</dt><dd>${escapeHtml(formatMovePriority(move.priority))}</dd></div>`
              : `<div class="move-detail-locked"><dt>정보</dt><dd>???</dd></div>`
          }
      </dl>
        <p class="move-detail-effect"><span>${move ? "효과" : "조건"}</span>${escapeHtml(
          move ? move.effect : `Lv. ${entry.level}에 습득 가능`,
        )}</p>
      </${contentTag}>
    </li>
  `;
}

function localizeMoveCategory(category: FrameEntity["moves"][number]["category"]): string {
  switch (category) {
    case "physical":
      return "물리";
    case "special":
      return "특수";
    case "status":
      return "변화";
  }
}

function formatMovePower(move: FrameEntity["moves"][number]): string {
  return move.category === "status" || move.power <= 0 ? "-" : String(move.power);
}

function formatMovePriority(priority: number): string {
  return priority > 0 ? `+${priority}` : String(priority);
}

function renderShopActionCard(action: FrameAction, frame: GameFrame): string {
  const disabled = action.enabled ? "" : " disabled";
  const reason = action.reason ? ` title="${escapeHtml(action.reason)}"` : "";
  const profile = createShopActionProfile(action, frame);
  const compactMeta = createCompactShopMeta(action, profile);
  const detailText = profile.detail ? `: ${profile.detail}` : "";
  const ariaLabel = [profile.kicker, profile.title, profile.detail, profile.meta]
    .filter(Boolean)
    .join(" ");
  const featuredAttribute = action.id === "encounter:next" ? ' data-shop-featured="true"' : "";
  const grade = resolveShopCardGrade(action);
  const gradeAttribute = grade ? ` data-grade="${grade}"` : "";
  const isPremium = action.tpCost !== undefined;
  const premiumAttribute = isPremium ? ' data-tp-card="true"' : "";
  const isOnSale =
    !isPremium &&
    action.originalCost !== undefined &&
    action.cost !== undefined &&
    action.originalCost > action.cost;
  const saleAttribute = isOnSale ? ' data-on-sale="true"' : "";
  const discountPercent =
    isOnSale && action.originalCost
      ? Math.round((1 - (action.cost ?? 0) / action.originalCost) * 100)
      : 0;
  const saleBadge = isOnSale
    ? `<span class="shop-sale-badge">-${discountPercent}%</span><span class="shop-sale-original">${formatMoney(
        action.originalCost ?? 0,
      )}</span>`
    : "";
  const premiumBadge = isPremium ? '<span class="shop-premium-badge">PREMIUM</span>' : "";
  const inventoryBadge = renderShopCardInventoryBadge(action, frame);
  const encounterBadges = action.id === "encounter:next" ? renderEncounterBoostBadges(frame) : "";
  const soldOut = !action.enabled && action.reason === "재고가 없습니다";
  const soldOutAttribute = soldOut ? ' data-sold-out="true"' : "";
  const soldOutBadge = soldOut ? '<span class="shop-soldout-badge">SOLD OUT</span>' : "";

  return `
    <button type="button" class="shop-card" data-action-id="${escapeHtml(action.id)}" data-shop-kind="${profile.kind}" data-role="${action.role}"${gradeAttribute}${featuredAttribute}${saleAttribute}${premiumAttribute}${soldOutAttribute} aria-label="${escapeHtml(ariaLabel)}"${disabled}${reason}>
      ${renderActionIcon(action)}
      <small>${escapeHtml(compactMeta)}</small>
      <p class="shop-card-body"><strong>${escapeHtml(profile.title)}</strong>${escapeHtml(detailText)}</p>
      ${saleBadge}
      ${premiumBadge}
      ${inventoryBadge}
      ${encounterBadges}
      ${soldOutBadge}
    </button>
  `;
}

function renderEncounterBoostBadges(frame: GameFrame): string {
  const boost = frame.hud.encounterBoost;
  if (!boost) return "";
  const badges: string[] = [];
  if (boost.rarityBonus && boost.rarityBonus > 0) {
    badges.push(
      `<span class="encounter-badge" data-badge-kind="rarity">⭐ 희귀 +${Math.round(boost.rarityBonus * 100)}%</span>`,
    );
  }
  if (boost.levelMax && boost.levelMax > 0) {
    const min = boost.levelMin ?? boost.levelMax;
    const range = min === boost.levelMax ? `+${boost.levelMax}` : `+${min}~${boost.levelMax}`;
    badges.push(`<span class="encounter-badge" data-badge-kind="level">📈 LV ${range}</span>`);
  }
  if (boost.lockedType) {
    const elementLabel = ELEMENT_KO[boost.lockedType] ?? boost.lockedType;
    const emoji = ELEMENT_EMOJI[boost.lockedType] ?? "🔒";
    badges.push(
      `<span class="encounter-badge" data-badge-kind="type">${emoji} ${escapeHtml(elementLabel)} 고정</span>`,
    );
  }
  if (badges.length === 0) return "";
  return `<span class="encounter-badge-row">${badges.join("")}</span>`;
}

function renderShopCardInventoryBadge(action: FrameAction, frame: GameFrame): string {
  if (action.action.type === "BUY_BALL") {
    const count = frame.hud.balls[action.action.ball] ?? 0;
    return `<span class="shop-ball-stock" aria-label="현재 보유">×${count}</span>`;
  }
  return "";
}

type ShopCardGrade = "common" | "uncommon" | "rare" | "epic" | "legendary";

function resolveShopCardGrade(action: FrameAction): ShopCardGrade | undefined {
  if (action.tpCost !== undefined) {
    return "legendary";
  }

  if (action.id === "encounter:next") {
    return "legendary";
  }

  if (action.action.type === "REST_TEAM") {
    return "legendary";
  }

  if (action.action.type === "BUY_HEAL") {
    return tierToGrade(action.action.tier);
  }

  if (action.action.type === "BUY_SCOUT") {
    return tierToGrade(action.action.tier + 1);
  }

  if (action.action.type === "BUY_RARITY_BOOST") {
    return tierToGrade(action.action.tier + 2);
  }

  if (action.action.type === "BUY_LEVEL_BOOST") {
    return tierToGrade(action.action.tier + 1);
  }

  if (action.action.type === "BUY_STAT_BOOST") {
    return tierToGrade(action.action.tier + 2);
  }

  if (action.action.type === "BUY_STAT_REROLL") {
    return "rare";
  }

  if (action.action.type === "BUY_TEACH_MOVE") {
    return "epic";
  }

  if (action.action.type === "BUY_TYPE_LOCK") {
    return "rare";
  }

  if (action.action.type === "SORT_TEAM") {
    return "common";
  }

  if (action.action.type === "REROLL_SHOP_INVENTORY") {
    return "epic";
  }

  if (action.action.type === "BUY_BALL") {
    switch (action.action.ball) {
      case "pokeBall":
        return "common";
      case "greatBall":
        return "uncommon";
      case "ultraBall":
        return "rare";
      case "hyperBall":
        return "epic";
      case "masterBall":
        return "legendary";
    }
  }

  if (action.id === "route:elite") {
    return "epic";
  }

  if (action.id === "route:supply") {
    return "uncommon";
  }

  if (action.id === "route:normal") {
    return "common";
  }

  return undefined;
}

function tierToGrade(tier: number): ShopCardGrade {
  if (tier <= 1) return "common";
  if (tier === 2) return "uncommon";
  if (tier === 3) return "rare";
  if (tier === 4) return "epic";
  return "legendary";
}

const ELEMENT_KO: Partial<Record<string, string>> = {
  normal: "노말",
  fire: "불꽃",
  water: "물",
  grass: "풀",
  electric: "전기",
  poison: "독",
  ground: "땅",
  flying: "비행",
  bug: "벌레",
  fighting: "격투",
  dragon: "드래곤",
  psychic: "에스퍼",
  rock: "바위",
  ghost: "고스트",
  ice: "얼음",
  dark: "악",
  steel: "강철",
  fairy: "페어리",
};

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

function createCompactShopMeta(action: FrameAction, profile: ShopActionProfile): string {
  if (action.id === "encounter:next") {
    return "출발";
  }

  if (action.tpCost !== undefined) {
    return formatTrainerPoints(action.tpCost);
  }

  return profile.meta;
}

function renderTeamDecisionScreen({
  frame,
  playerEntities,
  pendingCapture,
}: ScreenRenderContext): string {
  const fullTeam = playerEntities.length >= 6;
  const weakestPower =
    playerEntities.length === 0
      ? 0
      : Math.min(...playerEntities.map((entity) => entity.scores.power));

  return `
    <section class="screen team-decision-screen" data-screen="teamDecision" aria-label="팀 편성">
      ${renderCaptureOverlay(frame.scene.capture)}
      <div class="candidate-panel">
        ${pendingCapture ? renderCandidateCard(pendingCapture, weakestPower) : '<p class="empty">대기 중인 포획 대상이 없습니다.</p>'}
      </div>
      <div class="team-compare-panel" aria-label="현재 팀">
        <header>
          <span>${fullTeam ? "팀이 가득 찼습니다" : `현재 팀 ${playerEntities.length}/6`}</span>
          ${pendingCapture ? `<strong>새 동료 · ${escapeHtml(pendingCapture.name)}</strong>` : ""}
        </header>
        <div class="team-compare-grid">
          ${renderTeamCompareSlots(playerEntities, pendingCapture)}
        </div>
      </div>
    </section>
  `;
}

function renderTeamCompareSlots(
  playerEntities: readonly FrameEntity[],
  candidate: FrameEntity | undefined,
): string {
  return Array.from({ length: 6 }, (_, index) => {
    const entity = playerEntities[index];

    if (!entity) {
      return `
        <div class="team-compare-slot" data-slot-state="empty" data-team-slot="${index + 1}">
          <span class="compare-slot-number">${index + 1}</span>
          <span class="compare-slot-empty">${candidate ? "비어 있음" : ""}</span>
        </div>
      `;
    }

    const hpState = resolveHpState(entity.hp.ratio);
    const fainted = entity.hp.current <= 0;
    const slotState = fainted ? "fainted" : "filled";
    const delta = candidate ? candidate.scores.power - entity.scores.power : 0;
    const deltaTone = delta > 0 ? "up" : delta < 0 ? "down" : "equal";
    const deltaText =
      candidate && delta !== 0 ? `${delta > 0 ? "+" : ""}${delta}` : candidate ? "±0" : "";

    return `
      <div class="team-compare-slot" data-slot-state="${slotState}" data-team-slot="${index + 1}">
        <span class="compare-slot-number">${index + 1}</span>
        <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
        <div class="compare-slot-body">
          <strong>${escapeHtml(entity.name)}</strong>
          <p>전투력 ${entity.scores.power}</p>
          <span class="slot-meter" data-hp-state="${hpState}"><span style="width: ${Math.round(entity.hp.ratio * 100)}%"></span></span>
        </div>
        ${deltaText ? `<span class="compare-slot-delta" data-delta="${deltaTone}">${escapeHtml(deltaText)}</span>` : ""}
      </div>
    `;
  }).join("");
}

function renderCandidateCard(entity: FrameEntity, weakestPower: number): string {
  const delta = entity.scores.power - weakestPower;
  const deltaTone = delta > 0 ? "up" : delta < 0 ? "down" : "equal";

  return `
    <article class="candidate-card">
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
      <div class="candidate-heading">
        <h2>${escapeHtml(entity.name)}</h2>
        <p>${escapeHtml(entity.typeLabels.join(" / "))}</p>
        ${
          weakestPower > 0
            ? `<span class="candidate-delta" data-delta="${deltaTone}">팀 최약체 대비 ${delta > 0 ? "+" : ""}${delta}</span>`
            : ""
        }
      </div>
      <dl>
        <div><dt>HP</dt><dd>${entity.hp.max}</dd></div>
        <div><dt>공격</dt><dd>${entity.stats.attack}</dd></div>
        <div><dt>방어</dt><dd>${entity.stats.defense}</dd></div>
        <div><dt>전투력</dt><dd>${entity.scores.power}</dd></div>
      </dl>
    </article>
  `;
}

function renderGameOverScreen({
  frame,
  playerEntities,
  opponentEntities,
}: ScreenRenderContext): string {
  return `
    <section class="screen game-over-screen" data-screen="gameOver" aria-label="게임 오버">
      ${renderFinalTeamStats(playerEntities, frame.hud.teamPower)}
      <div class="result-board">
        <span>도전 종료</span>
        <h2>${formatWave(frame.hud.wave)}</h2>
        <p>${escapeHtml(frame.hud.gameOverReason ?? frame.scene.subtitle)}</p>
        ${renderTeamRecordShift(frame.scene.trainer, "inline")}
      </div>
      <div class="result-matchup">
        <div>
          <strong>${escapeHtml(frame.hud.trainerName)}</strong>
          ${renderTeamDots(playerEntities)}
        </div>
        <div>
          <strong>${escapeHtml(frame.scene.trainer?.trainerName ?? frame.scene.subtitle)}</strong>
          ${renderTeamDots(opponentEntities)}
        </div>
      </div>
    </section>
  `;
}

function renderFinalTeamStats(playerEntities: readonly FrameEntity[], teamPower: number): string {
  const slots = Array.from({ length: 6 }, (_, index) => playerEntities[index]);

  return `
    <div class="final-team-panel" aria-label="최종 포켓몬 스탯">
      <header>
        <span>최종 팀 스탯</span>
        <strong>전투력 ${teamPower}</strong>
      </header>
      <div class="final-team-grid">
        ${slots.map((entity, index) => renderFinalTeamSlot(entity, index)).join("")}
      </div>
    </div>
  `;
}

function renderFinalTeamSlot(entity: FrameEntity | undefined, index: number): string {
  if (!entity) {
    return `
      <article class="final-team-slot" data-slot-state="empty" data-team-slot="${index + 1}">
        <span class="final-slot-number">${index + 1}</span>
        <strong>빈 슬롯</strong>
      </article>
    `;
  }

  const slotState = entity.hp.current <= 0 ? "fainted" : "filled";

  return `
    <article class="final-team-slot" data-slot-state="${slotState}" data-team-slot="${index + 1}">
      <span class="final-slot-number">${index + 1}</span>
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
      <div class="final-slot-heading">
        <strong>${escapeHtml(entity.name)}</strong>
        <p>${escapeHtml(entity.typeLabels.join(" / "))}</p>
      </div>
      <dl>
        <div><dt>HP</dt><dd>${entity.hp.current}/${entity.hp.max}</dd></div>
        <div><dt>공</dt><dd>${entity.stats.attack}</dd></div>
        <div><dt>방</dt><dd>${entity.stats.defense}</dd></div>
        <div><dt>특</dt><dd>${entity.stats.special}</dd></div>
        <div><dt>스</dt><dd>${entity.stats.speed}</dd></div>
        <div><dt>전</dt><dd>${entity.scores.power}</dd></div>
      </dl>
    </article>
  `;
}

function renderCommandBand(
  frame: GameFrame,
  locked: boolean,
  playerEntities: readonly FrameEntity[],
  pendingCapture: FrameEntity | undefined,
): string {
  if (locked) {
    return renderBattleTeamStatusBand(playerEntities);
  }

  const commands = selectCommandItems(frame, playerEntities, pendingCapture);

  if (commands.length === 0) {
    return "";
  }

  return `
    <section class="command-band" data-command-count="${commands.length}">
      ${commands.map((command) => renderCommandItem(command, locked)).join("")}
    </section>
  `;
}

function renderBattleTeamStatusBand(playerEntities: readonly FrameEntity[]): string {
  return `
    <section class="battle-team-grid-panel" data-status-count="${playerEntities.length}" aria-label="전투 중 팀 상태">
      ${renderShopTeamGrid(playerEntities, undefined, undefined, { interactive: false, showRewardBadges: false })}
    </section>
  `;
}

function renderTrainerBadge(trainer: FrameTrainerScene | undefined): string {
  if (!trainer) {
    return "";
  }

  return `
    <div class="trainer-badge" data-trainer-source="${trainer.source}">
      <img src="${resolveTrainerAssetPath(trainer.portraitPath)}" alt="${escapeHtml(`${trainer.trainerName} 트레이너 초상`)}" />
      <div>
        <span>${escapeHtml(trainer.label)}</span>
        <strong>${escapeHtml(trainer.trainerName)}</strong>
      </div>
    </div>
  `;
}

function renderTeamRecordShift(
  trainer: FrameTrainerScene | undefined,
  placement: "toast" | "inline",
): string {
  const change = trainer?.recordChange;

  if (!change) {
    return "";
  }

  const direction = change.deltaWinRate >= 0 ? "up" : "down";
  const sign = change.deltaWinRate > 0 ? "+" : "";
  const opponentResult = change.opponentResult === "win" ? "상대 승리" : "상대 패배";
  const teamPower = trainer?.teamPower === undefined ? "" : ` · 전투력 ${trainer.teamPower}`;

  return `
    <div class="team-record-shift" data-record-direction="${direction}" data-record-placement="${placement}">
      <strong>상대 승률 ${formatPercent(change.before.winRate)} → ${formatPercent(change.after.winRate)}</strong>
      <span>${opponentResult} · ${change.after.wins}승 ${change.after.losses}패 · ${sign}${formatPercent(change.deltaWinRate)}${teamPower}</span>
    </div>
  `;
}

function renderCaptureOverlay(capture: FrameCaptureScene | undefined): string {
  if (!capture) {
    return "";
  }

  const ballClass = capture.ball === "greatBall" ? "great-ball" : "poke-ball";
  const chance =
    capture.chance === undefined ? "" : `<span>${Math.round(capture.chance * 100)}%</span>`;

  return `
    <div class="capture-overlay" data-capture-result="${capture.result}" data-capture-ball="${capture.ball ?? "none"}" data-capture-shakes="${capture.shakes}">
      <div class="capture-ball ${ballClass}" aria-hidden="true"><span></span></div>
      <p>${escapeHtml(capture.label)}</p>
      ${chance}
    </div>
  `;
}

function renderCheckpointVictoryScreen(
  record: HtmlRendererTeamRecordView | undefined,
  playerEntities: readonly FrameEntity[],
): string {
  if (!record) {
    return "";
  }

  const message = record.message
    ? `<p class="victory-record-message">${escapeHtml(record.message)}</p>`
    : "";
  const particles = Array.from({ length: 24 }, (_, index) => {
    const group = index % 5;
    const top = (index % 6) * 14 - 6;
    const left = (index * 37) % 100;
    const hue = 42 + group * 18;
    const drift = -28 + group * 14;
    return `<span style="--petal-index: ${index}; --petal-top: ${top}%; --petal-left: ${left}%; --petal-hue: ${hue}; --petal-drift: ${drift}px" aria-hidden="true"></span>`;
  }).join("");

  return `
    <section class="screen checkpoint-victory-screen" data-screen="checkpointVictory" aria-label="트레이너 승리 정산">
      <div class="victory-pollen-field" aria-hidden="true">${particles}</div>
      <div class="victory-ground" aria-hidden="true"></div>
      <form class="checkpoint-victory-card" data-team-record-form>
        <span class="victory-kicker">${formatWave(record.wave)} 트레이너 승리</span>
        <h2>${escapeHtml(record.opponentName)} 격파</h2>
        <p>현재 팀을 체크포인트 기록으로 저장합니다.</p>
        <div class="victory-team-row">
          ${renderTeamDots(playerEntities)}
        </div>
        <label>
          <span>팀 이름</span>
          <input name="trainerName" value="${escapeHtml(record.trainerName)}" maxlength="24" autocomplete="off" />
        </label>
        <button type="submit">정산 저장</button>
        ${message}
      </form>
    </section>
  `;
}

function renderAction(action: FrameAction, locked = false): string {
  const disabled = action.enabled && !locked ? "" : " disabled";
  const reason = locked
    ? ' title="전투 리플레이 재생 중입니다."'
    : action.reason
      ? ` title="${escapeHtml(action.reason)}"`
      : "";

  return `<button type="button" data-action-id="${escapeHtml(action.id)}" data-role="${action.role}"${disabled}${reason}>${renderActionIcon(
    action,
  )}<span>${escapeHtml(action.label)}</span></button>`;
}

function renderActionIcon(action: FrameAction, className = ""): string {
  const classAttribute = className ? ` ${className}` : "";
  return `<span class="button-icon${classAttribute}" aria-hidden="true">${actionIconContent(action)}</span>`;
}

function actionIconContent(action: FrameAction): string {
  if (action.action.type === "BUY_BALL" || action.action.type === "ATTEMPT_CAPTURE") {
    return renderBallSvg(action.action.ball);
  }

  return escapeHtml(actionEmoji(action));
}

interface BallPalette {
  top: string;
  accent?: string;
  glyph?: string;
}

const BALL_PALETTES: Record<string, BallPalette> = {
  pokeBall: { top: "#e25248" },
  greatBall: { top: "#557eea", accent: "#e25248" },
  ultraBall: { top: "#f6c453", glyph: "H" },
  hyperBall: { top: "#6b3b94", glyph: "L" },
  masterBall: { top: "#b07cd6", glyph: "M", accent: "#e25248" },
};

function renderBallSvg(ball: string): string {
  const palette = BALL_PALETTES[ball] ?? BALL_PALETTES.pokeBall;
  const accentDots =
    palette.accent && ball === "greatBall"
      ? `<circle cx="8" cy="7.4" r="1.3" fill="${palette.accent}" />` +
        `<circle cx="16" cy="7.4" r="1.3" fill="${palette.accent}" />`
      : "";
  const masterDot =
    palette.accent && ball === "masterBall"
      ? `<circle cx="8.5" cy="6.8" r="0.9" fill="${palette.accent}" />` +
        `<circle cx="11" cy="5.5" r="0.9" fill="${palette.accent}" />`
      : "";
  const glyph = palette.glyph
    ? `<text x="12" y="9.6" text-anchor="middle" font-family="'Trebuchet MS','Verdana',sans-serif" font-size="6" font-weight="900" fill="#131c28">${escapeHtml(palette.glyph)}</text>`
    : "";

  return `<svg class="ball-svg" viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
    <circle cx="12" cy="12" r="10.4" fill="#fffef4" stroke="#131c28" stroke-width="1.7"/>
    <path d="M 12 1.6 A 10.4 10.4 0 0 1 22.4 12 L 1.6 12 A 10.4 10.4 0 0 1 12 1.6 Z" fill="${palette.top}"/>
    <rect x="1.6" y="11" width="20.8" height="2" fill="#131c28"/>
    ${accentDots}
    ${masterDot}
    ${glyph}
    <circle cx="12" cy="12" r="3" fill="#fffef4" stroke="#131c28" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="1.3" fill="#fffef4" stroke="#131c28" stroke-width="0.7"/>
  </svg>`;
}

const HEAL_TIER_EMOJI: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "🩹",
  2: "💊",
  3: "🧪",
  4: "💉",
  5: "🛡️",
};

const RARITY_BOOST_EMOJI: Record<1 | 2 | 3, string> = {
  1: "⭐",
  2: "🌟",
  3: "💎",
};

const LEVEL_BOOST_EMOJI: Record<1 | 2 | 3 | 4, string> = {
  1: "⬆️",
  2: "⏫",
  3: "🚀",
  4: "🔥",
};

const SCOUT_RARITY_EMOJI: Record<1 | 2 | 3, string> = {
  1: "🔎",
  2: "🔬",
  3: "🪄",
};

const SCOUT_POWER_EMOJI: Record<1 | 2 | 3, string> = {
  1: "📡",
  2: "📊",
  3: "🎯",
};

function actionEmoji(action: FrameAction): string {
  switch (action.action.type) {
    case "START_RUN":
      return "🐾";
    case "RETURN_TO_STARTER_CHOICE":
      return "🎲";
    case "CHOOSE_ROUTE":
      return action.action.routeId === "supply" ? "🎁" : "🧭";
    case "RESOLVE_NEXT_ENCOUNTER":
      return "⚔️";
    case "ATTEMPT_CAPTURE":
    case "BUY_BALL":
      return "🔴";
    case "ACCEPT_CAPTURE":
      return "✅";
    case "DISCARD_CAPTURE":
      return "🚪";
    case "REST_TEAM":
      return "🛌";
    case "BUY_HEAL":
      return HEAL_TIER_EMOJI[action.action.tier];
    case "BUY_SCOUT":
      return action.action.kind === "rarity"
        ? SCOUT_RARITY_EMOJI[action.action.tier]
        : SCOUT_POWER_EMOJI[action.action.tier];
    case "BUY_RARITY_BOOST":
      return RARITY_BOOST_EMOJI[action.action.tier];
    case "BUY_LEVEL_BOOST":
      return LEVEL_BOOST_EMOJI[action.action.tier];
    case "BUY_STAT_BOOST": {
      const map: Record<1 | 2 | 3, string> = { 1: "🛠️", 2: "💪", 3: "🦾" };
      return map[action.action.tier];
    }
    case "BUY_STAT_REROLL":
      return "🎰";
    case "BUY_TEACH_MOVE":
      return ELEMENT_EMOJI[action.action.element] ?? "📘";
    case "BUY_TYPE_LOCK":
      return ELEMENT_EMOJI[action.action.element] ?? "🔒";
    case "SORT_TEAM":
      return action.action.direction === "asc" ? "⬆️" : "⬇️";
    case "BUY_PREMIUM_SHOP_ITEM":
      return "💎";
    case "BUY_PREMIUM_MASTERBALL":
      return "✨";
    case "BUY_PREMIUM_REVIVE_ALL":
      return "🌈";
    case "BUY_PREMIUM_COIN_BAG":
      return "💰";
    case "BUY_PREMIUM_TEAM_REROLL":
      return "🎴";
    case "BUY_PREMIUM_DEX_UNLOCK":
      return "📜";
    case "REROLL_SHOP_INVENTORY":
      return "🔄";
    case "SET_TRAINER_NAME":
      return "💾";
    default:
      return "?";
  }
}

const ELEMENT_EMOJI: Partial<Record<string, string>> = {
  normal: "⚪",
  fire: "🔥",
  water: "💧",
  grass: "🌿",
  electric: "⚡",
  poison: "☠️",
  ground: "⛰️",
  flying: "🪽",
  bug: "🐞",
  fighting: "🥊",
  dragon: "🐉",
  psychic: "🔮",
  rock: "🪨",
  ghost: "👻",
  ice: "❄️",
  dark: "🌑",
  steel: "⚙️",
  fairy: "✨",
};

function renderCommandItem(command: CommandItem, locked: boolean): string {
  return renderAction(command.action, locked);
}

function renderBattleMonster(
  entity: FrameEntity | undefined,
  className: string,
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
): string {
  if (!entity) {
    return "";
  }

  const effect = resolveBattleEffect(entity, activeEvent, activeCue);
  const motion = resolveBattleMotionTemplate(entity, activeEvent, activeCue);
  const moveType = activeEvent?.moveType ?? getCueMoveType(activeCue);
  const effectAttribute = effect ? ` data-battle-effect="${effect}"` : "";
  const motionAttribute = motion
    ? ` data-motion-clip="${motion.clip}" data-motion-role="${motion.role}" data-motion-lane="${entity.owner === "player" ? "hero" : "enemy"}"`
    : "";
  const moveTypeAttribute = moveType ? ` data-move-type="${escapeHtml(moveType)}"` : "";
  const cueAttribute =
    activeCue && visualCueReferencesEntity(activeCue, entity.id)
      ? ` data-battle-effect-key="${escapeHtml(activeCue.effectKey)}"`
      : "";
  const faintedAttribute = entity.flags.includes("fainted") ? ' data-fainted="true"' : "";

  return `
    <div class="screen-monster ${className}" data-entity-id="${escapeHtml(entity.id)}"${effectAttribute}${motionAttribute}${moveTypeAttribute}${cueAttribute}${faintedAttribute}>
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
    </div>
  `;
}

function resolveBattleMotionTemplate(
  entity: FrameEntity,
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
): BattleMotionTemplate | undefined {
  if (!activeEvent || !shouldRenderBattleMotion(activeEvent)) {
    return undefined;
  }

  const sourceId = activeEvent.sourceEntityId ?? getCueSourceEntityId(activeCue);
  const targetId =
    activeEvent.targetEntityId ?? activeEvent.entityId ?? getCueTargetEntityId(activeCue);

  if (sourceId === entity.id) {
    return {
      clip: resolveUserMotionClip(activeEvent, activeCue),
      role: "user",
    };
  }

  if (targetId !== entity.id) {
    return undefined;
  }

  return {
    clip: resolveTargetMotionClip(activeEvent, activeCue),
    role: "target",
  };
}

function shouldRenderBattleMotion(activeEvent: FrameBattleReplayEvent): boolean {
  return (
    activeEvent.type === "damage.apply" ||
    activeEvent.type === "move.miss" ||
    activeEvent.type === "move.effect" ||
    activeEvent.type === "status.apply" ||
    activeEvent.type === "status.immune"
  );
}

function getCueSourceEntityId(activeCue: FrameVisualCue | undefined): string | undefined {
  if (
    activeCue?.type === "battle.hit" ||
    activeCue?.type === "battle.miss" ||
    activeCue?.type === "battle.support"
  ) {
    return activeCue.sourceEntityId;
  }

  return undefined;
}

function getCueTargetEntityId(activeCue: FrameVisualCue | undefined): string | undefined {
  if (
    activeCue?.type === "battle.hit" ||
    activeCue?.type === "battle.miss" ||
    activeCue?.type === "battle.support"
  ) {
    return activeCue.targetEntityId ?? activeCue.entityId;
  }

  return undefined;
}

function resolveUserMotionClip(
  activeEvent: FrameBattleReplayEvent,
  activeCue: FrameVisualCue | undefined,
): BattleMotionClip {
  if (activeEvent.moveCategory === "status" || activeCue?.type === "battle.support") {
    return "use-aura";
  }

  const moveType = activeEvent.moveType ?? getCueMoveType(activeCue);

  if (moveType && ["electric", "psychic", "ice", "dragon"].includes(moveType)) {
    return "use-beam";
  }

  if (moveType && ["fire", "water", "poison", "rock", "ground", "steel"].includes(moveType)) {
    return "use-launch";
  }

  if (
    activeEvent.moveCategory === "physical" ||
    (moveType && ["normal", "fighting", "bug", "dark", "flying"].includes(moveType))
  ) {
    return "use-strike";
  }

  return "use-burst";
}

function resolveTargetMotionClip(
  activeEvent: FrameBattleReplayEvent,
  activeCue: FrameVisualCue | undefined,
): BattleMotionClip {
  if (activeEvent.type === "move.miss" || activeCue?.type === "battle.miss") {
    return "evade";
  }

  if (activeEvent.type === "damage.apply") {
    if (activeEvent.critical || (activeEvent.effectiveness ?? 1) > 1) {
      return "take-heavy";
    }

    if ((activeEvent.effectiveness ?? 1) > 0 && (activeEvent.effectiveness ?? 1) < 1) {
      return "take-guard";
    }

    return "take-hit";
  }

  return "take-status";
}

function renderBattleCard(
  entity: FrameEntity | undefined,
  className: string,
  title: string,
  subtitle: string,
): string {
  const name = entity?.name ?? title;
  const hpRatio = entity?.hp.ratio ?? 0;
  const hpText = entity ? `${entity.hp.current}/${entity.hp.max}` : subtitle;
  const hpState = resolveHpState(hpRatio);

  return `
    <aside class="battle-card ${className}" data-hp-state="${hpState}">
      <div class="name-row">
        <span>${escapeHtml(name)}</span>
        <span>${escapeHtml(hpText)}</span>
      </div>
      <div class="hp-line"><span style="width: ${Math.round(hpRatio * 100)}%"></span></div>
      ${renderBattleTags(entity)}
    </aside>
  `;
}

function renderBattleTags(entity: FrameEntity | undefined): string {
  if (!entity) {
    return "";
  }

  const typeTags = entity.typeLabels
    .slice(0, 2)
    .map((label) => `<span data-tag-kind="type">${escapeHtml(label)}</span>`);
  const statusTags = entity.flags
    .filter((flag) => flag.startsWith("status:"))
    .map((flag) => {
      const status = flag.replace("status:", "") as BattleStatus;
      return `<span data-tag-kind="status">${localizeBattleStatus(status)}</span>`;
    });
  const faintedTag = entity.flags.includes("fainted")
    ? ['<span data-tag-kind="fainted">기절</span>']
    : [];
  const tags = [...typeTags, ...statusTags, ...faintedTag];

  return tags.length > 0 ? `<div class="battle-tags">${tags.join("")}</div>` : "";
}

function renderTeamDots(entities: readonly FrameEntity[]): string {
  const dots = Array.from({ length: 6 }, (_, index) => {
    const entity = entities[index];
    const state = entity ? (entity.hp.current <= 0 ? "down" : "filled") : "empty";
    return `<span class="team-dot" data-state="${state}"></span>`;
  }).join("");

  return `<div class="team-strip" aria-hidden="true">${dots}</div>`;
}

function renderReplayMeter(playback: BattlePlaybackView): string {
  if (playback.visibleEvents.length === 0) {
    return "";
  }

  const current = playback.activeEvent?.sequence ?? 0;
  const total = playback.visibleEvents.at(-1)?.sequence ?? current;
  const state = playback.isPlaying ? '<span class="replay-state">전투 재생 중</span>' : "";

  return `
    <div class="replay-row" data-replay-current="${current}" data-replay-total="${total}">
      <span>${current}/${total}</span>
      ${state}
    </div>
  `;
}

function renderBattleEventSummary(
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
  entities: readonly FrameEntity[],
): string {
  const summary = createBattleEventSummary(activeEvent, activeCue, entities);

  if (!summary) {
    return "";
  }

  const effectKey = activeCue?.effectKey ?? "";

  return `
    <div class="battle-event-summary" data-event-kind="${summary.kind}" data-effect-key="${escapeHtml(effectKey)}">
      <span class="turn-chip">${escapeHtml(summary.turn)}</span>
      <strong>${escapeHtml(summary.title)}</strong>
      <span class="result-chip">${escapeHtml(summary.result)}</span>
      ${summary.detail ? `<p>${escapeHtml(summary.detail)}</p>` : ""}
    </div>
  `;
}

function renderBattleCue(
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
  entities: readonly FrameEntity[],
): string {
  if (!activeEvent) {
    return "";
  }

  const targetId = activeEvent.targetEntityId ?? activeEvent.entityId;
  const target = entities.find((entity) => entity.id === targetId);
  const lane = target?.owner === "player" ? "hero" : "enemy";
  const cue = createBattleCueText(activeEvent, activeCue);

  if (!cue) {
    return "";
  }

  const moveType = activeEvent.moveType ?? getCueMoveType(activeCue);
  const moveTypeAttribute = moveType ? ` data-move-type="${escapeHtml(moveType)}"` : "";
  const damageAtlas = renderDamageAtlas(activeEvent, cue.kind);
  const feedback = renderBattleFeedbackText(activeEvent, cue.text, cue.kind);
  const content = damageAtlas
    ? `${damageAtlas}<span class="battle-feedback">${escapeHtml(feedback)}</span>`
    : `<span class="battle-feedback">${escapeHtml(feedback)}</span>`;

  return `<div class="battle-float" data-cue-kind="${escapeHtml(cue.kind)}" data-cue-lane="${lane}"${moveTypeAttribute}>${content}</div>`;
}

function renderDamageAtlas(activeEvent: FrameBattleReplayEvent, cueKind: string): string {
  if (activeEvent.type !== "damage.apply") {
    return "";
  }

  const damage = Math.max(0, activeEvent.damage ?? 0);
  const glyphs = `-${damage}`
    .split("")
    .map(
      (glyph, index) =>
        `<span class="damage-glyph" data-glyph="${escapeHtml(glyph)}" style="--glyph-index:${index}">${escapeHtml(glyph)}</span>`,
    )
    .join("");

  return `<span class="damage-atlas" data-damage-kind="${escapeHtml(cueKind)}" aria-label="${damage} damage">${glyphs}</span>`;
}

function renderBattleFeedbackText(
  activeEvent: FrameBattleReplayEvent,
  fallback: string,
  cueKind: string,
): string {
  if (activeEvent.type === "damage.apply") {
    if (cueKind === "critical") {
      return "급소에 맞았다!";
    }

    if (cueKind === "super-effective") {
      return "효과가 굉장했다!";
    }

    if (cueKind === "resisted") {
      return "효과가 별로였다...";
    }

    return "피해!";
  }

  if (activeEvent.type === "move.miss") {
    return "빗나갔다!";
  }

  return fallback;
}

function getCueMoveType(activeCue: FrameVisualCue | undefined): ElementType | undefined {
  if (activeCue?.type === "battle.hit" || activeCue?.type === "battle.miss") {
    return activeCue.moveType;
  }

  if (activeCue?.type === "battle.support") {
    return activeCue.moveType;
  }

  return undefined;
}

function spawnActiveBattleEffect(
  root: HTMLElement,
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
): void {
  if (!isSpawnableBattleCue(activeCue)) {
    return;
  }

  const moveType = activeEvent?.moveType ?? getCueMoveType(activeCue);
  const moveCategory = getEffectMoveCategory(activeEvent, activeCue);

  if (!moveType || !moveCategory) {
    return;
  }

  const sourceEntityId = activeCue.sourceEntityId ?? activeCue.entityId ?? activeCue.targetEntityId;
  const targetEntityId = activeCue.targetEntityId ?? activeCue.entityId ?? activeCue.sourceEntityId;

  if (!sourceEntityId || !targetEntityId) {
    return;
  }

  const sourceEl = findBattleEntityElement(root, sourceEntityId);
  const targetEl = findBattleEntityElement(root, targetEntityId);

  if (!sourceEl || !targetEl) {
    return;
  }

  const descriptor = resolveEffectDescriptor(
    { type: moveType, category: moveCategory },
    {
      critical: activeCue.type === "battle.hit" ? activeCue.critical : activeEvent?.critical,
      effectiveness:
        activeCue.type === "battle.hit" ? activeCue.effectiveness : activeEvent?.effectiveness,
      originSide: normalizeEffectSide(activeEvent?.sourceSide),
      targetSide: normalizeEffectSide(activeEvent?.targetSide),
    },
  );

  effectEngine.spawn(descriptor, sourceEl, targetEl, activeCue.id, activeCue.effectKey);
}

function getEffectMoveCategory(
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: BattleEffectVisualCue,
): MoveCategory | undefined {
  return (
    activeEvent?.moveCategory ??
    activeCue.moveCategory ??
    (activeCue.type === "battle.support" ? "status" : undefined)
  );
}

function isSpawnableBattleCue(
  activeCue: FrameVisualCue | undefined,
): activeCue is BattleEffectVisualCue {
  return activeCue?.type === "battle.hit" || activeCue?.type === "battle.support";
}

function normalizeEffectSide(
  side: FrameBattleReplayEvent["sourceSide"] | undefined,
): "player" | "enemy" | undefined {
  return side === "player" || side === "enemy" ? side : undefined;
}

function findBattleEntityElement(root: HTMLElement, entityId: string): HTMLElement | undefined {
  return (
    root.querySelector<HTMLElement>(`.screen-monster[data-entity-id="${cssEscape(entityId)}"]`) ??
    undefined
  );
}

function positionActiveMoveVfx(
  root: HTMLElement,
  activeEvent: FrameBattleReplayEvent | undefined,
): void {
  const moveVfx = root.querySelector<HTMLElement>(".move-vfx");
  const sourceEntityId = activeEvent?.sourceEntityId;
  const targetEntityId = activeEvent?.targetEntityId ?? activeEvent?.entityId;

  if (!moveVfx || !sourceEntityId || !targetEntityId) {
    return;
  }

  const sourceEl = findBattleEntityElement(root, sourceEntityId);
  const targetEl = findBattleEntityElement(root, targetEntityId);
  const screenEl = root.querySelector<HTMLElement>('.screen[data-screen="battle"]');

  if (!sourceEl || !targetEl || !screenEl) {
    return;
  }

  const screenRect = screenEl.getBoundingClientRect();
  const sourceRect = normalizeMeasuredRect(sourceEl.getBoundingClientRect());
  const targetRect = normalizeMeasuredRect(targetEl.getBoundingClientRect());
  const sourceX = sourceRect.left - screenRect.left + sourceRect.width / 2;
  const sourceY = sourceRect.top - screenRect.top + sourceRect.height / 2;
  const targetX = targetRect.left - screenRect.left + targetRect.width / 2;
  const targetY = targetRect.top - screenRect.top + targetRect.height / 2;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

  moveVfx.style.setProperty("--move-start-x", `${sourceX}px`);
  moveVfx.style.setProperty("--move-start-y", `${sourceY}px`);
  moveVfx.style.setProperty("--move-target-x", `${targetX}px`);
  moveVfx.style.setProperty("--move-target-y", `${targetY}px`);
  moveVfx.style.setProperty("--move-distance", `${distance}px`);
  moveVfx.style.setProperty("--move-angle", `${angleDeg}deg`);
  moveVfx.setAttribute("data-vfx-positioned", "true");
}

function normalizeMeasuredRect(rect: DOMRect): Pick<DOMRect, "left" | "top" | "width" | "height"> {
  const fallbackSize = Math.max(rect.width, rect.height, 1);

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width > 0 ? rect.width : fallbackSize,
    height: rect.height > 0 ? rect.height : fallbackSize,
  };
}

function renderMoveVfx(
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
  entities: readonly FrameEntity[],
): string {
  const moveType = activeEvent?.moveType ?? getCueMoveType(activeCue);

  if (!activeEvent || !moveType || !shouldRenderMoveVfx(activeEvent)) {
    return "";
  }

  const source = entities.find((entity) => entity.id === activeEvent.sourceEntityId);
  const target = entities.find(
    (entity) => entity.id === (activeEvent.targetEntityId ?? activeEvent.entityId),
  );
  const lane = source?.owner === "opponent" ? "enemy-to-hero" : "hero-to-enemy";
  const targetLane = target?.owner === "player" ? "hero" : "enemy";
  const shape = resolveMoveVfxShape(moveType, activeEvent, activeCue);
  const style = renderMoveVfxPaletteStyle(moveType);
  const sparks = Array.from(
    { length: 7 },
    (_, index) => `<span class="move-vfx-spark" style="--spark-index:${index}"></span>`,
  ).join("");

  return `
    <div class="move-vfx" data-move-type="${escapeHtml(moveType)}" data-move-shape="${shape}" data-move-lane="${lane}" data-vfx-target-lane="${targetLane}" style="${style}" aria-hidden="true">
      <span class="move-vfx-core"></span>
      ${sparks}
    </div>
  `;
}

function renderMoveVfxPaletteStyle(moveType: ElementType): string {
  const palette = getElementPalette(moveType);

  return [
    `--move-color:${palette.primary}`,
    `--move-accent:${palette.accent}`,
    `--fx-primary:${palette.primary}`,
    `--fx-secondary:${palette.secondary}`,
    `--fx-accent:${palette.accent}`,
  ].join(";");
}

function shouldRenderMoveVfx(activeEvent: FrameBattleReplayEvent): boolean {
  return (
    activeEvent.type === "damage.apply" ||
    activeEvent.type === "move.miss" ||
    activeEvent.type === "move.effect" ||
    activeEvent.type === "status.apply" ||
    activeEvent.type === "status.immune"
  );
}

function resolveMoveVfxShape(
  moveType: ElementType,
  activeEvent: FrameBattleReplayEvent,
  activeCue: FrameVisualCue | undefined,
): string {
  if (activeEvent.moveCategory === "status" || activeCue?.type === "battle.support") {
    return "aura";
  }

  if (["electric", "psychic", "ice", "dragon"].includes(moveType)) {
    return "beam";
  }

  if (["fire", "water", "poison", "rock", "ground", "steel"].includes(moveType)) {
    return "missile";
  }

  return "particles";
}

function updateBattlePlayback(playback: BattlePlaybackState, frame: GameFrame): void {
  const replayKey = createBattleReplayKey(frame);
  const finalCursor = Math.max(0, frame.battleReplay.events.length - 1);

  if (!playback.initialized) {
    playback.initialized = true;
    playback.replayKey = replayKey;
    playback.cursor = finalCursor;
    return;
  }

  if (playback.replayKey !== replayKey) {
    clearBattlePlaybackTimer(playback);
    playback.replayKey = replayKey;
    playback.cursor = replayKey ? 0 : finalCursor;
    return;
  }

  playback.cursor = Math.min(playback.cursor, finalCursor);
}

function createBattlePlaybackView(
  playback: BattlePlaybackState,
  frame: GameFrame,
): BattlePlaybackView {
  const events = frame.battleReplay.events;
  const activeEvent = events[playback.cursor];

  return {
    activeEvent,
    visibleEvents: events.slice(0, playback.cursor + 1),
    isPlaying: events.length > 1 && playback.cursor < events.length - 1,
    replayKey: playback.replayKey,
  };
}

function scheduleBattlePlayback(
  playback: BattlePlaybackState,
  frame: GameFrame,
  render: () => void,
  lifecycle: AppLifecycleState,
): void {
  if (
    lifecycle.suspended ||
    playback.timerId !== undefined ||
    frame.battleReplay.events.length <= 1
  ) {
    return;
  }

  if (playback.cursor >= frame.battleReplay.events.length - 1) {
    return;
  }

  playback.timerId = window.setTimeout(() => {
    playback.timerId = undefined;
    if (lifecycle.suspended) {
      return;
    }
    playback.cursor = Math.min(playback.cursor + 1, frame.battleReplay.events.length - 1);
    render();
  }, BATTLE_REPLAY_STEP_MS);
}

function clearBattlePlaybackTimer(playback: BattlePlaybackState): void {
  if (playback.timerId === undefined) {
    return;
  }

  window.clearTimeout(playback.timerId);
  playback.timerId = undefined;
}

function createBattleReplayKey(frame: GameFrame): string {
  return frame.battleReplay.events
    .map((event) =>
      [
        event.sequence,
        event.turn,
        event.type,
        event.sourceEntityId ?? "",
        event.targetEntityId ?? "",
        event.entityId ?? "",
        event.move ?? "",
        event.damage ?? "",
        event.status ?? "",
        event.winner ?? "",
        event.label,
      ].join(":"),
    )
    .join("|");
}

function unlockAudio(audioState: AudioState): void {
  audioState.unlocked = true;
}

function syncAudio(
  audioState: AudioState,
  frame: GameFrame,
  playback: BattlePlaybackView,
  lifecycle: AppLifecycleState,
): void {
  if (!audioState.unlocked || lifecycle.suspended) {
    pauseAudio(audioState);
    return;
  }

  if (playback.replayKey !== audioState.lastReplayKey) {
    audioState.playedCueIds.clear();
    audioState.lastReplayKey = playback.replayKey;
  }

  syncBgm(audioState, frame.scene.bgmKey);

  const activeSequence = playback.activeEvent?.sequence;
  const playableCues = frame.visualCues.filter((cue) =>
    shouldPlaySfxCue(cue, playback, activeSequence),
  );
  const hasPriorityCue = playableCues.some((cue) => cue.type !== "phase.change");

  for (const cue of playableCues) {
    if (hasPriorityCue && cue.type === "phase.change") {
      continue;
    }

    if (audioState.playedCueIds.has(cue.id)) {
      continue;
    }

    audioState.playedCueIds.add(cue.id);
    playSfx(audioState, cue.soundKey);
  }
}

function shouldPlaySfxCue(
  cue: FrameVisualCue,
  playback: BattlePlaybackView,
  activeSequence: number | undefined,
): boolean {
  if (playback.isPlaying) {
    return isBattleSfxCue(cue) && cue.sequence === activeSequence;
  }

  if (playback.replayKey && isBattleSfxCue(cue)) {
    return false;
  }

  return true;
}

function isBattleSfxCue(cue: FrameVisualCue): boolean {
  return (
    cue.type === "battle.hit" ||
    cue.type === "battle.miss" ||
    cue.type === "battle.support" ||
    cue.type === "creature.faint"
  );
}

function syncBgm(audioState: AudioState, bgmKey: FrameBgmKey): void {
  if (audioState.currentBgmKey === bgmKey && audioState.bgm) {
    void audioState.bgm.play().catch(() => undefined);
    return;
  }

  audioState.bgm?.pause();
  const url = resolveBgmUrl(bgmKey);

  if (!url) {
    audioState.currentBgmKey = undefined;
    audioState.bgm = undefined;
    return;
  }

  const bgm = new Audio(url);
  bgm.loop = true;
  bgm.volume = 0.34;
  audioState.currentBgmKey = bgmKey;
  audioState.bgm = bgm;
  void bgm.play().catch(() => undefined);
}

function pauseAudio(audioState: AudioState): void {
  audioState.bgm?.pause();
  stopActiveSfx(audioState);
}

function stopActiveSfx(audioState: AudioState): void {
  for (const audio of audioState.activeSfx) {
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // Some mobile browsers reject seeking streams that have not fully loaded.
    }
  }

  audioState.activeSfx.clear();
}

function playSfx(audioState: AudioState, soundKey: string): void {
  const url = resolveSfxUrl(soundKey);

  if (!url) {
    console.warn(`[audio] missing sfx asset for key: ${soundKey}`);
    return;
  }

  const audio = new Audio(url);
  audio.volume = resolveSfxVolume(soundKey);
  audioState.activeSfx.add(audio);
  const cleanup = () => audioState.activeSfx.delete(audio);
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  void audio.play().catch((error) => {
    console.warn(`[audio] sfx play failed for ${soundKey}:`, error);
    cleanup();
  });
}

function resolveSfxVolume(soundKey: string): number {
  if (soundKey.startsWith("sfx.battle.type.") || soundKey.startsWith("sfx.battle.support.")) {
    return 0.56;
  }

  if (soundKey === "sfx.battle.critical.hit") {
    return 0.58;
  }

  if (
    soundKey === "sfx.battle.hit" ||
    soundKey === "sfx.battle.miss" ||
    soundKey === "sfx.creature.faint"
  ) {
    return 0.46;
  }

  if (soundKey === "sfx.phase.change") {
    return 0.18;
  }

  return 0.34;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function cssEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function resolveAssetPath(assetPath: string): string {
  return pokemonAssetUrls[`../${assetPath}`] ?? assetPath;
}

function resolveTrainerAssetPath(assetPath: string): string {
  return trainerAssetUrls[`../${assetPath}`] ?? assetPath;
}

function resolveSfxUrl(soundKey: string): string | undefined {
  const fileName = `${soundKey.replace("sfx.", "").replaceAll(".", "-")}.m4a`;
  return sfxAssetUrls[`../resources/audio/sfx/${fileName}`];
}

function resolveBgmUrl(bgmKey: FrameBgmKey): string | undefined {
  const fileName = `${bgmKey
    .replace("bgm.", "")
    .replaceAll(/([A-Z])/g, "-$1")
    .toLowerCase()}.m4a`;
  return bgmAssetUrls[`../resources/audio/bgm/${fileName}`];
}
