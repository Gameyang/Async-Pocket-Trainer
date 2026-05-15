import { summarizeHeadlessQaReport } from "./reportSummary";
import { runHeadlessQa } from "./simulate";
import type { HeadlessQaJsonSummary } from "./reportSummary";
import type {
  HeadlessQaReport,
  ShopEconomyCategory,
  ShopEconomyCategoryReport,
  ShopEconomyReport,
  ShopEconomyWaveReport,
} from "./simulate";
import type { AutoPlayStrategy } from "../types";

export type ShopEconomyDatasetScope = AutoPlayStrategy | "all";

export interface ShopEconomyDatasetOptions {
  seed: string;
  seedCount: number;
  runs: number;
  waves: number;
  strategies: AutoPlayStrategy[];
  generatedAt?: string;
}

export interface ShopEconomyDataset {
  generatedAt: string;
  options: {
    seed: string;
    seedCount: number;
    runsPerSeed: number;
    waves: number;
    strategies: AutoPlayStrategy[];
    totalRuns: number;
  };
  aggregate: ShopEconomyDatasetAggregate;
  strategies: ShopEconomyStrategySummary[];
  categorySummaries: ShopEconomyCategorySummary[];
  waveSummaries: ShopEconomyWaveSummary[];
  scenarios: ShopEconomyScenarioSummary[];
  categoryRows: ShopEconomyCategoryDatasetRow[];
  waveRows: ShopEconomyWaveDatasetRow[];
}

export interface ShopEconomyDatasetAggregate {
  scope: "all";
  scenarioCount: number;
  runs: number;
  invariantErrorCount: number;
  completedTargetWave: number;
  gameOvers: number;
  averageFinalWave: number;
  averageTeamPower: number;
  averageHealthRatio: number;
  shopEconomy: ShopEconomyReport["aggregate"];
}

export interface ShopEconomyStrategySummary {
  scope: AutoPlayStrategy;
  scenarioCount: number;
  runs: number;
  invariantErrorCount: number;
  completedTargetWave: number;
  gameOvers: number;
  averageFinalWave: number;
  averageTeamPower: number;
  averageHealthRatio: number;
  shopEconomy: ShopEconomyReport["aggregate"];
}

export interface ShopEconomyScenarioSummary {
  scenarioId: string;
  seed: string;
  seedIndex: number;
  strategy: AutoPlayStrategy;
  runs: number;
  waves: number;
  invariantErrorCount: number;
  aggregate: HeadlessQaReport["aggregate"];
  shopEconomy: ShopEconomyReport["aggregate"];
  topGameOverReasons: HeadlessQaJsonSummary["topGameOverReasons"];
}

export interface ShopEconomyCategoryDatasetRow extends ShopEconomyCategoryReport {
  scenarioId: string;
  seed: string;
  seedIndex: number;
  strategy: AutoPlayStrategy;
}

export interface ShopEconomyWaveDatasetRow extends ShopEconomyWaveReport {
  scenarioId: string;
  seed: string;
  seedIndex: number;
  strategy: AutoPlayStrategy;
}

export interface ShopEconomyCategorySummary extends ShopEconomyCategoryReport {
  scope: ShopEconomyDatasetScope;
  scenarioCount: number;
}

export interface ShopEconomyWaveSummary extends ShopEconomyWaveReport {
  scope: ShopEconomyDatasetScope;
  scenarioCount: number;
}

interface ScenarioRecord {
  scenario: ShopEconomyScenarioSummary;
  categories: ShopEconomyCategoryDatasetRow[];
  waves: ShopEconomyWaveDatasetRow[];
}

