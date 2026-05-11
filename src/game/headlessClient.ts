import { runAutoBattle } from "./battle/battleEngine";
import { attemptCapture } from "./capture/captureSystem";
import { createCreature, healTeam } from "./creatureFactory";
import { defaultBalance, starterSpeciesIds } from "./data/catalog";
import { SeededRng } from "./rng";
import { chooseReplacementIndex, getTeamHealthRatio, scoreTeam } from "./scoring";
import { createGameFrame, type GameFrame } from "./view/frame";
import { calculateReward, createEncounter, replaceTeamAfterCapture } from "./wave/waveSystem";
import type {
  AutoPlayOptions,
  BallType,
  GameAction,
  GameBalance,
  GameEvent,
  GameState,
  RunSummary,
} from "./types";

export interface HeadlessClientOptions {
  seed?: string;
  trainerName?: string;
  balance?: Partial<GameBalance>;
}

export interface HeadlessClientSnapshot {
  version: 1;
  frameId: number;
  nextEventId: number;
  balance: GameBalance;
  state: GameState;
}

export class HeadlessGameClient {
  private balance: GameBalance;
  private readonly rng: SeededRng;
  private state: GameState;
  private nextEventId = 1;
  private frameId = 0;

  constructor(options: HeadlessClientOptions = {}) {
    const seed = options.seed ?? "apt-headless-default";
    this.balance = { ...defaultBalance, ...options.balance };
    this.rng = new SeededRng(seed);
    this.state = {
      version: 1,
      seed,
      rngState: this.rng.getState(),
      trainerName: options.trainerName ?? "Headless Trainer",
      phase: "starterChoice",
      currentWave: 1,
      money: this.balance.startingMoney,
      balls: {
        pokeBall: this.balance.startingPokeBalls,
        greatBall: this.balance.startingGreatBalls,
      },
      team: [],
      events: [],
    };
  }

  static fromSnapshot(snapshot: HeadlessClientSnapshot): HeadlessGameClient {
    const client = new HeadlessGameClient({
      seed: snapshot.state.seed,
      trainerName: snapshot.state.trainerName,
      balance: snapshot.balance,
    });
    client.loadSnapshot(snapshot);
    return client;
  }

  getSnapshot(): GameState {
    return cloneState(this.state);
  }

  saveSnapshot(): HeadlessClientSnapshot {
    return cloneClientSnapshot({
      version: 1,
      frameId: this.frameId,
      nextEventId: this.nextEventId,
      balance: { ...this.balance },
      state: this.state,
    });
  }

  loadSnapshot(snapshot: HeadlessClientSnapshot): GameState {
    assertValidClientSnapshot(snapshot);

    this.balance = { ...snapshot.balance };
    this.state = cloneState(snapshot.state);
    this.rng.setState(this.state.rngState);
    this.frameId = snapshot.frameId;
    this.nextEventId = snapshot.nextEventId;

    return this.getSnapshot();
  }

  getFrame(): GameFrame {
    return createGameFrame(this.state, this.balance, this.frameId);
  }

  getBalance(): GameBalance {
    return { ...this.balance };
  }

  dispatch(action: GameAction): GameState {
    switch (action.type) {
      case "START_RUN":
        this.startRun(action.starterSpeciesId, action.trainerName);
        break;
      case "RESOLVE_NEXT_ENCOUNTER":
        this.resolveNextEncounter();
        break;
      case "ATTEMPT_CAPTURE":
        this.tryCapture(action.ball);
        break;
      case "ACCEPT_CAPTURE":
        this.acceptCapture(action.replaceIndex);
        break;
      case "DISCARD_CAPTURE":
        this.discardCapture();
        break;
      case "REST_TEAM":
        this.restTeam();
        break;
      case "BUY_BALL":
        this.buyBall(action.ball, action.quantity ?? 1);
        break;
    }

    this.syncRngState();
    this.frameId += 1;
    return this.getSnapshot();
  }

