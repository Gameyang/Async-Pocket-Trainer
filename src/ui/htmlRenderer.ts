import type { GameAction } from "../game/types";
import type { FrameAction, FrameEntity, GameFrame } from "../game/view/frame";

const pokemonAssetUrls = import.meta.glob<string>("../resources/pokemon/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});

export interface FrameClient {
  getFrame(): GameFrame;
  dispatch(action: GameAction): unknown;
}

export function mountHtmlRenderer(root: HTMLElement, client: FrameClient): void {
  const render = () => {
    const frame = client.getFrame();
    root.innerHTML = renderFrame(frame);
    bindActions(root, client, frame, render);
  };

  render();
}

function bindActions(
  root: HTMLElement,
  client: FrameClient,
  frame: GameFrame,
  render: () => void,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-action-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = frame.actions.find((candidate) => candidate.id === button.dataset.actionId);

      if (action?.enabled) {
        client.dispatch(action.action);
        render();
      }
    });
  });
}

function renderFrame(frame: GameFrame): string {
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
    <main class="app-shell" data-frame-id="${frame.frameId}" data-protocol="${frame.protocolVersion}">
      <header class="topbar">
        <div>
          <p class="eyebrow">Frame API ${frame.protocolVersion}</p>
          <h1>${escapeHtml(frame.hud.title)}</h1>
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
