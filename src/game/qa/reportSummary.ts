import type { HeadlessQaOptions, HeadlessQaReport, WaveBalanceReport } from "./simulate";

export interface HeadlessQaJsonSummary {
  options: HeadlessQaOptions;
  invariantErrorCount: number;
  aggregate: HeadlessQaReport["aggregate"];
  targetResult?: HeadlessQaReport["targetResult"];
  shopEconomy: HeadlessQaReport["shopEconomy"];
  waves: WaveJsonSummary[];
  topGameOverReasons: Array<{
    reason: string;
    count: number;
  }>;
}

export interface WaveJsonSummary {
  wave: number;
  battleWinRate: number;
  captureSuccessRate: number;
  deaths: number;
  averageTeamPower: number;
  medianTeamPower: number;
  averageHealthRatio: number;
  rests: number;
  ballPurchases: number;
}

export interface HeadlessQaSummaryComparison {
  before: HeadlessQaJsonSummary;
  after: HeadlessQaJsonSummary;
  delta: {
    completedTargetWave: number;
    gameOvers: number;
    averageFinalWave: number;
    averageTeamPower: number;
    averageHealthRatio: number;
  };
  waves: WaveJsonSummaryDelta[];
}

export interface WaveJsonSummaryDelta {
  wave: number;
  battleWinRate: number;
  captureSuccessRate: number;
  deaths: number;
  averageTeamPower: number;
  medianTeamPower: number;
  averageHealthRatio: number;
}

export function summarizeHeadlessQaReport(report: HeadlessQaReport): HeadlessQaJsonSummary {
  return {
    options: report.options,
    invariantErrorCount: report.invariantErrors.length,
    aggregate: report.aggregate,
    targetResult: report.targetResult,
    shopEconomy: report.shopEconomy,
    waves: report.waveBalance.map(toWaveSummary),
    topGameOverReasons: summarizeGameOverReasons(report.waveBalance),
  };
}

export function compareHeadlessQaReports(
  before: HeadlessQaReport,
  after: HeadlessQaReport,
): HeadlessQaSummaryComparison {
  const beforeSummary = summarizeHeadlessQaReport(before);
  const afterSummary = summarizeHeadlessQaReport(after);
  const beforeWaves = new Map(beforeSummary.waves.map((wave) => [wave.wave, wave]));
  const afterWaves = new Map(afterSummary.waves.map((wave) => [wave.wave, wave]));
  const waveIds = [...new Set([...beforeWaves.keys(), ...afterWaves.keys()])].sort(
    (left, right) => left - right,
  );

  return {
    before: beforeSummary,
    after: afterSummary,
    delta: {
      completedTargetWave:
        afterSummary.aggregate.completedTargetWave - beforeSummary.aggregate.completedTargetWave,
      gameOvers: afterSummary.aggregate.gameOvers - beforeSummary.aggregate.gameOvers,
      averageFinalWave: round(
        afterSummary.aggregate.averageFinalWave - beforeSummary.aggregate.averageFinalWave,
      ),
      averageTeamPower: round(
        afterSummary.aggregate.averageTeamPower - beforeSummary.aggregate.averageTeamPower,
      ),
      averageHealthRatio: round(
        afterSummary.aggregate.averageHealthRatio - beforeSummary.aggregate.averageHealthRatio,
        4,
      ),
    },
    waves: waveIds.map((wave) => {
      const beforeWave = beforeWaves.get(wave);
      const afterWave = afterWaves.get(wave);

      return {
        wave,
        battleWinRate: round((afterWave?.battleWinRate ?? 0) - (beforeWave?.battleWinRate ?? 0), 4),
        captureSuccessRate: round(
          (afterWave?.captureSuccessRate ?? 0) - (beforeWave?.captureSuccessRate ?? 0),
          4,
        ),
        deaths: (afterWave?.deaths ?? 0) - (beforeWave?.deaths ?? 0),
        averageTeamPower: round(
          (afterWave?.averageTeamPower ?? 0) - (beforeWave?.averageTeamPower ?? 0),
        ),
        medianTeamPower: round(
          (afterWave?.medianTeamPower ?? 0) - (beforeWave?.medianTeamPower ?? 0),
        ),
        averageHealthRatio: round(
          (afterWave?.averageHealthRatio ?? 0) - (beforeWave?.averageHealthRatio ?? 0),
          4,
        ),
      };
    }),
  };
}

function toWaveSummary(wave: WaveBalanceReport): WaveJsonSummary {
  return {
    wave: wave.wave,
    battleWinRate: wave.battleResults === 0 ? 0 : round(wave.battleWins / wave.battleResults, 4),
    captureSuccessRate: wave.captureSuccessRate,
    deaths: wave.deaths,
    averageTeamPower: wave.averageTeamPower,
    medianTeamPower: wave.teamPowerDistribution.median,
    averageHealthRatio: wave.averageHealthRatio,
    rests: wave.rests,
    ballPurchases: wave.ballPurchases,
  };
}

function summarizeGameOverReasons(
  waves: readonly WaveBalanceReport[],
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();

  for (const wave of waves) {
    for (const reason of wave.topGameOverReasons) {
      counts.set(reason.reason, (counts.get(reason.reason) ?? 0) + reason.count);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));
}

function round(value: number, precision = 2): number {
  return Number(value.toFixed(precision));
}