interface MetricRow {
  rowType: string;
  scope?: ShopEconomyDatasetScope;
  scenarioId?: string;
  seed?: string;
  seedIndex?: number;
  strategy?: AutoPlayStrategy;
  category?: ShopEconomyCategory;
  wave?: number;
  runs?: number;
  waves?: number;
  scenarioCount?: number;
  invariantErrorCount?: number;
  completedTargetWave?: number;
  gameOvers?: number;
  averageFinalWave?: number;
  averageTeamPower?: number;
  averageHealthRatio?: number;
  readyFrames?: number;
  averageMoneyAtShop?: number;
  coinOfferSamples?: number;
  coinOfferMoneyAffordableRate?: number;
  coinOfferEnabledRate?: number;
  averageCheapestCoinOffer?: number;
  totalCoinEarned?: number;
  totalStartingCoin?: number;
  totalCoinAvailable?: number;
  totalCoinSpent?: number;
  netCoin?: number;
  spendToIncomeRatio?: number;
  spendToAvailableCoinRatio?: number;
  coinPurchases?: number;
  premiumPurchases?: number;
  totalTrainerPointsSpent?: number;
  averageCoinEarnedPerRun?: number;
  averageCoinSpentPerRun?: number;
  offerSamples?: number;
  purchases?: number;
  spend?: number;
  trainerPointsSpend?: number;
  averageCost?: number;
  averageMoneyAtOffer?: number;
  moneyAffordableRate?: number;
  enabledRate?: number;
  moneyBlockedRate?: number;
  coinEarned?: number;
  coinSpent?: number;
}

const csvColumns: Array<keyof MetricRow> = [
  "rowType",
  "scope",
  "scenarioId",
  "seed",
  "seedIndex",
  "strategy",
  "category",
  "wave",
  "runs",
  "waves",
  "scenarioCount",
  "invariantErrorCount",
  "completedTargetWave",
  "gameOvers",
  "averageFinalWave",
  "averageTeamPower",
  "averageHealthRatio",
  "readyFrames",
  "averageMoneyAtShop",
  "coinOfferSamples",
  "coinOfferMoneyAffordableRate",
  "coinOfferEnabledRate",
  "averageCheapestCoinOffer",
  "totalCoinEarned",
  "totalStartingCoin",
  "totalCoinAvailable",
  "totalCoinSpent",
  "netCoin",
  "spendToIncomeRatio",
  "spendToAvailableCoinRatio",
  "coinPurchases",
  "premiumPurchases",
  "totalTrainerPointsSpent",
  "averageCoinEarnedPerRun",
  "averageCoinSpentPerRun",
  "offerSamples",
  "purchases",
  "spend",
  "trainerPointsSpend",
  "averageCost",
  "averageMoneyAtOffer",
  "moneyAffordableRate",
  "enabledRate",
  "moneyBlockedRate",
  "coinEarned",
  "coinSpent",
];

export async function buildShopEconomyDataset(
  options: ShopEconomyDatasetOptions,
): Promise<ShopEconomyDataset> {
  const records: ScenarioRecord[] = [];

  for (const strategy of options.strategies) {
    for (let seedIndex = 0; seedIndex < options.seedCount; seedIndex += 1) {
      const scenarioSeed = `${options.seed}:${strategy}:${seedIndex + 1}`;
      const report = await runHeadlessQa({
        seed: scenarioSeed,
        runs: options.runs,
        waves: options.waves,
        strategy,
      });
      records.push(toScenarioRecord(report, seedIndex + 1));
    }
  }

  const scenarios = records.map((record) => record.scenario);
  const categoryRows = records.flatMap((record) => record.categories);
  const waveRows = records.flatMap((record) => record.waves);
  const strategies = options.strategies.map((strategy) =>
    summarizeStrategies(strategy, scenarios.filter((scenario) => scenario.strategy === strategy)),
  );

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    options: {
      seed: options.seed,
      seedCount: options.seedCount,
      runsPerSeed: options.runs,
      waves: options.waves,
      strategies: options.strategies,
      totalRuns: options.seedCount * options.runs * options.strategies.length,
    },
    aggregate: summarizeDataset(scenarios),
    strategies,
    categorySummaries: summarizeCategories(categoryRows, options.strategies),
    waveSummaries: summarizeWaves(waveRows, options.strategies),
    scenarios,
    categoryRows,
    waveRows,
  };
}

