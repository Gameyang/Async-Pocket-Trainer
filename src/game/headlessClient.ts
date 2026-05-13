import { runAutoBattle } from "./battle/battleEngine";
import { attemptCapture } from "./capture/captureSystem";
import { createCreature, healTeam } from "./creatureFactory";
import { defaultBalance, starterSpeciesIds } from "./data/catalog";
import {
  DEFAULT_HEADLESS_TRAINER_NAME,
  formatWave,
  localizeBall,
  localizeWinner,
  withJosa,
} from "./localization";
import { SeededRng } from "./rng";
import { chooseReplacementIndex, getTeamHealthRatio, scoreTeam } from "./scoring";
import { createGameFrame, type GameFrame } from "./view/frame";
import {
  calculateReward,
  calculateRestCost,
  createEncounter,
  createTrainerEncounterFromSnapshot,
  replaceTeamAfterCapture,
} from "./wave/waveSystem";
import type { TrainerSnapshot } from "./sync/trainerSnapshot";
import type {
  AutoPlayOptions,
  BallType,
  EncounterSnapshot,
  GameAction,
  GameBalance,
  GameEvent,
  GameState,
  RouteId,
  RunSummary,
} from "./types";

export interface HeadlessClientOptions {
  seed?: string;
  trainerName?: string;
  balance?: Partial<GameBalance>;
  trainerSnapshots?: TrainerSnapshot[];
}

export interface HeadlessClientSnapshot {
  version: 1;
  frameId: number;
  nextEventId: number;
  balance: GameBalance;
  trainerSnapshots: TrainerSnapshot[];
  state: GameState;
}

export class HeadlessGameClient {
  private balance: GameBalance;
  private readonly rng: SeededRng;
  private trainerSnapshots: TrainerSnapshot[];
  private state: GameState;
  private nextEventId = 1;
  private frameId = 0;

