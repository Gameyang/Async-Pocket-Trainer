import type { GameAction } from "../game/types";
import type {
  FrameAction,
  FrameBattleReplayEvent,
  FrameEntity,
  GameFrame,
} from "../game/view/frame";
import type { BrowserSyncStatus } from "../browser/browserSync";
import type { SyncSettings } from "../browser/syncSettings";

const BATTLE_REPLAY_STEP_MS = 260;

const pokemonAssetUrls = import.meta.glob<string>("../resources/pokemon/*.webp", {
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

  const render = () => {
    const frame = client.getFrame();
    updateBattlePlayback(battlePlayback, frame);
    const playbackView = createBattlePlaybackView(battlePlayback, frame);
    root.innerHTML = renderFrame(frame, options.getStatusView?.() ?? {}, playbackView);
    bindActions(root, client, frame, playbackView, render);
    bindSettings(root, options, render);
    bindBattlePlayback(root, battlePlayback, frame, render);
    scheduleBattlePlayback(battlePlayback, frame, render);
  };

  render();
}

function bindActions(
  root: HTMLElement,
  client: FrameClient,
  frame: GameFrame,
  playback: BattlePlaybackView,
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
      await options.onClearSave?.();
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

function renderFrame(
  frame: GameFrame,
  statusView: HtmlRendererStatusView,
  playback: BattlePlaybackView,
): string {
  const playerEntities = frame.scene.playerSlots
    .map((id) => frame.entities.find((entity) => entity.id === id))
    .filter((entity): entity is FrameEntity => Boolean(entity));
  const opponentEntities = frame.scene.opponentSlots
    .map((id) => frame.entities.find((entity) => entity.id === id))
    .filter((entity): entity is FrameEntity => Boolean(entity));
  const pendingCapture = frame.scene.pendingCaptureId
    ? frame.entities.find((entity) => entity.id === frame.scene.pendingCaptureId)
    : undefined;
  const activePlayer = playerEntities[0];
  const activeOpponent =
    pendingCapture ??
    opponentEntities.find((entity) => entity.hp.current > 0) ??
    opponentEntities[0];
  const latestCue = [...frame.visualCues].reverse().find((cue) => cue.type !== "phase.change");
  const latestLine = frame.timeline[0]?.text ?? latestCue?.label ?? frame.scene.subtitle;
  const logLine =
    playback.isPlaying && playback.activeEvent
      ? formatBattleEventLabel(playback.activeEvent, frame.entities)
      : latestLine;

  return `
    <main class="app-shell" data-frame-id="${frame.frameId}" data-protocol="${frame.protocolVersion}" data-phase="${frame.phase}" data-wave="${frame.hud.wave}" data-money="${frame.hud.money}" data-poke-balls="${frame.hud.balls.pokeBall}" data-great-balls="${frame.hud.balls.greatBall}" data-team-size="${playerEntities.length}" data-timeline-count="${frame.timeline.length}" data-battle-playback="${playback.isPlaying ? "playing" : "idle"}" data-battle-sequence="${playback.activeEvent?.sequence ?? 0}" data-battle-event-type="${escapeHtml(playback.activeEvent?.type ?? "")}">
      <header class="topbar">
        <div class="brand">
          <span class="mark" aria-hidden="true"></span>
          <div>
            <h1>${escapeHtml(frame.hud.title)}</h1>
            <p>${escapeHtml(frame.hud.trainerName)}</p>
          </div>
        </div>
        <div class="run-status">
          <span>W${frame.hud.wave}</span>
          <span>${renderPhaseLabel(frame.phase)}</span>
          <span>${frame.hud.money}c</span>
        </div>
      </header>

      <section class="screen encounter-panel" aria-label="battle screen">
        <div class="battlefield" aria-hidden="true"></div>
        <div class="platform enemy" aria-hidden="true"></div>
        <div class="platform hero" aria-hidden="true"></div>
        ${renderBattleMonster(activeOpponent, "enemy-mon", playback.activeEvent)}
        ${renderBattleMonster(activePlayer, "hero-mon", playback.activeEvent)}
        ${renderBattleCard(activeOpponent, "enemy", frame.scene.title, frame.scene.subtitle)}
        ${renderBattleCard(activePlayer, "hero", frame.hud.trainerName, `Power ${frame.hud.teamPower}`)}
        ${renderBattleCue(playback.activeEvent, frame.entities)}
        <div class="battle-log log-panel" aria-label="battle log">
          <p class="log-line">${escapeHtml(logLine)}</p>
          ${renderReplayMeter(playback)}
          ${renderTeamDots(playerEntities)}
        </div>
      </section>

      <section class="command-band">
        ${frame.actions.map((action) => renderAction(action, playback.isPlaying)).join("")}
      </section>

      <section class="drawer-stack">
        <details class="drawer team-panel">
          <summary>
            <span>Team</span>
            <span>Power ${frame.hud.teamPower}</span>
          </summary>
          <div class="meter" aria-label="Team HP">
            <span style="width: ${Math.round(frame.hud.teamHpRatio * 100)}%"></span>
          </div>
          <div class="team-list">
            ${playerEntities.map(renderEntity).join("") || '<p class="empty">Choose a starter.</p>'}
          </div>
        </details>

        <details class="drawer timeline-panel">
          <summary>
            <span>Log</span>
            <span>${frame.timeline.length}</span>
          </summary>
          <ol class="event-list">
            ${frame.timeline
              .map(
                (entry) =>
                  `<li data-tone="${entry.tone}"><span>W${entry.wave}</span>${escapeHtml(entry.text)}</li>`,
              )
              .join("")}
          </ol>
        </details>

        ${renderSyncPanel(statusView)}
      </section>
    </main>
  `;
}

function renderAction(action: FrameAction, locked = false): string {
  const disabled = action.enabled && !locked ? "" : " disabled";
  const reason = locked
    ? ' title="Battle replay is playing."'
    : action.reason
      ? ` title="${escapeHtml(action.reason)}"`
      : "";

  return `<button type="button" data-action-id="${escapeHtml(action.id)}" data-role="${action.role}"${disabled}${reason}>${escapeHtml(
    action.label,
  )}</button>`;
}

function renderBattleMonster(
  entity: FrameEntity | undefined,
  className: string,
  activeEvent: FrameBattleReplayEvent | undefined,
): string {
  if (!entity) {
    return "";
  }

  const effect = resolveBattleEffect(entity, activeEvent);
  const effectAttribute = effect ? ` data-battle-effect="${effect}"` : "";

  return `
    <div class="screen-monster ${className}" data-entity-id="${escapeHtml(entity.id)}"${effectAttribute}>
      <img src="${resolveAssetPath(entity.assetPath)}" alt="" />
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

  return `
    <aside class="battle-card ${className}">
      <div class="name-row">
        <span>${escapeHtml(name)}</span>
        <span>${escapeHtml(hpText)}</span>
      </div>
      <div class="hp-line"><span style="width: ${Math.round(hpRatio * 100)}%"></span></div>
    </aside>
  `;
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
    ? '<button type="button" class="replay-skip" data-replay-skip aria-label="Fast forward battle replay">&gt;&gt;</button>'
    : "";

  return `
    <div class="replay-row" data-replay-current="${current}" data-replay-total="${total}">
      <span>${current}/${total}</span>
      ${button}
    </div>
  `;
}

function renderBattleCue(
  activeEvent: FrameBattleReplayEvent | undefined,
  entities: readonly FrameEntity[],
): string {
  if (!activeEvent) {
    return "";
  }

  const targetId = activeEvent.targetEntityId ?? activeEvent.entityId;
  const target = entities.find((entity) => entity.id === targetId);
  const lane = target?.owner === "player" ? "hero" : "enemy";
  const cue = createBattleCueText(activeEvent);

  if (!cue) {
    return "";
  }

  return `<div class="battle-float" data-cue-kind="${cue.kind}" data-cue-lane="${lane}">${escapeHtml(cue.text)}</div>`;
}

function createBattleCueText(
  activeEvent: FrameBattleReplayEvent,
): { kind: string; text: string } | undefined {
  if (activeEvent.type === "damage.apply") {
    const prefix = activeEvent.critical ? "CRIT " : "";
    const suffix =
      activeEvent.effectiveness && activeEvent.effectiveness > 1
        ? "!"
        : activeEvent.effectiveness && activeEvent.effectiveness < 1
          ? "..."
          : "";
    return {
      kind: activeEvent.critical ? "critical" : "damage",
      text: `${prefix}-${activeEvent.damage ?? 0}${suffix}`,
    };
  }

  if (activeEvent.type === "move.miss") {
    return { kind: "miss", text: "MISS" };
  }

  if (activeEvent.type === "creature.faint") {
    return { kind: "faint", text: "FAINT" };
  }

  if (activeEvent.type === "status.apply" || activeEvent.type === "status.tick") {
    return { kind: "status", text: String(activeEvent.status ?? "STATUS").toUpperCase() };
  }

  return undefined;
}

function formatBattleEventLabel(
  activeEvent: FrameBattleReplayEvent,
  entities: readonly FrameEntity[],
): string {
  const source = resolveEntityName(activeEvent.sourceEntityId, entities);
  const target = resolveEntityName(activeEvent.targetEntityId, entities);
  const entity = resolveEntityName(activeEvent.entityId, entities);

  if (activeEvent.type === "battle.start") {
    return "Battle started.";
  }

  if (activeEvent.type === "turn.start") {
    return `Turn ${activeEvent.turn}`;
  }

  if (activeEvent.type === "move.select") {
    return `${source} readied ${activeEvent.move ?? "a move"}.`;
  }

  if (activeEvent.type === "move.miss") {
    return `${source}'s ${activeEvent.move ?? "move"} missed ${target}.`;
  }

  if (activeEvent.type === "damage.apply") {
    const critical = activeEvent.critical ? " Critical hit." : "";
    return `${source} hit ${target} with ${activeEvent.move ?? "a move"} for ${activeEvent.damage ?? 0}.${critical}`;
  }

  if (activeEvent.type === "turn.skip") {
    return `${entity} could not move.`;
  }

  if (activeEvent.type === "status.apply") {
    return `${target} was afflicted with ${activeEvent.status}.`;
  }

  if (activeEvent.type === "status.immune") {
    return `${target} resisted ${activeEvent.status}.`;
  }

  if (activeEvent.type === "status.tick") {
    return `${entity} took ${activeEvent.damage ?? 0} ${activeEvent.status} damage.`;
  }

  if (activeEvent.type === "status.clear") {
    return `${entity} recovered from ${activeEvent.status}.`;
  }

  if (activeEvent.type === "creature.faint") {
    return `${entity} fainted.`;
  }

  return activeEvent.winner === "player" ? "Your team won the battle." : "The opponent won.";
}

function resolveEntityName(id: string | undefined, entities: readonly FrameEntity[]): string {
  if (!id) {
    return "It";
  }

  return entities.find((entity) => entity.id === id)?.name ?? "It";
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
      return activeEvent.critical ? "critical-hit" : "hit";
    }

    return "status";
  }

  if (activeEvent.entityId === entity.id) {
    return "status";
  }

  return "";
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

