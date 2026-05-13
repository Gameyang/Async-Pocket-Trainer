import type { BattleStatus, GameAction } from "../game/types";
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
import type { BrowserSyncStatus } from "../browser/browserSync";
import type { SyncSettings } from "../browser/syncSettings";
import {
  formatMoney,
  formatWave,
  localizeBall,
  localizeBattleStatus,
  withJosa,
} from "../game/localization";

const BATTLE_REPLAY_STEP_MS = 540;
const AUDIO_MUTED_STORAGE_KEY = "apt:audio-muted:v1";

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
  saveNotice?: string;
  sync?: {
    settings: SyncSettings;
    status: BrowserSyncStatus;
  };
}

export interface HtmlRendererOptions {
  getStatusView?: () => HtmlRendererStatusView;
  onSyncSettingsSubmit?: (settings: SyncSettings) => unknown | Promise<unknown>;
  onClearSave?: () => unknown | Promise<unknown>;
  onNewRun?: () => unknown | Promise<unknown>;
  onTrainerNameSubmit?: (trainerName: string) => unknown | Promise<unknown>;
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
  muted: boolean;
  currentBgmKey?: FrameBgmKey;
  bgm?: HTMLAudioElement;
  playedCueIds: Set<string>;
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
    muted: loadMutedPreference(),
    playedCueIds: new Set(),
  };

  const render = () => {
    const frame = client.getFrame();
    updateBattlePlayback(battlePlayback, frame);
    const playbackView = createBattlePlaybackView(battlePlayback, frame);
    root.innerHTML = renderFrame(frame, options.getStatusView?.() ?? {}, playbackView, audioState);
    bindActions(root, client, frame, playbackView, audioState, render);
    bindSettings(root, options, render);
    bindAudio(root, audioState, frame, playbackView, render);
    bindBattlePlayback(root, battlePlayback, frame, render);
    bindPanelToggles(root);
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
        unlockAudio(audioState);
        busy = true;
        root.dataset.busy = "true";

        try {
          await client.dispatch(action.action);
        } finally {
          busy = false;
          delete root.dataset.busy;
          render();
        }
      }
    });
  });
}

function bindSettings(root: HTMLElement, options: HtmlRendererOptions, render: () => void): void {
  const form = root.querySelector<HTMLFormElement>("[data-sync-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!options.onSyncSettingsSubmit) {
      return;
    }

    const data = new FormData(form);
    await options.onSyncSettingsSubmit({
      enabled: data.get("enabled") === "on",
      mode: data.get("mode") === "googleApi" ? "googleApi" : "publicCsv",
      spreadsheetId: String(data.get("spreadsheetId") ?? ""),
      range: String(data.get("range") ?? ""),
      publicCsvUrl: optionalFormValue(data.get("publicCsvUrl")),
      appsScriptSubmitUrl: optionalFormValue(data.get("appsScriptSubmitUrl")),
      apiKey: optionalFormValue(data.get("apiKey")),
      accessToken: optionalFormValue(data.get("accessToken")),
    });
    render();
  });

  root
    .querySelector<HTMLButtonElement>("[data-clear-save]")
    ?.addEventListener("click", async () => {
      if (!window.confirm("저장 데이터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) {
        return;
      }

      await options.onClearSave?.();
      render();
    });

  root.querySelector<HTMLButtonElement>("[data-new-run]")?.addEventListener("click", async () => {
    await options.onNewRun?.();
    render();
  });

  const trainerForm = root.querySelector<HTMLFormElement>("[data-trainer-form]");
  trainerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!options.onTrainerNameSubmit) {
      return;
    }

    const data = new FormData(trainerForm);
    await options.onTrainerNameSubmit(String(data.get("trainerName") ?? ""));
    render();
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

