import { starterSpeciesIds } from "../game/data/catalog";
import { HeadlessGameClient } from "../game/headlessClient";
import { getTeamHealthRatio, scoreTeam } from "../game/scoring";
import type { BallType, Creature, GameAction, GameState } from "../game/types";

export function mountHtmlRenderer(root: HTMLElement, client: HeadlessGameClient): void {
  const render = () => {
    const snapshot = client.getSnapshot();
    root.innerHTML = renderSnapshot(snapshot, client.getBalance());
    bindActions(root, client, render);
  };

  render();
}

function bindActions(root: HTMLElement, client: HeadlessGameClient, render: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = parseAction(button.dataset);

      if (action) {
        client.dispatch(action);
        render();
      }
    });
  });

  root.querySelector<HTMLButtonElement>("[data-auto-step]")?.addEventListener("click", () => {
    client.autoStep("greedy");
    render();
  });

  root.querySelector<HTMLButtonElement>("[data-auto-run]")?.addEventListener("click", () => {
    const targetWave = client.getSnapshot().currentWave + 5;
    client.autoPlay({ maxWaves: targetWave, strategy: "greedy" });
    render();
  });
}

function parseAction(dataset: DOMStringMap): GameAction | undefined {
  switch (dataset.action) {
    case "START_RUN":
      return {
        type: "START_RUN",
        starterSpeciesId: Number.parseInt(dataset.speciesId ?? `${starterSpeciesIds[0]}`, 10),
      };
    case "RESOLVE_NEXT_ENCOUNTER":
      return { type: "RESOLVE_NEXT_ENCOUNTER" };
    case "ATTEMPT_CAPTURE":
      return { type: "ATTEMPT_CAPTURE", ball: (dataset.ball ?? "pokeBall") as BallType };
    case "ACCEPT_CAPTURE":
      return {
        type: "ACCEPT_CAPTURE",
        replaceIndex:
          dataset.replaceIndex === undefined
            ? undefined
            : Number.parseInt(dataset.replaceIndex, 10),
      };
    case "DISCARD_CAPTURE":
      return { type: "DISCARD_CAPTURE" };
    case "REST_TEAM":
      return { type: "REST_TEAM" };
    case "BUY_BALL":
      return {
        type: "BUY_BALL",
        ball: (dataset.ball ?? "pokeBall") as BallType,
        quantity: Number.parseInt(dataset.quantity ?? "1", 10),
      };
    default:
      return undefined;
  }
}

function renderSnapshot(
  snapshot: GameState,
  balance: ReturnType<HeadlessGameClient["getBalance"]>,
): string {
  return `
    <main class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Headless Core</p>
          <h1>Async Pocket Trainer</h1>
        </div>
        <div class="run-status">
          <span>Wave ${snapshot.currentWave}</span>
          <span>${snapshot.phase}</span>
          <span>${snapshot.money}c</span>
        </div>
      </header>

      <section class="command-band">
        ${renderPrimaryActions(snapshot, balance)}
        <button type="button" data-auto-step>Auto Step</button>
        <button type="button" data-auto-run>Auto +5 Waves</button>
      </section>

      <section class="dashboard">
        <article class="panel team-panel">
          <div class="panel-heading">
            <h2>Team</h2>
            <span>Power ${scoreTeam(snapshot.team)}</span>
          </div>
          <div class="meter" aria-label="Team HP">
            <span style="width: ${Math.round(getTeamHealthRatio(snapshot.team) * 100)}%"></span>
          </div>
          <div class="team-list">
            ${snapshot.team.map(renderCreature).join("") || '<p class="empty">Choose a starter.</p>'}
          </div>
        </article>

        <article class="panel encounter-panel">
          <div class="panel-heading">
            <h2>Encounter</h2>
            <span>${snapshot.pendingEncounter?.kind ?? "none"}</span>
          </div>
          ${renderEncounter(snapshot)}
        </article>

        <article class="panel log-panel">
          <div class="panel-heading">
            <h2>Events</h2>
            <span>${snapshot.events.length}</span>
          </div>
          <ol class="event-list">
            ${snapshot.events
              .slice()
              .reverse()
              .slice(0, 12)
              .map((event) => `<li><span>W${event.wave}</span>${escapeHtml(event.message)}</li>`)
              .join("")}
          </ol>
        </article>
      </section>
    </main>
  `;
}

