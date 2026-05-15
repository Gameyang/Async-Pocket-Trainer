import { getMove, getSpecies, starterSpeciesIds } from "../data/catalog";
import {
  BATTLE_FIELD_WAVE_SPAN,
  normalizeBattleFieldOrder,
  resolveBattleFieldForWave,
} from "../battleField";
import {
  calculateDexUnlockReward,
  calculateSkillUnlockReward,
  getDexRewardAchievementId,
  getSkillRewardAchievementId,
  isAchievementClaimed,
} from "../achievements";
import { normalizeCreatureMoves } from "../creatureFactory";
import { calculatePokemonStats, createEmptyStats, createPokemonStatProfile } from "../pokemonStats";
import {
  ballActionSlug,
  getBallCost,
  getHealItemName,
  getHealProduct,
  getLevelBoostProduct,
  getPremiumOffer,
  getRarityBoostProduct,
  getStatBoostProduct,
  getTeachMoveProduct,
  getTeamSortProduct,
  getTypeLockProduct,
  hasPremiumOffer,
  healTiers,
  levelBoostTiers,
  premiumOfferIds,
  rarityBoostTiers,
  shopStatKeys,
  statBoostTiers,
  teachMoveElements,
  teamSortActionId,
  teamSortOptions,
  typeLockElements,
} from "../shopCatalog";
import { SeededRng } from "../rng";
import {
  formatMoney,
  formatTrainerPoints,
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
import { getLearnableLevelUpMoves } from "../moveLearning";
import { getTeamHealthRatio, scoreCreature, scoreTeam } from "../scoring";
import { ballTypes } from "../types";
import trainerPortraitManifest from "../../resources/trainers/trainerPortraitManifest.json" with { type: "json" };
import {
  createTrainerPortraitShopOffers,
  getSelectedTrainerPortraitId,
  getTrainerPortrait,
  getTrainerPortraitAssetPath,
  isTrainerPortraitOwned,
  trainerPortraitActionId,
} from "../trainerPortraits";
import type {
  BattleFieldId,
  BattleStat,
  BattleStatus,
  BattleFieldState,
  BattleReplayEvent,
  BattleResult,
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
  PremiumOfferId,
  RouteId,
  ShopStatKey,
  ShopInventory,
  SortDirection,
  SpeciesDefinition,
  TeamRecordChange,
  TeamRecordSummary,
  TeamSortKey,
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
  trainerPoints: number;
  trainerPortrait?: FrameTrainerPortrait;
  battleField: BattleFieldState;
  encounterBoost?: {
    rarityBonus?: number;
    levelMin?: number;
    levelMax?: number;
    lockedType?: ElementType;
  };
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
  battleField: BattleFieldState;
  worldMap?: FrameBattleFieldMap;
  bgmKey: FrameBgmKey;
  bgmTrackKey: string;
  teamEffect?: { entityId: string; kind: string; key: string };
}

export type FrameBattleFieldMapMode = "start" | "transition" | "travel";
export type FrameBattleFieldMapNodeStatus = "previous" | "active" | "next";
export type FrameBattleFieldMapNodeKind = "field" | "start";
export type FrameBattleFieldMapNodeId = BattleFieldId | "starter-town";

export interface FrameBattleFieldMap {
  mode: FrameBattleFieldMapMode;
  activeIndex: number;
  nextIndex: number;
  cycle: number;
  progressInField: number;
  progressTotal: number;
  nodes: FrameBattleFieldMapNode[];
}

export interface FrameBattleFieldMapNode {
  index: number;
  id: FrameBattleFieldMapNodeId;
  kind: FrameBattleFieldMapNodeKind;
  label: string;
  element: ElementType;
  elementLabel: string;
  timeOfDay: BattleFieldState["timeOfDay"];
  timeLabel: string;
  waveStart: number;
  waveEnd: number;
  levelLabel: string;
  status: FrameBattleFieldMapNodeStatus;
}

export interface FrameStarterOption {
  speciesId: number;
  name: string;
  level: number;
  typeLabels: string[];
  types: ElementType[];
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

export interface FrameTrainerPortrait {
  id: string;
  label: string;
  assetPath: string;
  owned: boolean;
  selected: boolean;
}

export interface FrameMoveSummary {
  id: string;
  name: string;
  type: string;
  typeKey: ElementType;
  power: number;
  accuracy: number;
  accuracyLabel: string;
  category: MoveCategory;
  priority: number;
  effect: string;
}

export interface FrameMoveDexEntry {
  moveId: string;
  level: number;
  learned: boolean;
  source: "level-up" | "loadout";
  unlocked: boolean;
  rewardClaimable: boolean;
  rewardClaimed: boolean;
  rewardTrainerPoints: number;
  move?: FrameMoveSummary;
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
  teamName: string;
  greeting?: string;
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
  speciesIdentifier?: string;
  level: number;
  typeLabels: string[];
  types: ElementType[];
  hp: {
    current: number;
    max: number;
    ratio: number;
  };
  battleStatus?: BattleStatus;
  stats: {
    hp: number;
    attack: number;
    defense: number;
    special: number;
    speed: number;
  };
  moves: FrameMoveSummary[];
  moveDex: FrameMoveDexEntry[];
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
  tpCost?: number;
  portrait?: FrameTrainerPortrait;
  requiresTarget?: boolean;
  targetCount?: 1 | 2;
  sameSpeciesRequired?: boolean;
  eligibleTargetIds?: string[];
  reason?: string;
}

export interface FrameTimelineEntry {
  id: string;
  wave: number;
  type: string;
  text: string;
  data?: Record<string, unknown>;
  tone: "neutral" | "success" | "warning" | "danger";
}

export interface FrameBattleReplay {
  sequenceIndex: number;
  events: FrameBattleReplayEvent[];
}

export type FrameBattleReplayEventType =
  | BattleReplayEvent["type"]
  | "trainer.intro"
  | "trainer.throw"
  | "creature.summon"
  | "trainer.outro";

export type FrameBattleCeremonyStage = "intro" | "throw" | "summon" | "outro";

export interface FrameBattleReplayEvent {
  sequence: number;
  sourceSequence?: number;
  turn: number;
  type: FrameBattleReplayEventType;
  label: string;
  ceremonyStage?: FrameBattleCeremonyStage;
  playerLine?: string;
  opponentLine?: string;
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
      soundKeys?: string[];
      cryKey?: string;
      turn: number;
      sourceEntityId: string;
      targetEntityId: string;
      entityId?: string;
      label: string;
      damage: number;
      effectiveness: number;
      critical: boolean;
      moveType?: ElementType;
      moveCategory?: MoveCategory;
    }
  | {
      id: string;
      type: "battle.support";
      sequence: number;
      effectKey: string;
      soundKey: string;
      soundKeys?: string[];
      cryKey?: string;
      turn: number;
      sourceEntityId?: string;
      targetEntityId?: string;
      entityId?: string;
      label: string;
      moveType?: ElementType;
      moveCategory?: MoveCategory;
    }
  | {
      id: string;
      type: "creature.faint";
      sequence: number;
      effectKey: string;
      soundKey: string;
      soundKeys?: string[];
      cryKey?: string;
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
      soundKeys?: string[];
      cryKey?: string;
      label: string;
      phase: GamePhase;
    }
  | {
      id: string;
      type: "capture.success" | "capture.fail";
      sequence: number;
      effectKey: string;
      soundKey: string;
      soundKeys?: string[];
      cryKey?: string;
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
  const dexContext = createFrameDexContext(state);
  const currentBattleField = resolveBattleFieldForWave(state.currentWave, state.battleFieldOrder);
  const sceneBattleField = resolveSceneBattleField(state, currentBattleField);
  const worldMap = createBattleFieldWorldMap(state);
  const trainerPortrait = createFrameTrainerPortrait(
    getSelectedTrainerPortraitId(state.metaCurrency),
    state,
  );
  const playerEntities = state.team.map((creature, index) =>
    toFrameEntity(creature, "player", index, dexContext),
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
    toFrameEntity(creature, "opponent", index, dexContext),
  );
  const pendingCaptureEntity = state.pendingCapture
    ? toFrameEntity(state.pendingCapture, "pendingCapture", 0, dexContext)
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
    addFrameEntity(toFrameEntity(creature, owner, resolvedSlot, dexContext));
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
      trainerPoints: state.metaCurrency?.trainerPoints ?? 0,
      trainerPortrait,
      battleField: currentBattleField,
      encounterBoost:
        state.encounterBoost && state.encounterBoost.wave === state.currentWave
          ? {
              rarityBonus: state.encounterBoost.rarityBonus,
              levelMin: state.encounterBoost.levelMin,
              levelMax: state.encounterBoost.levelMax,
              lockedType: state.encounterBoost.lockedType,
            }
          : undefined,
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
      battleField: sceneBattleField,
      worldMap,
      bgmKey: createBgmKey(state),
      bgmTrackKey: createBgmTrackKey(state),
      teamEffect:
        state.lastTeamEffect && state.lastTeamEffect.frameId >= frameId
          ? {
              entityId: state.lastTeamEffect.entityId,
              kind: state.lastTeamEffect.kind,
              key: `${state.lastTeamEffect.kind}:${state.lastTeamEffect.frameId}`,
            }
          : undefined,
    },
    entities,
    actions: createFrameActions(state, balance),
    timeline: createTimeline(state),
    battleReplay: createBattleReplay(state),
    visualCues: createVisualCues(state),
  };
}