export function formatShopEconomyDatasetCsv(dataset: ShopEconomyDataset): string {
  const rows: MetricRow[] = [
    toAggregateRow(dataset.aggregate),
    ...dataset.strategies.map(toStrategyRow),
    ...dataset.categorySummaries.map(toCategorySummaryRow),
    ...dataset.waveSummaries.map(toWaveSummaryRow),
    ...dataset.scenarios.map(toScenarioRow),
    ...dataset.categoryRows.map(toCategoryRow),
    ...dataset.waveRows.map(toWaveRow),
  ];

  return [
    csvColumns.join(","),
    ...rows.map((row) => csvColumns.map((column) => escapeCsv(row[column])).join(",")),
  ].join("\n");
}

function toScenarioRecord(report: HeadlessQaReport, seedIndex: number): ScenarioRecord {
  const summary = summarizeHeadlessQaReport(report);
  const scenarioId = `${report.options.strategy}-${seedIndex}`;
  const seed = report.options.seed;

  return {
    scenario: {
      scenarioId,
      seed,
      seedIndex,
      strategy: report.options.strategy,
      runs: report.options.runs,
      waves: report.options.waves,
      invariantErrorCount: summary.invariantErrorCount,
      aggregate: summary.aggregate,
      shopEconomy: summary.shopEconomy.aggregate,
      topGameOverReasons: summary.topGameOverReasons,
    },
    categories: summary.shopEconomy.categories.map((category) => ({
      scenarioId,
      seed,
      seedIndex,
      strategy: report.options.strategy,
      ...category,
    })),
    waves: summary.shopEconomy.waves.map((wave) => ({
      scenarioId,
      seed,
      seedIndex,
      strategy: report.options.strategy,
      ...wave,
    })),
  };
}

function summarizeDataset(
  scenarios: readonly ShopEconomyScenarioSummary[],
): ShopEconomyDatasetAggregate {
  return {
    scope: "all",
    ...summarizeScenarioGroup(scenarios),
  };
}

function summarizeStrategies(
  strategy: AutoPlayStrategy,
  scenarios: readonly ShopEconomyScenarioSummary[],
): ShopEconomyStrategySummary {
  return {
    scope: strategy,
    ...summarizeScenarioGroup(scenarios),
  };
}

function summarizeScenarioGroup(scenarios: readonly ShopEconomyScenarioSummary[]): Omit<
  ShopEconomyDatasetAggregate,
  "scope"
