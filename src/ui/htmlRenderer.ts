import { ballTypes, type BattleStatus, type GameAction } from "../game/types";
import type {
  FrameAction,
  FrameBattleReplayEvent,
  FrameBgmKey,
  FrameCaptureScene,
  FrameEntity,
  FrameStarterOption,
  FrameTrainerScene,
  FrameVisualCue,
  GameFrame,
} from "../game/view/frame";
import { formatMoney, formatWave, localizeBattleStatus } from "../game/localization";
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

const BATTLE_REPLAY_STEP_MS = 540;

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
const sfxAssetUrls = import.meta.glob<string>("../resources/audio/sfx/*.wav", {
  eager: true,
  import: "default",
  query: "?url",
});
const bgmAssetUrls = import.meta.glob<string>("../resources/audio/bgm/*.wav", {
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

interface AudioState {
  unlocked: boolean;
  currentBgmKey?: FrameBgmKey;
  bgm?: HTMLAudioElement;
  playedCueIds: Set<string>;
}

interface ShopTargetState {
  action?: FrameAction;
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
  };
  const shopTarget: ShopTargetState = {};

  const render = () => {
    const frame = client.getFrame();
    if (frame.phase !== "ready") {
      shopTarget.action = undefined;
    }
    updateBattlePlayback(battlePlayback, frame);
    const playbackView = createBattlePlaybackView(battlePlayback, frame);
    root.innerHTML = renderFrame(
      frame,
      options.getStatusView?.() ?? {},
      playbackView,
      Boolean(options.onStarterReroll),
      shopTarget.action,
    );
    bindActions(root, client, frame, playbackView, audioState, shopTarget, render);
    bindShopTargetSelection(root, client, shopTarget, render);
    bindTeamRecord(root, options, render);
    bindStarterReroll(root, options, render);
    bindStarterDexSelection(root);
    bindBattlePlayback(root, battlePlayback, frame, render);
    syncAudio(audioState, frame, playbackView);
    scheduleBattlePlayback(battlePlayback, frame, render);
  };

  render();
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
          render();
          return;
        }

        unlockAudio(audioState);
        busy = true;
        root.dataset.busy = "true";

        try {
          await client.dispatch(action.action);
        } finally {
          busy = false;
          delete root.dataset.busy;
          shopTarget.action = undefined;
          render();
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
  root.querySelector<HTMLButtonElement>("[data-shop-target-cancel]")?.addEventListener("click", () => {
    shopTarget.action = undefined;
    render();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-shop-target-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetEntityId = button.dataset.shopTargetId;
      const action = shopTarget.action;

      if (!targetEntityId || !action || action.action.type !== "BUY_HEAL") {
        return;
      }

      root.dataset.busy = "true";

      try {
        await client.dispatch({
          type: "BUY_HEAL",
          scope: action.action.scope,
          tier: action.action.tier,
          targetEntityId,
        });
      } finally {
        delete root.dataset.busy;
        shopTarget.action = undefined;
        render();
      }
    });
  });
}

