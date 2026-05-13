import type { FrameEntity, FrameVisualCue, GameFrame } from "../game/view/frame";
import { formatMoney, formatWave, localizeBall } from "../game/localization";

export interface CanvasFrameRenderer {
  render(frame: GameFrame): void;
}

export interface CanvasFrameRendererOptions {
  width?: number;
  height?: number;
  resolveAssetPath?: (assetPath: string) => string;
}

export function createCanvasFrameRenderer(
  canvas: HTMLCanvasElement,
  options: CanvasFrameRendererOptions = {},
): CanvasFrameRenderer {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const width = options.width ?? 430;
  const height = options.height ?? 640;
  const resolveAssetPath = options.resolveAssetPath ?? ((assetPath: string) => assetPath);
  const imageCache = new Map<string, HTMLImageElement>();
  canvas.width = width;
  canvas.height = height;

  return {
    render(frame: GameFrame) {
      drawFrame(context, frame, {
        width,
        height,
        resolveAssetPath,
        imageCache,
      });
    },
  };
}

interface DrawContext {
  width: number;
  height: number;
  resolveAssetPath: (assetPath: string) => string;
  imageCache: Map<string, HTMLImageElement>;
}

interface CanvasActiveEntities {
  player?: FrameEntity;
  opponent?: FrameEntity;
}

function getLatestVisualCue(frame: GameFrame): FrameVisualCue | undefined {
  return [...frame.visualCues].reverse().find((cue) => cue.type !== "phase.change");
}

function resolveActiveCanvasEntities(
  frame: GameFrame,
  entitiesById: ReadonlyMap<string, FrameEntity>,
  latestCue: FrameVisualCue | undefined,
): CanvasActiveEntities {
  const entityFromCue = (owner: "player" | "opponent"): FrameEntity | undefined => {
    const ids =
      latestCue?.type === "battle.hit" || latestCue?.type === "battle.miss"
        ? [latestCue.sourceEntityId, latestCue.targetEntityId]
        : latestCue?.type === "creature.faint"
          ? [latestCue.entityId]
          : latestCue?.type === "capture.success" || latestCue?.type === "capture.fail"
            ? [latestCue.targetEntityId]
            : [];

    return ids
      .map((id) => (id ? entitiesById.get(id) : undefined))
      .find((entity): entity is FrameEntity => entity?.owner === owner);
  };
  const firstLivingSlot = (ids: readonly string[]) =>
    ids
      .map((id) => entitiesById.get(id))
      .find((entity): entity is FrameEntity => entity !== undefined && entity.hp.current > 0);
  const firstSlot = (ids: readonly string[]) =>
    ids.map((id) => entitiesById.get(id)).find((entity): entity is FrameEntity => Boolean(entity));
  const pendingCapture = frame.scene.pendingCaptureId
    ? entitiesById.get(frame.scene.pendingCaptureId)
    : undefined;

  return {
    player:
      entityFromCue("player") ??
      firstLivingSlot(frame.scene.playerSlots) ??
      firstSlot(frame.scene.playerSlots),
    opponent:
      pendingCapture ??
      entityFromCue("opponent") ??
      firstLivingSlot(frame.scene.opponentSlots) ??
      firstSlot(frame.scene.opponentSlots),
  };
}

function drawFrame(context: CanvasRenderingContext2D, frame: GameFrame, draw: DrawContext): void {
  context.clearRect(0, 0, draw.width, draw.height);
  drawDevice(context, frame, draw);

  const entitiesById = new Map(frame.entities.map((entity) => [entity.id, entity]));
  const latestCue = getLatestVisualCue(frame);
  const activeEntities = resolveActiveCanvasEntities(frame, entitiesById, latestCue);
  const drawnEntityIds = new Set<string>();
  const drawOnce = (entity: FrameEntity | undefined) => {
    if (!entity || drawnEntityIds.has(entity.id)) {
      return;
    }

    drawnEntityIds.add(entity.id);
    drawEntity(context, entity, draw, latestCue);
  };
  const capture = frame.scene.pendingCaptureId
    ? entitiesById.get(frame.scene.pendingCaptureId)
    : undefined;

  drawOnce(activeEntities.opponent);
  drawOnce(activeEntities.player);
  drawOnce(capture);

  if (drawnEntityIds.size === 0) {
    for (const entityId of [...frame.scene.opponentSlots, ...frame.scene.playerSlots]) {
      drawOnce(entitiesById.get(entityId));
    }
  }

  drawVisualCue(context, latestCue, entitiesById, draw);
  drawBattleSummary(context, frame, latestCue, draw);
  drawTeamStrip(context, frame, entitiesById, draw);
  drawCommandPanel(context, frame, draw);
}