> {
  const runs = sum(scenarios.map((scenario) => scenario.runs));
  const shopEconomies = scenarios.map((scenario) => scenario.shopEconomy);
  const totalCoinEarned = sum(shopEconomies.map((economy) => economy.totalCoinEarned));
  const totalCoinSpent = sum(shopEconomies.map((economy) => economy.totalCoinSpent));
  const totalCoinAvailable = sum(shopEconomies.map((economy) => economy.totalCoinAvailable));

  return {
    scenarioCount: scenarios.length,
    runs,
    invariantErrorCount: sum(scenarios.map((scenario) => scenario.invariantErrorCount)),
    completedTargetWave: sum(scenarios.map((scenario) => scenario.aggregate.completedTargetWave)),
    gameOvers: sum(scenarios.map((scenario) => scenario.aggregate.gameOvers)),
    averageFinalWave: weightedAverage(
      scenarios.map((scenario) => ({
        value: scenario.aggregate.averageFinalWave,
        weight: scenario.runs,
      })),
    ),
    averageTeamPower: weightedAverage(
      scenarios.map((scenario) => ({
        value: scenario.aggregate.averageTeamPower,
        weight: scenario.runs,
      })),
    ),
    averageHealthRatio: weightedAverage(
      scenarios.map((scenario) => ({
        value: scenario.aggregate.averageHealthRatio,
        weight: scenario.runs,
      })),
      4,
    ),
    shopEconomy: {
      readyFrames: sum(shopEconomies.map((economy) => economy.readyFrames)),
      averageMoneyAtShop: weightedAverage(
        shopEconomies.map((economy) => ({
          value: economy.averageMoneyAtShop,
          weight: economy.readyFrames,
        })),
      ),
      coinOfferSamples: sum(shopEconomies.map((economy) => economy.coinOfferSamples)),
      coinOfferMoneyAffordableRate: weightedAverage(
        shopEconomies.map((economy) => ({
          value: economy.coinOfferMoneyAffordableRate,
          weight: economy.coinOfferSamples,
        })),
        4,
      ),
      coinOfferEnabledRate: weightedAverage(
        shopEconomies.map((economy) => ({
          value: economy.coinOfferEnabledRate,
          weight: economy.coinOfferSamples,
        })),
        4,
      ),
      averageCheapestCoinOffer: weightedAverage(
        shopEconomies.map((economy) => ({
          value: economy.averageCheapestCoinOffer,
          weight: economy.readyFrames,
        })),
      ),
      totalCoinEarned,
      totalStartingCoin: sum(shopEconomies.map((economy) => economy.totalStartingCoin)),
      totalCoinAvailable,
      totalCoinSpent,
      netCoin: totalCoinEarned - totalCoinSpent,
      spendToIncomeRatio: ratio(totalCoinSpent, totalCoinEarned),
      spendToAvailableCoinRatio: ratio(totalCoinSpent, totalCoinAvailable),
      coinPurchases: sum(shopEconomies.map((economy) => economy.coinPurchases)),
      premiumPurchases: sum(shopEconomies.map((economy) => economy.premiumPurchases)),
      totalTrainerPointsSpent: sum(
        shopEconomies.map((economy) => economy.totalTrainerPointsSpent),
      ),
      averageCoinEarnedPerRun: averageFromTotal(totalCoinEarned, runs),
      averageCoinSpentPerRun: averageFromTotal(totalCoinSpent, runs),
    },
  };
}

function summarizeCategories(
  rows: readonly ShopEconomyCategoryDatasetRow[],
  strategies: readonly AutoPlayStrategy[],
): ShopEconomyCategorySummary[] {
  return [
    ...summarizeCategoryScope("all", rows),
    ...strategies.flatMap((strategy) =>
      summarizeCategoryScope(
        strategy,
        rows.filter((row) => row.strategy === strategy),
      ),
    ),
  ];
}

function summarizeCategoryScope(
  scope: ShopEconomyDatasetScope,
  rows: readonly ShopEconomyCategoryDatasetRow[],
): ShopEconomyCategorySummary[] {
  const byCategory = new Map<ShopEconomyCategory, ShopEconomyCategoryDatasetRow[]>();

  for (const row of rows) {
    const bucket = byCategory.get(row.category) ?? [];
    bucket.push(row);
    byCategory.set(row.category, bucket);
  }

  return [...byCategory.entries()]
    .sort((left, right) => categorySortIndex(left[0]) - categorySortIndex(right[0]))
    .map(([category, bucket]) => {
      const offerSamples = sum(bucket.map((row) => row.offerSamples));

      return {
        scope,
        scenarioCount: new Set(bucket.map((row) => row.scenarioId)).size,
        category,
        offerSamples,
        purchases: sum(bucket.map((row) => row.purchases)),
        spend: sum(bucket.map((row) => row.spend)),
        trainerPointsSpend: sum(bucket.map((row) => row.trainerPointsSpend)),
        averageCost: weightedAverage(
          bucket.map((row) => ({ value: row.averageCost, weight: row.offerSamples })),
        ),
        averageMoneyAtOffer: weightedAverage(
          bucket.map((row) => ({ value: row.averageMoneyAtOffer, weight: row.offerSamples })),
        ),
        moneyAffordableRate: weightedAverage(
          bucket.map((row) => ({ value: row.moneyAffordableRate, weight: row.offerSamples })),
          4,
        ),
        enabledRate: weightedAverage(
          bucket.map((row) => ({ value: row.enabledRate, weight: row.offerSamples })),
          4,
        ),
        moneyBlockedRate: weightedAverage(
          bucket.map((row) => ({ value: row.moneyBlockedRate, weight: row.offerSamples })),
          4,
        ),
      };
    });
}

