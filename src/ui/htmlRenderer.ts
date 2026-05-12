import type { GameAction } from "../game/types";
import type { FrameAction, FrameEntity, GameFrame } from "../game/view/frame";
import type { BrowserSyncStatus } from "../browser/browserSync";
import type { SyncSettings } from "../browser/syncSettings";

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

export function mountHtmlRenderer(
  root: HTMLElement,
  client: FrameClient,
  options: HtmlRendererOptions = {},
): void {
  const render = () => {
    const frame = client.getFrame();
    root.innerHTML = renderFrame(frame, options.getStatusView?.() ?? {});
    bindActions(root, client, frame, render);
    bindSettings(root, options, render);
  };

  render();
}

function bindActions(
  root: HTMLElement,
  client: FrameClient,
  frame: GameFrame,
  render: () => void,
): void {
  let busy = false;

  root.querySelectorAll<HTMLButtonElement>("[data-action-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (busy) {
        return;
      }

      const action = frame.actions.find((candidate) => candidate.id === button.dataset.actionId);

      if (action?.enabled) {
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

function renderFrame(frame: GameFrame, statusView: HtmlRendererStatusView): string {
  const playerEntities = frame.scene.playerSlots
    .map((id) => frame.entities.find((entity) => entity.id === id))
    .filter((entity): entity is FrameEntity => Boolean(entity));
  const opponentEntities = frame.scene.opponentSlots
    .map((id) => frame.entities.find((entity) => entity.id === id))
    .filter((entity): entity is FrameEntity => Boolean(entity));
  const pendingCapture = frame.scene.pendingCaptureId
    ? frame.entities.find((entity) => entity.id === frame.scene.pendingCaptureId)
    : undefined;

  return `
    <main class="app-shell" data-frame-id="${frame.frameId}" data-protocol="${frame.protocolVersion}" data-phase="${frame.phase}" data-wave="${frame.hud.wave}" data-money="${frame.hud.money}" data-poke-balls="${frame.hud.balls.pokeBall}" data-great-balls="${frame.hud.balls.greatBall}" data-team-size="${playerEntities.length}" data-timeline-count="${frame.timeline.length}">
      <header class="topbar">
        <div class="brand">
          <span class="mark" aria-hidden="true"></span>
          <div>
          <p class="eyebrow">Frame API ${frame.protocolVersion}</p>
          <h1>${escapeHtml(frame.hud.title)}</h1>
          </div>
        </div>
        <div class="run-status">
          <span>Wave ${frame.hud.wave}</span>
          <span>${frame.phase}</span>
          <span>${frame.hud.money}c</span>
        </div>
      </header>

      <section class="command-band">
        ${frame.actions.map(renderAction).join("")}
      </section>

      <section class="dashboard">
        <article class="panel team-panel">
          <div class="panel-heading">
            <h2>Team</h2>
            <span>Power ${frame.hud.teamPower}</span>
          </div>
          <div class="meter" aria-label="Team HP">
            <span style="width: ${Math.round(frame.hud.teamHpRatio * 100)}%"></span>
          </div>
          <div class="team-list">
            ${playerEntities.map(renderEntity).join("") || '<p class="empty">Choose a starter.</p>'}
          </div>
        </article>

        <article class="panel encounter-panel">
          <div class="panel-heading">
            <h2>${escapeHtml(frame.scene.title)}</h2>
            <span>${escapeHtml(frame.scene.subtitle)}</span>
          </div>
          ${(pendingCapture ? [pendingCapture] : opponentEntities).map(renderEntity).join("") || '<p class="empty">No pending encounter.</p>'}
          <div class="battle-log">
            ${frame.visualCues
              .filter((cue) => cue.type !== "phase.change")
              .slice(-6)
              .map((cue) => `<p>${escapeHtml(cue.label)}</p>`)
              .join("")}
          </div>
        </article>

        <article class="panel log-panel">
          <div class="panel-heading">
            <h2>Timeline</h2>
            <span>${frame.timeline.length}</span>
          </div>
          <ol class="event-list">
            ${frame.timeline
              .map(
                (entry) =>
                  `<li data-tone="${entry.tone}"><span>W${entry.wave}</span>${escapeHtml(entry.text)}</li>`,
              )
              .join("")}
          </ol>
        </article>

        ${renderSyncPanel(statusView)}
      </section>
    </main>
  `;
}

function renderAction(action: FrameAction): string {
  const disabled = action.enabled ? "" : " disabled";
  const reason = action.reason ? ` title="${escapeHtml(action.reason)}"` : "";

  return `<button type="button" data-action-id="${escapeHtml(action.id)}" data-role="${action.role}"${disabled}${reason}>${escapeHtml(
    action.label,
  )}</button>`;
}

function renderEntity(entity: FrameEntity): string {
  return `
    <article class="creature" data-entity-id="${escapeHtml(entity.id)}" data-owner="${entity.owner}">
      <div class="creature-heading">
        <div>
          <h3>${escapeHtml(entity.name)}</h3>
          <p>${entity.typeLabels.join(" / ")} · P${entity.scores.power} · R${entity.scores.rarity}</p>
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
    <article class="panel sync-panel" data-sync-state="${status.state}">
      <div class="panel-heading">
        <h2>Sync</h2>
        <span data-sync-status>${escapeHtml(status.message)}</span>
      </div>
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
    </article>
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