function drawDevice(context: CanvasRenderingContext2D, frame: GameFrame, draw: DrawContext): void {
  context.fillStyle = "#26384f";
  context.fillRect(0, 0, draw.width, draw.height);
  context.fillStyle = "#f8f1dc";
  context.fillRect(12, 12, draw.width - 24, 54);
  context.fillStyle = "#17202a";
  context.font = "700 16px sans-serif";
  context.fillText(frame.hud.title, 24, 43);
  context.font = "700 12px sans-serif";
  context.textAlign = "right";
  context.fillText(
    `${formatWave(frame.hud.wave)}  ${formatMoney(frame.hud.money)}`,
    draw.width - 24,
    35,
  );
  context.fillText(
    `${localizeBall("pokeBall")} ${frame.hud.balls.pokeBall}  ${localizeBall("greatBall")} ${frame.hud.balls.greatBall}`,
    draw.width - 24,
    53,
  );
  context.textAlign = "left";

  const screenTop = 78;
  const screenHeight = draw.height - 196;
  const grassTop = screenTop + screenHeight * 0.52;
  const skyGradient = context.createLinearGradient(0, screenTop, 0, grassTop);
  skyGradient.addColorStop(0, "#8bd8ff");
  skyGradient.addColorStop(1, "#ffe189");
  context.fillStyle = skyGradient;
  context.fillRect(12, screenTop, draw.width - 24, screenHeight);
  context.fillStyle = "#58b368";
  context.fillRect(12, grassTop, draw.width - 24, screenHeight - (grassTop - screenTop));

  drawPlatform(context, draw.width * 0.7, screenTop + screenHeight * 0.34, 150, 48);
  drawPlatform(context, draw.width * 0.31, screenTop + screenHeight * 0.74, 190, 58);
}