function createBattleFieldWorldMap(state: GameState): FrameBattleFieldMap {
  const order = normalizeBattleFieldOrder(state.battleFieldOrder);
  const normalizedWave = Math.max(1, Math.floor(state.currentWave));
  const activeBlock = Math.floor((normalizedWave - 1) / BATTLE_FIELD_WAVE_SPAN);
  const cycleIndex = Math.floor(activeBlock / order.length);
  const activeIndex = activeBlock % order.length;
  const nextIndex = (activeIndex + 1) % order.length;
  const previousIndex = (activeIndex + order.length - 1) % order.length;
  const progressInField = ((normalizedWave - 1) % BATTLE_FIELD_WAVE_SPAN) + 1;
  const mode: FrameBattleFieldMapMode =
    normalizedWave === 1 ? "start" : progressInField === 1 ? "transition" : "travel";
  const previousBlock =
    activeBlock === 0 ? cycleIndex * order.length + previousIndex : activeBlock - 1;
  const nodeBlocks =
    normalizedWave === 1
      ? [
          { index: -1, block: -1, status: "previous" as const, kind: "start" as const },
          {
            index: activeIndex,
            block: activeBlock,
            status: "active" as const,
            kind: "field" as const,
          },
          {
            index: nextIndex,
            block: activeBlock + 1,
            status: "next" as const,
            kind: "field" as const,
          },
        ]
      : [
          {
            index: previousIndex,
            block: previousBlock,
            status: "previous" as const,
            kind: "field" as const,
          },
          {
            index: activeIndex,
            block: activeBlock,
            status: "active" as const,
            kind: "field" as const,
          },
          {
            index: nextIndex,
            block: activeBlock + 1,
            status: "next" as const,
            kind: "field" as const,
          },
        ];

  return {
    mode,
    activeIndex,
    nextIndex,
    cycle: cycleIndex + 1,
    progressInField,
    progressTotal: BATTLE_FIELD_WAVE_SPAN,
    nodes: nodeBlocks.map((node) => {
      if (node.kind === "start") {
        return createStarterTownWorldMapNode();
      }

      const nodeWave = node.block * BATTLE_FIELD_WAVE_SPAN + 1;
      const field = resolveBattleFieldForWave(nodeWave, order);
      return {
        index: node.index,
        id: field.id,
        kind: node.kind,
        label: field.label,
        element: field.element,
        elementLabel: localizeType(field.element),
        timeOfDay: field.timeOfDay,
        timeLabel: field.timeLabel,
        waveStart: field.waveStart,
        waveEnd: field.waveEnd,
        levelLabel: `Lv. ${field.waveStart}-${field.waveEnd}`,
        status: node.status,
      };
    }),
  };
}

function createStarterTownWorldMapNode(): FrameBattleFieldMapNode {
  return {
    index: -1,
    id: "starter-town",
    kind: "start",
    label: "태초마을",
    element: "normal",
    elementLabel: "마을",
    timeOfDay: "day",
    timeLabel: "출발",
    waveStart: 0,
    waveEnd: 0,
    levelLabel: "START",
    status: "previous",
  };
}