  autoStep(strategy: AutoPlayOptions["strategy"] = "greedy"): GameState {
    const before = signature(this.state);

    if (this.state.phase === "starterChoice") {
      this.startRun(this.rng.pick(starterSpeciesIds));
    } else if (this.state.phase === "ready") {
      this.prepareForEncounter(strategy);
      this.resolveNextEncounter();
    } else if (this.state.phase === "captureDecision") {
      const ball = this.chooseBall(strategy);

      if (ball) {
        this.tryCapture(ball);
      } else {
        this.discardCapture();
      }
    } else if (this.state.phase === "teamDecision") {
      this.acceptCapture();
    }

    this.syncRngState();
    this.frameId += 1;

    if (before === signature(this.state) && this.state.phase !== "gameOver") {
      this.addEvent("stalled", "Headless auto step made no progress.");
    }

    return this.getSnapshot();
  }

  autoPlay(options: AutoPlayOptions): GameState {
    const maxSteps = options.maxSteps ?? options.maxWaves * 8 + 16;

    for (let step = 0; step < maxSteps; step += 1) {
      if (this.state.phase === "gameOver" || this.state.currentWave > options.maxWaves) {
        break;
      }

      this.autoStep(options.strategy ?? "greedy");
    }

    return this.getSnapshot();
  }

  getRunSummary(): RunSummary {
    return {
      seed: this.state.seed,
      trainerName: this.state.trainerName,
      finalWave: this.state.currentWave,
      phase: this.state.phase,
      money: this.state.money,
      balls: { ...this.state.balls },
      teamSize: this.state.team.length,
      teamPower: scoreTeam(this.state.team),
      events: this.state.events.length,
      gameOverReason: this.state.gameOverReason,
    };
  }

  private startRun(starterSpeciesId: number = starterSpeciesIds[0], trainerName?: string): void {
    if (this.state.phase !== "starterChoice" && this.state.phase !== "gameOver") {
      this.addEvent("start_ignored", "Run is already active.");
      return;
    }

    const starter = createCreature({
      rng: this.rng,
      wave: 1,
      balance: this.balance,
      speciesId: starterSpeciesId,
      role: "starter",
    });

    this.state = {
      version: 1,
      seed: this.state.seed,
      rngState: this.rng.getState(),
      trainerName: trainerName ?? this.state.trainerName,
      phase: "ready",
      currentWave: 1,
      money: this.balance.startingMoney,
      balls: {
        pokeBall: this.balance.startingPokeBalls,
        greatBall: this.balance.startingGreatBalls,
      },
      team: [starter],
      events: [],
    };
    this.nextEventId = 1;
    this.addEvent("run_started", `${this.state.trainerName} chose ${starter.speciesName}.`, {
      starterSpeciesId: starter.speciesId,
      starterPower: starter.powerScore,
    });
  }

  private resolveNextEncounter(): void {
    if (this.state.phase !== "ready") {
      this.addEvent("encounter_ignored", "Encounter can only resolve while ready.");
      return;
    }

    const encounter = createEncounter(this.state.currentWave, this.rng, this.balance);
    const battle = runAutoBattle({
      kind: encounter.kind,
      playerTeam: this.state.team,
      enemyTeam: encounter.enemyTeam,
      rng: this.rng,
      damageScale: this.balance.battleDamageScale,
    });

    this.state.team = battle.playerTeam;
    this.state.pendingEncounter = encounter;
    this.state.lastBattle = battle;
    const reward = calculateReward(this.state.currentWave, encounter.kind, this.balance);

    this.addEvent(
      "battle_resolved",
      `${encounter.opponentName} battle ended with ${battle.winner} win.`,
      {
        kind: encounter.kind,
        winner: battle.winner,
        opponentName: encounter.opponentName,
        turns: battle.turns,
        reward: battle.winner === "player" ? reward : 0,
        enemyPower: scoreTeam(battle.enemyTeam),
        teamPower: scoreTeam(battle.playerTeam),
      },
    );

    if (battle.winner !== "player") {
      this.state.phase = "gameOver";
      this.state.gameOverReason = `Lost at wave ${this.state.currentWave} against ${encounter.opponentName}.`;
      this.addEvent("game_over", this.state.gameOverReason, {
        wave: this.state.currentWave,
        opponentName: encounter.opponentName,
        kind: encounter.kind,
        enemyPower: scoreTeam(battle.enemyTeam),
        teamPower: scoreTeam(battle.playerTeam),
      });
      return;
    }

    this.state.money += reward;

    if (encounter.kind === "trainer") {
      this.advanceWave();
      return;
    }

    const defeatedWild = battle.enemyTeam[0];
    this.state.pendingEncounter = {
      ...encounter,
      enemyTeam: [defeatedWild],
    };
    this.state.phase = "captureDecision";
  }

