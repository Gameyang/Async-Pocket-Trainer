import { getMove, getSpecies, starterSpeciesIds } from "../data/catalog";
import { normalizeCreatureMoves } from "../creatureFactory";
import {
  ballActionSlug,
  getBallCost,
  getHealProduct,
  getLevelBoostProduct,
  getRarityBoostProduct,
  getScoutProduct,
  getStatBoostProduct,
  getStatRerollProduct,
  getTeachMoveProduct,
  getTypeLockProduct,
  healTiers,
  levelBoostTiers,
  rarityBoostTiers,
  scoutKinds,
  scoutTiers,
  statBoostTiers,
  teachMoveElements,
  typeLockElements,
} from "../shopCatalog";
import {
  formatMoney,
  formatWave,
  GAME_TITLE,
  localizeBall,
  localizeBattleStatus,
  localizeEncounterKind,
  localizeType,
  localizeTypes,
  localizeWinner,
  withJosa,
} from "../localization";
import { getTeamHealthRatio, scoreCreature, scoreTeam } from "../scoring";
import { ballTypes } from "../types";
import type {
  BattleStat,
  BattleStatus,
  BattleReplayEvent,
  BallType,
  Creature,
  ElementType,
  EncounterSource,
  GameAction,
  GameBalance,
  GameEvent,
  GamePhase,
  GameState,
  HealScope,
  MoveCategory,
  MoveDefinition,
  RouteId,
  SpeciesDefinition,
  TeamRecordChange,
  TeamRecordSummary,
  VolatileBattleStatus,
} from "../types";

export type FrameProtocolVersion = 1;

export interface GameFrame {
  protocolVersion: FrameProtocolVersion;
  frameId: number;
  stateKey: string;
  phase: GamePhase;
  hud: FrameHud;
  scene: FrameScene;
  entities: FrameEntity[];
  actions: FrameAction[];
  timeline: FrameTimelineEntry[];
  battleReplay: FrameBattleReplay;
  visualCues: FrameVisualCue[];
}

export interface FrameHud {
  title: string;
  trainerName: string;
  wave: number;
  money: number;
  balls: Record<BallType, number>;
  teamPower: number;
  teamHpRatio: number;
  gameOverReason?: string;
}

export interface FrameScene {
  title: string;
  subtitle: string;
  playerSlots: string[];
  opponentSlots: string[];
  pendingCaptureId?: string;
  focusEntityId?: string;
  starterOptions: FrameStarterOption[];
  capture?: FrameCaptureScene;
  trainer?: FrameTrainerScene;
  bgmKey: FrameBgmKey;
}

export interface FrameStarterOption {
  speciesId: number;
  name: string;
  typeLabels: string[];
  assetKey: string;
  assetPath: string;
  power: number;
  moves: FrameMoveSummary[];
  stats: {
    hp: number;
    attack: number;
    defense: number;
    special: number;
    speed: number;
  };
}

export interface FrameMoveSummary {
  id: string;
  name: string;
  type: string;
  power: number;
  accuracy: number;
  accuracyLabel: string;
  category: MoveCategory;
  priority: number;
  effect: string;
}

export interface FrameCaptureScene {
  result: "choosing" | "success" | "failure";
  ball?: BallType;
  targetEntityId?: string;
  targetName?: string;
  chance?: number;
  shakes: number;
  label: string;
}

export interface FrameTrainerScene {
  source: EncounterSource;
  label: string;
  trainerName: string;
  portraitKey: string;
  portraitPath: string;
  teamPower?: number;
  record?: TeamRecordSummary;
  recordChange?: TeamRecordChange;
}

export type FrameBgmKey =
  | "bgm.starterReady"
  | "bgm.battleCapture"
  | "bgm.teamDecision"
  | "bgm.gameOver";

export interface FrameEntity {
  id: string;
  kind: "creature";
  owner: FrameEntityOwner;
  slot: number;
  layout: FrameEntityLayout;
  assetKey: string;
  assetPath: string;
  name: string;
  speciesId: number;
  typeLabels: string[];
  hp: {
    current: number;
    max: number;
    ratio: number;
  };
  stats: {
    hp: number;
    attack: number;
    defense: number;
    special: number;
    speed: number;
  };
  moves: FrameMoveSummary[];
  scores: {
    power: number;
    rarity: number;
  };
  flags: string[];
}

export type FrameEntityOwner = "player" | "opponent" | "pendingCapture";

export interface FrameEntityLayout {
  lane: "player" | "opponent" | "center";
  slot: number;
  role: "active" | "bench" | "pendingCapture";
}

export interface FrameAction {
  id: string;
  label: string;
  role: "primary" | "secondary" | "danger";
  enabled: boolean;
  action: GameAction;
  targetEntityId?: string;
  cost?: number;
  originalCost?: number;
  reason?: string;
}