function renderPrimaryActions(
  snapshot: GameState,
  balance: ReturnType<HeadlessGameClient["getBalance"]>,
): string {
  if (snapshot.phase === "starterChoice" || snapshot.phase === "gameOver") {
    return starterSpeciesIds
      .map(
        (speciesId) =>
          `<button type="button" data-action="START_RUN" data-species-id="${speciesId}">Start ${speciesId}</button>`,
      )
      .join("");
  }

  if (snapshot.phase === "ready") {
    return `
      <button type="button" data-action="RESOLVE_NEXT_ENCOUNTER">Next Encounter</button>
      <button type="button" data-action="REST_TEAM">Rest ${balance.teamRestCost}c</button>
      <button type="button" data-action="BUY_BALL" data-ball="pokeBall" data-quantity="1">Buy Poké Ball</button>
      <button type="button" data-action="BUY_BALL" data-ball="greatBall" data-quantity="1">Buy Great Ball</button>
    `;
  }

  if (snapshot.phase === "captureDecision") {
    return `
      <button type="button" data-action="ATTEMPT_CAPTURE" data-ball="pokeBall">Poké Ball (${snapshot.balls.pokeBall})</button>
      <button type="button" data-action="ATTEMPT_CAPTURE" data-ball="greatBall">Great Ball (${snapshot.balls.greatBall})</button>
      <button type="button" data-action="DISCARD_CAPTURE">Skip</button>
    `;
  }

  if (snapshot.phase === "teamDecision") {
    const replacementButtons =
      snapshot.team.length >= balance.maxTeamSize
        ? snapshot.team
            .map(
              (creature, index) =>
                `<button type="button" data-action="ACCEPT_CAPTURE" data-replace-index="${index}">Replace ${escapeHtml(
                  creature.speciesName,
                )}</button>`,
            )
            .join("")
        : `<button type="button" data-action="ACCEPT_CAPTURE">Keep</button>`;

    return `${replacementButtons}<button type="button" data-action="DISCARD_CAPTURE">Release</button>`;
  }

  return "";
}

function renderEncounter(snapshot: GameState): string {
  const pending = snapshot.pendingCapture ?? snapshot.pendingEncounter?.enemyTeam[0];
  const battleLog = snapshot.lastBattle?.log.slice(-6) ?? [];

  return `
    ${pending ? renderCreature(pending) : '<p class="empty">No pending encounter.</p>'}
    <div class="battle-log">
      ${battleLog
        .map(
          (entry) =>
            `<p><strong>T${entry.turn}</strong> ${escapeHtml(entry.actor)} used ${escapeHtml(
              entry.move,
            )} for ${entry.damage}</p>`,
        )
        .join("")}
    </div>
  `;
}

function renderCreature(creature: Creature): string {
  const hpPercent = Math.round((creature.currentHp / creature.stats.hp) * 100);

  return `
    <article class="creature">
      <div>
        <h3>${escapeHtml(creature.speciesName)}</h3>
        <p>${creature.types.join(" / ")} · P${creature.powerScore} · R${creature.rarityScore}</p>
      </div>
      <div class="hp-line"><span style="width: ${hpPercent}%"></span></div>
      <dl>
        <div><dt>HP</dt><dd>${creature.currentHp}/${creature.stats.hp}</dd></div>
        <div><dt>Atk</dt><dd>${creature.stats.attack}</dd></div>
        <div><dt>Def</dt><dd>${creature.stats.defense}</dd></div>
        <div><dt>Spc</dt><dd>${creature.stats.special}</dd></div>
        <div><dt>Spd</dt><dd>${creature.stats.speed}</dd></div>
      </dl>
      <p class="moves">${creature.moves.map((move) => escapeHtml(move.name)).join(", ")}</p>
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