function drawPlatform(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): void {
  context.save();
  context.fillStyle = "#70b865";
  context.strokeStyle = "#2f7e54";
  context.lineWidth = 3;
  context.beginPath();
  context.ellipse(centerX, centerY, width / 2, height / 2, 0, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawEntity(
  context: CanvasRenderingContext2D,
  entity: FrameEntity,
  draw: DrawContext,
  latestCue: FrameVisualCue | undefined,
): void {
  const position = entityPosition(entity, draw);
  const image = getImage(entity, draw);
  const effect = resolveCueEffect(entity, latestCue);
  const offset = resolveCueOffset(entity, latestCue, effect);
  const fainted = entity.flags.includes("fainted") || effect === "faint";

  context.save();
  context.globalAlpha = fainted ? 0.58 : effect === "resisted-hit" ? 0.84 : 1;
  if (image.complete && image.naturalWidth > 0) {
    context.drawImage(
      image,
      position.x + offset.x - position.size / 2,
      position.y + offset.y - position.size,
      position.size,
      position.size,
    );
  } else {
    context.fillStyle = entity.owner === "opponent" ? "#8161cb" : "#48a7c5";
    context.fillRect(
      position.x + offset.x - position.size / 3,
      position.y + offset.y - position.size,
      position.size * 0.66,
      position.size * 0.66,
    );
  }
  context.restore();

  context.fillStyle = "#fffbe9";
  context.strokeStyle = "#17202a";
  context.lineWidth = 2;
  context.fillRect(position.cardX, position.cardY, 150, 54);
  context.strokeRect(position.cardX, position.cardY, 150, 54);
  context.fillStyle = "#17202a";
  context.font = "700 11px sans-serif";
  context.fillText(entity.name.slice(0, 14), position.cardX + 8, position.cardY + 16);
  context.textAlign = "right";
  context.font = "700 10px sans-serif";
  context.fillText(
    `${entity.hp.current}/${entity.hp.max}`,
    position.cardX + 142,
    position.cardY + 16,
  );
  context.textAlign = "left";
  context.fillStyle = "#6b5e4b";
  context.fillRect(position.cardX + 8, position.cardY + 25, 128, 9);
  context.fillStyle = hpColor(entity.hp.ratio);
  context.fillRect(position.cardX + 8, position.cardY + 25, Math.max(0, 128 * entity.hp.ratio), 9);
  context.fillStyle = "#34413c";
  context.font = "700 9px sans-serif";
  context.fillText(
    [...entity.typeLabels.slice(0, 2), ...(fainted ? ["기절"] : [])].join(" / ").slice(0, 22),
    position.cardX + 8,
    position.cardY + 47,
  );
}

function resolveCueEffect(
  entity: FrameEntity,
  latestCue: FrameVisualCue | undefined,
): "attack" | "hit" | "critical-hit" | "super-effective" | "resisted-hit" | "miss" | "faint" | "" {
  if (!latestCue) {
    return "";
  }

  if (latestCue.type === "creature.faint" && latestCue.entityId === entity.id) {
    return "faint";
  }

  if (latestCue.type === "battle.hit" || latestCue.type === "battle.miss") {
    if (latestCue.sourceEntityId === entity.id) {
      return "attack";
    }

    if (latestCue.targetEntityId !== entity.id) {
      return "";
    }

    if (latestCue.type === "battle.miss") {
      return "miss";
    }

    if (latestCue.critical) {
      return "critical-hit";
    }

    if (latestCue.effectiveness > 1) {
      return "super-effective";
    }

    if (latestCue.effectiveness > 0 && latestCue.effectiveness < 1) {
      return "resisted-hit";
    }

    return "hit";
  }

  return "";
}

function resolveCueOffset(
  entity: FrameEntity,
  latestCue: FrameVisualCue | undefined,
  effect: ReturnType<typeof resolveCueEffect>,
): { x: number; y: number } {
  if (!latestCue || !effect) {
    return { x: 0, y: 0 };
  }

  if (effect === "attack") {
    return entity.owner === "player" ? { x: 12, y: -7 } : { x: -12, y: 7 };
  }

  if (effect === "miss") {
    return { x: 0, y: -12 };
  }

  if (effect === "faint") {
    return { x: 0, y: 16 };
  }

  if (effect === "resisted-hit") {
    return { x: latestCue.sequence % 2 === 0 ? 3 : -3, y: 0 };
  }

  return { x: latestCue.sequence % 2 === 0 ? 7 : -7, y: 0 };
}

function hpColor(ratio: number): string {
  if (ratio <= 0.25) {
    return "#e25248";
  }

  if (ratio <= 0.5) {
    return "#f0b83e";
  }

  return "#4fc46b";
}

function drawVisualCue(
  context: CanvasRenderingContext2D,
  latestCue: FrameVisualCue | undefined,
  entitiesById: ReadonlyMap<string, FrameEntity>,
  draw: DrawContext,
): void {
  if (!latestCue) {
    return;
  }

  const targetId =
    latestCue.type === "battle.hit" || latestCue.type === "battle.miss"
      ? latestCue.targetEntityId
      : latestCue.type === "creature.faint"
        ? latestCue.entityId
        : latestCue.type === "capture.success" || latestCue.type === "capture.fail"
          ? latestCue.targetEntityId
          : undefined;
  const target = targetId ? entitiesById.get(targetId) : undefined;
  const position = target ? entityPosition(target, draw) : undefined;
  const text = formatVisualCueText(latestCue);
  const colors = visualCueColors(latestCue);
  const x = position
    ? position.x + (target?.owner === "player" ? position.size * 0.28 : -position.size * 0.2)
    : draw.width * 0.5;
  const y = position ? position.y - position.size * 0.82 : draw.height * 0.42;

  context.fillStyle = colors.fill;
  context.strokeStyle = "#17202a";
  context.lineWidth = 2;
  context.fillRect(x - 54, y - 17, 108, 30);
  context.strokeRect(x - 54, y - 17, 108, 30);
  context.fillStyle = colors.text;
  context.font = "700 13px sans-serif";
  context.textAlign = "center";
  context.fillText(text.slice(0, 14), x, y + 3);
  context.textAlign = "left";
}

function drawBattleSummary(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  latestCue: FrameVisualCue | undefined,
  draw: DrawContext,
): void {
  const event = latestCue
    ? frame.battleReplay.events.find((candidate) => candidate.sequence === latestCue.sequence)
    : frame.battleReplay.events.at(-1);
  const label = latestCue?.label ?? event?.label ?? frame.scene.subtitle;
  const turn = event && event.turn > 0 ? `${event.turn}턴` : frame.scene.title;
  const top = draw.height - 178;

  context.fillStyle = "rgba(255, 244, 206, 0.95)";
  context.strokeStyle = "#17202a";
  context.lineWidth = 2;
  context.fillRect(20, top, draw.width - 40, 50);
  context.strokeRect(20, top, draw.width - 40, 50);
  context.fillStyle = "#17202a";
  context.font = "700 11px sans-serif";
  context.fillText(turn, 32, top + 17);
  context.font = "700 12px sans-serif";
  context.fillText(label.slice(0, 34), 32, top + 36);
}

function drawTeamStrip(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  entitiesById: ReadonlyMap<string, FrameEntity>,
  draw: DrawContext,
): void {
  const dotSize = 10;
  const gap = 5;
  const x = draw.width - 24 - 6 * dotSize - 5 * gap;
  const y = draw.height - 119;

  Array.from({ length: 6 }, (_, index) => frame.scene.playerSlots[index]).forEach(
    (entityId, index) => {
      const entity = entityId ? entitiesById.get(entityId) : undefined;
      context.fillStyle = !entity ? "#fffef4" : entity.hp.current <= 0 ? "#ba4f46" : "#4fc46b";
      context.strokeStyle = "#17202a";
      context.lineWidth = 2;
      context.fillRect(x + index * (dotSize + gap), y, dotSize, dotSize);
      context.strokeRect(x + index * (dotSize + gap), y, dotSize, dotSize);
    },
  );
}

function formatVisualCueText(cue: FrameVisualCue): string {
  if (cue.type === "battle.miss") {
    return "빗나감";
  }

  if (cue.type === "battle.hit") {
    if (cue.critical) {
      return `급소 -${cue.damage}`;
    }

    if (cue.effectiveness > 1) {
      return `효과 굉장 -${cue.damage}`;
    }

    if (cue.effectiveness > 0 && cue.effectiveness < 1) {
      return `효과 약함 -${cue.damage}`;
    }

    return `-${cue.damage}`;
  }

  if (cue.type === "creature.faint") {
    return "기절";
  }

  return cue.type === "capture.success" ? "포획 성공" : "포획 실패";
}

function visualCueColors(cue: FrameVisualCue): { fill: string; text: string } {
  if (cue.type === "battle.miss") {
    return { fill: "#eef7ff", text: "#315d91" };
  }

  if (cue.type === "battle.hit" && (cue.critical || cue.effectiveness > 1)) {
    return { fill: "#fff0a6", text: "#8b2420" };
  }

  if (cue.type === "battle.hit" && cue.effectiveness > 0 && cue.effectiveness < 1) {
    return { fill: "#edf4f0", text: "#3f6b55" };
  }

  if (cue.type === "creature.faint" || cue.type === "capture.fail") {
    return { fill: "#ffe2de", text: "#7f2720" };
  }

  if (cue.type === "capture.success") {
    return { fill: "#e9ffd8", text: "#2f7e54" };
  }

  return { fill: "#fffef4", text: "#17202a" };
}

function drawCommandPanel(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  draw: DrawContext,
): void {
  const top = draw.height - 106;
  context.fillStyle = "#fff4ce";
  context.fillRect(12, top, draw.width - 24, 94);
  context.strokeStyle = "#17202a";
  context.lineWidth = 3;
  context.strokeRect(12, top, draw.width - 24, 94);
  context.fillStyle = "#17202a";
  context.font = "700 12px sans-serif";

  frame.actions.slice(0, 4).forEach((action, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 28 + column * ((draw.width - 56) / 2);
    const y = top + 28 + row * 32;
    context.fillText(action.label.slice(0, 18), x, y);
  });
}

function entityPosition(entity: FrameEntity, draw: DrawContext) {
  if (entity.owner === "opponent") {
    return {
      x: draw.width * 0.7,
      y: draw.height * 0.33,
      size: 96,
      cardX: 24,
      cardY: 92 + entity.layout.slot * 4,
    };
  }

  if (entity.owner === "pendingCapture") {
    return {
      x: draw.width * 0.5,
      y: draw.height * 0.48,
      size: 104,
      cardX: draw.width - 164,
      cardY: draw.height * 0.45,
    };
  }

  return {
    x: draw.width * 0.32,
    y: draw.height * 0.68,
    size: 112,
    cardX: draw.width - 164,
    cardY: draw.height * 0.56 + entity.layout.slot * 4,
  };
}

function getImage(entity: FrameEntity, draw: DrawContext): HTMLImageElement {
  const src = draw.resolveAssetPath(entity.assetPath);
  const cached = draw.imageCache.get(src);

  if (cached) {
    return cached;
  }

  const image = new Image();
  image.src = src;
  draw.imageCache.set(src, image);
  return image;
}