  private tryCapture(ball: BallType): void {
    if (this.state.phase !== "captureDecision" || !this.state.pendingEncounter) {
      this.addEvent("capture_ignored", "No capture decision is pending.");
      return;
    }

    if (this.state.balls[ball] <= 0) {
      this.addEvent("capture_no_ball", `No ${ball} remains.`);
      return;
    }

    this.state.balls[ball] -= 1;

    const target = this.state.pendingEncounter.enemyTeam[0];
    const result = attemptCapture(target, this.state.currentWave, ball, this.rng);

    this.addEvent(
      "capture_attempted",
      `${ball} capture ${result.success ? "succeeded" : "failed"}.`,
      {
        ball,
        chance: Number(result.chance.toFixed(4)),
        success: result.success,
        target: target.speciesName,
      },
    );

    if (result.success) {
      this.state.pendingCapture = {
        ...target,
        currentHp: target.stats.hp,
      };
      this.state.phase = "teamDecision";
    } else {
      this.advanceWave();
    }
  }

  private acceptCapture(replaceIndex?: number): void {
    if (this.state.phase !== "teamDecision" || !this.state.pendingCapture) {
      this.addEvent("team_decision_ignored", "No captured creature is pending.");
      return;
    }

    const captured = this.state.pendingCapture;
    const resolvedIndex = replaceIndex ?? chooseReplacementIndex(this.state.team, captured);
    const oldTeamPower = scoreTeam(this.state.team);
    this.state.team = replaceTeamAfterCapture(
      this.state.team,
      captured,
      this.balance.maxTeamSize,
      resolvedIndex,
    );
    const accepted =
      scoreTeam(this.state.team) > oldTeamPower || this.state.team.includes(captured);

    this.addEvent(
      accepted ? "capture_kept" : "capture_released",
      accepted
        ? `${captured.speciesName} joined the team.`
        : `${captured.speciesName} was released after comparison.`,
      {
        accepted,
        replaceIndex: resolvedIndex,
        capturedPower: captured.powerScore,
        teamPower: scoreTeam(this.state.team),
      },
    );
    this.advanceWave();
  }

  private discardCapture(): void {
    if (this.state.phase !== "captureDecision" && this.state.phase !== "teamDecision") {
      this.addEvent("discard_ignored", "No capture can be discarded now.");
      return;
    }

    const name =
      this.state.pendingCapture?.speciesName ??
      this.state.pendingEncounter?.enemyTeam[0]?.speciesName;
    this.addEvent("capture_skipped", `${name ?? "Encounter"} was skipped.`);
    this.advanceWave();
  }

  private restTeam(): void {
    if (this.state.phase !== "ready") {
      this.addEvent("rest_ignored", "Team rest is only available before an encounter.");
      return;
    }

    if (this.state.money < this.balance.teamRestCost) {
      this.addEvent("rest_denied", "Not enough money for team rest.");
      return;
    }

    this.state.money -= this.balance.teamRestCost;
    this.state.team = healTeam(this.state.team);
    this.addEvent("team_rested", "Team fully restored.", {
      cost: this.balance.teamRestCost,
    });
  }