export interface FrameTimelineEntry {
  id: string;
  wave: number;
  text: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface FrameBattleReplay {
  sequenceIndex: number;
  events: FrameBattleReplayEvent[];
}

export interface FrameBattleReplayEvent {
  sequence: number;
  turn: number;
  type: BattleReplayEvent["type"];
  label: string;
  move?: string;
  moveType?: ElementType;
  moveCategory?: MoveCategory;
  sourceSide?: "player" | "enemy";
  targetSide?: "player" | "enemy";
  side?: "player" | "enemy";
  activePlayerId?: string;
  activeEnemyId?: string;
  sourceEntityId?: string;
  targetEntityId?: string;
  entityId?: string;
  damage?: number;
  targetHpBefore?: number;
  targetHpAfter?: number;
  hpBefore?: number;
  hpAfter?: number;
  effectiveness?: number;
  critical?: boolean;
  status?: BattleStatus | VolatileBattleStatus;
  winner?: "player" | "enemy";
  playerRemainingHp?: number;
  enemyRemainingHp?: number;
}

export type FrameVisualCue =
  | {
      id: string;
      type: "battle.hit" | "battle.miss";
      sequence: number;
      effectKey: string;
      soundKey: string;
      turn: number;
      sourceEntityId: string;
      targetEntityId: string;
      entityId?: string;
      label: string;
      damage: number;
      effectiveness: number;
      critical: boolean;
      moveType?: ElementType;
    }
  | {
      id: string;
      type: "battle.support";
      sequence: number;
      effectKey: string;
      soundKey: string;
      turn: number;
      sourceEntityId?: string;
      targetEntityId?: string;
      entityId?: string;
      label: string;
      moveType?: ElementType;
    }
  | {
      id: string;
      type: "creature.faint";
      sequence: number;
      effectKey: string;
      soundKey: string;
      turn: number;
      entityId: string;
      label: string;
    }
  | {
      id: string;
      type: "phase.change";
      sequence: number;
      effectKey: string;
      soundKey: string;
      label: string;
      phase: GamePhase;
    }
  | {
      id: string;
      type: "capture.success" | "capture.fail";
      sequence: number;
      effectKey: string;
      soundKey: string;
      label: string;
      ball: BallType;
      targetEntityId?: string;
      targetName?: string;
    };

export function createGameFrame(
  state: GameState,
  balance: GameBalance,
  frameId: number,
): GameFrame {
  const captureScene = createCaptureScene(state);
  const playerEntities = state.team.map((creature, index) =>
    toFrameEntity(creature, "player", index),
  );
  const opponentTeam =
    state.phase === "captureDecision"
      ? (state.pendingEncounter?.enemyTeam ?? [])
      : state.phase === "gameOver"
        ? (state.lastBattle?.enemyTeam ?? [])
        : captureScene?.result === "failure"
          ? (state.lastBattle?.enemyTeam ?? [])
          : state.pendingCapture
            ? []
            : state.lastBattle?.replay.length
              ? state.lastBattle.enemyTeam
              : [];
  const opponentEntities = opponentTeam.map((creature, index) =>
    toFrameEntity(creature, "opponent", index),
  );
  const pendingCaptureEntity = state.pendingCapture
    ? toFrameEntity(state.pendingCapture, "pendingCapture", 0)
    : undefined;
  const entities: FrameEntity[] = [];
  const occupiedEntitySlots = new Set<string>();
  const addFrameEntity = (entity: FrameEntity) => {
    if (!entities.some((existing) => existing.id === entity.id)) {
      entities.push(entity);
      occupiedEntitySlots.add(`${entity.owner}:${entity.slot}`);
    }
  };
  const addMissingEntity = (creature: Creature, owner: FrameEntity["owner"], slot: number) => {
    const resolvedSlot = resolveEntitySlot(owner, slot, occupiedEntitySlots);
    addFrameEntity(toFrameEntity(creature, owner, resolvedSlot));
  };

  playerEntities.forEach(addFrameEntity);
  opponentEntities.forEach(addFrameEntity);
  if (pendingCaptureEntity) {
    addFrameEntity(pendingCaptureEntity);
  }
  state.lastBattle?.playerTeam.forEach((creature, index) => {
    addMissingEntity(creature, "player", index);
  });
  state.lastBattle?.enemyTeam.forEach((creature, index) => {
    addMissingEntity(creature, "opponent", index);
  });

  const focusEntityId =
    pendingCaptureEntity?.id ?? opponentEntities.find((entity) => entity.hp.current > 0)?.id;

  return {
    protocolVersion: 1,
    frameId,
    stateKey: createStateKey(state),
    phase: state.phase,
    hud: {
      title: GAME_TITLE,
      trainerName: state.trainerName,
      wave: state.currentWave,
      money: state.money,
      balls: { ...state.balls },
      teamPower: scoreTeam(state.team),
      teamHpRatio: Number(getTeamHealthRatio(state.team).toFixed(4)),
      gameOverReason: state.gameOverReason,
    },
    scene: {
      title: createSceneTitle(state),
      subtitle: createSceneSubtitle(state),
      playerSlots: playerEntities.map((entity) => entity.id),
      opponentSlots: opponentEntities.map((entity) => entity.id),
      pendingCaptureId: pendingCaptureEntity?.id,
      focusEntityId,
      starterOptions: createStarterOptions(state),
      capture: captureScene,
      trainer: createTrainerScene(state),
      bgmKey: createBgmKey(state),
    },
    entities,
    actions: createFrameActions(state, balance),
    timeline: createTimeline(state),
    battleReplay: createBattleReplay(state),
    visualCues: createVisualCues(state),
  };
}

export function validateFrameContract(frame: GameFrame): string[] {
  const errors: string[] = [];
  const entityIds = new Set<string>();
  const entitySlots = new Set<string>();
  const actionIds = new Set<string>();

  if (frame.protocolVersion !== 1) {
    errors.push(`unsupported frame protocol ${frame.protocolVersion}`);
  }

  for (const entity of frame.entities) {
    if (entityIds.has(entity.id)) {
      errors.push(`duplicate entity id ${entity.id}`);
    }
    entityIds.add(entity.id);

    if (!entity.assetKey.startsWith("monster:")) {
      errors.push(`entity ${entity.id} has invalid asset key ${entity.assetKey}`);
    }

    if (!Number.isInteger(entity.slot) || entity.slot < 0) {
      errors.push(`entity ${entity.id} has invalid slot ${entity.slot}`);
    }

    if (entity.layout.slot !== entity.slot) {
      errors.push(`entity ${entity.id} layout slot does not match entity slot`);
    }

    if (!isValidEntityLayout(entity)) {
      errors.push(`entity ${entity.id} has invalid layout for owner ${entity.owner}`);
    }

    const slotKey = `${entity.owner}:${entity.slot}`;
    if (entitySlots.has(slotKey)) {
      errors.push(`duplicate entity owner/slot ${slotKey}`);
    }
    entitySlots.add(slotKey);

    if (!/^resources\/pokemon\/\d{4}\.webp$/.test(entity.assetPath)) {
      errors.push(`entity ${entity.id} has invalid asset path ${entity.assetPath}`);
    }

    if (entity.hp.current < 0 || entity.hp.current > entity.hp.max) {
      errors.push(`entity ${entity.id} hp out of bounds`);
    }
  }

  for (const action of frame.actions) {
    if (actionIds.has(action.id)) {
      errors.push(`duplicate action id ${action.id}`);
    }
    actionIds.add(action.id);
  }

  for (const entityId of [...frame.scene.playerSlots, ...frame.scene.opponentSlots]) {
    if (!entityIds.has(entityId)) {
      errors.push(`scene references missing entity ${entityId}`);
    }
  }

  if (frame.scene.pendingCaptureId && !entityIds.has(frame.scene.pendingCaptureId)) {
    errors.push(`scene references missing pending capture ${frame.scene.pendingCaptureId}`);
  }

  for (const option of frame.scene.starterOptions) {
    if (!/^resources\/pokemon\/\d{4}\.webp$/.test(option.assetPath)) {
      errors.push(`starter ${option.speciesId} has invalid asset path ${option.assetPath}`);
    }
  }

  if (
    frame.scene.trainer &&
    !/^resources\/trainers\/[a-z0-9-]+\.webp$/.test(frame.scene.trainer.portraitPath)
  ) {
    errors.push(`trainer has invalid portrait path ${frame.scene.trainer.portraitPath}`);
  }

  for (const cue of frame.visualCues) {
    if (!Number.isInteger(cue.sequence) || cue.sequence < 0) {
      errors.push(`cue ${cue.id} has invalid sequence ${cue.sequence}`);
    }

    if (!cue.effectKey) {
      errors.push(`cue ${cue.id} has no effect key`);
    }

    if (!cue.soundKey) {
      errors.push(`cue ${cue.id} has no sound key`);
    }

    if (cue.type === "phase.change") {
      continue;
    }

    if (cue.type === "creature.faint" && !entityIds.has(cue.entityId)) {
      errors.push(`cue references missing faint entity ${cue.entityId}`);
    }

    if (
      (cue.type === "battle.hit" || cue.type === "battle.miss" || cue.type === "battle.support") &&
      cue.sourceEntityId &&
      !entityIds.has(cue.sourceEntityId)
    ) {
      errors.push(`cue references missing source entity ${cue.sourceEntityId}`);
    }

    if (
      (cue.type === "battle.hit" || cue.type === "battle.miss" || cue.type === "battle.support") &&
      cue.targetEntityId &&
      !entityIds.has(cue.targetEntityId)
    ) {
      errors.push(`cue references missing target entity ${cue.targetEntityId}`);
    }

    if (cue.type === "battle.support" && cue.entityId && !entityIds.has(cue.entityId)) {
      errors.push(`cue references missing support entity ${cue.entityId}`);
    }

    if (
      (cue.type === "capture.success" || cue.type === "capture.fail") &&
      cue.targetEntityId &&
      !entityIds.has(cue.targetEntityId)
    ) {
      errors.push(`cue references missing capture target ${cue.targetEntityId}`);
    }
  }

  let previousSequence = 0;
  for (const event of frame.battleReplay.events) {
    if (event.sequence <= previousSequence) {
      errors.push(`battle replay sequence is not increasing at ${event.sequence}`);
    }
    previousSequence = event.sequence;

    if (event.sourceEntityId && !entityIds.has(event.sourceEntityId)) {
      errors.push(
        `replay event ${event.sequence} references missing source ${event.sourceEntityId}`,
      );
    }

    if (event.targetEntityId && !entityIds.has(event.targetEntityId)) {
      errors.push(
        `replay event ${event.sequence} references missing target ${event.targetEntityId}`,
      );
    }

    if (event.entityId && !entityIds.has(event.entityId)) {
      errors.push(`replay event ${event.sequence} references missing entity ${event.entityId}`);
    }
  }

  const lastReplaySequence = frame.battleReplay.events.at(-1)?.sequence ?? 0;
  if (frame.battleReplay.sequenceIndex !== lastReplaySequence) {
    errors.push(
      `battle replay sequenceIndex ${frame.battleReplay.sequenceIndex} does not match last event ${lastReplaySequence}`,
    );
  }

  return errors;
}

const trainerPortraits = [
  "resources/trainers/field-scout.webp",
  "resources/trainers/checkpoint-captain.webp",
  "resources/trainers/sheet-rival.webp",
] as const;

function createStarterOptions(state: GameState): FrameStarterOption[] {
  if (state.phase !== "starterChoice") {
    return [];
  }

  return starterSpeciesIds.map((speciesId) => speciesToStarterOption(getSpecies(speciesId)));
}

export function speciesToStarterOption(species: SpeciesDefinition): FrameStarterOption {
  const moves = normalizeCreatureMoves(
    species.id,
    1,
    species.movePool.map((moveId) => getMove(moveId)),
  );

  return {
    speciesId: species.id,
    name: species.name,
    typeLabels: localizeTypes(species.types),
    assetKey: `monster:${species.id}`,
    assetPath: `resources/pokemon/${species.id.toString().padStart(4, "0")}.webp`,
    power: scoreCreature({ stats: species.baseStats, moves, types: species.types }),
    moves: moves.map(toFrameMoveSummary),
    stats: { ...species.baseStats },
  };
}

function createCaptureScene(state: GameState): FrameCaptureScene | undefined {
  const latestCapture = parseLatestCaptureAttempt(state.events.at(-1));

  if (state.phase === "captureDecision" && state.pendingEncounter) {
    const target = state.pendingEncounter.enemyTeam[0];

    return {
      result: "choosing",
      targetEntityId: target?.instanceId,
      targetName: target?.speciesName,
      shakes: 0,
      label: target
        ? `${withJosa(target.speciesName, "을/를")} 포획할 기회입니다.`
        : "사용할 볼을 선택하세요.",
    };
  }

  if (state.phase === "teamDecision" && state.pendingCapture && latestCapture?.success) {
    return {
      result: "success",
      ball: latestCapture.ball,
      targetEntityId: state.pendingCapture.instanceId,
      targetName: state.pendingCapture.speciesName,
      chance: latestCapture.chance,
      shakes: 3,
      label: `${withJosa(state.pendingCapture.speciesName, "이/가")} 포획되었습니다!`,
    };
  }

  if (latestCapture && !latestCapture.success) {
    const target = state.lastBattle?.enemyTeam[0];

    return {
      result: "failure",
      ball: latestCapture.ball,
      targetEntityId: target?.instanceId,
      targetName: target?.speciesName ?? latestCapture.targetName,
      chance: latestCapture.chance,
      shakes: Math.max(1, Math.min(2, Math.ceil((latestCapture.chance ?? 0.45) * 3))),
      label: `${withJosa(target?.speciesName ?? latestCapture.targetName ?? "대상", "은/는")} 볼에서 빠져나왔습니다.`,
    };
  }

  return undefined;
}

function parseLatestCaptureAttempt(event: GameEvent | undefined):
  | {
      ball: BallType;
      chance?: number;
      success: boolean;
      targetName?: string;
    }
  | undefined {
  if (event?.type !== "capture_attempted") {
    return undefined;
  }

  const data = event.data ?? {};
  const ball = ballTypes.includes(data.ball as BallType) ? (data.ball as BallType) : "pokeBall";
  const success = data.success === true;
  const chance = typeof data.chance === "number" ? data.chance : undefined;
  const targetName = typeof data.target === "string" ? data.target : undefined;

  return {
    ball,
    chance,
    success,
    targetName,
  };
}

function createTrainerScene(state: GameState): FrameTrainerScene | undefined {
  const kind = state.pendingEncounter?.kind ?? state.lastBattle?.kind;

  if (kind !== "trainer") {
    return undefined;
  }

  const source = state.pendingEncounter?.source ?? state.lastBattle?.encounterSource ?? "generated";
  const trainerName =
    state.pendingEncounter?.opponentName ?? state.lastBattle?.opponentName ?? "트레이너";
  const opponentTeam = state.pendingEncounter?.opponentTeam ?? state.lastBattle?.opponentTeam;
  const portraitPath = pickTrainerPortrait(trainerName, source);

  return {
    source,
    label: source === "sheet" ? "시트 트레이너" : "트레이너",
    trainerName,
    portraitKey: `trainer:${portraitPath.split("/").at(-1)?.replace(".webp", "") ?? "portrait"}`,
    portraitPath,
    teamPower: opponentTeam?.teamPower,
    record: opponentTeam?.record,
    recordChange: state.lastBattle?.opponentTeamRecordChange,
  };
}

function pickTrainerPortrait(trainerName: string, source: EncounterSource): string {
  if (source === "sheet") {
    return "resources/trainers/sheet-rival.webp";
  }

  const hash = trainerName.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return trainerPortraits[hash % (trainerPortraits.length - 1)];
}

function createBgmKey(state: GameState): FrameBgmKey {
  if (state.phase === "gameOver") {
    return "bgm.gameOver";
  }

  if (state.phase === "teamDecision") {
    return "bgm.teamDecision";
  }

  if (state.phase === "captureDecision" || state.lastBattle?.replay.length) {
    return "bgm.battleCapture";
  }

  return "bgm.starterReady";
}

function toFrameEntity(creature: Creature, owner: FrameEntityOwner, slot: number): FrameEntity {
  return {
    id: creature.instanceId,
    kind: "creature",
    owner,
    slot,
    layout: createEntityLayout(owner, slot),
    assetKey: `monster:${creature.speciesId}`,
    assetPath: `resources/pokemon/${creature.speciesId.toString().padStart(4, "0")}.webp`,
    name: creature.speciesName,
    speciesId: creature.speciesId,
    typeLabels: localizeTypes(creature.types),
    hp: {
      current: creature.currentHp,
      max: creature.stats.hp,
      ratio:
        creature.stats.hp === 0 ? 0 : Number((creature.currentHp / creature.stats.hp).toFixed(4)),
    },
    stats: { ...creature.stats },
    moves: creature.moves.map(toFrameMoveSummary),
    scores: {
      power: creature.powerScore,
      rarity: creature.rarityScore,
    },
    flags: [
      ...(creature.currentHp <= 0 ? ["fainted"] : []),
      ...(creature.status ? [`status:${creature.status.type}`] : []),
    ],
  };
}

function toFrameMoveSummary(move: MoveDefinition): FrameMoveSummary {
  return {
    id: move.id,
    name: move.name,
    type: localizeType(move.type),
    power: move.power,
    accuracy: move.accuracy,
    accuracyLabel:
      move.accuracyPercent === undefined ? "-" : `${Math.round(move.accuracyPercent)}%`,
    category: move.category,
    priority: move.priority,
    effect: createMoveEffectText(move),
  };
}

function createMoveEffectText(move: MoveDefinition): string {
  const translatedShortEffect = move.shortEffect
    ? translateMoveShortEffect(move.shortEffect)
    : undefined;

  if (translatedShortEffect) {
    return translatedShortEffect;
  }

  const effects: string[] = [];

  if (move.statusEffect) {
    effects.push(
      `${localizeBattleStatus(move.statusEffect.status)} ${Math.round(move.statusEffect.chance * 100)}%`,
    );
  }

  if (move.statChanges.length > 0) {
    effects.push(`능력 변화: ${move.statChanges.map(formatMoveStatChange).join(", ")}`);
  }

  if (move.meta.drain > 0) {
    effects.push(`피해량 ${move.meta.drain}% 회복`);
  }

  if (move.meta.healing > 0) {
    effects.push(`HP ${move.meta.healing}% 회복`);
  }

  if (move.meta.flinchChance > 0) {
    effects.push(`풀죽음 ${move.meta.flinchChance}%`);
  }

  if (move.meta.critRate > 0) {
    effects.push("급소율 상승");
  }

  if (effects.length > 0) {
    return effects.join(" · ");
  }

  return move.category === "status" ? "상태 변화 기술" : "추가 효과 없음";
}

function translateMoveShortEffect(effect: string): string | undefined {
  const normalized = effect.replace(/\s+/g, " ").trim();
  const exactTranslations: Record<string, string> = {
    "Inflicts regular damage with no additional effect.": "추가 효과 없이 피해를 줍니다.",
    "Inflicts regular damage.": "피해를 줍니다.",
    "Never misses.": "반드시 명중합니다.",
    "Has an increased chance for a critical hit.": "급소에 맞을 확률이 높습니다.",
    "Always scores a critical hit.": "반드시 급소에 맞습니다.",
    "Hits twice in one turn.": "한 턴에 2회 공격합니다.",
    "Hits 2-5 times in one turn.": "한 턴에 2~5회 연속으로 공격합니다.",
    "Requires a turn to charge before attacking.": "1턴 동안 힘을 모은 뒤 공격합니다.",
    "User must switch out after attacking.": "공격한 뒤 사용자는 교체됩니다.",
    "Ends wild battles. Forces trainers to switch Pokémon.":
      "야생 배틀을 끝내고, 트레이너전에서는 상대의 교체를 강제합니다.",
  };

  if (exactTranslations[normalized]) {
    return exactTranslations[normalized];
  }

  let match = normalized.match(/^Has a (\d+)% chance to (paralyze|burn|poison|freeze|confuse) the target\.$/);
  if (match) {
    return `${match[1]}% 확률로 상대를 ${translateAilmentVerb(match[2])} 상태로 만듭니다.`;
  }

  match = normalized.match(/^Has a (\d+)% chance to make the target flinch\.$/);
  if (match) {
    return `${match[1]}% 확률로 상대를 풀죽게 합니다.`;
  }

  match = normalized.match(
    /^Has a (\d+)% chance to lower the target's ([A-Za-z -]+) by (one|two|three) stages?\.$/,
  );
  if (match) {
    return `${match[1]}% 확률로 상대의 ${translateStatList(match[2])} 능력치를 ${translateStageCount(
      match[3],
    )}랭크 낮춥니다.`;
  }

  match = normalized.match(
    /^Has a (\d+)% chance to raise the user's ([A-Za-z -]+) by (one|two|three) stages?\.$/,
  );
  if (match) {
    return `${match[1]}% 확률로 사용자의 ${translateStatList(match[2])} 능력치를 ${translateStageCount(
      match[3],
    )}랭크 올립니다.`;
  }

  match = normalized.match(/^Lowers the target's ([A-Za-z -]+) by (one|two|three) stages?\.$/);
  if (match) {
    return `상대의 ${translateStatList(match[1])} 능력치를 ${translateStageCount(
      match[2],
    )}랭크 낮춥니다.`;
  }

  match = normalized.match(/^Raises the user's ([A-Za-z ,and-]+) by (one|two|three) stages? each\.$/);
  if (match) {
    return `사용자의 ${translateStatList(match[1])} 능력치를 각각 ${translateStageCount(
      match[2],
    )}랭크 올립니다.`;
  }

  match = normalized.match(/^Raises the user's ([A-Za-z ,and-]+) by (one|two|three) stages?\.$/);
  if (match) {
    return `사용자의 ${translateStatList(match[1])} 능력치를 ${translateStageCount(
      match[2],
    )}랭크 올립니다.`;
  }

  match = normalized.match(
    /^Lowers the user's ([A-Za-z -]+) by (one|two|three) stages? after inflicting damage\.$/,
  );
  if (match) {
    return `피해를 준 뒤 사용자의 ${translateStatList(match[1])} 능력치를 ${translateStageCount(
      match[2],
    )}랭크 낮춥니다.`;
  }

  match = normalized.match(/^Drains (\d+)% of the damage inflicted to heal the user\.$/);
  if (match) {
    return `준 피해의 ${match[1]}%만큼 HP를 회복합니다.`;
  }

  match = normalized.match(/^User receives 1\/(\d+) the damage inflicted in recoil\.$/);
  if (match) {
    return `준 피해의 1/${match[1]}만큼 반동 피해를 받습니다.`;
  }

  match = normalized.match(/^Heals the user by (half|50%) its max HP\.$/);
  if (match) {
    return "사용자의 HP를 최대 HP의 절반만큼 회복합니다.";
  }

  match = normalized.match(/^Heals the target for (half|50%) (?:its|their) max HP\.$/);
  if (match) {
    return "대상의 HP를 최대 HP의 절반만큼 회복합니다.";
  }

  if (normalized.includes("Power is higher")) {
    return "조건에 따라 위력이 달라집니다.";
  }

  if (normalized.includes("double damage") || normalized.includes("double power")) {
    return "조건을 만족하면 위력이 2배가 됩니다.";
  }

  return undefined;
}

function translateAilmentVerb(verb: string): string {
  switch (verb) {
    case "paralyze":
      return "마비";
    case "burn":
      return "화상";
    case "poison":
      return "독";
    case "freeze":
      return "얼음";
    case "confuse":
      return "혼란";
    default:
      return verb;
  }
}

function translateStatList(value: string): string {
  return value
    .replace(/, and /g, ", ")
    .replace(/ and /g, ", ")
    .split(",")
    .map((stat) => translateMoveStatName(stat.trim()))
    .filter(Boolean)
    .join(", ");
}

function translateMoveStatName(value: string): string {
  switch (value.toLowerCase()) {
    case "attack":
      return "공격";
    case "defense":
      return "방어";
    case "special attack":
      return "특수공격";
    case "special defense":
      return "특수방어";
    case "speed":
      return "스피드";
    case "accuracy":
      return "명중률";
    case "evasion":
      return "회피율";
    default:
      return value;
  }
}

function translateStageCount(value: string): number {
  switch (value) {
    case "one":
      return 1;
    case "two":
      return 2;
    case "three":
      return 3;
    default:
      return 1;
  }
}

function formatMoveStatChange(change: MoveDefinition["statChanges"][number]): string {
  const sign = change.change > 0 ? "+" : "";
  return `${localizeBattleStat(change.stat)} ${sign}${change.change}`;
}

function localizeBattleStat(stat: BattleStat): string {
  switch (stat) {
    case "attack":
      return "공격";
    case "defense":
      return "방어";
    case "special":
      return "특수";
    case "speed":
      return "스피드";
    case "accuracy":
      return "명중";
    case "evasion":
      return "회피";
  }
}

function createEntityLayout(owner: FrameEntityOwner, slot: number): FrameEntityLayout {
  if (owner === "pendingCapture") {
    return {
      lane: "center",
      slot,
      role: "pendingCapture",
    };
  }

  return {
    lane: owner,
    slot,
    role: slot === 0 ? "active" : "bench",
  };
}

function resolveEntitySlot(
  owner: FrameEntityOwner,
  preferredSlot: number,
  occupiedSlots: ReadonlySet<string>,
): number {
  let slot = preferredSlot;

  while (occupiedSlots.has(`${owner}:${slot}`)) {
    slot += 1;
  }

  return slot;
}

function isValidEntityLayout(entity: FrameEntity): boolean {
  if (entity.owner === "pendingCapture") {
    return entity.layout.lane === "center" && entity.layout.role === "pendingCapture";
  }

  return entity.layout.lane === entity.owner && entity.layout.role !== "pendingCapture";
}

function createFrameActions(state: GameState, balance: GameBalance): FrameAction[] {
  if (state.phase === "starterChoice") {
    return starterSpeciesIds.map((speciesId) => ({
      id: `start:${speciesId}`,
      label: `${getSpecies(speciesId).name} 선택`,
      role: "primary",
      enabled: true,
      action: { type: "START_RUN", starterSpeciesId: speciesId },
    }));
  }

  if (state.phase === "gameOver") {
    return createGameOverActions(state, balance);
  }

  if (state.phase === "ready") {
    const selectedRoute = getSelectedRouteId(state);

    return [
      routeAction("supply", selectedRoute, state, balance),
      {
        id: "encounter:next",
        label: selectedRoute === "supply" ? "보급 받기" : "전투 시작",
        role: "primary",
        enabled: true,
        action: { type: "RESOLVE_NEXT_ENCOUNTER" },
      },
      ...createReadyShopActions(state, balance),
    ];
  }

  if (state.phase === "captureDecision") {
    const targetEntityId = state.pendingEncounter?.enemyTeam[0]?.instanceId;
    return [
      ...ballTypes.map((ball) => captureBallAction(state, ball, targetEntityId)),
      {
        id: "capture:skip",
        label: "포획 포기",
        role: "danger",
        enabled: true,
        targetEntityId,
        action: { type: "DISCARD_CAPTURE" },
      },
    ];
  }

  if (state.phase === "teamDecision") {
    const capture = state.pendingCapture;
    const keepAction: FrameAction[] =
      state.team.length < balance.maxTeamSize
        ? [
            {
              id: "team:keep",
              label: "팀에 추가",
              role: "primary",
              enabled: true,
              targetEntityId: capture?.instanceId,
              action: { type: "ACCEPT_CAPTURE" },
            },
          ]
        : state.team.map((creature, index) => ({
            id: `team:replace:${index}`,
            label: `${withJosa(creature.speciesName, "와/과")} 교체`,
            role: "primary" as const,
            enabled: true,
            targetEntityId: creature.instanceId,
            action: { type: "ACCEPT_CAPTURE", replaceIndex: index },
          }));

    return [
      ...keepAction,
      {
        id: "team:release",
        label: "포획한 포켓몬 놓아주기",
        role: "danger",
        enabled: true,
        targetEntityId: capture?.instanceId,
        action: { type: "DISCARD_CAPTURE" },
      },
    ];
  }

  return [];
}

function createGameOverActions(state: GameState, balance: GameBalance): FrameAction[] {
  const teamRestartActions = state.team.slice(0, balance.maxTeamSize).map(
    (creature, index): FrameAction => ({
      id: `restart:team:${index}`,
      label: `${index + 1}번 ${creature.speciesName} 재출발`,
      role: "primary",
      enabled: true,
      targetEntityId: creature.instanceId,
      action: { type: "START_RUN", starterSpeciesId: creature.speciesId },
    }),
  );

  return [
    ...teamRestartActions,
    {
      id: "restart:starter-choice",
      label: "스타터 화면으로",
      role: "secondary",
      enabled: true,
      action: { type: "RETURN_TO_STARTER_CHOICE" },
    },
  ];
}

function captureBallAction(
  state: GameState,
  ball: BallType,
  targetEntityId: string | undefined,
): FrameAction {
  const count = state.balls[ball];

  return {
    id: `capture:${ballActionSlug(ball)}`,
    label: `${localizeBall(ball)} 던지기 (${count})`,
    role: "primary",
    enabled: count > 0,
    targetEntityId,
    action: { type: "ATTEMPT_CAPTURE", ball },
    reason: count > 0 ? undefined : `${withJosa(localizeBall(ball), "이/가")} 없습니다`,
  };
}

function createReadyShopActions(state: GameState, balance: GameBalance): FrameAction[] {
  const baseActions = [
    ...createHealActions(state),
    ...createBallShopActions(state, balance),
    ...createScoutActions(state),
    ...createRarityBoostActions(state),
    ...createLevelBoostActions(state),
    ...createStatBoostActions(state),
    ...createStatRerollActions(state),
    ...createTeachMoveActions(state),
    ...createTypeLockActions(state),
  ];
  return baseActions.map((action) => applyShopDeal(action, state));
}

function applyShopDeal(action: FrameAction, state: GameState): FrameAction {
  const deal = state.shopDeal;
  if (!deal || deal.wave !== state.currentWave || action.cost === undefined) {
    return action;
  }
  if (!deal.discountedActionIds.includes(action.id)) {
    return action;
  }
  const discounted = Math.max(1, Math.round(action.cost * (1 - deal.discountRate)));
  return {
    ...action,
    cost: discounted,
    originalCost: action.cost,
    enabled: state.money >= discounted,
    reason: state.money >= discounted ? undefined : "코인이 부족합니다",
  };
}

function createStatBoostActions(state: GameState): FrameAction[] {
  return statBoostTiers.map((tier) => {
    const product = getStatBoostProduct(tier);
    return {
      id: `shop:stat-boost:${tier}`,
      label: `능력치 +${product.bonus} ${formatMoney(product.cost)}`,
      role: "secondary" as const,
      enabled: state.money >= product.cost,
      cost: product.cost,
      action: { type: "BUY_STAT_BOOST" as const, tier },
      reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
    };
  });
}

function createStatRerollActions(state: GameState): FrameAction[] {
  const product = getStatRerollProduct();
  return [
    {
      id: "shop:stat-reroll",
      label: `능력치 재추첨 ${formatMoney(product.cost)}`,
      role: "secondary",
      enabled: state.money >= product.cost,
      cost: product.cost,
      action: { type: "BUY_STAT_REROLL" },
      reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
    },
  ];
}

function createTeachMoveActions(state: GameState): FrameAction[] {
  return teachMoveElements.map((element) => {
    const product = getTeachMoveProduct(element);
    return {
      id: `shop:teach-move:${element}`,
      label: `${localizeType(element)} 기술 머신 ${formatMoney(product.cost)}`,
      role: "secondary" as const,
      enabled: state.money >= product.cost,
      cost: product.cost,
      action: { type: "BUY_TEACH_MOVE" as const, element },
      reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
    };
  });
}

function createTypeLockActions(state: GameState): FrameAction[] {
  return typeLockElements.map((element) => {
    const product = getTypeLockProduct(element);
    return {
      id: `shop:type-lock:${element}`,
      label: `${localizeType(element)} 고정 ${formatMoney(product.cost)}`,
      role: "secondary" as const,
      enabled: state.money >= product.cost,
      cost: product.cost,
      action: { type: "BUY_TYPE_LOCK" as const, element },
      reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
    };
  });
}

function createRarityBoostActions(state: GameState): FrameAction[] {
  return rarityBoostTiers.map((tier) => {
    const product = getRarityBoostProduct(tier);
    const bonusPercent = Math.round(product.bonus * 100);

    return {
      id: `shop:rarity-boost:${tier}`,
      label: `희귀도 +${bonusPercent}% ${formatMoney(product.cost)}`,
      role: "secondary" as const,
      enabled: state.money >= product.cost,
      cost: product.cost,
      action: { type: "BUY_RARITY_BOOST" as const, tier },
      reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
    };
  });
}

function createLevelBoostActions(state: GameState): FrameAction[] {
  return levelBoostTiers.map((tier) => {
    const product = getLevelBoostProduct(tier);

    return {
      id: `shop:level-boost:${tier}`,
      label: `숙련도 ${product.min}~${product.max} ${formatMoney(product.cost)}`,
      role: "secondary" as const,
      enabled: state.money >= product.cost,
      cost: product.cost,
      action: { type: "BUY_LEVEL_BOOST" as const, tier },
      reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
    };
  });
}

function createHealActions(state: GameState): FrameAction[] {
  return [
    ...healTiers.map((tier) => healAction(state, "single", tier)),
    ...healTiers.map((tier) => healAction(state, "team", tier)),
  ];
}

function healAction(state: GameState, scope: HealScope, tier: (typeof healTiers)[number]): FrameAction {
  const product = getHealProduct(scope, tier);
  const isFullTeamRest = scope === "team" && tier === 5;
  const label =
    scope === "team"
      ? `전체 회복 ${tier}단계 ${formatMoney(product.cost)}`
      : `단일 회복 ${tier}단계 ${formatMoney(product.cost)}`;

  return {
    id: isFullTeamRest ? "shop:rest" : `shop:heal:${scope}:${tier}`,
    label,
    role: "secondary",
    enabled: state.money >= product.cost,
    cost: product.cost,
    action: isFullTeamRest ? { type: "REST_TEAM" } : { type: "BUY_HEAL", scope, tier },
    reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
  };
}

function createBallShopActions(state: GameState, balance: GameBalance): FrameAction[] {
  return ballTypes.map((ball) => {
    const cost = getBallCost(ball, balance);

    return {
      id: `shop:${ballActionSlug(ball)}`,
      label: `${localizeBall(ball)} 구매 ${formatMoney(cost)}`,
      role: "secondary",
      enabled: state.money >= cost,
      cost,
      action: { type: "BUY_BALL", ball, quantity: 1 },
      reason: state.money >= cost ? undefined : "코인이 부족합니다",
    };
  });
}

function createScoutActions(state: GameState): FrameAction[] {
  return scoutKinds.flatMap((kind) =>
    scoutTiers.map((tier) => {
      const product = getScoutProduct(kind, tier);
      const label = kind === "rarity" ? "희귀 탐지" : "강도 탐지";

      return {
        id: `shop:scout:${kind}:${tier}`,
        label: `${label} ${tier}단계 ${formatMoney(product.cost)}`,
        role: "secondary" as const,
        enabled: state.money >= product.cost,
        cost: product.cost,
        action: { type: "BUY_SCOUT" as const, kind, tier },
        reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
      };
    }),
  );
}

function createTimeline(state: GameState): FrameTimelineEntry[] {
  return state.events
    .slice()
    .reverse()
    .slice(0, 16)
    .map((event) => ({
      id: `event:${event.id}`,
      wave: event.wave,
      text: event.message,
      tone: toneForEvent(event.type),
    }));
}

function createVisualCues(state: GameState): FrameVisualCue[] {
  const lookup = createBattleEntityLookup(state);
  const battleCues = (state.lastBattle?.replay ?? [])
    .filter(
      (event) =>
        event.type === "damage.apply" ||
        event.type === "move.miss" ||
        isSupportCueEvent(event) ||
        event.type === "creature.faint",
    )
    .slice(-12)
    .map((event) => battleReplayEventToCue(event, lookup))
    .filter((cue): cue is FrameVisualCue => Boolean(cue));
  const captureCue = createCaptureCue(state);

  return [
    ...battleCues,
    ...(captureCue ? [captureCue] : []),
    {
      id: `phase:${state.phase}:${state.currentWave}`,
      type: "phase.change",
      sequence: state.lastBattle?.replay.at(-1)?.sequence ?? 0,
      effectKey: "phase.change",
      soundKey: "sfx.phase.change",
      label: state.phase,
      phase: state.phase,
    },
  ];
}

function createCaptureCue(state: GameState): FrameVisualCue | undefined {
  const latestEvent = state.events.at(-1);
  const latestCapture = parseLatestCaptureAttempt(latestEvent);

  if (!latestEvent || !latestCapture) {
    return undefined;
  }

  const target = state.pendingCapture ?? state.lastBattle?.enemyTeam[0];
  const type = latestCapture.success ? "capture.success" : "capture.fail";

  return {
    id: `capture:${latestEvent.id}:${latestCapture.ball}`,
    type,
    sequence: (state.lastBattle?.replay.at(-1)?.sequence ?? 0) + latestEvent.id,
    effectKey: type,
    soundKey: latestCapture.success ? "sfx.capture.success" : "sfx.capture.fail",
    label: latestCapture.success ? "포획 성공!" : "포획 실패",
    ball: latestCapture.ball,
    targetEntityId: target?.instanceId,
    targetName: target?.speciesName ?? latestCapture.targetName,
  };
}

function createBattleReplay(state: GameState): FrameBattleReplay {
  const lookup = createBattleEntityLookup(state);
  const events = (state.lastBattle?.replay ?? []).map((event) =>
    toFrameBattleReplayEvent(event, lookup),
  );

  return {
    sequenceIndex: events.at(-1)?.sequence ?? 0,
    events,
  };
}

interface BattleEntityLookup {
  name: (entityId: string | undefined) => string;
  side: (entityId: string | undefined) => "player" | "enemy" | undefined;
}

function createBattleEntityLookup(state: GameState): BattleEntityLookup {
  const names = new Map<string, string>();
  const sides = new Map<string, "player" | "enemy">();
  const addCreature = (creature: Creature, side: "player" | "enemy") => {
    names.set(creature.instanceId, creature.speciesName);
    sides.set(creature.instanceId, side);
  };

  state.team.forEach((creature) => addCreature(creature, "player"));
  state.pendingEncounter?.enemyTeam.forEach((creature) => addCreature(creature, "enemy"));
  state.lastBattle?.playerTeam.forEach((creature) => addCreature(creature, "player"));
  state.lastBattle?.enemyTeam.forEach((creature) => addCreature(creature, "enemy"));

  if (state.pendingCapture) {
    names.set(state.pendingCapture.instanceId, state.pendingCapture.speciesName);
  }

  return {
    name: (entityId) => (entityId ? (names.get(entityId) ?? "대상") : "대상"),
    side: (entityId) => (entityId ? sides.get(entityId) : undefined),
  };
}

function toFrameBattleReplayEvent(
  event: BattleReplayEvent,
  lookup: BattleEntityLookup,
): FrameBattleReplayEvent {
  if (event.type === "battle.start") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${localizeEncounterKind(event.kind)} 전투가 시작되었습니다.`,
    };
  }

  if (event.type === "turn.start") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.turn}턴 시작`,
      activePlayerId: event.activePlayerId,
      activeEnemyId: event.activeEnemyId,
    };
  }

  if (event.type === "move.select") {
    const actor = lookup.name(event.actorId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${withJosa(actor, "이/가")} ${withJosa(event.move, "을/를")} 준비했습니다.`,
      move: event.move,
      sourceSide: event.actorSide,
      targetSide: event.targetSide,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
    };
  }

  if (event.type === "move.miss") {
    const actor = lookup.name(event.actorId);
    const target = lookup.name(event.targetId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${withJosa(`${actor}의 ${event.move}`, "이/가")} ${target}에게 빗나갔습니다.`,
      move: event.move,
      sourceSide: lookup.side(event.actorId),
      targetSide: lookup.side(event.targetId),
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
    };
  }

  if (event.type === "move.effect") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: event.label,
      move: event.move,
      moveType: event.moveType,
      moveCategory: event.moveCategory,
      sourceSide: event.actorSide ?? lookup.side(event.actorId),
      targetSide: event.targetSide ?? lookup.side(event.targetId),
      side: event.side,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      entityId: event.type === "move.effect" ? event.entityId : undefined,
    };
  }