function bindAudio(
  root: HTMLElement,
  audioState: AudioState,
  frame: GameFrame,
  playback: BattlePlaybackView,
  render: () => void,
): void {
  root.querySelector<HTMLButtonElement>("[data-audio-toggle]")?.addEventListener("click", () => {
    unlockAudio(audioState);
    audioState.muted = !audioState.muted;
    saveMutedPreference(audioState.muted);
    syncAudio(audioState, frame, playback);
    render();
  });
}

function bindPanelToggles(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-team-details-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = root.querySelector<HTMLDetailsElement>("[data-team-panel]");

      if (!panel) {
        return;
      }

      panel.open = true;
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  });
}

function renderFrame(
  frame: GameFrame,
  statusView: HtmlRendererStatusView,
  playback: BattlePlaybackView,
  audioState: AudioState,
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
  const activeIds = resolveActiveBattleIds(frame, playback, entityView.entitiesById);
  const activePlayer =
    (activeIds.playerId ? entityView.entitiesById.get(activeIds.playerId) : undefined) ??
    playerEntities.find((entity) => entity.hp.current > 0) ??
    playerEntities[0];
  const activeOpponent =
    pendingCapture ??
    (activeIds.opponentId ? entityView.entitiesById.get(activeIds.opponentId) : undefined) ??
    opponentEntities.find((entity) => entity.hp.current > 0) ??
    opponentEntities[0];
  const latestCue = [...frame.visualCues].reverse().find((cue) => cue.type !== "phase.change");
  const activeCue = findActiveVisualCue(frame, playback.activeEvent);
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
  });

  return `
    <main class="app-shell" data-frame-id="${frame.frameId}" data-protocol="${frame.protocolVersion}" data-phase="${frame.phase}" data-wave="${frame.hud.wave}" data-money="${frame.hud.money}" data-poke-balls="${frame.hud.balls.pokeBall}" data-great-balls="${frame.hud.balls.greatBall}" data-team-size="${playerEntities.length}" data-timeline-count="${frame.timeline.length}" data-battle-playback="${playback.isPlaying ? "playing" : "idle"}" data-battle-sequence="${playback.activeEvent?.sequence ?? 0}" data-battle-event-type="${escapeHtml(playback.activeEvent?.type ?? "")}" data-audio-muted="${audioState.muted ? "true" : "false"}">
      <header class="topbar">
        <div class="brand">
          <span class="mark" aria-hidden="true"></span>
          <div>
            <h1>${escapeHtml(frame.hud.title)}</h1>
            <p>${escapeHtml(frame.hud.trainerName)}</p>
          </div>
        </div>
        <div class="run-status">
          <span>${formatWave(frame.hud.wave)}</span>
          <span class="team-hp-chip">
            <span>팀 HP ${Math.round(frame.hud.teamHpRatio * 100)}%</span>
            <span class="mini-meter"><span style="width: ${Math.round(frame.hud.teamHpRatio * 100)}%"></span></span>
          </span>
          <span>${formatMoney(frame.hud.money)}</span>
          <span>${localizeBall("pokeBall")} ${frame.hud.balls.pokeBall} / ${localizeBall("greatBall")} ${frame.hud.balls.greatBall}</span>
        </div>
        ${renderAudioButton(audioState)}
      </header>

      ${screen}

      ${
        frame.phase === "starterChoice" || frame.phase === "ready"
          ? ""
          : renderCommandBand(frame, playback.isPlaying, playerEntities, pendingCapture)
      }

      <section class="drawer-stack" aria-label="보조 정보">
        ${renderTeamPanel(frame, playerEntities, pendingCapture)}
        ${renderTimelinePanel(frame)}
        ${renderSyncPanel(statusView)}
        ${renderSettingsPanel(frame, statusView)}
      </section>
    </main>
  `;
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
}