function summarizeWaves(
  rows: readonly ShopEconomyWaveDatasetRow[],
  strategies: readonly AutoPlayStrategy[],
): ShopEconomyWaveSummary[] {
  return [
    ...summarizeWaveScope("all", rows),
    ...strategies.flatMap((strategy) =>
      summarizeWaveScope(
        strategy,
        rows.filter((row) => row.strategy === strategy),
      ),
    ),
  ];
}

function summarizeWaveScope(
  scope: ShopEconomyDatasetScope,
  rows: readonly ShopEconomyWaveDatasetRow[],
): ShopEconomyWaveSummary[] {
  const byWave = new Map<number, ShopEconomyWaveDatasetRow[]>();

  for (const row of rows) {
    const bucket = byWave.get(row.wave) ?? [];
    bucket.push(row);
    byWave.set(row.wave, bucket);
  }

  return [...byWave.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([wave, bucket]) => {
      const coinEarned = sum(bucket.map((row) => row.coinEarned));
      const coinSpent = sum(bucket.map((row) => row.coinSpent));

      return {
        scope,
        scenarioCount: new Set(bucket.map((row) => row.scenarioId)).size,
        wave,
        readyFrames: sum(bucket.map((row) => row.readyFrames)),
        averageMoneyAtShop: weightedAverage(
          bucket.map((row) => ({ value: row.averageMoneyAtShop, weight: row.readyFrames })),
        ),
        coinOfferSamples: sum(bucket.map((row) => row.coinOfferSamples)),
        moneyAffordableRate: weightedAverage(
          bucket.map((row) => ({ value: row.moneyAffordableRate, weight: row.coinOfferSamples })),
          4,
        ),
        coinEarned,
        coinSpent,
        netCoin: coinEarned - coinSpent,
        purchases: sum(bucket.map((row) => row.purchases)),
      };
    });
}

function toAggregateRow(aggregate: ShopEconomyDatasetAggregate): MetricRow {
  return {
    rowType: "aggregate",
    scope: aggregate.scope,
    scenarioCount: aggregate.scenarioCount,
    runs: aggregate.runs,
    invariantErrorCount: aggregate.invariantErrorCount,
    completedTargetWave: aggregate.completedTargetWave,
    gameOvers: aggregate.gameOvers,
    averageFinalWave: aggregate.averageFinalWave,
    averageTeamPower: aggregate.averageTeamPower,
    averageHealthRatio: aggregate.averageHealthRatio,
    ...aggregate.shopEconomy,
  };
}

function toStrategyRow(strategy: ShopEconomyStrategySummary): MetricRow {
  return {
    rowType: "strategy",
    scope: strategy.scope,
    strategy: strategy.scope,
    scenarioCount: strategy.scenarioCount,
    runs: strategy.runs,
    invariantErrorCount: strategy.invariantErrorCount,
    completedTargetWave: strategy.completedTargetWave,
    gameOvers: strategy.gameOvers,
    averageFinalWave: strategy.averageFinalWave,
    averageTeamPower: strategy.averageTeamPower,
    averageHealthRatio: strategy.averageHealthRatio,
    ...strategy.shopEconomy,
  };
}

function toScenarioRow(scenario: ShopEconomyScenarioSummary): MetricRow {
  return {
    rowType: "scenario",
    scenarioId: scenario.scenarioId,
    seed: scenario.seed,
    seedIndex: scenario.seedIndex,
    strategy: scenario.strategy,
    runs: scenario.runs,
    waves: scenario.waves,
    invariantErrorCount: scenario.invariantErrorCount,
    completedTargetWave: scenario.aggregate.completedTargetWave,
    gameOvers: scenario.aggregate.gameOvers,
    averageFinalWave: scenario.aggregate.averageFinalWave,
    averageTeamPower: scenario.aggregate.averageTeamPower,
    averageHealthRatio: scenario.aggregate.averageHealthRatio,
    ...scenario.shopEconomy,
  };
}