  if (event.type === "turn.skip") {
    const entity = lookup.name(event.entityId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${withJosa(entity, "은/는")} 움직일 수 없습니다: ${event.reason}`,
      entityId: event.entityId,
      side: event.side,
      status: event.status,
    };
  }

  if (event.type === "damage.apply") {
    const actor = lookup.name(event.actorId);
    const target = lookup.name(event.targetId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${actor}의 ${event.move}: ${target}에게 ${event.damage} 피해${formatDamageQualifiers(
        event.effectiveness,
        event.critical,
      )}`,
      move: event.move,
      moveType: event.moveType,
      sourceSide: lookup.side(event.actorId),
      targetSide: lookup.side(event.targetId),
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      damage: event.damage,
      targetHpBefore: event.targetHpBefore,
      targetHpAfter: event.targetHpAfter,
      effectiveness: event.effectiveness,
      critical: event.critical,
    };
  }

  if (event.type === "status.apply") {
    const target = lookup.name(event.targetId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${withJosa(target, "이/가")} ${localizeBattleStatus(event.status)} 상태가 되었습니다.`,
      move: event.move,
      sourceSide: lookup.side(event.actorId),
      targetSide: lookup.side(event.targetId),
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      moveType: event.moveType,
      moveCategory: event.moveCategory,
      status: event.status,
    };
  }

  if (event.type === "status.immune") {
    const target = lookup.name(event.targetId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${withJosa(target, "은/는")} ${localizeBattleStatus(event.status)}에 면역입니다.`,
      move: event.move,
      sourceSide: lookup.side(event.actorId),
      targetSide: lookup.side(event.targetId),
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      moveType: event.moveType,
      moveCategory: event.moveCategory,
      status: event.status,
    };
  }