function renderPhaseLabel(phase: GameFrame["phase"]): string {
  switch (phase) {
    case "starterChoice":
      return "Starter";
    case "ready":
      return "Ready";
    case "captureDecision":
      return "Catch";
    case "teamDecision":
      return "Team";
    case "gameOver":
      return "Game Over";
  }
}

function renderEntity(entity: FrameEntity): string {
  return `
    <article class="creature" data-entity-id="${escapeHtml(entity.id)}" data-owner="${entity.owner}">
      <div class="creature-heading">
        <div>
          <h3>${escapeHtml(entity.name)}</h3>
          <p>${entity.typeLabels.join(" / ")} / P${entity.scores.power} / R${entity.scores.rarity}</p>
        </div>
        <img src="${resolveAssetPath(entity.assetPath)}" alt="" loading="lazy" />
      </div>
      <div class="hp-line"><span style="width: ${Math.round(entity.hp.ratio * 100)}%"></span></div>
      <dl>
        <div><dt>HP</dt><dd>${entity.hp.current}/${entity.hp.max}</dd></div>
        <div><dt>Atk</dt><dd>${entity.stats.attack}</dd></div>
        <div><dt>Def</dt><dd>${entity.stats.defense}</dd></div>
        <div><dt>Spc</dt><dd>${entity.stats.special}</dd></div>
        <div><dt>Spd</dt><dd>${entity.stats.speed}</dd></div>
      </dl>
      <p class="moves">${entity.moves.map((move) => escapeHtml(move.name)).join(", ")}</p>
    </article>
  `;
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
  const notice = statusView.saveNotice
    ? `<p class="save-notice" data-save-notice>${escapeHtml(statusView.saveNotice)}</p>`
    : "";

  return `
    <details class="drawer sync-panel" data-sync-state="${status.state}">
      <summary>
        <span>Sync</span>
        <span data-sync-status>${escapeHtml(status.message)}</span>
      </summary>
      <form class="sync-form" data-sync-form>
        <label class="toggle-row">
          <input type="checkbox" name="enabled"${checked} />
          <span>Google Sheets</span>
        </label>
        <label>
          <span>Mode</span>
          <select name="mode">
            <option value="publicCsv"${publicSelected}>Public CSV</option>
            <option value="googleApi"${googleSelected}>Google API</option>
          </select>
        </label>
        <label>
          <span>Sheet URL/ID</span>
          <input name="spreadsheetId" value="${escapeHtml(settings.spreadsheetId)}" autocomplete="off" />
        </label>
        <label>
          <span>Tab/Range</span>
          <input name="range" value="${escapeHtml(settings.range)}" autocomplete="off" />
        </label>
        <label>
          <span>CSV URL</span>
          <input name="publicCsvUrl" value="${escapeHtml(settings.publicCsvUrl ?? "")}" autocomplete="off" />
        </label>
        <label>
          <span>Submit URL</span>
          <input name="appsScriptSubmitUrl" value="${escapeHtml(settings.appsScriptSubmitUrl ?? "")}" autocomplete="off" />
        </label>
        <label>
          <span>API key</span>
          <input name="apiKey" type="password" value="${escapeHtml(settings.apiKey ?? "")}" autocomplete="off" />
        </label>
        <label>
          <span>Token</span>
          <input name="accessToken" type="password" value="${escapeHtml(settings.accessToken ?? "")}" autocomplete="off" />
        </label>
        <div class="sync-actions">
          <button type="submit">Save Sync</button>
          <button type="button" data-clear-save>Clear Save</button>
        </div>
      </form>
      ${notice}
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
