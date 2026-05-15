import { createBrowserGameRuntime, createMemoryStorage } from "../../browser/gameRuntime";
import { CODE_SYNC_SETTINGS } from "../../browser/syncSettings";
import type { HeadlessGameClient } from "../headlessClient";
import { SeededRng } from "../rng";
import { getTeamHealthRatio, scoreTeam } from "../scoring";
import {
  createTrainerSnapshot,
  isCheckpointWave,
  parseSheetTrainerRow,
  serializeTrainerSnapshot,
} from "../sync/trainerSnapshot";
import { ballTypes } from "../types";
import type { AutoPlayStrategy, GameEvent, GamePhase, GameState, RunSummary } from "../types";
import { validateFrameContract } from "../view/frame";
import type { FrameAction, GameFrame } from "../view/frame";
import type { RenderlessActionTraceEntry, RenderlessTerminalReason } from "./renderlessPlayer";
import { playRenderlessGame } from "./renderlessPlayer";

export interface HeadlessQaOptions {
  seed: string;
  runs: number;
  waves: number;
  strategy: AutoPlayStrategy;
  targets?: HeadlessQaTargets;
}

export interface HeadlessQaTargets {
  minAverageFinalWave?: number;
  minCompletedTargetWave?: number;
  maxGameOvers?: number;
}

export interface HeadlessQaTargetResult {
  passed: boolean;
  failures: string[];
  minAverageFinalWave?: {
    target: number;
    actual: number;
    passed: boolean;
  };
  minCompletedTargetWave?: {
    target: number;
    actual: number;
    passed: boolean;
  };
  maxGameOvers?: {
    target: number;
    actual: number;
    passed: boolean;
  };
}

export interface HeadlessRunReport extends RunSummary {
  invariantErrors: string[];
  healthRatio: number;
  terminalReason: RenderlessTerminalReason;
  steps: number;
  actionTrace: RenderlessActionTraceEntry[];
}

export interface HeadlessQaReport {
  options: HeadlessQaOptions;
  aggregate: {
    runs: number;
    completedTargetWave: number;
    gameOvers: number;
    averageFinalWave: number;
    averageTeamPower: number;
    averageHealthRatio: number;
  };
  targetResult?: HeadlessQaTargetResult;
  invariantErrors: string[];
  waveBalance: WaveBalanceReport[];
  shopEconomy: ShopEconomyReport;
  runs: HeadlessRunReport[];
}

export type ShopEconomyCategory =
  | "recovery"
  | "capture"
  | "encounter"
  | "teamUpgrade"
  | "reroll"
  | "premium"
  | "portrait"
  | "other";

export interface ShopEconomyReport {
  aggregate: {
    readyFrames: number;
    averageMoneyAtShop: number;
    coinOfferSamples: number;
    coinOfferMoneyAffordableRate: number;
    coinOfferEnabledRate: number;
    averageCheapestCoinOffer: number;
    totalCoinEarned: number;
    totalStartingCoin: number;
    totalCoinAvailable: number;
    totalCoinSpent: number;
    netCoin: number;
    spendToIncomeRatio: number;
    spendToAvailableCoinRatio: number;
    coinPurchases: number;
    premiumPurchases: number;
    totalTrainerPointsSpent: number;
    averageCoinEarnedPerRun: number;
    averageCoinSpentPerRun: number;
  };
  categories: ShopEconomyCategoryReport[];
  waves: ShopEconomyWaveReport[];
}

export interface ShopEconomyCategoryReport {
  category: ShopEconomyCategory;
  offerSamples: number;
  purchases: number;
  spend: number;
  trainerPointsSpend: number;
  averageCost: number;
  averageMoneyAtOffer: number;
  moneyAffordableRate: number;
  enabledRate: number;
  moneyBlockedRate: number;
}

export interface ShopEconomyWaveReport {
  wave: number;
  readyFrames: number;
  averageMoneyAtShop: number;
  coinOfferSamples: number;
  moneyAffordableRate: number;
  coinEarned: number;
  coinSpent: number;
  netCoin: number;
  purchases: number;
}

export interface WaveBalanceReport {
  wave: number;
  samples: number;
  battleResults: number;
  battleWins: number;
  battleLosses: number;
  deaths: number;
  captureAttempts: number;
  captureSuccesses: number;
  captureSuccessRate: number;
  captureKeeps: number;
  captureReleases: number;
  rests: number;
  ballPurchases: number;
  averageTeamPower: number;
  teamPowerDistribution: NumericDistribution;
  averageHealthRatio: number;
  averageTeamSize: number;
  topGameOverReasons: Array<{
    reason: string;
    count: number;
  }>;
}