  if (event.type === "status.tick") {
    const entity = lookup.name(event.entityId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${withJosa(entity, "이/가")} ${localizeBattleStatus(event.status)} 피해 ${withJosa(String(event.damage), "을/를")} 받았습니다.`,
      entityId: event.entityId,
      side: event.side,
      damage: event.damage,
      hpBefore: event.hpBefore,
      hpAfter: event.hpAfter,
      status: event.status,
    };
  }

  if (event.type === "status.clear") {
    const entity = lookup.name(event.entityId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${entity}의 ${localizeBattleStatus(event.status)} 상태가 풀렸습니다.`,
      entityId: event.entityId,
      side: event.side,
      status: event.status,
    };
  }

  if (event.type === "creature.faint") {
    const entity = lookup.name(event.entityId);
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${withJosa(entity, "이/가")} 쓰러졌습니다.`,
      entityId: event.entityId,
      side: event.side,
    };
  }

  return {
    sequence: event.sequence,
    turn: event.turn,
    type: event.type,
    label: `${localizeWinner(event.winner)}했습니다.`,
    winner: event.winner,
    playerRemainingHp: event.playerRemainingHp,
    enemyRemainingHp: event.enemyRemainingHp,
  };
}

function formatDamageQualifiers(effectiveness: number, critical: boolean): string {
  const qualifiers = [
    ...(critical ? ["급소"] : []),
    ...(effectiveness > 1 ? ["효과 굉장"] : []),
    ...(effectiveness > 0 && effectiveness < 1 ? ["효과 약함"] : []),
  ];

  return qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : "";
}

function battleHitEffectKey(effectiveness: number, critical: boolean): string {
  if (critical) {
    return "battle.criticalHit";
  }

  if (effectiveness > 1) {
    return "battle.superEffective";
  }

  if (effectiveness > 0 && effectiveness < 1) {
    return "battle.resisted";
  }

  return "battle.hit";
}

function battleHitSoundKey(moveType: ElementType | undefined, critical: boolean): string {
  if (!moveType) {
    return critical ? "sfx.battle.criticalHit" : "sfx.battle.hit";
  }

  return critical ? `sfx.battle.type.${moveType}.critical` : `sfx.battle.type.${moveType}`;
}

function battleSupportSoundKey(moveType: ElementType): string {
  return `sfx.battle.support.type.${moveType}`;
}

function isSupportCueEvent(
  event: BattleReplayEvent,
): event is Extract<
  BattleReplayEvent,
  { type: "move.effect" | "status.apply" | "status.immune" }
> & { moveType: ElementType; moveCategory: "status" } {
  return (
    (event.type === "move.effect" ||
      event.type === "status.apply" ||
      event.type === "status.immune") &&
    event.moveCategory === "status" &&
    Boolean(event.moveType)
  );
}

function battleSupportLabel(
  event: Extract<BattleReplayEvent, { type: "move.effect" | "status.apply" | "status.immune" }>,
  lookup: BattleEntityLookup,
): string {
  if (event.type === "move.effect") {
    return event.label;
  }

  if (event.type === "status.immune") {
    return `${lookup.name(event.targetId)}: ${localizeBattleStatus(event.status)} 면역`;
  }

  return `${lookup.name(event.targetId)}: ${localizeBattleStatus(event.status)}`;
}

function battleReplayEventToCue(
  event: BattleReplayEvent,
  lookup: BattleEntityLookup,
): FrameVisualCue | undefined {
  if (event.type === "move.miss") {
    const actor = lookup.name(event.actorId);
    const target = lookup.name(event.targetId);
    return {
      id: `battle:${event.sequence}:miss`,
      type: "battle.miss",
      sequence: event.sequence,
      effectKey: "battle.miss",
      soundKey: "sfx.battle.miss",
      turn: event.turn,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      label: `${withJosa(`${actor}의 ${event.move}`, "이/가")} ${target}에게 빗나갔습니다.`,
      damage: 0,
      effectiveness: 1,
      critical: false,
    };
  }

  if (event.type === "damage.apply") {
    const actor = lookup.name(event.actorId);
    const target = lookup.name(event.targetId);
    return {
      id: `battle:${event.sequence}:hit`,
      type: "battle.hit",
      sequence: event.sequence,
      effectKey: battleHitEffectKey(event.effectiveness, event.critical),
      soundKey: battleHitSoundKey(event.moveType, event.critical),
      turn: event.turn,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      label: `${actor}의 ${event.move}: ${target}에게 ${event.damage} 피해${formatDamageQualifiers(
        event.effectiveness,
        event.critical,
      )}`,
      damage: event.damage,
      effectiveness: event.effectiveness,
      critical: event.critical,
      moveType: event.moveType,
    };
  }

  if (isSupportCueEvent(event)) {
    return {
      id: `battle:${event.sequence}:support`,
      type: "battle.support",
      sequence: event.sequence,
      effectKey: "battle.support",
      soundKey: battleSupportSoundKey(event.moveType),
      turn: event.turn,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      entityId: event.type === "move.effect" ? event.entityId : undefined,
      label: battleSupportLabel(event, lookup),
      moveType: event.moveType,
    };
  }

  if (event.type === "creature.faint") {
    const entity = lookup.name(event.entityId);
    return {
      id: `faint:${event.sequence}:${event.entityId}`,
      type: "creature.faint",
      sequence: event.sequence,
      effectKey: "creature.faint",
      soundKey: "sfx.creature.faint",
      turn: event.turn,
      entityId: event.entityId,
      label: `${withJosa(entity, "이/가")} 쓰러졌습니다.`,
    };
  }

  return undefined;
}

function createSceneTitle(state: GameState): string {
  if (state.phase === "starterChoice") {
    return "스타터 선택";
  }

  if (state.phase === "gameOver") {
    return "도전 종료";
  }

  return formatWave(state.currentWave);
}

function createSceneSubtitle(state: GameState): string {
  if (state.pendingCapture) {
    return `포획한 ${withJosa(state.pendingCapture.speciesName, "을/를")} 팀과 비교하세요`;
  }

  if (state.pendingEncounter) {
    return state.pendingEncounter.opponentName;
  }

  if (state.phase === "ready") {
    return `${routeActionName(getSelectedRouteId(state))}을 준비하세요`;
  }

  return "다음 만남을 준비하세요";
}

function createStateKey(state: GameState): string {
  return [
    state.seed,
    state.rngState,
    state.phase,
    state.currentWave,
    state.selectedRoute?.id ?? "normal",
    state.money,
    state.team.map((creature) => `${creature.instanceId}:${creature.currentHp}`).join("|"),
    state.events.at(-1)?.id ?? 0,
  ].join(":");
}

function toneForEvent(type: string): FrameTimelineEntry["tone"] {
  if (type.includes("denied") || type.includes("ignored") || type.includes("no_ball")) {
    return "warning";
  }

  if (type.includes("game_over") || type.includes("released")) {
    return "danger";
  }

  if (
    type.includes("kept") ||
    type.includes("succeeded") ||
    type.includes("rested") ||
    type.includes("healed") ||
    type.includes("scout_reported")
  ) {
    return "success";
  }

  return "neutral";
}

function getSelectedRouteId(state: GameState): RouteId {
  return state.selectedRoute?.wave === state.currentWave ? state.selectedRoute.id : "normal";
}

function routeAction(
  routeId: RouteId,
  selectedRoute: RouteId,
  state: GameState,
  balance: GameBalance,
): FrameAction {
  const selected = routeId === selectedRoute;
  const supplyUsed = routeId === "supply" && state.supplyUsedAtWave === state.currentWave;
  const supplyAffordable = routeId !== "supply" || state.money >= balance.supplyRouteCost;
  const enabled = !selected && !supplyUsed && supplyAffordable;

  return {
    id: `route:${routeId}`,
    label:
      routeId === "supply" && !selected
        ? `${routeActionName(routeId)} ${formatMoney(balance.supplyRouteCost)}`
        : selected
          ? `${routeActionName(routeId)} 선택됨`
          : routeActionName(routeId),
    role: selected ? "primary" : "secondary",
    enabled,
    action: { type: "CHOOSE_ROUTE", routeId },
    cost: routeId === "supply" ? balance.supplyRouteCost : undefined,
    reason: selected
      ? "이미 선택된 길입니다"
      : supplyUsed
        ? "보급은 웨이브마다 한 번만 받을 수 있습니다"
        : supplyAffordable
          ? undefined
          : "코인이 부족합니다",
  };
}

function routeActionName(routeId: RouteId): string {
  switch (routeId) {
    case "normal":
      return "일반 탐험";
    case "elite":
      return "강적 탐험";
    case "supply":
      return "보급";
  }
}