function renderScreen(context: ScreenRenderContext): string {
  const { frame, playback } = context;

  if (shouldRenderBattleScreen(frame, playback)) {
    return renderBattleScreen(context);
  }

  if (frame.phase === "starterChoice") {
    return renderStarterScreen(frame.scene.starterOptions, frame.actions);
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

function resolveActiveBattleIds(
  frame: GameFrame,
  playback: BattlePlaybackView,
  entitiesById: ReadonlyMap<string, FrameEntity>,
): { playerId?: string; opponentId?: string } {
  let playerId: string | undefined;
  let opponentId: string | undefined;

  const setActive = (entityId: string | undefined) => {
    if (!entityId) {
      return;
    }

    const entity = entitiesById.get(entityId);

    if (entity?.owner === "player") {
      playerId = entityId;
    } else if (entity?.owner === "opponent") {
      opponentId = entityId;
    }
  };

  for (const event of playback.visibleEvents) {
    if (event.type === "turn.start") {
      playerId = event.activePlayerId ?? playerId;
      opponentId = event.activeEnemyId ?? opponentId;
    }

    setActive(event.sourceEntityId);
    setActive(event.targetEntityId);
    setActive(event.entityId);
  }

  return {
    playerId:
      playerId ??
      frame.scene.playerSlots.find((id) => (entitiesById.get(id)?.hp.current ?? 0) > 0) ??
      frame.scene.playerSlots[0],
    opponentId:
      opponentId ??
      frame.scene.opponentSlots.find((id) => (entitiesById.get(id)?.hp.current ?? 0) > 0) ??
      frame.scene.opponentSlots[0],
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
      ${renderCaptureOverlay(frame.scene.capture)}
      ${renderBattleCue(playback.activeEvent, activeCue, battleEntities)}
      <div class="battle-log log-panel" aria-label="전투 로그">
        ${renderBattleEventSummary(playback.activeEvent, activeCue, battleEntities)}
        <p class="log-line">${escapeHtml(logLine)}</p>
        ${renderReplayMeter(playback)}
        ${renderTeamDots(playerEntities)}
      </div>
    </section>
  `;
}

function renderStarterScreen(
  options: readonly FrameStarterOption[],
  actions: readonly FrameAction[],
): string {
  return `
    <section class="screen starter-screen" data-screen="starterChoice" aria-label="스타터 선택">
      <div class="starter-stage" aria-hidden="true"></div>
      <h2 class="starter-prompt">함께 시작할 포켓몬을 선택하세요</h2>
      <div class="starter-choice-row">
        ${options.map((option) => renderStarterOption(option, actions)).join("")}
      </div>
    </section>
  `;
}

function renderStarterOption(option: FrameStarterOption, actions: readonly FrameAction[]): string {
  const statTotal =
    option.stats.hp +
    option.stats.attack +
    option.stats.defense +
    option.stats.special +
    option.stats.speed;
  const action = actions.find((candidate) => candidate.id === `start:${option.speciesId}`);
  const actionAttribute = action ? ` data-action-id="${escapeHtml(action.id)}"` : "";
  const moves = option.moves
    .slice(0, 2)
    .map(
      (move) =>
        `<li>${escapeHtml(move.name)} <span>${move.power > 0 ? `위력 ${move.power}` : "변화"}</span></li>`,
    )
    .join("");

  return `
    <button type="button" class="starter-option" data-starter-id="${option.speciesId}"${actionAttribute}>
      <img src="${resolveAssetPath(option.assetPath)}" alt="${escapeHtml(`${option.name} 포켓몬`)}" />
      <h2>${escapeHtml(option.name)}</h2>
      <p>${escapeHtml(option.typeLabels.join(" / "))}</p>
      <span>전투력 ${option.power}</span>
      <span>종합 ${statTotal}</span>
      ${moves ? `<ul class="starter-moves">${moves}</ul>` : ""}
    </button>
  `;
}

function renderReadyScreen({ frame, playerEntities, activePlayer }: ScreenRenderContext): string {
  const shopActions = selectReadyShopActions(frame, playerEntities);

  return `
    <section class="screen ready-screen shop-screen" data-screen="ready" data-shop-actions="${shopActions.length}" aria-label="관리 단계">
      <div class="camp-sky" aria-hidden="true"></div>
      <div class="camp-ground" aria-hidden="true"></div>
      <div class="shop-board">
        <span>${formatWave(frame.hud.wave)} 관리 단계</span>
        <strong>${escapeHtml(frame.scene.subtitle)}</strong>
        <div class="shop-route-row">
          <span>${escapeHtml(resolveSelectedRouteLabel(frame.actions))}</span>
          <span>${formatMoney(frame.hud.money)}</span>
        </div>
      </div>
      <div class="shop-party">
        ${activePlayer ? renderCampLead(activePlayer) : '<p class="empty">스타터를 선택하세요.</p>'}
        ${renderTeamDots(playerEntities)}
      </div>
      <div class="shop-card-grid" data-shop-card-count="${shopActions.length}">
        ${shopActions.map((action) => renderShopActionCard(action, frame)).join("")}
      </div>
    </section>
  `;
}

function renderCampLead(entity: FrameEntity): string {
  return `
    <div class="camp-lead">
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
      <div>
        <h2>${escapeHtml(entity.name)}</h2>
        <p>HP ${entity.hp.current}/${entity.hp.max} / 전투력 ${entity.scores.power}</p>
      </div>
    </div>
  `;
}

function renderShopActionCard(action: FrameAction, frame: GameFrame): string {
  const disabled = action.enabled ? "" : " disabled";
  const reason = action.reason ? ` title="${escapeHtml(action.reason)}"` : "";
  const profile = shopActionProfile(action, frame);

  return `
    <button type="button" class="shop-card" data-action-id="${escapeHtml(action.id)}" data-shop-kind="${profile.kind}" data-role="${action.role}"${disabled}${reason}>
      <span>${escapeHtml(profile.kicker)}</span>
      <strong>${escapeHtml(profile.title)}</strong>
      <p>${escapeHtml(profile.detail)}</p>
      <small>${escapeHtml(profile.meta)}</small>
    </button>
  `;
}

function shopActionProfile(
  action: FrameAction,
  frame: GameFrame,
): { kind: string; kicker: string; title: string; detail: string; meta: string } {
  if (action.id === "encounter:next") {
    return {
      kind: "battle",
      kicker: "전투",
      title: "다음 만남",
      detail: action.label,
      meta: `${formatWave(frame.hud.wave)} 출발`,
    };
  }

  if (action.id === "shop:rest") {
    return {
      kind: "rest",
      kicker: "정비",
      title: "전원 회복",
      detail: `팀 HP ${Math.round(frame.hud.teamHpRatio * 100)}%`,
      meta: action.cost === undefined ? action.label : formatMoney(action.cost),
    };
  }

  if (action.id === "shop:pokeball" || action.id === "shop:greatball") {
    return {
      kind: "item",
      kicker: "상점",
      title: action.id === "shop:greatball" ? localizeBall("greatBall") : localizeBall("pokeBall"),
      detail:
        action.id === "shop:greatball"
          ? `보유 ${frame.hud.balls.greatBall}`
          : `보유 ${frame.hud.balls.pokeBall}`,
      meta: action.cost === undefined ? action.label : formatMoney(action.cost),
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

function renderTeamDecisionScreen({
  frame,
  playerEntities,
  pendingCapture,
}: ScreenRenderContext): string {
  const fullTeam = playerEntities.length >= 6;

  return `
    <section class="screen team-decision-screen" data-screen="teamDecision" aria-label="팀 편성">
      ${renderCaptureOverlay(frame.scene.capture)}
      <div class="candidate-panel">
        ${pendingCapture ? renderCandidateCard(pendingCapture) : '<p class="empty">대기 중인 포획 대상이 없습니다.</p>'}
      </div>
      <div class="reward-board">
        <span>${fullTeam ? "팀이 가득 찼습니다" : "새 동료 후보"}</span>
        <strong>${pendingCapture ? escapeHtml(pendingCapture.name) : "포획 결과"}</strong>
        ${renderTeamDots(playerEntities)}
      </div>
    </section>
  `;
}

function renderCandidateCard(entity: FrameEntity): string {
  return `
    <article class="candidate-card">
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" />
      <div>
        <h2>${escapeHtml(entity.name)}</h2>
        <p>${escapeHtml(entity.typeLabels.join(" / "))}</p>
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

type CommandItem =
  | { type: "action"; action: FrameAction }
  | { type: "panel"; id: string; label: string; role: FrameAction["role"] };

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

function renderAudioButton(audioState: AudioState): string {
  const label = audioState.muted ? "소리 켜기" : "음소거";
  return `<button type="button" class="audio-toggle" data-audio-toggle aria-label="${label}">${label}</button>`;
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

function renderTeamPanel(
  frame: GameFrame,
  playerEntities: readonly FrameEntity[],
  pendingCapture: FrameEntity | undefined,
): string {
  return `
    <details class="drawer team-panel" data-team-panel>
      <summary>
        <span>팀 상세</span>
        <span>전투력 ${frame.hud.teamPower}</span>
      </summary>
      <div class="meter" aria-label="팀 HP">
        <span style="width: ${Math.round(frame.hud.teamHpRatio * 100)}%"></span>
      </div>
      <div class="team-slot-list">
        ${renderTeamSlots(playerEntities, pendingCapture, frame.actions)}
      </div>
    </details>
  `;
}

function renderTeamSlots(
  playerEntities: readonly FrameEntity[],
  pendingCapture: FrameEntity | undefined,
  actions: readonly FrameAction[] = [],
): string {
  return Array.from({ length: 6 }, (_, index) => {
    const entity = playerEntities[index];
    const action = actions.find((candidate) => candidate.id === `team:replace:${index}`);
    return renderTeamSlot(index, entity, pendingCapture, action);
  }).join("");
}

function renderTeamSlot(
  index: number,
  entity: FrameEntity | undefined,
  pendingCapture: FrameEntity | undefined,
  action: FrameAction | undefined,
): string {
  const state = entity ? (entity.hp.current <= 0 ? "fainted" : "filled") : "empty";
  const delta = entity && pendingCapture ? pendingCapture.scores.power - entity.scores.power : 0;
  const deltaText = pendingCapture && entity ? `${delta >= 0 ? "+" : ""}${delta}` : "";
  const actionButton = action
    ? `<button type="button" data-action-id="${escapeHtml(action.id)}" data-role="${action.role}">교체</button>`
    : "";

  if (!entity) {
    return `
      <article class="team-slot" data-slot-state="empty">
        <span class="slot-icon" aria-hidden="true"></span>
        <div>
          <h3>${index + 1}번 슬롯</h3>
          <p>비어 있음</p>
        </div>
      </article>
    `;
  }

  return `
    <article class="team-slot" data-slot-state="${state}" data-entity-id="${escapeHtml(entity.id)}">
      <span class="slot-icon" aria-hidden="true"></span>
      <img src="${resolveAssetPath(entity.assetPath)}" alt="${escapeHtml(`${entity.name} 포켓몬`)}" loading="lazy" />
      <div>
        <h3>${escapeHtml(entity.name)}</h3>
        <p>HP ${entity.hp.current}/${entity.hp.max} / 전투력 ${entity.scores.power}</p>
      </div>
      <div class="slot-meter hp-line"><span style="width: ${Math.round(entity.hp.ratio * 100)}%"></span></div>
      ${pendingCapture ? `<span class="slot-delta" data-delta="${delta >= 0 ? "up" : "down"}">${deltaText}</span>` : ""}
      ${actionButton}
    </article>
  `;
}

function renderTimelinePanel(frame: GameFrame): string {
  return `
    <details class="drawer timeline-panel">
      <summary>
        <span>로그</span>
        <span>${frame.timeline.length}</span>
      </summary>
      <ol class="event-list">
        ${frame.timeline
          .map(
            (entry) =>
              `<li data-tone="${entry.tone}"><span>${formatWave(entry.wave)}</span>${escapeHtml(entry.text)}</li>`,
          )
          .join("")}
      </ol>
    </details>
  `;
}

function renderSettingsPanel(frame: GameFrame, statusView: HtmlRendererStatusView): string {
  const notice = statusView.saveNotice
    ? `<p class="save-notice" data-save-notice>${escapeHtml(statusView.saveNotice)}</p>`
    : "";

  return `
    <details class="drawer settings-panel">
      <summary>
        <span>설정</span>
        <span>도전</span>
      </summary>
      <form class="trainer-form" data-trainer-form>
        <label>
          <span>트레이너 이름</span>
          <input name="trainerName" value="${escapeHtml(frame.hud.trainerName)}" autocomplete="off" />
        </label>
        <button type="submit">이름 변경</button>
      </form>
      <div class="settings-actions">
        <button type="button" data-new-run>새 도전</button>
        <button type="button" data-clear-save>저장 삭제</button>
      </div>
      ${notice}
    </details>
  `;
}

function renderAction(action: FrameAction, locked = false): string {
  const disabled = action.enabled && !locked ? "" : " disabled";
  const reason = locked
    ? ' title="전투 리플레이 재생 중입니다."'
    : action.reason
      ? ` title="${escapeHtml(action.reason)}"`
      : "";

  return `<button type="button" data-action-id="${escapeHtml(action.id)}" data-role="${action.role}"${disabled}${reason}>${escapeHtml(
    action.label,
  )}</button>`;
}

function renderCommandItem(command: CommandItem, locked: boolean): string {
  if (command.type === "action") {
    return renderAction(command.action, locked);
  }

  const disabled = locked ? " disabled" : "";
  const reason = locked ? ' title="전투 리플레이 재생 중입니다."' : "";
  return `<button type="button" data-panel-command-id="${escapeHtml(command.id)}" data-team-details-toggle data-role="${command.role}"${disabled}${reason}>${escapeHtml(command.label)}</button>`;
}

function selectReadyShopActions(
  frame: GameFrame,
  playerEntities: readonly FrameEntity[],
): FrameAction[] {
  const next = findAction(frame.actions, "encounter:next");
  const rest = findAction(frame.actions, "shop:rest");
  const pokeBall = findAction(frame.actions, "shop:pokeball");
  const greatBall = findAction(frame.actions, "shop:greatball");
  const routeActions = ["route:elite", "route:supply", "route:normal"]
    .map((id) => findAction(frame.actions, id))
    .filter((action): action is FrameAction => action !== undefined && action.enabled);
  const needsRest =
    frame.hud.teamHpRatio < 0.75 || playerEntities.some((entity) => entity.hp.current <= 0);
  const picks: FrameAction[] = [];
  const add = (action: FrameAction | undefined) => {
    if (!action || !action.enabled || picks.some((existing) => existing.id === action.id)) {
      return;
    }

    picks.push(action);
  };

  add(next);

  if (needsRest) {
    add(rest);
  }

  if (frame.hud.balls.pokeBall < 2) {
    add(pokeBall);
  }

  if (frame.hud.balls.greatBall < 1) {
    add(greatBall);
  }

  for (const action of [...routeActions, rest, pokeBall, greatBall]) {
    if (picks.length >= 3) {
      break;
    }

    add(action);
  }

  return picks.slice(0, 3);
}

function selectCommandItems(
  frame: GameFrame,
  playerEntities: readonly FrameEntity[],
  pendingCapture: FrameEntity | undefined,
): CommandItem[] {
  if (frame.phase === "ready") {
    return [];
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
      {
        type: "panel" as const,
        id: "team:direct",
        label: "팀 직접 선택",
        role: "secondary" as const,
      },
    ].slice(0, 3);
  }

  return frame.actions.slice(0, 3).map((action) => ({ type: "action", action }));
}

function selectRecommendedReplaceAction(
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

function findAction(actions: readonly FrameAction[], id: string): FrameAction | undefined {
  return actions.find((action) => action.id === id);
}

function resolveSelectedRouteLabel(actions: readonly FrameAction[]): string {
  const selected = actions.find(
    (action) => action.id.startsWith("route:") && action.role === "primary" && !action.enabled,
  );

  return selected ? selected.label.replace(" 선택됨", "") : "일반 모험";
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

  const effect = resolveBattleEffect(entity, activeEvent);
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

function resolveHpState(hpRatio: number): "high" | "mid" | "low" | "empty" {
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

function createBattleEventSummary(
  activeEvent: FrameBattleReplayEvent | undefined,
  activeCue: FrameVisualCue | undefined,
  entities: readonly FrameEntity[],
): { kind: string; turn: string; title: string; result: string; detail?: string } | undefined {
  if (!activeEvent) {
    return undefined;
  }

  const source = resolveEntityName(activeEvent.sourceEntityId, entities);
  const target = resolveEntityName(activeEvent.targetEntityId, entities);
  const entity = resolveEntityName(activeEvent.entityId, entities);
  const turn = activeEvent.turn > 0 ? `${activeEvent.turn}턴` : "개시";

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
    detail: `남은 HP 우리 ${activeEvent.playerRemainingHp ?? 0} / 상대 ${activeEvent.enemyRemainingHp ?? 0}`,
  };
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

function createBattleCueText(
  activeEvent: FrameBattleReplayEvent,
  activeCue: FrameVisualCue | undefined,
): { kind: string; text: string } | undefined {
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

  return undefined;
}

function resolveDamageCueKind(
  activeEvent: FrameBattleReplayEvent,
  activeCue: FrameVisualCue | undefined,
): "critical" | "super-effective" | "resisted" | "damage" {
  if (activeCue?.effectKey === "battle.criticalHit" || activeEvent.critical) {
    return "critical";
  }

  if (activeCue?.effectKey === "battle.superEffective" || (activeEvent.effectiveness ?? 1) > 1) {
    return "super-effective";
  }

  if (
    activeCue?.effectKey === "battle.resisted" ||
    ((activeEvent.effectiveness ?? 1) > 0 && (activeEvent.effectiveness ?? 1) < 1)
  ) {
    return "resisted";
  }

  return "damage";
}

function formatDamageSummaryNotes(activeEvent: FrameBattleReplayEvent): string {
  const notes = [
    ...(activeEvent.critical ? ["급소"] : []),
    ...(activeEvent.effectiveness && activeEvent.effectiveness > 1 ? ["효과 굉장"] : []),
    ...(activeEvent.effectiveness && activeEvent.effectiveness > 0 && activeEvent.effectiveness < 1
      ? ["효과 약함"]
      : []),
  ];

  return notes.length > 0 ? ` / ${notes.join(", ")}` : "";
}

function formatBattleEventLabel(
  activeEvent: FrameBattleReplayEvent,
  entities: readonly FrameEntity[],
): string {
  const source = resolveEntityName(activeEvent.sourceEntityId, entities);
  const target = resolveEntityName(activeEvent.targetEntityId, entities);
  const entity = resolveEntityName(activeEvent.entityId, entities);

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

  if (activeEvent.type === "damage.apply") {
    const notes = formatDamageSummaryNotes(activeEvent).replace(" / ", "");
    return `${source}의 ${activeEvent.move ?? "기술"}! ${target}에게 ${activeEvent.damage ?? 0} 피해.${notes ? ` ${notes}.` : ""}`;
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

function resolveEntityName(id: string | undefined, entities: readonly FrameEntity[]): string {
  if (!id) {
    return "대상";
  }

  return entities.find((entity) => entity.id === id)?.name ?? "대상";
}

function resolveBattleEffect(
  entity: FrameEntity,
  activeEvent: FrameBattleReplayEvent | undefined,
): string {
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

function findActiveVisualCue(
  frame: GameFrame,
  activeEvent: FrameBattleReplayEvent | undefined,
): FrameVisualCue | undefined {
  if (!activeEvent) {
    return undefined;
  }

  return frame.visualCues.find((cue) => {
    if (cue.sequence !== activeEvent.sequence) {
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

    return false;
  });
}

function visualCueReferencesEntity(cue: FrameVisualCue, entityId: string): boolean {
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
  if (!audioState.unlocked || audioState.muted) {
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

function loadMutedPreference(): boolean {
  try {
    return window.localStorage.getItem(AUDIO_MUTED_STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function saveMutedPreference(muted: boolean): void {
  try {
    window.localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    return;
  }
}

function renderPhaseLabel(phase: GameFrame["phase"]): string {
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

function renderSyncPanel(statusView: HtmlRendererStatusView): string {
  const sync = statusView.sync;

  if (!sync) {
    return "";
  }

  const { settings, status } = sync;
  const checked = settings.enabled ? " checked" : "";
  const publicSelected = settings.mode === "publicCsv" ? " selected" : "";
  const googleSelected = settings.mode === "googleApi" ? " selected" : "";
  const lastError =
    status.state === "error" && status.lastError
      ? `<p class="sync-error-detail">상세 오류: ${escapeHtml(status.lastError)}</p>`
      : "";

  return `
    <details class="drawer sync-panel" data-sync-state="${status.state}">
      <summary>
        <span>동기화</span>
        <span data-sync-status>${escapeHtml(status.message)}</span>
      </summary>
      <form class="sync-form" data-sync-form>
        <label class="toggle-row">
          <input type="checkbox" name="enabled"${checked} />
          <span>Google Sheets 사용</span>
        </label>
        <label>
          <span>방식</span>
          <select name="mode">
            <option value="publicCsv"${publicSelected}>공개 CSV</option>
            <option value="googleApi"${googleSelected}>Google API</option>
          </select>
        </label>
        <details class="advanced-settings">
          <summary>고급 설정</summary>
          <label>
            <span>시트 URL/ID</span>
            <input name="spreadsheetId" value="${escapeHtml(settings.spreadsheetId)}" autocomplete="off" />
          </label>
          <label>
            <span>탭/범위</span>
            <input name="range" value="${escapeHtml(settings.range)}" autocomplete="off" />
          </label>
          <label>
            <span>CSV URL</span>
            <input name="publicCsvUrl" value="${escapeHtml(settings.publicCsvUrl ?? "")}" autocomplete="off" />
          </label>
          <label>
            <span>제출 URL</span>
            <input name="appsScriptSubmitUrl" value="${escapeHtml(settings.appsScriptSubmitUrl ?? "")}" autocomplete="off" />
          </label>
          <label>
            <span>API 키</span>
            <input name="apiKey" type="password" value="${escapeHtml(settings.apiKey ?? "")}" autocomplete="off" />
          </label>
          <label>
            <span>토큰</span>
            <input name="accessToken" type="password" value="${escapeHtml(settings.accessToken ?? "")}" autocomplete="off" />
          </label>
          ${lastError}
        </details>
        <div class="sync-actions">
          <button type="submit">동기화 저장</button>
        </div>
      </form>
    </details>
  `;
}

function optionalFormValue(value: FormDataEntryValue | null): string | undefined {
  const resolved = String(value ?? "").trim();
  return resolved.length > 0 ? resolved : undefined;
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
