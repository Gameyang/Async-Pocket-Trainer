import type { FrameEntity, GameFrame } from "../game/view/frame";
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

function drawFrame(context: CanvasRenderingContext2D, frame: GameFrame, draw: DrawContext): void {
  context.clearRect(0, 0, draw.width, draw.height);
  drawDevice(context, frame, draw);

  const entitiesById = new Map(frame.entities.map((entity) => [entity.id, entity]));
  for (const entityId of frame.scene.opponentSlots) {
    const entity = entitiesById.get(entityId);
    if (entity) {
      drawEntity(context, entity, draw);
    }
  }
  for (const entityId of frame.scene.playerSlots) {
    const entity = entitiesById.get(entityId);
    if (entity) {
      drawEntity(context, entity, draw);
    }
  }

  const capture = frame.scene.pendingCaptureId
    ? entitiesById.get(frame.scene.pendingCaptureId)
    : undefined;
  if (capture) {
    drawEntity(context, capture, draw);
  }

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
): void {
  const position = entityPosition(entity, draw);
  const image = getImage(entity, draw);

  if (image.complete && image.naturalWidth > 0) {
    context.drawImage(
      image,
      position.x - position.size / 2,
      position.y - position.size,
      position.size,
      position.size,
    );
  } else {
    context.fillStyle = entity.owner === "opponent" ? "#8161cb" : "#48a7c5";
    context.fillRect(
      position.x - position.size / 3,
      position.y - position.size,
      position.size * 0.66,
      position.size * 0.66,
    );
  }

  context.fillStyle = "#fffbe9";
  context.strokeStyle = "#17202a";
  context.lineWidth = 2;
  context.fillRect(position.cardX, position.cardY, 138, 42);
  context.strokeRect(position.cardX, position.cardY, 138, 42);
  context.fillStyle = "#17202a";
  context.font = "700 11px sans-serif";
  context.fillText(entity.name.slice(0, 14), position.cardX + 8, position.cardY + 16);
  context.fillStyle = "#4fc46b";
  context.fillRect(position.cardX + 8, position.cardY + 25, Math.max(0, 112 * entity.hp.ratio), 8);
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
