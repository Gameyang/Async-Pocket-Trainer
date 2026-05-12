import { getSpecies, starterSpeciesIds } from "../data/catalog";
import { getTeamHealthRatio, scoreTeam } from "../scoring";
import type {
  BattleStatus,
  BattleReplayEvent,
  Creature,
  GameAction,
  GameBalance,
  GamePhase,
  GameState,
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
  balls: {
    pokeBall: number;
    greatBall: number;
  };
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
}

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
  moves: Array<{
    id: string;
    name: string;
    type: string;
    power: number;
    accuracy: number;
  }>;
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
  sourceEntityId?: string;
  targetEntityId?: string;
  entityId?: string;
  damage?: number;
  effectiveness?: number;
  critical?: boolean;
  status?: BattleStatus;
  winner?: "player" | "enemy";
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
      label: string;
      damage: number;
      effectiveness: number;
      critical: boolean;
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
      soundKey?: string;
      label: string;
      phase: GamePhase;
    };

export function createGameFrame(
  state: GameState,
  balance: GameBalance,
  frameId: number,
): GameFrame {
  const playerEntities = state.team.map((creature, index) =>
    toFrameEntity(creature, "player", index),
  );
  const opponentTeam =
    state.phase === "captureDecision"
      ? (state.pendingEncounter?.enemyTeam ?? [])
      : state.phase === "gameOver"
        ? (state.lastBattle?.enemyTeam ?? [])
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
      title: "Async Pocket Trainer",
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

  for (const cue of frame.visualCues) {
    if (!Number.isInteger(cue.sequence) || cue.sequence < 0) {
      errors.push(`cue ${cue.id} has invalid sequence ${cue.sequence}`);
    }

    if (!cue.effectKey) {
      errors.push(`cue ${cue.id} has no effect key`);
    }

    if (cue.type === "phase.change") {
      continue;
    }

    if (cue.type === "creature.faint" && !entityIds.has(cue.entityId)) {
      errors.push(`cue references missing faint entity ${cue.entityId}`);
    }

    if (
      (cue.type === "battle.hit" || cue.type === "battle.miss") &&
      !entityIds.has(cue.sourceEntityId)
    ) {
      errors.push(`cue references missing source entity ${cue.sourceEntityId}`);
    }

    if (
      (cue.type === "battle.hit" || cue.type === "battle.miss") &&
      !entityIds.has(cue.targetEntityId)
    ) {
      errors.push(`cue references missing target entity ${cue.targetEntityId}`);
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
    typeLabels: [...creature.types],
    hp: {
      current: creature.currentHp,
      max: creature.stats.hp,
      ratio:
        creature.stats.hp === 0 ? 0 : Number((creature.currentHp / creature.stats.hp).toFixed(4)),
    },
    stats: { ...creature.stats },
    moves: creature.moves.map((move) => ({
      id: move.id,
      name: move.name,
      type: move.type,
      power: move.power,
      accuracy: move.accuracy,
    })),
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
  if (state.phase === "starterChoice" || state.phase === "gameOver") {
    return starterSpeciesIds.map((speciesId) => ({
      id: `start:${speciesId}`,
      label: `Start ${getSpecies(speciesId).name}`,
      role: "primary",
      enabled: true,
      action: { type: "START_RUN", starterSpeciesId: speciesId },
    }));
  }

  if (state.phase === "ready") {
    return [
      {
        id: "encounter:next",
        label: "Next Encounter",
        role: "primary",
        enabled: true,
        action: { type: "RESOLVE_NEXT_ENCOUNTER" },
      },
      {
        id: "shop:rest",
        label: `Rest ${balance.teamRestCost}c`,
        role: "secondary",
        enabled: state.money >= balance.teamRestCost,
        cost: balance.teamRestCost,
        action: { type: "REST_TEAM" },
        reason: state.money >= balance.teamRestCost ? undefined : "Not enough money.",
      },
      {
        id: "shop:pokeball",
        label: `Buy Poke Ball ${balance.pokeBallCost}c`,
        role: "secondary",
        enabled: state.money >= balance.pokeBallCost,
        cost: balance.pokeBallCost,
        action: { type: "BUY_BALL", ball: "pokeBall", quantity: 1 },
      },
      {
        id: "shop:greatball",
        label: `Buy Great Ball ${balance.greatBallCost}c`,
        role: "secondary",
        enabled: state.money >= balance.greatBallCost,
        cost: balance.greatBallCost,
        action: { type: "BUY_BALL", ball: "greatBall", quantity: 1 },
      },
    ];
  }

  if (state.phase === "captureDecision") {
    const targetEntityId = state.pendingEncounter?.enemyTeam[0]?.instanceId;
    return [
      {
        id: "capture:pokeball",
        label: `Poke Ball (${state.balls.pokeBall})`,
        role: "primary",
        enabled: state.balls.pokeBall > 0,
        targetEntityId,
        action: { type: "ATTEMPT_CAPTURE", ball: "pokeBall" },
      },
      {
        id: "capture:greatball",
        label: `Great Ball (${state.balls.greatBall})`,
        role: "primary",
        enabled: state.balls.greatBall > 0,
        targetEntityId,
        action: { type: "ATTEMPT_CAPTURE", ball: "greatBall" },
      },
      {
        id: "capture:skip",
        label: "Skip",
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
              label: "Keep",
              role: "primary",
              enabled: true,
              targetEntityId: capture?.instanceId,
              action: { type: "ACCEPT_CAPTURE" },
            },
          ]
        : state.team.map((creature, index) => ({
            id: `team:replace:${index}`,
            label: `Replace ${creature.speciesName}`,
            role: "primary" as const,
            enabled: true,
            targetEntityId: creature.instanceId,
            action: { type: "ACCEPT_CAPTURE", replaceIndex: index },
          }));

    return [
      ...keepAction,
      {
        id: "team:release",
        label: "Release",
        role: "danger",
        enabled: true,
        targetEntityId: capture?.instanceId,
        action: { type: "DISCARD_CAPTURE" },
      },
    ];
  }

  return [];
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
  const battleCues = (state.lastBattle?.replay ?? [])
    .filter(
      (event) =>
        event.type === "damage.apply" ||
        event.type === "move.miss" ||
        event.type === "creature.faint",
    )
    .slice(-12)
    .map((event) => battleReplayEventToCue(event))
    .filter((cue): cue is FrameVisualCue => Boolean(cue));

  return [
    ...battleCues,
    {
      id: `phase:${state.phase}:${state.currentWave}`,
      type: "phase.change",
      sequence: state.lastBattle?.replay.at(-1)?.sequence ?? 0,
      effectKey: "phase.change",
      label: state.phase,
      phase: state.phase,
    },
  ];
}

function createBattleReplay(state: GameState): FrameBattleReplay {
  const events = (state.lastBattle?.replay ?? []).map(toFrameBattleReplayEvent);

  return {
    sequenceIndex: events.at(-1)?.sequence ?? 0,
    events,
  };
}

function toFrameBattleReplayEvent(event: BattleReplayEvent): FrameBattleReplayEvent {
  if (event.type === "battle.start") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.kind} battle started.`,
    };
  }

  if (event.type === "turn.start") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `Turn ${event.turn} started.`,
    };
  }

  if (event.type === "move.select") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.actorId} selected ${event.move}.`,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
    };
  }

  if (event.type === "move.miss") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.actorId} missed ${event.move}.`,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
    };
  }

  if (event.type === "turn.skip") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.entityId} skipped the turn: ${event.reason}`,
      entityId: event.entityId,
      status: event.status,
    };
  }

  if (event.type === "damage.apply") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.actorId} dealt ${event.damage} damage with ${event.move}.`,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      damage: event.damage,
      effectiveness: event.effectiveness,
      critical: event.critical,
    };
  }

  if (event.type === "status.apply") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.targetId} was afflicted with ${event.status}.`,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      status: event.status,
    };
  }

  if (event.type === "status.immune") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.targetId} resisted ${event.status}.`,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      status: event.status,
    };
  }

  if (event.type === "status.tick") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.entityId} took ${event.damage} ${event.status} damage.`,
      entityId: event.entityId,
      damage: event.damage,
      status: event.status,
    };
  }

  if (event.type === "status.clear") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.entityId} recovered from ${event.status}.`,
      entityId: event.entityId,
      status: event.status,
    };
  }

  if (event.type === "creature.faint") {
    return {
      sequence: event.sequence,
      turn: event.turn,
      type: event.type,
      label: `${event.entityId} fainted.`,
      entityId: event.entityId,
    };
  }

  return {
    sequence: event.sequence,
    turn: event.turn,
    type: event.type,
    label: `${event.winner} won the battle.`,
    winner: event.winner,
  };
}

function battleReplayEventToCue(event: BattleReplayEvent): FrameVisualCue | undefined {
  if (event.type === "move.miss") {
    return {
      id: `battle:${event.sequence}:miss`,
      type: "battle.miss",
      sequence: event.sequence,
      effectKey: "battle.miss",
      soundKey: "sfx.battle.miss",
      turn: event.turn,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      label: `${event.actorId} missed ${event.move}.`,
      damage: 0,
      effectiveness: 1,
      critical: false,
    };
  }

  if (event.type === "damage.apply") {
    return {
      id: `battle:${event.sequence}:hit`,
      type: "battle.hit",
      sequence: event.sequence,
      effectKey: event.critical ? "battle.criticalHit" : "battle.hit",
      soundKey: event.critical ? "sfx.battle.criticalHit" : "sfx.battle.hit",
      turn: event.turn,
      sourceEntityId: event.actorId,
      targetEntityId: event.targetId,
      label: `${event.actorId} used ${event.move}.`,
      damage: event.damage,
      effectiveness: event.effectiveness,
      critical: event.critical,
    };
  }

  if (event.type === "creature.faint") {
    return {
      id: `faint:${event.sequence}:${event.entityId}`,
      type: "creature.faint",
      sequence: event.sequence,
      effectKey: "creature.faint",
      soundKey: "sfx.creature.faint",
      turn: event.turn,
      entityId: event.entityId,
      label: `${event.entityId} fainted.`,
    };
  }

  return undefined;
}

function createSceneTitle(state: GameState): string {
  if (state.phase === "starterChoice") {
    return "Choose a starter";
  }

  if (state.phase === "gameOver") {
    return "Run ended";
  }

  return `Wave ${state.currentWave}`;
}

function createSceneSubtitle(state: GameState): string {
  if (state.pendingCapture) {
    return `Compare captured ${state.pendingCapture.speciesName}`;
  }

  if (state.pendingEncounter) {
    return state.pendingEncounter.opponentName;
  }

  return "Prepare for the next encounter";
}

function createStateKey(state: GameState): string {
  return [
    state.seed,
    state.rngState,
    state.phase,
    state.currentWave,
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

  if (type.includes("kept") || type.includes("succeeded") || type.includes("rested")) {
    return "success";
  }

  return "neutral";
}