function toCategorySummaryRow(summary: ShopEconomyCategorySummary): MetricRow {
  return {
    rowType: "categorySummary",
    scope: summary.scope,
    strategy: summary.scope === "all" ? undefined : summary.scope,
    category: summary.category,
    scenarioCount: summary.scenarioCount,
    offerSamples: summary.offerSamples,
    purchases: summary.purchases,
    spend: summary.spend,
    trainerPointsSpend: summary.trainerPointsSpend,
    averageCost: summary.averageCost,
    averageMoneyAtOffer: summary.averageMoneyAtOffer,
    moneyAffordableRate: summary.moneyAffordableRate,
    enabledRate: summary.enabledRate,
    moneyBlockedRate: summary.moneyBlockedRate,
  };
}

function toCategoryRow(row: ShopEconomyCategoryDatasetRow): MetricRow {
  return {
    rowType: "category",
    scenarioId: row.scenarioId,
    seed: row.seed,
    seedIndex: row.seedIndex,
    strategy: row.strategy,
    category: row.category,
    offerSamples: row.offerSamples,
    purchases: row.purchases,
    spend: row.spend,
    trainerPointsSpend: row.trainerPointsSpend,
    averageCost: row.averageCost,
    averageMoneyAtOffer: row.averageMoneyAtOffer,
    moneyAffordableRate: row.moneyAffordableRate,
    enabledRate: row.enabledRate,
    moneyBlockedRate: row.moneyBlockedRate,
  };
}

function toWaveSummaryRow(summary: ShopEconomyWaveSummary): MetricRow {
  return {
    rowType: "waveSummary",
    scope: summary.scope,
    strategy: summary.scope === "all" ? undefined : summary.scope,
    wave: summary.wave,
    scenarioCount: summary.scenarioCount,
    readyFrames: summary.readyFrames,
    averageMoneyAtShop: summary.averageMoneyAtShop,
    coinOfferSamples: summary.coinOfferSamples,
    moneyAffordableRate: summary.moneyAffordableRate,
    coinEarned: summary.coinEarned,
    coinSpent: summary.coinSpent,
    netCoin: summary.netCoin,
    purchases: summary.purchases,
  };
}

function toWaveRow(row: ShopEconomyWaveDatasetRow): MetricRow {
  return {
    rowType: "wave",
    scenarioId: row.scenarioId,
    seed: row.seed,
    seedIndex: row.seedIndex,
    strategy: row.strategy,
    wave: row.wave,
    readyFrames: row.readyFrames,
    averageMoneyAtShop: row.averageMoneyAtShop,
    coinOfferSamples: row.coinOfferSamples,
    moneyAffordableRate: row.moneyAffordableRate,
    coinEarned: row.coinEarned,
    coinSpent: row.coinSpent,
    netCoin: row.netCoin,
    purchases: row.purchases,
  };
}

function weightedAverage(
  entries: Array<{ value: number; weight: number }>,
  precision = 2,
): number {
  const totalWeight = sum(entries.map((entry) => entry.weight));

  if (totalWeight <= 0) {
    return 0;
  }

  return round(
    entries.reduce((total, entry) => total + entry.value * entry.weight, 0) / totalWeight,
    precision,
  );
}

function averageFromTotal(total: number, count: number, precision = 2): number {
  if (count <= 0) {
    return 0;
  }

  return round(total / count, precision);
}

function ratio(numerator: number, denominator: number, precision = 4): number {
  if (denominator <= 0) {
    return 0;
  }

  return round(numerator / denominator, precision);
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
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

function escapeCsv(value: string | number | undefined): string {
  if (value === undefined) {
    return "";
  }

  const text = String(value);

  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}