export interface NumericDistribution {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

interface MutableWaveBalance {
  wave: number;
  samples: number;
  teamPowerTotal: number;
  teamPowers: number[];
  healthRatioTotal: number;
  teamSizeTotal: number;
  battleResults: number;
  battleWins: number;
  battleLosses: number;
  deaths: number;
  captureAttempts: number;
  captureSuccesses: number;
  captureKeeps: number;
  captureReleases: number;
  rests: number;
  ballPurchases: number;
  gameOverReasons: Map<string, number>;
}

interface MutableShopEconomy {
  readyFrames: number;
  moneyAtShopTotal: number;
  coinOfferSamples: number;
  coinOfferMoneyAffordableSamples: number;
  coinOfferEnabledSamples: number;
  cheapestCoinOfferSamples: number;
  cheapestCoinOfferTotal: number;
  totalCoinEarned: number;
  totalStartingCoin: number;
  totalCoinSpent: number;
  totalTrainerPointsSpent: number;
  coinPurchases: number;
  premiumPurchases: number;
  categories: Map<ShopEconomyCategory, MutableShopEconomyCategory>;
  waves: Map<number, MutableShopEconomyWave>;
}

interface MutableShopEconomyCategory {
  category: ShopEconomyCategory;
  offerSamples: number;
  purchases: number;
  spend: number;
  trainerPointsSpend: number;
  costTotal: number;
  moneyAtOfferTotal: number;
  moneyAffordableSamples: number;
  enabledSamples: number;
  moneyBlockedSamples: number;
}

interface MutableShopEconomyWave {
  wave: number;
  readyFrames: number;
  moneyAtShopTotal: number;
  coinOfferSamples: number;
  coinOfferMoneyAffordableSamples: number;
  coinEarned: number;
  coinSpent: number;
  purchases: number;
}

const validPhases: GamePhase[] = [
  "starterChoice",
  "ready",
  "captureDecision",
  "teamDecision",
  "gameOver",
];

export async function runHeadlessQa(options: HeadlessQaOptions): Promise<HeadlessQaReport> {
  const runs: HeadlessRunReport[] = [];
  const waveBalance = new Map<number, MutableWaveBalance>();
  const shopEconomy = createMutableShopEconomy();

  for (let index = 0; index < options.runs; index += 1) {
    const controllerRng = new SeededRng(`${options.seed}:${index}:controller`);
    const runtime = createBrowserGameRuntime({
      storage: createMemoryStorage(),
      seed: `${options.seed}:${index}`,
      trainerName: `QA-${index + 1}`,
      playerId: `qa-${index + 1}`,
      syncSettings: {
        ...CODE_SYNC_SETTINGS,
        enabled: false,
      },
      now: () => "2026-05-12T00:00:00.000Z",
      random: () => controllerRng.nextFloat(),
      prefetchNextCheckpoint: false,
    });
    const client = runtime.client;
    shopEconomy.totalStartingCoin += client.getBalance().startingMoney;
    const errors: string[] = [];
    const seenEventIds = new Set<number>();
    const seenCheckpointWaves = new Set<number>();
    let snapshot = runtime.getSnapshot();
    recordWaveSnapshot(snapshot, seenEventIds, waveBalance, shopEconomy);
    errors.push(
      ...validateCheckpointSnapshot(client, snapshot, seenCheckpointWaves).map(
        (error) => `initial checkpoint: ${error}`,
      ),
    );

    const playResult = await playRenderlessGame(runtime, {
      maxWaves: options.waves,
      strategy: options.strategy,
      rng: controllerRng,
      onFrame(step, frame, state) {
        recordShopFrame(frame, state, shopEconomy);
        errors.push(...validateState(state).map((error) => `step ${step}: ${error}`));
        errors.push(...validateFrameContract(frame).map((error) => `step ${step} frame: ${error}`));
      },
      onAction(_step, frame, action, before, after) {
        recordShopAction(frame, action, before, after, shopEconomy);
      },
      onState(step, state) {
        snapshot = state;
        recordWaveSnapshot(snapshot, seenEventIds, waveBalance, shopEconomy);
        errors.push(
          ...validateCheckpointSnapshot(client, snapshot, seenCheckpointWaves).map(
            (error) => `step ${step} checkpoint: ${error}`,
          ),
        );
      },
    });
    snapshot = playResult.state;

    if (
      playResult.terminalReason === "noEnabledAction" ||
      playResult.terminalReason === "noDispatchablePayload" ||
      playResult.terminalReason === "maxSteps"
    ) {
      errors.push(`terminal: ${playResult.terminalReason}`);
    }

    errors.push(...validateState(snapshot).map((error) => `final: ${error}`));
    errors.push(
      ...validateFrameContract(runtime.getFrame()).map((error) => `final frame: ${error}`),
    );

    runs.push({
      ...client.getRunSummary(),
      invariantErrors: errors,
      healthRatio: Number(getTeamHealthRatio(snapshot.team).toFixed(4)),
      terminalReason: playResult.terminalReason,
      steps: playResult.steps,
      actionTrace: playResult.actionTrace.slice(-12),
    });
  }

  const invariantErrors = runs.flatMap((run) =>
    run.invariantErrors.map((error) => `${run.seed}: ${error}`),
  );
  const completedTargetWave = runs.filter((run) => run.finalWave > options.waves).length;
  const gameOvers = runs.filter((run) => run.phase === "gameOver").length;
  const aggregate = {
    runs: options.runs,
    completedTargetWave,
    gameOvers,
    averageFinalWave: average(runs.map((run) => run.finalWave)),
    averageTeamPower: average(runs.map((run) => run.teamPower)),
    averageHealthRatio: average(runs.map((run) => run.healthRatio)),
  };

  return {
    options,
    aggregate,
    targetResult: evaluateTargets(options.targets, aggregate),
    invariantErrors,
    waveBalance: toWaveBalanceReport(waveBalance),
    shopEconomy: toShopEconomyReport(shopEconomy, options.runs),
    runs,
  };
}

function evaluateTargets(
  targets: HeadlessQaTargets | undefined,
  aggregate: HeadlessQaReport["aggregate"],
): HeadlessQaTargetResult | undefined {
  if (!targets) {
    return undefined;
  }

  const result: HeadlessQaTargetResult = {
    passed: true,
    failures: [],
  };

  if (targets.minAverageFinalWave !== undefined) {
    const passed = aggregate.averageFinalWave >= targets.minAverageFinalWave;
    result.minAverageFinalWave = {
      target: targets.minAverageFinalWave,
      actual: aggregate.averageFinalWave,
      passed,
    };
    recordTargetResult(
      result,
      passed,
      `averageFinalWave ${aggregate.averageFinalWave} is below ${targets.minAverageFinalWave}`,
    );
  }

  if (targets.minCompletedTargetWave !== undefined) {
    const passed = aggregate.completedTargetWave >= targets.minCompletedTargetWave;
    result.minCompletedTargetWave = {
      target: targets.minCompletedTargetWave,
      actual: aggregate.completedTargetWave,
      passed,
    };
    recordTargetResult(
      result,
      passed,
      `completedTargetWave ${aggregate.completedTargetWave} is below ${targets.minCompletedTargetWave}`,
    );
  }

  if (targets.maxGameOvers !== undefined) {
    const passed = aggregate.gameOvers <= targets.maxGameOvers;
    result.maxGameOvers = {
      target: targets.maxGameOvers,
      actual: aggregate.gameOvers,
      passed,
    };
    recordTargetResult(
      result,
      passed,
      `gameOvers ${aggregate.gameOvers} is above ${targets.maxGameOvers}`,
    );
  }

  return result;
}

function recordTargetResult(
  result: HeadlessQaTargetResult,
  passed: boolean,
  failure: string,
): void {
  if (passed) {
    return;
  }

  result.passed = false;
  result.failures.push(failure);
}

export function validateState(state: GameState): string[] {
  const errors: string[] = [];

  if (state.version !== 1) {
    errors.push(`unsupported state version ${state.version}`);
  }

  if (!validPhases.includes(state.phase)) {
    errors.push(`invalid phase ${state.phase}`);
  }

  if (!Number.isInteger(state.currentWave) || state.currentWave < 1) {
    errors.push(`invalid currentWave ${state.currentWave}`);
  }

  if (state.money < 0) {
    errors.push(`money is negative: ${state.money}`);
  }

  for (const ball of ballTypes) {
    if (!Number.isInteger(state.balls[ball]) || state.balls[ball] < 0) {
      errors.push(`${ball} count is invalid: ${state.balls[ball]}`);
    }
  }

  if (state.phase !== "starterChoice" && state.team.length < 1) {
    errors.push("active run has no team");
  }

  if (state.team.length > 6) {
    errors.push(`team has too many members: ${state.team.length}`);
  }

  for (const creature of state.team) {
    if (creature.currentHp < 0 || creature.currentHp > creature.stats.hp) {
      errors.push(
        `${creature.speciesName} hp out of range: ${creature.currentHp}/${creature.stats.hp}`,
      );
    }

    if (creature.moves.length !== 2) {
      errors.push(`${creature.speciesName} has invalid move count: ${creature.moves.length}`);
    }
  }

  if (state.phase === "captureDecision" && !state.pendingEncounter) {
    errors.push("captureDecision phase has no pending encounter");
  }

  if (state.phase === "teamDecision" && !state.pendingCapture) {
    errors.push("teamDecision phase has no pending capture");
  }

  if (state.phase === "gameOver" && !state.gameOverReason) {
    errors.push("gameOver phase has no reason");
  }

  if (scoreTeam(state.team) < 0) {
    errors.push("team power cannot be negative");
  }

  return errors;
}

function validateCheckpointSnapshot(
  client: HeadlessGameClient,
  state: GameState,
  seenCheckpointWaves: Set<number>,
): string[] {
  if (
    state.phase !== "ready" ||
    seenCheckpointWaves.has(state.currentWave) ||
    !isCheckpointWave(state.currentWave, client.getBalance().checkpointInterval)
  ) {
    return [];
  }

  seenCheckpointWaves.add(state.currentWave);

  try {
    const snapshot = createTrainerSnapshot(state, {
      playerId: `qa-${state.seed}`,
      createdAt: "2026-05-12T00:00:00.000Z",
      runSummary: client.getRunSummary(),
    });
    const row = serializeTrainerSnapshot(snapshot);
    const parsed = parseSheetTrainerRow(row);

    if (JSON.stringify(parsed) !== JSON.stringify(snapshot)) {
      return [`checkpoint snapshot round-trip changed at wave ${state.currentWave}`];
    }

    return [];
  } catch (error) {
    return [
      `checkpoint snapshot failed at wave ${state.currentWave}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}

function ratio(numerator: number, denominator: number, precision = 4): number {
  if (denominator === 0) {
    return 0;
  }

  return Number((numerator / denominator).toFixed(precision));
}

function recordWaveSnapshot(
  state: GameState,
  seenEventIds: Set<number>,
  waveBalance: Map<number, MutableWaveBalance>,
  shopEconomy: MutableShopEconomy,
): void {
  if (state.phase !== "starterChoice") {
    const bucket = getWaveBucket(waveBalance, state.currentWave);
    bucket.samples += 1;
    const teamPower = scoreTeam(state.team);
    bucket.teamPowerTotal += teamPower;
    bucket.teamPowers.push(teamPower);
    bucket.healthRatioTotal += getTeamHealthRatio(state.team);
    bucket.teamSizeTotal += state.team.length;
  }

  for (const event of state.events) {
    if (seenEventIds.has(event.id)) {
      continue;
    }

    seenEventIds.add(event.id);
    recordWaveEvent(event, getWaveBucket(waveBalance, event.wave));
    recordShopEconomyEvent(event, shopEconomy);
  }
}

function recordWaveEvent(event: GameEvent, bucket: MutableWaveBalance): void {
  if (event.type === "battle_resolved") {
    bucket.battleResults += 1;

    if (event.data?.winner === "player") {
      bucket.battleWins += 1;
    } else if (event.data?.winner === "enemy") {
      bucket.battleLosses += 1;
    }
  }

  if (event.type === "game_over") {
    bucket.deaths += 1;
    bucket.gameOverReasons.set(event.message, (bucket.gameOverReasons.get(event.message) ?? 0) + 1);
  }

  if (event.type === "capture_attempted") {
    bucket.captureAttempts += 1;

    if (event.data?.success === true) {
      bucket.captureSuccesses += 1;
    }
  }

  if (event.type === "capture_kept") {
    bucket.captureKeeps += 1;
  }

  if (event.type === "capture_released") {
    bucket.captureReleases += 1;
  }

  if (event.type === "team_rested") {
    bucket.rests += 1;
  }

  if (event.type === "ball_bought") {
    bucket.ballPurchases += 1;
  }
}

function createMutableShopEconomy(): MutableShopEconomy {
  return {
    readyFrames: 0,
    moneyAtShopTotal: 0,
    coinOfferSamples: 0,
    coinOfferMoneyAffordableSamples: 0,
    coinOfferEnabledSamples: 0,
    cheapestCoinOfferSamples: 0,
    cheapestCoinOfferTotal: 0,
    totalCoinEarned: 0,
    totalStartingCoin: 0,
    totalCoinSpent: 0,
    totalTrainerPointsSpent: 0,
    coinPurchases: 0,
    premiumPurchases: 0,
    categories: new Map(),
    waves: new Map(),
  };
}

function recordShopFrame(
  frame: GameFrame,
  state: GameState,
  economy: MutableShopEconomy,
): void {
  if (frame.phase !== "ready") {
    return;
  }

  const money = state.money;
  const wave = getShopEconomyWave(economy, frame.hud.wave);
  economy.readyFrames += 1;
  economy.moneyAtShopTotal += money;
  wave.readyFrames += 1;
  wave.moneyAtShopTotal += money;

  const coinActions = frame.actions.filter(
    (action) => action.id.startsWith("shop:") && action.cost !== undefined,
  );

  if (coinActions.length > 0) {
    const cheapest = Math.min(...coinActions.map((action) => action.cost ?? 0));
    economy.cheapestCoinOfferSamples += 1;
    economy.cheapestCoinOfferTotal += cheapest;
  }

  for (const action of coinActions) {
    const cost = action.cost ?? 0;
    const category = getShopEconomyCategory(action.id);
    const bucket = getShopEconomyCategoryBucket(economy, category);
    const affordableByMoney = money >= cost;

    economy.coinOfferSamples += 1;
    wave.coinOfferSamples += 1;
    bucket.offerSamples += 1;
    bucket.costTotal += cost;
    bucket.moneyAtOfferTotal += money;

    if (affordableByMoney) {
      economy.coinOfferMoneyAffordableSamples += 1;
      wave.coinOfferMoneyAffordableSamples += 1;
      bucket.moneyAffordableSamples += 1;
    } else {
      bucket.moneyBlockedSamples += 1;
    }

    if (action.enabled) {
      economy.coinOfferEnabledSamples += 1;
      bucket.enabledSamples += 1;
    }
  }
}

function recordShopAction(
  frame: GameFrame,
  action: FrameAction,
  before: GameState,
  after: GameState,
  economy: MutableShopEconomy,
): void {
  if (frame.phase !== "ready" || !action.id.startsWith("shop:")) {
    return;
  }

  const coinSpent = Math.max(0, before.money - after.money);
  const trainerPointsSpent = Math.max(
    0,
    (before.metaCurrency?.trainerPoints ?? 0) - (after.metaCurrency?.trainerPoints ?? 0),
  );

  if (coinSpent <= 0 && trainerPointsSpent <= 0) {
    return;
  }

  const category = getShopEconomyCategory(action.id);
  const categoryBucket = getShopEconomyCategoryBucket(economy, category);
  const wave = getShopEconomyWave(economy, frame.hud.wave);

  categoryBucket.purchases += 1;
  wave.purchases += 1;

  if (coinSpent > 0) {
    economy.totalCoinSpent += coinSpent;
    economy.coinPurchases += 1;
    categoryBucket.spend += coinSpent;
    wave.coinSpent += coinSpent;
  }

  if (trainerPointsSpent > 0) {
    economy.totalTrainerPointsSpent += trainerPointsSpent;
    economy.premiumPurchases += 1;
    categoryBucket.trainerPointsSpend += trainerPointsSpent;
  }
}

function recordShopEconomyEvent(event: GameEvent, economy: MutableShopEconomy): void {
  if (event.type !== "battle_resolved") {
    return;
  }

  const reward = readEventNumber(event, "reward");
  if (reward <= 0) {
    return;
  }

  economy.totalCoinEarned += reward;
  getShopEconomyWave(economy, event.wave).coinEarned += reward;
}

function readEventNumber(event: GameEvent, key: string): number {
  const value = event.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toShopEconomyReport(
  economy: MutableShopEconomy,
  runs: number,
): ShopEconomyReport {
  const totalCoinAvailable = economy.totalStartingCoin + economy.totalCoinEarned;

  return {
    aggregate: {
      readyFrames: economy.readyFrames,
      averageMoneyAtShop: averageFromTotal(economy.moneyAtShopTotal, economy.readyFrames),
      coinOfferSamples: economy.coinOfferSamples,
      coinOfferMoneyAffordableRate: ratio(
        economy.coinOfferMoneyAffordableSamples,
        economy.coinOfferSamples,
      ),
      coinOfferEnabledRate: ratio(economy.coinOfferEnabledSamples, economy.coinOfferSamples),
      averageCheapestCoinOffer: averageFromTotal(
        economy.cheapestCoinOfferTotal,
        economy.cheapestCoinOfferSamples,
      ),
      totalCoinEarned: economy.totalCoinEarned,
      totalStartingCoin: economy.totalStartingCoin,
      totalCoinAvailable,
      totalCoinSpent: economy.totalCoinSpent,
      netCoin: economy.totalCoinEarned - economy.totalCoinSpent,
      spendToIncomeRatio: ratio(economy.totalCoinSpent, economy.totalCoinEarned),
      spendToAvailableCoinRatio: ratio(economy.totalCoinSpent, totalCoinAvailable),
      coinPurchases: economy.coinPurchases,
      premiumPurchases: economy.premiumPurchases,
      totalTrainerPointsSpent: economy.totalTrainerPointsSpent,
      averageCoinEarnedPerRun: averageFromTotal(economy.totalCoinEarned, runs),
      averageCoinSpentPerRun: averageFromTotal(economy.totalCoinSpent, runs),
    },
    categories: [...economy.categories.values()]
      .sort((left, right) => categorySortIndex(left.category) - categorySortIndex(right.category))
      .map(toShopEconomyCategoryReport),
    waves: [...economy.waves.values()]
      .sort((left, right) => left.wave - right.wave)
      .map(toShopEconomyWaveReport),
  };
}

function toShopEconomyCategoryReport(
  bucket: MutableShopEconomyCategory,
): ShopEconomyCategoryReport {
  return {
    category: bucket.category,
    offerSamples: bucket.offerSamples,
    purchases: bucket.purchases,
    spend: bucket.spend,
    trainerPointsSpend: bucket.trainerPointsSpend,
    averageCost: averageFromTotal(bucket.costTotal, bucket.offerSamples),
    averageMoneyAtOffer: averageFromTotal(bucket.moneyAtOfferTotal, bucket.offerSamples),
    moneyAffordableRate: ratio(bucket.moneyAffordableSamples, bucket.offerSamples),
    enabledRate: ratio(bucket.enabledSamples, bucket.offerSamples),
    moneyBlockedRate: ratio(bucket.moneyBlockedSamples, bucket.offerSamples),
  };
}

function toShopEconomyWaveReport(bucket: MutableShopEconomyWave): ShopEconomyWaveReport {
  return {
    wave: bucket.wave,
    readyFrames: bucket.readyFrames,
    averageMoneyAtShop: averageFromTotal(bucket.moneyAtShopTotal, bucket.readyFrames),
    coinOfferSamples: bucket.coinOfferSamples,
    moneyAffordableRate: ratio(bucket.coinOfferMoneyAffordableSamples, bucket.coinOfferSamples),
    coinEarned: bucket.coinEarned,
    coinSpent: bucket.coinSpent,
    netCoin: bucket.coinEarned - bucket.coinSpent,
    purchases: bucket.purchases,
  };
}

function getShopEconomyCategoryBucket(
  economy: MutableShopEconomy,
  category: ShopEconomyCategory,
): MutableShopEconomyCategory {
  const existing = economy.categories.get(category);
  if (existing) {
    return existing;
  }

  const created: MutableShopEconomyCategory = {
    category,
    offerSamples: 0,
    purchases: 0,
    spend: 0,
    trainerPointsSpend: 0,
    costTotal: 0,
    moneyAtOfferTotal: 0,
    moneyAffordableSamples: 0,
    enabledSamples: 0,
    moneyBlockedSamples: 0,
  };
  economy.categories.set(category, created);
  return created;
}

function getShopEconomyWave(
  economy: MutableShopEconomy,
  wave: number,
): MutableShopEconomyWave {
  const existing = economy.waves.get(wave);
  if (existing) {
    return existing;
  }

  const created: MutableShopEconomyWave = {
    wave,
    readyFrames: 0,
    moneyAtShopTotal: 0,
    coinOfferSamples: 0,
    coinOfferMoneyAffordableSamples: 0,
    coinEarned: 0,
    coinSpent: 0,
    purchases: 0,
  };
  economy.waves.set(wave, created);
  return created;
}

function getShopEconomyCategory(actionId: string): ShopEconomyCategory {
  if (actionId === "shop:rest" || actionId.startsWith("shop:heal:")) {
    return "recovery";
  }

  if (
    actionId === "shop:pokeball" ||
    actionId === "shop:greatball" ||
    actionId === "shop:ultraball" ||
    actionId === "shop:hyperball" ||
    actionId === "shop:masterball"
  ) {
    return "capture";
  }

  if (
    actionId.startsWith("shop:rarity-boost:") ||
    actionId.startsWith("shop:level-boost:") ||
    actionId.startsWith("shop:type-lock:")
  ) {
    return "encounter";
  }

  if (
    actionId.startsWith("shop:stat-boost:") ||
    actionId.startsWith("shop:stat-reroll") ||
    actionId.startsWith("shop:teach-move:") ||
    actionId.startsWith("shop:team-sort:")
  ) {
    return "teamUpgrade";
  }

  if (actionId === "shop:reroll") {
    return "reroll";
  }

  if (actionId.startsWith("shop:premium:")) {
    return "premium";
  }

  if (actionId.startsWith("shop:portrait:")) {
    return "portrait";
  }

  return "other";
}

function categorySortIndex(category: ShopEconomyCategory): number {
  const order: ShopEconomyCategory[] = [
    "recovery",
    "capture",
    "encounter",
    "teamUpgrade",
    "reroll",
    "premium",
    "portrait",
    "other",
  ];
  return order.indexOf(category);
}

function getWaveBucket(
  waveBalance: Map<number, MutableWaveBalance>,
  wave: number,
): MutableWaveBalance {
  const existing = waveBalance.get(wave);

  if (existing) {
    return existing;
  }

  const created: MutableWaveBalance = {
    wave,
    samples: 0,
    teamPowerTotal: 0,
    teamPowers: [],
    healthRatioTotal: 0,
    teamSizeTotal: 0,
    battleResults: 0,
    battleWins: 0,
    battleLosses: 0,
    deaths: 0,
    captureAttempts: 0,
    captureSuccesses: 0,
    captureKeeps: 0,
    captureReleases: 0,
    rests: 0,
    ballPurchases: 0,
    gameOverReasons: new Map<string, number>(),
  };
  waveBalance.set(wave, created);
  return created;
}

function toWaveBalanceReport(
  waveBalance: ReadonlyMap<number, MutableWaveBalance>,
): WaveBalanceReport[] {
  return [...waveBalance.values()]
    .sort((left, right) => left.wave - right.wave)
    .map((bucket) => ({
      wave: bucket.wave,
      samples: bucket.samples,
      battleResults: bucket.battleResults,
      battleWins: bucket.battleWins,
      battleLosses: bucket.battleLosses,
      deaths: bucket.deaths,
      captureAttempts: bucket.captureAttempts,
      captureSuccesses: bucket.captureSuccesses,
      captureSuccessRate:
        bucket.captureAttempts === 0
          ? 0
          : Number((bucket.captureSuccesses / bucket.captureAttempts).toFixed(4)),
      captureKeeps: bucket.captureKeeps,
      captureReleases: bucket.captureReleases,
      rests: bucket.rests,
      ballPurchases: bucket.ballPurchases,
      averageTeamPower: averageFromTotal(bucket.teamPowerTotal, bucket.samples),
      teamPowerDistribution: toDistribution(bucket.teamPowers),
      averageHealthRatio: averageFromTotal(bucket.healthRatioTotal, bucket.samples, 4),
      averageTeamSize: averageFromTotal(bucket.teamSizeTotal, bucket.samples),
      topGameOverReasons: [...bucket.gameOverReasons.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    }));
}

function averageFromTotal(total: number, count: number, precision = 2): number {
  if (count === 0) {
    return 0;
  }

  return Number((total / count).toFixed(precision));
}

function toDistribution(values: readonly number[]): NumericDistribution {
  if (values.length === 0) {
    return { min: 0, p25: 0, median: 0, p75: 0, max: 0 };
  }

  const sorted = [...values].sort((left, right) => left - right);

  return {
    min: sorted[0],
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sortedValues: readonly number[], ratio: number): number {
  const index = Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * ratio));
  return sortedValues[index];
}