function resolveSceneBattleField(
  state: GameState,
  currentBattleField: BattleFieldState,
): BattleFieldState {
  return state.pendingEncounter?.battleField ?? state.lastBattle?.battleField ?? currentBattleField;
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

  if (!/^bgm\.showdown\.[a-z0-9-]+$/.test(frame.scene.bgmTrackKey)) {
    errors.push(`scene has invalid bgm track key ${frame.scene.bgmTrackKey}`);
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

    for (const soundKey of cue.soundKeys ?? []) {
      if (!soundKey) {
        errors.push(`cue ${cue.id} has an empty supplemental sound key`);
      }
    }

    if (cue.cryKey && !/^sfx\.cry\.[a-z0-9-]+$/.test(cue.cryKey)) {
      errors.push(`cue ${cue.id} has invalid cry key ${cue.cryKey}`);
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

const generatedTrainerPortraits = trainerPortraitManifest.generated;
const sheetTrainerPortrait = trainerPortraitManifest.sheet;

const showdownStarterBgmStems = [
  "xy-rival",
  "bw-rival",
  "bw2-rival",
  "dpp-rival",
  "oras-rival",
  "sm-rival",
] as const;
const showdownBattleBgmStems = [
  "bw-trainer",
  "bw2-homika-dogars",
  "bw2-kanto-gym-leader",
  "dpp-trainer",
  "hgss-johto-trainer",
  "hgss-kanto-trainer",
  "oras-trainer",
  "sm-trainer",
  "xy-trainer",
  "spl-elite4",
] as const;
const showdownTeamDecisionBgmStems = [
  "bw-subway-trainer",
  "colosseum-miror-b",
  "xd-miror-b",
] as const;
const showdownGameOverBgmStems = [
  "spl-elite4",
  "xd-miror-b",
  "colosseum-miror-b",
  "bw2-kanto-gym-leader",
] as const;

function createFrameTrainerPortrait(portraitId: string, state: GameState): FrameTrainerPortrait {
  const portrait = getTrainerPortrait(portraitId);

  return {
    id: portrait.id,
    label: portrait.label,
    assetPath: portrait.assetPath,
    owned: isTrainerPortraitOwned(state.metaCurrency, portrait.id),
    selected: getSelectedTrainerPortraitId(state.metaCurrency) === portrait.id,
  };
}

interface FrameDexContext {
  unlockedMoveIds: ReadonlySet<string>;
  claimedAchievementIds: ReadonlySet<string>;
}

function createFrameDexContext(state: GameState): FrameDexContext {
  return {
    unlockedMoveIds: new Set(state.unlockedMoveIds ?? []),
    claimedAchievementIds: new Set(state.metaCurrency?.claimedAchievements ?? []),
  };
}

function createStarterOptions(state: GameState): FrameStarterOption[] {
  if (state.phase !== "starterChoice") {
    return [];
  }

  return starterSpeciesIds.map((speciesId) => speciesToStarterOption(getSpecies(speciesId)));
}

export function speciesToStarterOption(species: SpeciesDefinition): FrameStarterOption {
  const starterLevel = 5;
  const moves = normalizeCreatureMoves(
    species.id,
    starterLevel,
    species.movePool.map((moveId) => getMove(moveId)),
  );
  const statProfile = createPokemonStatProfile({
    seed: `starter-option:${species.id}`,
    speciesId: species.id,
    level: starterLevel,
    role: "starter",
  });
  const stats = calculatePokemonStats(
    species.baseStats,
    starterLevel,
    statProfile,
    createEmptyStats(),
  );

  return {
    speciesId: species.id,
    name: species.name,
    level: starterLevel,
    typeLabels: localizeTypes(species.types),
    types: [...species.types],
    assetKey: `monster:${species.id}`,
    assetPath: `resources/pokemon/${species.id.toString().padStart(4, "0")}.webp`,
    power: scoreCreature({ stats, moves, types: species.types }),
    moves: moves.map(toFrameMoveSummary),
    stats,
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
  const teamName = opponentTeam?.snapshotTeamName ?? trainerName;
  const portraitPath = pickTrainerPortrait(
    trainerName,
    source,
    opponentTeam?.snapshotTrainerPortraitId,
  );

  return {
    source,
    label: source === "sheet" ? "시트 트레이너" : "트레이너",
    trainerName,
    teamName,
    greeting: opponentTeam?.snapshotTrainerGreeting,
    portraitKey: `trainer:${portraitPath.split("/").at(-1)?.replace(".webp", "") ?? "portrait"}`,
    portraitPath,
    teamPower: opponentTeam?.teamPower,
    record: opponentTeam?.record,
    recordChange: state.lastBattle?.opponentTeamRecordChange,
  };
}

function pickTrainerPortrait(
  trainerName: string,
  source: EncounterSource,
  savedPortraitId?: string,
): string {
  if (source === "sheet") {
    return savedPortraitId ? getTrainerPortraitAssetPath(savedPortraitId) : sheetTrainerPortrait;
  }

  const hash = trainerName.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return generatedTrainerPortraits[hash % generatedTrainerPortraits.length];
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

function createBgmTrackKey(state: GameState): string {
  if (state.phase === "gameOver") {
    return toShowdownBgmTrackKey(pickByWave(showdownGameOverBgmStems, state));
  }

  if (state.phase === "teamDecision") {
    return toShowdownBgmTrackKey(pickByWave(showdownTeamDecisionBgmStems, state));
  }

  if (state.phase === "captureDecision" || state.lastBattle?.replay.length) {
    return toShowdownBgmTrackKey(pickByWave(showdownBattleBgmStems, state));
  }

  return toShowdownBgmTrackKey(pickByWave(showdownStarterBgmStems, state));
}

function pickByWave<const T extends readonly string[]>(stems: T, state: GameState): T[number] {
  const phaseOffset = positiveHash(`${state.seed}:${state.phase}`) % stems.length;
  const waveOffset = Math.max(0, state.currentWave - 1);
  const index = (phaseOffset + waveOffset) % stems.length;
  return stems[index];
}

function toShowdownBgmTrackKey(stem: string): string {
  return `bgm.showdown.${stem}`;
}

function toFrameEntity(
  creature: Creature,
  owner: FrameEntityOwner,
  slot: number,
  dexContext: FrameDexContext,
): FrameEntity {
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
    speciesIdentifier: getSpecies(creature.speciesId).identifier,
    level: creature.level ?? 1,
    typeLabels: localizeTypes(creature.types),
    types: [...creature.types],
    hp: {
      current: creature.currentHp,
      max: creature.stats.hp,
      ratio:
        creature.stats.hp === 0 ? 0 : Number((creature.currentHp / creature.stats.hp).toFixed(4)),
    },
    ...(creature.status ? { battleStatus: creature.status.type } : {}),
    stats: { ...creature.stats },
    moves: creature.moves.map(toFrameMoveSummary),
    moveDex: createMoveDexEntries(creature, dexContext),
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
    typeKey: move.type,
    power: move.power,
    accuracy: move.accuracy,
    accuracyLabel:
      move.accuracyPercent === undefined ? "-" : `${Math.round(move.accuracyPercent)}%`,
    category: move.category,
    priority: move.priority,
    effect: createMoveEffectText(move),
  };
}

function createMoveDexEntries(
  creature: Creature,
  dexContext: FrameDexContext,
): FrameMoveDexEntry[] {
  const species = getSpecies(creature.speciesId);
  const learnedMoveIds = new Set(creature.moves.map((move) => move.id));
  const speciesMoveIds = new Set(species.levelUpMoves.map((entry) => entry.moveId));
  const loadoutEntries = creature.moves
    .filter((move) => !speciesMoveIds.has(move.id))
    .map((move) =>
      createMoveDexEntry({
        moveId: move.id,
        level: creature.level ?? 1,
        source: "loadout",
        learned: true,
        dexContext,
      }),
    );

  return [
    ...loadoutEntries,
    ...species.levelUpMoves.map((entry) =>
      createMoveDexEntry({
        moveId: entry.moveId,
        level: entry.level,
        source: "level-up",
        learned: learnedMoveIds.has(entry.moveId),
        dexContext,
      }),
    ),
  ];
}

function createMoveDexEntry(options: {
  moveId: string;
  level: number;
  learned: boolean;
  source: FrameMoveDexEntry["source"];
  dexContext: FrameDexContext;
}): FrameMoveDexEntry {
  const unlocked = options.learned || options.dexContext.unlockedMoveIds.has(options.moveId);
  const rewardId = getSkillRewardAchievementId(options.moveId);
  const rewardTrainerPoints = calculateSkillUnlockReward(options.moveId) ?? 0;
  const rewardClaimed = options.dexContext.claimedAchievementIds.has(rewardId);

  return {
    moveId: options.moveId,
    level: options.level,
    learned: options.learned,
    source: options.source,
    unlocked,
    rewardClaimable: unlocked && rewardTrainerPoints > 0 && !rewardClaimed,
    rewardClaimed,
    rewardTrainerPoints,
    move: unlocked ? toFrameMoveSummary(getMove(options.moveId)) : undefined,
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

  let match = normalized.match(
    /^Has a (\d+)% chance to (paralyze|burn|poison|freeze|confuse) the target\.$/,
  );
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

  match = normalized.match(
    /^Raises the user's ([A-Za-z ,and-]+) by (one|two|three) stages? each\.$/,
  );
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
    return [
      ...starterSpeciesIds.map(
        (speciesId): FrameAction => ({
          id: `start:${speciesId}`,
          label: `${getSpecies(speciesId).name} 선택`,
          role: "primary",
          enabled: true,
          action: { type: "START_RUN", starterSpeciesId: speciesId },
        }),
      ),
      ...createDexRewardClaimActions(state),
    ];
  }

  if (state.phase === "gameOver") {
    return createGameOverActions(state, balance);
  }

  if (state.phase === "ready") {
    return [
      {
        id: "encounter:next",
        label: "전투 시작",
        role: "primary",
        enabled: true,
        action: { type: "RESOLVE_NEXT_ENCOUNTER" },
      },
      ...createReadyShopActions(state, balance),
      ...createSkillRewardClaimActions(state),
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

function createDexRewardClaimActions(state: GameState): FrameAction[] {
  const meta = state.metaCurrency;
  return (state.unlockedSpeciesIds ?? [])
    .map((speciesId): FrameAction | undefined => {
      const reward = calculateDexUnlockReward(speciesId);
      const rewardId = getDexRewardAchievementId(speciesId);
      if (!reward || isAchievementClaimed(meta, rewardId)) {
        return undefined;
      }

      return {
        id: `claim:dex:${speciesId}`,
        label: `도감 보상 ${formatTrainerPoints(reward)}`,
        role: "secondary",
        enabled: true,
        action: { type: "CLAIM_DEX_REWARD", speciesId },
      };
    })
    .filter((action): action is FrameAction => Boolean(action));
}

function createSkillRewardClaimActions(state: GameState): FrameAction[] {
  const meta = state.metaCurrency;
  return (state.unlockedMoveIds ?? [])
    .map((moveId): FrameAction | undefined => {
      const reward = calculateSkillUnlockReward(moveId);
      const rewardId = getSkillRewardAchievementId(moveId);
      if (!reward || isAchievementClaimed(meta, rewardId)) {
        return undefined;
      }

      return {
        id: `claim:skill:${moveId}`,
        label: `기술 도감 보상 ${formatTrainerPoints(reward)}`,
        role: "secondary",
        enabled: true,
        action: { type: "CLAIM_SKILL_REWARD", moveId },
      };
    })
    .filter((action): action is FrameAction => Boolean(action));
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
  const allActions = [
    ...createHealActions(state),
    ...createBallShopActions(state, balance),
    ...createRarityBoostActions(state),
    ...createLevelBoostActions(state),
    ...createStatBoostActions(state),
    ...createTeachMoveActions(state),
    ...createTeamSortActions(state),
    ...createTypeLockActions(state),
    ...createPremiumActions(state),
    ...createTrainerPortraitActions(state),
  ];
  const inventory =
    state.shopInventory && state.shopInventory.wave === state.currentWave
      ? state.shopInventory
      : undefined;
  const visibleActions = inventory ? filterByInventory(allActions, inventory) : allActions;
  return [
    ...visibleActions.map((action) => applyShopDeal(action, state)),
    createRerollAction(state, inventory?.rerollCount ?? 0),
  ];
}

function filterByInventory(actions: FrameAction[], inventory: ShopInventory): FrameAction[] {
  const idMap = new Map(inventory.entries.map((entry) => [entry.actionId, entry]));
  return actions
    .filter((action) => idMap.has(action.id))
    .map((action) => {
      const entry = idMap.get(action.id);
      if (!entry || entry.stock <= 0) {
        return {
          ...action,
          enabled: false,
          reason: "재고가 없습니다",
        };
      }
      return action;
    });
}

function createRerollAction(state: GameState, rerollCount: number): FrameAction {
  const cost = computeRerollCost(rerollCount);
  return {
    id: "shop:reroll",
    label: `상점 재구성 ${formatMoney(cost)}`,
    role: "secondary",
    enabled: state.money >= cost,
    cost,
    action: { type: "REROLL_SHOP_INVENTORY" },
    reason: state.money >= cost ? undefined : "코인이 부족합니다",
  };
}

export function computeRerollCost(rerollCount: number): number {
  return 12 + rerollCount * 10;
}

function createPremiumActions(state: GameState): FrameAction[] {
  const tp = state.metaCurrency?.trainerPoints ?? 0;
  const offerIds = resolveActivePremiumOffers(state);
  return offerIds.map((offerId) => {
    const offer = getPremiumOffer(offerId);
    const effect = offer.effect;
    const eligibleTargetIds = resolvePremiumEligibleTargetIds(state, offer);
    const targetBlocked = offer.targetRequired && eligibleTargetIds?.length === 0;
    return {
      id: `shop:${offerId}`,
      label: `${offer.label.replace(/^TP\s+/, "")} ${formatTrainerPoints(offer.tpCost)}`,
      role: "secondary" as const,
      enabled: tp >= offer.tpCost && !targetBlocked,
      tpCost: offer.tpCost,
      requiresTarget: offer.targetRequired,
      targetCount: offer.targetCount,
      sameSpeciesRequired: offer.sameSpeciesRequired,
      eligibleTargetIds,
      action: { type: "BUY_PREMIUM_SHOP_ITEM" as const, offerId },
      reason:
        tp < offer.tpCost
          ? "보석이 부족합니다"
          : targetBlocked
            ? resolvePremiumTargetBlockedReason(effect.kind)
            : undefined,
    };
  });
}

function resolvePremiumEligibleTargetIds(
  state: GameState,
  offer: ReturnType<typeof getPremiumOffer>,
): string[] | undefined {
  const effect = offer.effect;

  if (effect.kind === "teachMove") {
    return state.team
      .filter(
        (creature) =>
          getLearnableLevelUpMoves(creature, effect.element, {
            grade: effect.grade,
          }).length > 0,
      )
      .map((creature) => creature.instanceId);
  }

  if (effect.kind === "sellCoin" || effect.kind === "sellBall" || effect.kind === "speciesLure") {
    return state.team.length > 1 ? state.team.map((creature) => creature.instanceId) : [];
  }

  if (
    effect.kind === "fuseEvolution" ||
    effect.kind === "fuseStats" ||
    effect.kind === "fuseMoveDex"
  ) {
    const duplicateSpeciesIds = findDuplicateSpeciesIds(state.team);
    return state.team
      .filter((creature) => {
        if (!duplicateSpeciesIds.has(creature.speciesId)) {
          return false;
        }
        if (
          effect.kind === "fuseEvolution" &&
          getSpecies(creature.speciesId).evolvesTo.length === 0
        ) {
          return false;
        }
        if (effect.kind === "fuseMoveDex" && !hasLockedMoveDexCandidate(creature, state)) {
          return false;
        }
        return true;
      })
      .map((creature) => creature.instanceId);
  }

  return undefined;
}

function findDuplicateSpeciesIds(team: readonly Creature[]): Set<number> {
  const counts = new Map<number, number>();
  for (const creature of team) {
    counts.set(creature.speciesId, (counts.get(creature.speciesId) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count >= 2).map(([speciesId]) => speciesId),
  );
}

function hasLockedMoveDexCandidate(creature: Creature, state: GameState): boolean {
  const unlockedMoveIds = new Set(state.unlockedMoveIds ?? []);
  const knownMoveIds = new Set(creature.moves.map((move) => move.id));
  return getSpecies(creature.speciesId).levelUpMoves.some(
    (entry) => !unlockedMoveIds.has(entry.moveId) && !knownMoveIds.has(entry.moveId),
  );
}

function resolvePremiumTargetBlockedReason(effectKind: string): string {
  switch (effectKind) {
    case "teachMove":
      return "배울 수 있는 팀원이 없습니다";
    case "sellCoin":
    case "sellBall":
    case "speciesLure":
      return "마지막 팀원은 보낼 수 없습니다";
    case "fuseEvolution":
      return "진화 가능한 같은 포켓몬 2마리가 필요합니다";
    case "fuseStats":
      return "같은 포켓몬 2마리가 필요합니다";
    case "fuseMoveDex":
      return "숨겨진 스킬이 있는 같은 포켓몬 2마리가 필요합니다";
    default:
      return "대상 팀원이 없습니다";
  }
}

function createTrainerPortraitActions(state: GameState): FrameAction[] {
  const tp = state.metaCurrency?.trainerPoints ?? 0;
  const selectedId = getSelectedTrainerPortraitId(state.metaCurrency);

  return createTrainerPortraitShopOffers(state.seed, state.currentWave, state.metaCurrency).map(
    (portrait): FrameAction => {
      const owned = isTrainerPortraitOwned(state.metaCurrency, portrait.id);
      const selected = selectedId === portrait.id;
      const canAfford = tp >= portrait.tpCost;
      const portraitView: FrameTrainerPortrait = {
        id: portrait.id,
        label: portrait.label,
        assetPath: portrait.assetPath,
        owned,
        selected,
      };

      return {
        id: trainerPortraitActionId(portrait.id),
        label: owned
          ? `${portrait.label} 적용`
          : `${portrait.label} ${formatTrainerPoints(portrait.tpCost)}`,
        role: "secondary",
        enabled: selected ? false : owned || canAfford,
        tpCost: owned ? undefined : portrait.tpCost,
        portrait: portraitView,
        action: { type: "BUY_TRAINER_PORTRAIT", portraitId: portrait.id },
        reason: selected
          ? "이미 적용 중인 스킨입니다"
          : owned || canAfford
            ? undefined
            : "보석이 부족합니다",
      };
    },
  );
}

function resolveActivePremiumOffers(state: GameState): PremiumOfferId[] {
  const cached = state.premiumOfferIds;
  const cachedIds = cached?.ids.filter(hasPremiumOffer) ?? [];
  if (cached && cached.wave === state.currentWave && cachedIds.length > 0) {
    return cachedIds;
  }
  return rollPremiumOffers(state.seed, state.currentWave);
}

function rollPremiumOffers(seed: string, wave: number): PremiumOfferId[] {
  const rng = new SeededRng(`${seed}:premium:${wave}`);
  const shuffled = rng.shuffle(premiumOfferIds);
  const count = 1 + Math.floor(rng.nextFloat() * 2);
  return shuffled.slice(0, Math.min(count, shuffled.length));
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
  const targetBlocked = action.requiresTarget && action.eligibleTargetIds?.length === 0;
  const blockedByActionState =
    !action.enabled && action.reason !== undefined && action.reason !== "코인이 부족합니다";
  return {
    ...action,
    cost: discounted,
    originalCost: action.cost,
    enabled: state.money >= discounted && !targetBlocked && !blockedByActionState,
    reason:
      state.money < discounted
        ? "코인이 부족합니다"
        : blockedByActionState
          ? action.reason
          : targetBlocked
            ? (action.reason ?? "배울 수 있는 팀원이 없습니다")
            : undefined,
  };
}

function formatShopStatLabel(stat: ShopStatKey): string {
  switch (stat) {
    case "hp":
      return "HP";
    case "attack":
      return "공격";
    case "defense":
      return "방어";
    case "special":
      return "특수";
    case "speed":
      return "속도";
  }
}

function formatTeamSortLabel(sortBy: TeamSortKey, direction: SortDirection): string {
  const sortLabel = sortBy === "power" ? "전투력" : "건강상태";
  const directionLabel = direction === "asc" ? "오름차순" : "내림차순";
  return `${sortLabel} ${directionLabel}`;
}

function wouldSortTeamOrderChange(
  team: readonly Creature[],
  sortBy: TeamSortKey,
  direction: SortDirection,
): boolean {
  return sortTeamMemberIds(team, sortBy, direction).some(
    (id, index) => id !== team[index]?.instanceId,
  );
}

function sortTeamMemberIds(
  team: readonly Creature[],
  sortBy: TeamSortKey,
  direction: SortDirection,
): string[] {
  const directionFactor = direction === "asc" ? 1 : -1;
  return team
    .map((creature, index) => ({
      id: creature.instanceId,
      index,
      value: teamSortValue(creature, sortBy),
    }))
    .sort((left, right) => (left.value - right.value) * directionFactor || left.index - right.index)
    .map((entry) => entry.id);
}

function teamSortValue(creature: Creature, sortBy: TeamSortKey): number {
  if (sortBy === "power") {
    return creature.powerScore;
  }

  return creature.stats.hp <= 0 ? 0 : creature.currentHp / creature.stats.hp;
}

function createStatBoostActions(state: GameState): FrameAction[] {
  return shopStatKeys.flatMap((stat) =>
    statBoostTiers.map((tier) => {
      const product = getStatBoostProduct(stat, tier);
      return {
        id: `shop:stat-boost:${stat}:${tier}`,
        label: `${formatShopStatLabel(stat)} +${product.bonus} ${formatMoney(product.cost)}`,
        role: "secondary" as const,
        enabled: state.money >= product.cost,
        cost: product.cost,
        requiresTarget: true,
        action: { type: "BUY_STAT_BOOST" as const, stat, tier },
        reason: state.money >= product.cost ? undefined : "코인이 부족합니다",
      };
    }),
  );
}

function createTeachMoveActions(state: GameState): FrameAction[] {
  return teachMoveElements.map((element) => {
    const product = getTeachMoveProduct(element);
    const eligibleTargetIds = state.team
      .filter((creature) => getLearnableLevelUpMoves(creature, element).length > 0)
      .map((creature) => creature.instanceId);
    const hasEligibleTarget = eligibleTargetIds.length > 0;
    return {
      id: `shop:teach-move:${element}`,
      label: `${localizeType(element)} 기술머신 ${formatMoney(product.cost)}`,
      role: "secondary" as const,
      enabled: state.money >= product.cost && hasEligibleTarget,
      cost: product.cost,
      requiresTarget: true,
      eligibleTargetIds,
      action: { type: "BUY_TEACH_MOVE" as const, element },
      reason:
        state.money < product.cost
          ? "코인이 부족합니다"
          : hasEligibleTarget
            ? undefined
            : "배울 수 있는 팀원이 없습니다",
    };
  });
}

function createTeamSortActions(state: GameState): FrameAction[] {
  return teamSortOptions.map((option) => {
    const product = getTeamSortProduct(option.sortBy, option.direction);
    const actionId = teamSortActionId(option.sortBy, option.direction);
    const wouldChange = wouldSortTeamOrderChange(state.team, option.sortBy, option.direction);
    const hasEnoughMoney = state.money >= product.cost;
    return {
      id: actionId,
      label: `팀 정렬 ${formatTeamSortLabel(option.sortBy, option.direction)} ${formatMoney(product.cost)}`,
      role: "secondary" as const,
      enabled: hasEnoughMoney && wouldChange,
      cost: product.cost,
      action: {
        type: "SORT_TEAM" as const,
        sortBy: option.sortBy,
        direction: option.direction,
      },
      reason: hasEnoughMoney
        ? wouldChange
          ? undefined
          : "이미 해당 기준으로 정렬되어 있습니다"
        : "코인이 부족합니다",
    };
  });
}

function createTypeLockActions(state: GameState): FrameAction[] {
  return typeLockElements.map((element) => {
    const product = getTypeLockProduct(element);
    return {
      id: `shop:type-lock:${element}`,
      label: `${localizeType(element)} 타입 고정 ${formatMoney(product.cost)}`,
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
      label: `희귀 포켓몬 확률 +${bonusPercent}% ${formatMoney(product.cost)}`,
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
      label: `다음 만남 레벨 +${product.min}~${product.max} ${formatMoney(product.cost)}`,
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

function healAction(
  state: GameState,
  scope: HealScope,
  tier: (typeof healTiers)[number],
): FrameAction {
  const product = getHealProduct(scope, tier);
  const isFullTeamRest = scope === "team" && tier === 5;
  const itemName = getHealItemName(tier);
  const label =
    scope === "team"
      ? `팀 ${itemName} ${formatMoney(product.cost)}`
      : `${itemName} ${formatMoney(product.cost)}`;

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

function createTimeline(state: GameState): FrameTimelineEntry[] {
  return state.events
    .slice()
    .reverse()
    .slice(0, 16)
    .map((event) => ({
      id: `event:${event.id}`,
      wave: event.wave,
      type: event.type,
      text: event.message,
      data: event.data,
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
      cryKey: createEncounterCryKey(state),
      label: state.phase,
      phase: state.phase,
    },
  ];
}

function createEncounterCryKey(state: GameState): string | undefined {
  if (state.phase !== "captureDecision") {
    return undefined;
  }

  const creature = state.pendingCapture ?? state.lastBattle?.enemyTeam[0];
  return creature ? toCrySoundKey(getSpecies(creature.speciesId).identifier) : undefined;
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
    cryKey: target ? toCrySoundKey(getSpecies(target.speciesId).identifier) : undefined,
    label: latestCapture.success ? "포획 성공!" : "포획 실패",
    ball: latestCapture.ball,
    targetEntityId: target?.instanceId,
    targetName: target?.speciesName ?? latestCapture.targetName,
  };
}

function createBattleReplay(state: GameState): FrameBattleReplay {
  const lookup = createBattleEntityLookup(state);
  const baseEvents = (state.lastBattle?.replay ?? []).map((event) =>
    toFrameBattleReplayEvent(event, lookup),
  );
  const events = createBattleCeremonyReplay(state, baseEvents);

  return {
    sequenceIndex: events.at(-1)?.sequence ?? 0,
    events,
  };
}

function createBattleCeremonyReplay(
  state: GameState,
  events: FrameBattleReplayEvent[],
): FrameBattleReplayEvent[] {
  const battle = state.lastBattle;

  if (!battle || events.length < 2) {
    return events;
  }

  const endEvent = events.at(-1);
  if (!endEvent || endEvent.type !== "battle.end") {
    return events;
  }

  const playerLeadId = battle.playerTeam[0]?.instanceId;
  const playerLeadName = battle.playerTeam[0]?.speciesName ?? "파트너";
  const opponentLeadId = battle.enemyTeam[0]?.instanceId;
  const battleWave = resolveBattleReplayWave(state, battle);
  const opponentName =
    state.pendingEncounter?.opponentName ??
    battle.opponentName ??
    (battle.kind === "trainer" ? "상대 트레이너" : battle.enemyTeam[0]?.speciesName) ??
    "야생 포켓몬";
  const introEvents = createBattleIntroEvents(
    battle.kind,
    state.trainerName,
    opponentName,
    playerLeadName,
    `${state.seed}:${battleWave}:${battle.kind}:${playerLeadId ?? ""}`,
    playerLeadId,
    opponentLeadId,
  );
  const hasTrainerOutro = battle.kind === "trainer";

  const startEvent = events[0];

  if (shouldPlayBattleFieldMapIntroForWave(battleWave) && startEvent?.type === "battle.start") {
    const introEventsAfterMap = introEvents.map((event) => ({
      ...event,
      sequence: event.sequence + 1,
    }));
    const remappedEvents = events.slice(1).map((event, index, restEvents) => {
      const isFinalEvent = index === restEvents.length - 1;

      return {
        ...event,
        sequence: event.sequence + (isFinalEvent && hasTrainerOutro ? 4 : 3),
        sourceSequence: event.sequence,
      };
    });
    const finalEndEvent = remappedEvents.at(-1);

    if (finalEndEvent) {
      const firstEvent = {
        ...startEvent,
        sequence: 1,
        sourceSequence: startEvent.sequence,
      };

      if (!hasTrainerOutro) {
        return [firstEvent, ...introEventsAfterMap, ...remappedEvents];
      }

      return [
        firstEvent,
        ...introEventsAfterMap,
        ...remappedEvents.slice(0, -1),
        createTrainerBattleOutroEvent({
          sequence: finalEndEvent.sequence - 1,
          turn: finalEndEvent.turn,
          winner: battle.winner,
          playerName: state.trainerName,
          opponentName,
          playerLeadId,
          opponentLeadId,
        }),
        finalEndEvent,
      ];
    }
  }

  const remappedEvents = events.map((event, index) => {
    const isFinalEvent = index === events.length - 1;

    return {
      ...event,
      sequence: event.sequence + (isFinalEvent && hasTrainerOutro ? 4 : 3),
      sourceSequence: event.sequence,
    };
  });
  const finalEndEvent = remappedEvents.at(-1);

  if (!finalEndEvent) {
    return events;
  }

  if (!hasTrainerOutro) {
    return [...introEvents, ...remappedEvents];
  }

  return [
    ...introEvents,
    ...remappedEvents.slice(0, -1),
    createTrainerBattleOutroEvent({
      sequence: finalEndEvent.sequence - 1,
      turn: finalEndEvent.turn,
      winner: battle.winner,
      playerName: state.trainerName,
      opponentName,
      playerLeadId,
      opponentLeadId,
    }),
    finalEndEvent,
  ];
}

function shouldPlayBattleFieldMapIntroForWave(wave: number): boolean {
  const normalizedWave = Math.max(1, Math.floor(wave));

  return normalizedWave === 1 || (normalizedWave - 1) % BATTLE_FIELD_WAVE_SPAN === 0;
}

function resolveBattleReplayWave(state: GameState, battle: BattleResult): number {
  const eventWave = [...state.events]
    .reverse()
    .find((event) => event.type === "battle_resolved" || event.type === "capture_attempted")?.wave;

  return Math.max(
    1,
    Math.floor(battle.wave ?? eventWave ?? state.pendingEncounter?.wave ?? state.currentWave),
  );
}

function createBattleIntroEvents(
  kind: "wild" | "trainer",
  playerName: string,
  opponentName: string,
  playerLeadName: string,
  lineSeed: string,
  playerLeadId: string | undefined,
  opponentLeadId: string | undefined,
): FrameBattleReplayEvent[] {
  const isTrainer = kind === "trainer";
  const readyLine = createTrainerPokemonLine(playerLeadName, `${lineSeed}:ready`);
  const throwLine = createTrainerPokemonLine(playerLeadName, `${lineSeed}:throw`);
  const summonLine = createTrainerPokemonLine(playerLeadName, `${lineSeed}:summon`);

  return [
    {
      sequence: 1,
      turn: 0,
      type: "trainer.intro",
      ceremonyStage: "intro",
      label: isTrainer
        ? `${playerName}와 ${opponentName}이 전투 필드에 등장했습니다.`
        : `${playerName}이 야생 ${opponentName}과의 전투를 준비합니다.`,
      playerLine: readyLine,
      opponentLine: isTrainer ? "좋아, 승부를 시작하지." : undefined,
      activePlayerId: playerLeadId,
      activeEnemyId: opponentLeadId,
    },
    {
      sequence: 2,
      turn: 0,
      type: "trainer.throw",
      ceremonyStage: "throw",
      label: isTrainer
        ? "두 트레이너가 몬스터볼을 던졌습니다."
        : `${playerName}이 몬스터볼을 던졌습니다.`,
      playerLine: throwLine,
      opponentLine: isTrainer ? "앞으로!" : undefined,
      activePlayerId: playerLeadId,
      activeEnemyId: opponentLeadId,
    },
    {
      sequence: 3,
      turn: 0,
      type: "creature.summon",
      ceremonyStage: "summon",
      label: isTrainer
        ? "첫 포켓몬이 전투 필드에 소환되었습니다."
        : `첫 포켓몬이 나오고 야생 ${opponentName}이 모습을 드러냅니다.`,
      playerLine: summonLine,
      opponentLine: isTrainer ? "전력을 보여줘." : undefined,
      activePlayerId: playerLeadId,
      activeEnemyId: opponentLeadId,
    },
  ];
}

const trainerPokemonLineTemplates = [
  "가라, {pokemon}~!",
  "나와라, {pokemon}!",
  "{pokemon}, 너로 정했다!",
  "{pokemon}, 부탁해!",
  "출전이다, {pokemon}!",
  "보여줘, {pokemon}!",
  "준비됐지, {pokemon}?",
  "{pokemon}, 첫 수는 맡긴다!",
] as const;

function createTrainerPokemonLine(pokemonName: string, seed: string): string {
  const name = pokemonName.trim() || "파트너";
  const template =
    trainerPokemonLineTemplates[
      positiveHash(`${seed}:${name}`) % trainerPokemonLineTemplates.length
    ];

  return template.replace("{pokemon}", name);
}

function createTrainerBattleOutroEvent(options: {
  sequence: number;
  turn: number;
  winner: "player" | "enemy";
  playerName: string;
  opponentName: string;
  playerLeadId: string | undefined;
  opponentLeadId: string | undefined;
}): FrameBattleReplayEvent {
  const playerWon = options.winner === "player";

  return {
    sequence: options.sequence,
    turn: options.turn,
    type: "trainer.outro",
    ceremonyStage: "outro",
    label: playerWon
      ? `${options.playerName}의 승리로 전투가 마무리되었습니다.`
      : `${options.opponentName}의 승리로 전투가 마무리되었습니다.`,
    playerLine: playerWon ? "좋았어. 다음 전투도 준비하자." : "아직 끝나지 않았어.",
    opponentLine: playerWon ? "강하군. 다음에는 지지 않겠어." : "승부는 내가 가져간다.",
    activePlayerId: options.playerLeadId,
    activeEnemyId: options.opponentLeadId,
    winner: options.winner,
  };
}

interface BattleEntityLookup {
  name: (entityId: string | undefined) => string;
  side: (entityId: string | undefined) => "player" | "enemy" | undefined;
  cryKey: (entityId: string | undefined) => string | undefined;
}

function createBattleEntityLookup(state: GameState): BattleEntityLookup {
  const names = new Map<string, string>();
  const sides = new Map<string, "player" | "enemy">();
  const cryKeys = new Map<string, string>();
  const addCreature = (creature: Creature, side: "player" | "enemy") => {
    names.set(creature.instanceId, creature.speciesName);
    sides.set(creature.instanceId, side);
    cryKeys.set(creature.instanceId, toCrySoundKey(getSpecies(creature.speciesId).identifier));
  };

  state.team.forEach((creature) => addCreature(creature, "player"));
  state.pendingEncounter?.enemyTeam.forEach((creature) => addCreature(creature, "enemy"));
  state.lastBattle?.playerTeam.forEach((creature) => addCreature(creature, "player"));
  state.lastBattle?.enemyTeam.forEach((creature) => addCreature(creature, "enemy"));

  if (state.pendingCapture) {
    names.set(state.pendingCapture.instanceId, state.pendingCapture.speciesName);
    cryKeys.set(
      state.pendingCapture.instanceId,
      toCrySoundKey(getSpecies(state.pendingCapture.speciesId).identifier),
    );
  }

  return {
    name: (entityId) => (entityId ? (names.get(entityId) ?? "대상") : "대상"),
    side: (entityId) => (entityId ? sides.get(entityId) : undefined),
    cryKey: (entityId) => (entityId ? cryKeys.get(entityId) : undefined),
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
      moveType: event.moveType,
      moveCategory: event.moveCategory,
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
      moveCategory: event.moveCategory,
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

function toCrySoundKey(speciesIdentifier: string): string {
  return `sfx.cry.${speciesIdentifier}`;
}

function positiveHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function battleHitSoundKey(moveType: ElementType | undefined, critical: boolean): string {
  if (!moveType) {
    return critical ? "sfx.battle.critical.hit" : "sfx.battle.hit";
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
      moveType: event.moveType,
      moveCategory: event.moveCategory,
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
      moveCategory: event.moveCategory,
    };
  }

  if (isSupportCueEvent(event)) {
    const supportEntityId = event.type === "move.effect" ? event.entityId : undefined;
    return {
      id: `battle:${event.sequence}:support`,
      type: "battle.support",
      sequence: event.sequence,
      effectKey: "battle.support",
      soundKey: battleSupportSoundKey(event.moveType),
      turn: event.turn,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      entityId: supportEntityId,
      label: battleSupportLabel(event, lookup),
      moveType: event.moveType,
      moveCategory: event.moveCategory,
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
      cryKey: lookup.cryKey(event.entityId),
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
    state.battleFieldOrder?.join(",") ?? "",
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

// (routeAction was removed when supply was retired from the shop.)

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