  private buyBall(ball: BallType, quantity: number): void {
    if (this.state.phase !== "ready") {
      this.addEvent("buy_ignored", "Balls can only be bought before an encounter.");
      return;
    }

    const cost = ball === "greatBall" ? this.balance.greatBallCost : this.balance.pokeBallCost;
    const affordableQuantity = Math.max(0, Math.min(quantity, Math.floor(this.state.money / cost)));

    if (affordableQuantity === 0) {
      this.addEvent("buy_denied", `Not enough money for ${ball}.`);
      return;
    }

    this.state.money -= affordableQuantity * cost;
    this.state.balls[ball] += affordableQuantity;
    this.addEvent("ball_bought", `Bought ${affordableQuantity} ${ball}.`, {
      ball,
      quantity: affordableQuantity,
      cost: affordableQuantity * cost,
    });
  }

  private prepareForEncounter(strategy: AutoPlayOptions["strategy"]): void {
    const healthRatio = getTeamHealthRatio(this.state.team);

    const hasFaintedMember = this.state.team.some((creature) => creature.currentHp <= 0);

    if ((healthRatio < 0.98 || hasFaintedMember) && this.state.money >= this.balance.teamRestCost) {
      this.restTeam();
    }

    if (strategy === "greedy" && this.state.balls.pokeBall <= 1) {
      this.buyBall("pokeBall", 2);
    }

    if (
      strategy === "greedy" &&
      this.state.currentWave >= 6 &&
      this.state.balls.greatBall === 0 &&
      this.state.money >= this.balance.greatBallCost
    ) {
      this.buyBall("greatBall", 1);
    }
  }

  private chooseBall(strategy: AutoPlayOptions["strategy"]): BallType | undefined {
    if (strategy === "conserveBalls" && this.state.currentWave < 4) {
      return undefined;
    }

    if (this.state.currentWave >= 7 && this.state.balls.greatBall > 0) {
      return "greatBall";
    }

    if (this.state.balls.pokeBall > 0) {
      return "pokeBall";
    }

    return this.state.balls.greatBall > 0 ? "greatBall" : undefined;
  }

  private advanceWave(): void {
    this.state.currentWave += 1;
    this.state.phase = "ready";
    this.state.pendingEncounter = undefined;
    this.state.pendingCapture = undefined;
  }

  private addEvent(type: string, message: string, data?: Record<string, unknown>): void {
    const event: GameEvent = {
      id: this.nextEventId,
      wave: this.state.currentWave,
      type,
      message,
      data,
    };
    this.nextEventId += 1;
    this.state.events = [...this.state.events, event].slice(-80);
  }

  private syncRngState(): void {
    this.state.rngState = this.rng.getState();
  }
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

export function cloneClientSnapshot(snapshot: HeadlessClientSnapshot): HeadlessClientSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as HeadlessClientSnapshot;
}

function assertValidClientSnapshot(snapshot: HeadlessClientSnapshot): void {
  if (snapshot.version !== 1) {
    throw new Error(`Unsupported headless snapshot version: ${snapshot.version}`);
  }

  if (snapshot.state.version !== 1) {
    throw new Error(`Unsupported game state version: ${snapshot.state.version}`);
  }

  if (!Number.isInteger(snapshot.frameId) || snapshot.frameId < 0) {
    throw new Error(`Invalid snapshot frame id: ${snapshot.frameId}`);
  }

  if (!Number.isInteger(snapshot.nextEventId) || snapshot.nextEventId < 1) {
    throw new Error(`Invalid snapshot next event id: ${snapshot.nextEventId}`);
  }

  if (!Number.isInteger(snapshot.state.rngState) || snapshot.state.rngState <= 0) {
    throw new Error(`Invalid snapshot RNG state: ${snapshot.state.rngState}`);
  }
}

function signature(state: GameState): string {
  return `${state.phase}:${state.currentWave}:${state.money}:${state.balls.pokeBall}:${state.balls.greatBall}:${state.events.length}`;
}