  constructor(options: HeadlessClientOptions = {}) {
    const seed = options.seed ?? "apt-headless-default";
    this.balance = normalizeBalance(options.balance);
    this.rng = new SeededRng(seed);
    this.trainerSnapshots = (options.trainerSnapshots ?? []).map(cloneTrainerSnapshot);
    this.state = {
      version: 1,
      seed,
      rngState: this.rng.getState(),
      trainerName: options.trainerName ?? DEFAULT_HEADLESS_TRAINER_NAME,
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
      trainerSnapshots: snapshot.trainerSnapshots,
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
      trainerSnapshots: this.trainerSnapshots,
      state: this.state,
    });
  }

  loadSnapshot(snapshot: HeadlessClientSnapshot): GameState {
    assertValidClientSnapshot(snapshot);

    this.balance = normalizeBalance(snapshot.balance);
    this.trainerSnapshots = snapshot.trainerSnapshots.map(cloneTrainerSnapshot);
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

  addTrainerSnapshot(snapshot: TrainerSnapshot): void {
    this.trainerSnapshots = [...this.trainerSnapshots, cloneTrainerSnapshot(snapshot)];
  }

  dispatch(action: GameAction): GameState {
    switch (action.type) {
      case "START_RUN":
        this.startRun(action.starterSpeciesId, action.trainerName);
        break;
      case "SET_TRAINER_NAME":
        this.setTrainerName(action.trainerName);
        break;
      case "CHOOSE_ROUTE":
        this.chooseRoute(action.routeId);
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
      this.chooseRoute(this.chooseAutoRoute(strategy));
      this.resolveNextEncounter();
    } else if (this.state.phase === "captureDecision") {
      const ball = this.chooseBall(strategy);

      if (ball) {
        this.tryCapture(ball);
      } else {
        this.discardCapture();
      }
    } else if (this.state.phase === "teamDecision") {
      const replaceIndex = this.state.pendingCapture
        ? chooseReplacementIndex(this.state.team, this.state.pendingCapture, strategy)
        : undefined;
      this.acceptCapture(replaceIndex, { chooseReplacement: false });
    }

    this.syncRngState();
    this.frameId += 1;

    if (before === signature(this.state) && this.state.phase !== "gameOver") {
      this.addEvent("stalled", "자동 진행이 더 이상 진행되지 않았습니다.");
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
      this.addEvent("start_ignored", "이미 진행 중인 도전입니다.");
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
      selectedRoute: undefined,
      events: [],
    };
    this.nextEventId = 1;
    this.addEvent(
      "run_started",
      `${this.state.trainerName}님이 ${starter.speciesName}를 선택했습니다.`,
      {
        starterSpeciesId: starter.speciesId,
        starterPower: starter.powerScore,
      },
    );
  }

  private setTrainerName(trainerName: string): void {
    const normalized = trainerName.trim();

    if (!normalized) {
      this.addEvent("trainer_name_ignored", "팀 이름이 비어 있습니다.");
      return;
    }

    this.state.trainerName = normalized;
  }

  private chooseRoute(routeId: RouteId): void {
    if (this.state.phase !== "ready") {
      this.addEvent("route_ignored", "준비 상태에서만 길을 선택할 수 있습니다.");
      return;
    }

    if (routeId === "supply" && this.state.supplyUsedAtWave === this.state.currentWave) {
      this.addEvent("route_denied", "보급은 웨이브마다 한 번만 받을 수 있습니다.");
      return;
    }

    if (routeId === "supply" && this.state.money < this.balance.supplyRouteCost) {
      this.addEvent("route_denied", "보급에 필요한 코인이 부족합니다.");
      return;
    }

    this.state.selectedRoute = {
      id: routeId,
      wave: this.state.currentWave,
    };
    this.addEvent("route_chosen", `선택한 길: ${routeName(routeId)}.`, {
      routeId,
    });
  }

  private resolveNextEncounter(): void {
    if (this.state.phase !== "ready") {
      this.addEvent("encounter_ignored", "준비 상태에서만 다음 만남을 시작할 수 있습니다.");
      return;
    }

    const routeId = this.consumeSelectedRoute();

    if (routeId === "supply") {
      this.resolveSupplyRoute();
      return;
    }

    const encounter = this.createEncounter(routeId);
    const battle = {
      ...runAutoBattle({
        kind: encounter.kind,
        playerTeam: this.state.team,
        enemyTeam: encounter.enemyTeam,
        rng: this.rng,
        damageScale: this.balance.battleDamageScale,
      }),
      encounterSource: encounter.source,
      encounterRoute: encounter.routeId,
      opponentName: encounter.opponentName,
    };

    this.state.team = battle.playerTeam;
    this.state.pendingEncounter = encounter;
    this.state.lastBattle = battle;
    const reward = calculateReward(this.state.currentWave, encounter.kind, this.balance, routeId);

    this.addEvent(
      "battle_resolved",
      `${withJosa(encounter.opponentName, "와/과")}의 전투에서 ${localizeWinner(battle.winner)}했습니다.`,
      {
        kind: encounter.kind,
        routeId,
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
      this.state.gameOverReason = `${formatWave(this.state.currentWave)}에서 ${encounter.opponentName}에게 패배했습니다.`;
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
      this.addEvent("capture_ignored", "포획을 선택할 대상이 없습니다.");
      return;
    }

    if (this.state.balls[ball] <= 0) {
      this.addEvent("capture_no_ball", `${localizeBall(ball)}이 없습니다.`);
      return;
    }

    this.state.balls[ball] -= 1;

    const target = this.state.pendingEncounter.enemyTeam[0];
    const routeId = this.state.pendingEncounter.routeId ?? "normal";
    const result = attemptCapture(target, this.state.currentWave, ball, this.rng, {
      hpRatioFloor: this.balance.defeatedCaptureHpRatioFloor,
      chanceBonus: routeId === "elite" ? this.balance.eliteCaptureChanceBonus : 0,
    });

    this.addEvent(
      "capture_attempted",
      `${localizeBall(ball)} 포획에 ${result.success ? "성공" : "실패"}했습니다.`,
      {
        ball,
        chance: Number(result.chance.toFixed(4)),
        success: result.success,
        target: target.speciesName,
        routeId,
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

  private acceptCapture(
    replaceIndex?: number,
    options: { chooseReplacement?: boolean } = {},
  ): void {
    if (this.state.phase !== "teamDecision" || !this.state.pendingCapture) {
      this.addEvent("team_decision_ignored", "편성할 포획 대상이 없습니다.");
      return;
    }

    const captured = this.state.pendingCapture;
    const resolvedIndex =
      replaceIndex ??
      (options.chooseReplacement === false
        ? undefined
        : chooseReplacementIndex(this.state.team, captured));
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
        ? `${captured.speciesName}가 팀에 합류했습니다.`
        : `${captured.speciesName}를 비교 후 놓아주었습니다.`,
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
      this.addEvent("discard_ignored", "지금은 포획 대상을 보낼 수 없습니다.");
      return;
    }

    const name =
      this.state.pendingCapture?.speciesName ??
      this.state.pendingEncounter?.enemyTeam[0]?.speciesName;
    this.addEvent("capture_skipped", `보낸 만남: ${name ?? "만남"}.`);
    this.advanceWave();
  }

  private restTeam(): void {
    if (this.state.phase !== "ready") {
      this.addEvent("rest_ignored", "휴식은 다음 만남 전 준비 상태에서만 가능합니다.");
      return;
    }

    const cost = calculateRestCost(this.state.currentWave, this.balance);

    if (this.state.money < cost) {
      this.addEvent("rest_denied", "팀 휴식에 필요한 코인이 부족합니다.");
      return;
    }

    this.state.money -= cost;
    this.state.team = healTeam(this.state.team);
    this.addEvent("team_rested", "팀의 HP가 모두 회복되었습니다.", {
      cost,
    });
  }

  private buyBall(ball: BallType, quantity: number): void {
    if (this.state.phase !== "ready") {
      this.addEvent("buy_ignored", "볼은 다음 만남 전 준비 상태에서만 살 수 있습니다.");
      return;
    }

    const cost = ball === "greatBall" ? this.balance.greatBallCost : this.balance.pokeBallCost;
    const affordableQuantity = Math.max(0, Math.min(quantity, Math.floor(this.state.money / cost)));

    if (affordableQuantity === 0) {
      this.addEvent("buy_denied", `${localizeBall(ball)} 구입에 필요한 코인이 부족합니다.`);
      return;
    }

    this.state.money -= affordableQuantity * cost;
    this.state.balls[ball] += affordableQuantity;
    this.addEvent("ball_bought", `${localizeBall(ball)} ${affordableQuantity}개를 샀습니다.`, {
      ball,
      quantity: affordableQuantity,
      cost: affordableQuantity * cost,
    });
  }

  private prepareForEncounter(strategy: AutoPlayOptions["strategy"]): void {
    const healthRatio = getTeamHealthRatio(this.state.team);
    const hasFaintedMember = this.state.team.some((creature) => creature.currentHp <= 0);
    const restCost = calculateRestCost(this.state.currentWave, this.balance);

    if ((healthRatio < 0.98 || hasFaintedMember) && this.state.money >= restCost) {
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

  private chooseAutoRoute(strategy: AutoPlayOptions["strategy"]): RouteId {
    const healthRatio = getTeamHealthRatio(this.state.team);
    const hasFaintedMember = this.state.team.some((creature) => creature.currentHp <= 0);
    const totalBalls = this.state.balls.pokeBall + this.state.balls.greatBall;
    const restCost = calculateRestCost(this.state.currentWave, this.balance);
    const isCheckpoint = this.state.currentWave % this.balance.checkpointInterval === 0;

    if (strategy === "conserveBalls") {
      return (healthRatio < 0.5 || hasFaintedMember) &&
        this.state.supplyUsedAtWave !== this.state.currentWave &&
        this.state.money >= this.balance.supplyRouteCost
        ? "supply"
        : "normal";
    }

    if (
      healthRatio >= 0.9 &&
      !hasFaintedMember &&
      totalBalls >= 4 &&
      this.state.money >= restCost &&
      !isCheckpoint
    ) {
      return "elite";
    }

    return "normal";
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

  private createEncounter(routeId: RouteId): EncounterSnapshot {
    const snapshot = this.pickTrainerSnapshot(this.state.currentWave);

    if (snapshot) {
      return createTrainerEncounterFromSnapshot(snapshot, this.balance, routeId);
    }

    return createEncounter(this.state.currentWave, this.rng, this.balance, routeId);
  }

  private resolveSupplyRoute(): void {
    if (this.state.supplyUsedAtWave === this.state.currentWave) {
      this.addEvent("supply_denied", "보급은 웨이브마다 한 번만 받을 수 있습니다.");
      return;
    }

    if (this.state.money < this.balance.supplyRouteCost) {
      this.addEvent("supply_denied", "보급에 필요한 코인이 부족합니다.");
      return;
    }

    const beforeHp = totalCurrentHp(this.state.team);
    this.state.money -= this.balance.supplyRouteCost;
    this.state.supplyUsedAtWave = this.state.currentWave;
    this.state.team = this.state.team.map((creature) => {
      const triageHp = Math.ceil(creature.stats.hp * 0.5);

      return {
        ...creature,
        currentHp: Math.min(creature.stats.hp, Math.max(creature.currentHp, triageHp)),
      };
    });
    const healedHp = totalCurrentHp(this.state.team) - beforeHp;
    this.state.phase = "ready";
    this.state.pendingEncounter = undefined;
    this.state.pendingCapture = undefined;
    this.addEvent(
      "supply_resolved",
      healedHp > 0
        ? `보급로에서 팀을 응급 처치했습니다. 회복량: ${healedHp} HP.`
        : "보급로를 확인했습니다. 팀은 이미 충분히 버틸 수 있습니다.",
      {
        healedHp,
        cost: this.balance.supplyRouteCost,
      },
    );
  }

  private consumeSelectedRoute(): RouteId {
    const selectedRouteId =
      this.state.selectedRoute?.wave === this.state.currentWave
        ? this.state.selectedRoute.id
        : undefined;
    const routeId =
      selectedRouteId === "elite" || selectedRouteId === "supply" ? selectedRouteId : "normal";
    this.state.selectedRoute = undefined;
    return routeId;
  }

  private pickTrainerSnapshot(wave: number): TrainerSnapshot | undefined {
    if (wave % this.balance.checkpointInterval !== 0) {
      return undefined;
    }

    const candidates = this.trainerSnapshots.filter((snapshot) => snapshot.wave === wave);

    return candidates.length > 0 ? this.rng.pick(candidates) : undefined;
  }

  private advanceWave(): void {
    this.state.currentWave += 1;
    this.state.phase = "ready";
    this.state.selectedRoute = undefined;
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

function cloneTrainerSnapshot(snapshot: TrainerSnapshot): TrainerSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as TrainerSnapshot;
}

function normalizeBalance(balance?: Partial<GameBalance>): GameBalance {
  return { ...defaultBalance, ...balance };
}

function totalCurrentHp(team: GameState["team"]): number {
  return team.reduce((total, creature) => total + Math.max(0, creature.currentHp), 0);
}

function routeName(routeId: RouteId): string {
  switch (routeId) {
    case "normal":
      return "일반로";
    case "elite":
      return "정예로";
    case "supply":
      return "보급로";
  }
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

  if (!Array.isArray(snapshot.trainerSnapshots)) {
    throw new Error("Headless snapshot trainerSnapshots must be an array.");
  }
}

function signature(state: GameState): string {
  return `${state.phase}:${state.currentWave}:${state.money}:${state.balls.pokeBall}:${state.balls.greatBall}:${state.events.length}`;
}