function requiresShopTarget(action: FrameAction): boolean {
  return action.action.type === "BUY_HEAL" && action.action.scope === "single";
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

function bindBattlePlayback(
  root: HTMLElement,
  playback: BattlePlaybackState,
  frame: GameFrame,
  render: () => void,
): void {
  root.querySelector<HTMLButtonElement>("[data-replay-skip]")?.addEventListener("click", () => {
    const finalCursor = Math.max(0, frame.battleReplay.events.length - 1);
    playback.cursor = finalCursor;
    clearBattlePlaybackTimer(playback);
    render();
  });
}

function renderFrame(
  frame: GameFrame,
  statusView: HtmlRendererStatusView,
  playback: BattlePlaybackView,
  canRerollStarter: boolean,
  shopTargetAction?: FrameAction,
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
  });
  const showReadyFailureCommands =
    frame.phase === "ready" && frame.scene.capture?.result === "failure";

  return `
    <main class="app-shell" data-frame-id="${frame.frameId}" data-protocol="${frame.protocolVersion}" data-phase="${frame.phase}" data-wave="${frame.hud.wave}" data-money="${frame.hud.money}" ${renderBallDataAttributes(frame)} data-team-size="${playerEntities.length}" data-team-hp-ratio="${frame.hud.teamHpRatio}" data-timeline-count="${frame.timeline.length}" data-battle-playback="${playback.isPlaying ? "playing" : "idle"}" data-battle-sequence="${playback.activeEvent?.sequence ?? 0}" data-battle-event-type="${escapeHtml(playback.activeEvent?.type ?? "")}">
      ${screen}
      ${playback.isPlaying ? "" : renderTeamRecordPanel(statusView.teamRecord, playerEntities)}

      ${
        frame.phase === "starterChoice" || (frame.phase === "ready" && !showReadyFailureCommands)
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

  return renderReadyScreen(context);
}

function shouldRenderBattleScreen(frame: GameFrame, playback: BattlePlaybackView): boolean {
  return (
    frame.phase === "captureDecision" ||
    frame.scene.capture?.result === "failure" ||
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
  if (frame.battleReplay.events.length === 0) {
    return {
      entities: frame.entities,
      entitiesById: new Map(frame.entities.map((entity) => [entity.id, entity])),
    };
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
      ${renderTrainerBadge(frame.scene.trainer)}
      ${renderBattleMonster(activeOpponent, "enemy-mon", playback.activeEvent, activeCue)}
      ${renderBattleMonster(activePlayer, "hero-mon", playback.activeEvent, activeCue)}
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
  const rerollButton = canReroll && options.length <= 12
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
  const disabled = action ? "" : " disabled";
  const state = action ? "unlocked" : "locked";
  const dexNumber = option.speciesId.toString().padStart(3, "0");
  const displayName = action ? option.name : "???";
  const typeLine = action ? option.typeLabels.join(" / ") : "미발견";

  return `
    <article class="starter-option" data-starter-id="${option.speciesId}" data-starter-state="${state}">
      <button type="button" class="starter-option-card" data-starter-pick="${option.speciesId}"${disabled}>
        ${action ? renderActionIcon(action, "starter-option-icon") : ""}
        <span class="starter-dex-number">#${dexNumber}</span>
        <img src="${resolveAssetPath(option.assetPath)}" alt="${escapeHtml(`${displayName} 포켓몬`)}" />
        <h2>${escapeHtml(displayName)}</h2>
        <p>${escapeHtml(typeLine)}</p>
        ${action ? '<span>선택 가능</span>' : '<span>LOCKED</span>'}
      </button>
      ${
        action
          ? `<div class="starter-option-actions" aria-label="${escapeHtml(`${option.name} 선택 확인`)}">
              <button type="button" class="starter-confirm" data-action-id="${escapeHtml(action.id)}">선택</button>
              <button type="button" class="starter-cancel" data-starter-cancel>취소</button>
            </div>`
          : ""
      }
    </article>
  `;
}

function renderReadyScreen({
  frame,
  playerEntities,
  shopTargetAction,
}: ScreenRenderContext): string {
  const shopActions = selectReadyShopActions(frame, playerEntities);

  return `
    <section class="screen ready-screen shop-screen" data-screen="ready" data-shop-actions="${shopActions.length}" data-shop-targeting="${shopTargetAction ? "true" : "false"}" aria-label="관리 단계">
      <div class="camp-sky" aria-hidden="true"></div>
      <div class="camp-ground" aria-hidden="true"></div>
      <div class="shop-top-panel">
        <div class="shop-board">
          <span class="shop-money">${formatMoney(frame.hud.money)}</span>
          ${
            shopTargetAction
              ? `<strong>${escapeHtml(createShopTargetLabel(shopTargetAction))}</strong><button type="button" class="shop-target-cancel" data-shop-target-cancel aria-label="대상 선택 취소">✕</button>`
              : ""
          }
        </div>
        ${renderShopTeamGrid(playerEntities, shopTargetAction)}
      </div>
      <div class="shop-card-grid" data-shop-card-count="${shopActions.length}">
        ${shopActions.map((action) => renderShopActionCard(action, frame)).join("")}
      </div>
    </section>
  `;
}

function createShopTargetLabel(action: FrameAction): string {
  return action.action.type === "BUY_HEAL" ? `${action.label} 대상 선택` : action.label;
}

function renderShopTeamGrid(
  playerEntities: readonly FrameEntity[],
  targetAction: FrameAction | undefined,
): string {
  const slots = Array.from({ length: 6 }, (_, index) => playerEntities[index]);

  return `
    <div class="shop-team-grid" data-targeting="${targetAction ? "true" : "false"}">
      ${slots.map((entity, index) => renderShopTeamSlot(entity, index, targetAction)).join("")}
    </div>
  `;
}

function renderShopTeamSlot(
  entity: FrameEntity | undefined,
  index: number,
  targetAction: FrameAction | undefined,
): string {
  if (!entity) {
    return `
      <div class="shop-team-slot empty" data-team-slot="${index + 1}" data-slot-state="empty">
        <span class="shop-slot-number">${index + 1}</span>
      </div>
    `;
  }

  const hpState = resolveHpState(entity.hp.ratio);
  const selectable = Boolean(targetAction) && entity.hp.current < entity.hp.max;
  const disabled = targetAction && !selectable ? " disabled" : "";
  const tag = targetAction ? "button" : "div";
  const typeAttribute = targetAction ? ' type="button"' : "";
  const targetAttribute = targetAction ? ` data-shop-target-id="${escapeHtml(entity.id)}"` : "";

  return `
    <${tag}${typeAttribute} class="shop-team-slot" data-team-slot="${index + 1}" data-slot-state="${hpState}"${targetAttribute}${disabled}>
      <span class="shop-slot-number">${index + 1}</span>
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
      <div>
        <strong>${escapeHtml(entity.name)}</strong>
        <p>${entity.hp.current}/${entity.hp.max} · ${entity.scores.power}</p>
      </div>
      <span class="slot-meter" data-hp-state="${hpState}"><span style="width: ${Math.round(entity.hp.ratio * 100)}%"></span></span>
    </${tag}>
  `;
}

function renderShopActionCard(action: FrameAction, frame: GameFrame): string {
  const disabled = action.enabled ? "" : " disabled";
  const reason = action.reason ? ` title="${escapeHtml(action.reason)}"` : "";
  const profile = createShopActionProfile(action, frame);
  const titleLines = createCompactShopTitleLines(action, profile);
  const compactMeta = createCompactShopMeta(action, profile);
  const ariaLabel = [profile.kicker, profile.title, profile.detail, profile.meta]
    .filter(Boolean)
    .join(" ");
  const featuredAttribute = action.id === "encounter:next" ? ' data-shop-featured="true"' : "";
  const grade = resolveShopCardGrade(action);
  const gradeAttribute = grade ? ` data-grade="${grade}"` : "";

  return `
    <button type="button" class="shop-card" data-action-id="${escapeHtml(action.id)}" data-shop-kind="${profile.kind}" data-role="${action.role}"${gradeAttribute}${featuredAttribute} aria-label="${escapeHtml(ariaLabel)}"${disabled}${reason}>
      ${renderActionIcon(action)}
      <strong>${titleLines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</strong>
      <small>${escapeHtml(compactMeta)}</small>
    </button>
  `;
}

const HEAL_RATIO_BY_TIER: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 20,
  2: 35,
  3: 50,
  4: 75,
  5: 100,
};

type ShopCardGrade = "common" | "uncommon" | "rare" | "epic" | "legendary";

function resolveShopCardGrade(action: FrameAction): ShopCardGrade | undefined {
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

function createCompactShopTitleLines(action: FrameAction, profile: ShopActionProfile): string[] {
  if (action.id === "encounter:next") {
    return ["전투", "시작"];
  }

  if (action.action.type === "REST_TEAM") {
    return ["전체 회복", "HP 100%"];
  }

  if (action.action.type === "BUY_HEAL") {
    const ratio = HEAL_RATIO_BY_TIER[action.action.tier] ?? 0;
    const scopeLabel = action.action.scope === "team" ? "전체 회복" : "단일 회복";
    return [scopeLabel, `HP ${ratio}%`];
  }

  if (action.action.type === "BUY_SCOUT") {
    const kindLabel = action.action.kind === "rarity" ? "희귀 탐지" : "강도 탐지";
    const detail =
      action.action.tier === 1
        ? "기본 정보"
        : action.action.tier === 2
          ? "상세 정보"
          : "정밀 분석";
    return [kindLabel, detail];
  }

  if (action.action.type === "BUY_BALL") {
    switch (action.action.ball) {
      case "pokeBall":
        return ["몬스터", "볼"];
      case "greatBall":
        return ["슈퍼", "볼"];
      case "ultraBall":
        return ["하이퍼", "볼"];
      case "hyperBall":
        return ["레전드", "볼"];
      case "masterBall":
        return ["마스터", "볼"];
    }
  }

  if (action.action.type === "BUY_RARITY_BOOST") {
    const map: Record<1 | 2 | 3, string> = { 1: "+10%", 2: "+25%", 3: "+50%" };
    return ["희귀도", map[action.action.tier]];
  }

  if (action.action.type === "BUY_LEVEL_BOOST") {
    const ranges: Record<1 | 2 | 3 | 4, string> = {
      1: "+1~2",
      2: "+1~3",
      3: "+2~4",
      4: "+3~6",
    };
    return ["숙련도", ranges[action.action.tier]];
  }

  if (action.id === "route:supply") {
    return ["보급", "루트"];
  }

  return [profile.title];
}

function createCompactShopMeta(action: FrameAction, profile: ShopActionProfile): string {
  if (action.id === "encounter:next") {
    return "출발";
  }

  return profile.meta;
}

function renderTeamDecisionScreen({
  frame,
  playerEntities,
  pendingCapture,
}: ScreenRenderContext): string {
  const fullTeam = playerEntities.length >= 6;
  const weakestPower = playerEntities.length === 0
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

function renderFinalTeamStats(
  playerEntities: readonly FrameEntity[],
  teamPower: number,
): string {
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

function renderTeamRecordPanel(
  record: HtmlRendererTeamRecordView | undefined,
  playerEntities: readonly FrameEntity[],
): string {
  if (!record) {
    return "";
  }

  const message = record.message
    ? `<p class="record-message">${escapeHtml(record.message)}</p>`
    : "";

  return `
    <section class="team-record-panel" data-team-record-panel>
      <form data-team-record-form>
        <span>${formatWave(record.wave)} 트레이너 승리 기록</span>
        <strong>${escapeHtml(record.opponentName)}</strong>
        ${renderTeamDots(playerEntities)}
        <label>
          <span>팀 이름</span>
          <input name="trainerName" value="${escapeHtml(record.trainerName)}" maxlength="24" autocomplete="off" />
        </label>
        <button type="submit">기록 저장</button>
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

function actionEmoji(action: FrameAction): string {
  switch (action.action.type) {
    case "START_RUN":
      return "🐾";
    case "RETURN_TO_STARTER_CHOICE":
      return "🎲";
    case "CHOOSE_ROUTE":
      if (action.action.routeId === "elite") {
        return "🔥";
      }
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
    case "BUY_HEAL":
      return "💊";
    case "BUY_SCOUT":
      return action.action.kind === "rarity" ? "🔎" : "📡";
    case "BUY_RARITY_BOOST":
      return "⭐";
    case "BUY_LEVEL_BOOST":
      return "⬆️";
    case "SET_TRAINER_NAME":
      return "💾";
  }
}

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
  const effectAttribute = effect ? ` data-battle-effect="${effect}"` : "";
  const cueAttribute =
    activeCue && visualCueReferencesEntity(activeCue, entity.id)
      ? ` data-battle-effect-key="${escapeHtml(activeCue.effectKey)}"`
      : "";
  const faintedAttribute = entity.flags.includes("fainted") ? ' data-fainted="true"' : "";

  return `
    <div class="screen-monster ${className}" data-entity-id="${escapeHtml(entity.id)}"${effectAttribute}${cueAttribute}${faintedAttribute}>
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
    </div>
  `;
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
  const button = playback.isPlaying
    ? '<button type="button" class="replay-skip" data-replay-skip aria-label="전투 리플레이 빠르게 넘기기"><span aria-hidden="true">&gt;&gt;</span><span>빠르게 넘기기</span></button>'
    : "";
  const state = playback.isPlaying ? '<span class="replay-state">전투 재생 중</span>' : "";

  return `
    <div class="replay-row" data-replay-current="${current}" data-replay-total="${total}">
      <span>${current}/${total}</span>
      ${state}
      ${button}
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

  return `<div class="battle-float" data-cue-kind="${cue.kind}" data-cue-lane="${lane}">${escapeHtml(cue.text)}</div>`;
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
): void {
  if (playback.timerId !== undefined || frame.battleReplay.events.length <= 1) {
    return;
  }

  if (playback.cursor >= frame.battleReplay.events.length - 1) {
    return;
  }

  playback.timerId = window.setTimeout(() => {
    playback.timerId = undefined;
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

function syncAudio(audioState: AudioState, frame: GameFrame, playback: BattlePlaybackView): void {
  if (!audioState.unlocked) {
    audioState.bgm?.pause();
    return;
  }

  syncBgm(audioState, frame.scene.bgmKey);

  const activeSequence = playback.activeEvent?.sequence;
  for (const cue of frame.visualCues) {
    if (
      playback.isPlaying &&
      (cue.type === "battle.hit" || cue.type === "battle.miss" || cue.type === "creature.faint") &&
      cue.sequence !== activeSequence
    ) {
      continue;
    }

    if (audioState.playedCueIds.has(cue.id)) {
      continue;
    }

    audioState.playedCueIds.add(cue.id);
    playSfx(cue.soundKey);
  }
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
  bgm.volume = 0.18;
  audioState.currentBgmKey = bgmKey;
  audioState.bgm = bgm;
  void bgm.play().catch(() => undefined);
}

function playSfx(soundKey: string): void {
  const url = resolveSfxUrl(soundKey);

  if (!url) {
    return;
  }

  const audio = new Audio(url);
  audio.volume = 0.34;
  void audio.play().catch(() => undefined);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolveAssetPath(assetPath: string): string {
  return pokemonAssetUrls[`../${assetPath}`] ?? assetPath;
}

function resolveTrainerAssetPath(assetPath: string): string {
  return trainerAssetUrls[`../${assetPath}`] ?? assetPath;
}

function resolveSfxUrl(soundKey: string): string | undefined {
  const fileName = `${soundKey.replace("sfx.", "").replaceAll(".", "-")}.wav`;
  return sfxAssetUrls[`../resources/audio/sfx/${fileName}`];
}

function resolveBgmUrl(bgmKey: FrameBgmKey): string | undefined {
  const fileName = `${bgmKey
    .replace("bgm.", "")
    .replaceAll(/([A-Z])/g, "-$1")
    .toLowerCase()}.wav`;
  return bgmAssetUrls[`../resources/audio/bgm/${fileName}`];
}
