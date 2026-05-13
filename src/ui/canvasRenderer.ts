import type {
  FrameAction,
  FrameBattleReplayEvent,
  FrameCaptureScene,
  FrameEntity,
  FrameStarterOption,
  FrameVisualCue,
  GameFrame,
} from "../game/view/frame";
import { formatMoney, formatWave, localizeBall } from "../game/localization";
import {
  createBattleCueText,
  createBattleEventSummary,
  createShopActionProfile,
  getLatestVisualCue,
  resolveActiveBattleEntityIds,
  resolveBattleEffect,
  resolveSelectedRouteLabel,
  selectCommandItems,
  selectReadyShopActions,
  type CommandItem,
  type FrameBattleEffect,
} from "./framePresentation";

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

interface ScreenEntities {
  players: FrameEntity[];
  opponents: FrameEntity[];
  pendingCapture?: FrameEntity;
  activePlayer?: FrameEntity;
  activeOpponent?: FrameEntity;
}

function drawFrame(context: CanvasRenderingContext2D, frame: GameFrame, draw: DrawContext): void {
  context.clearRect(0, 0, draw.width, draw.height);
  drawDevice(context, frame, draw);

  const entitiesById = new Map(frame.entities.map((entity) => [entity.id, entity]));
  const latestCue = getLatestVisualCue(frame);
  const latestEvent = latestCue
    ? frame.battleReplay.events.find((event) => event.sequence === latestCue.sequence)
    : frame.battleReplay.events.at(-1);
  const activeIds = resolveActiveBattleEntityIds(frame, entitiesById, latestEvent, latestCue);
  const screenEntities: ScreenEntities = {
    players: frame.scene.playerSlots
      .map((id) => entitiesById.get(id))
      .filter((entity): entity is FrameEntity => Boolean(entity)),
    opponents: frame.scene.opponentSlots
      .map((id) => entitiesById.get(id))
      .filter((entity): entity is FrameEntity => Boolean(entity)),
    pendingCapture: frame.scene.pendingCaptureId
      ? entitiesById.get(frame.scene.pendingCaptureId)
      : undefined,
    activePlayer: activeIds.playerId ? entitiesById.get(activeIds.playerId) : undefined,
    activeOpponent: activeIds.opponentId ? entitiesById.get(activeIds.opponentId) : undefined,
  };

  if (shouldDrawBattleScreen(frame)) {
    drawBattleScreen(context, frame, draw, screenEntities, latestEvent, latestCue, entitiesById);
  } else if (frame.phase === "starterChoice") {
    drawStarterScreen(context, frame, draw);
  } else if (frame.phase === "teamDecision") {
    drawTeamDecisionScreen(context, frame, draw, screenEntities);
  } else if (frame.phase === "gameOver") {
    drawGameOverScreen(context, frame, draw, screenEntities);
  } else {
    drawReadyScreen(context, frame, draw, screenEntities);
  }

  drawCommandPanel(context, frame, draw, screenEntities);
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
}

function shouldDrawBattleScreen(frame: GameFrame): boolean {
  return (
    frame.phase === "captureDecision" ||
    frame.scene.capture?.result === "failure" ||
    frame.battleReplay.events.length > 1
  );
}

function screenBounds(draw: DrawContext) {
  return {
    x: 12,
    y: 78,
    width: draw.width - 24,
    height: draw.height - 196,
  };
}

function drawScreenFrame(
  context: CanvasRenderingContext2D,
  draw: DrawContext,
  fill = "#77c7ef",
): ReturnType<typeof screenBounds> {
  const rect = screenBounds(draw);
  context.fillStyle = fill;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeStyle = "#101722";
  context.lineWidth = 4;
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  return rect;
}

function drawBattleScreen(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  draw: DrawContext,
  screenEntities: ScreenEntities,
  activeEvent: FrameBattleReplayEvent | undefined,
  latestCue: FrameVisualCue | undefined,
  entitiesById: ReadonlyMap<string, FrameEntity>,
): void {
  drawBattlefield(context, draw);

  const drawnEntityIds = new Set<string>();
  const drawOnce = (entity: FrameEntity | undefined) => {
    if (!entity || drawnEntityIds.has(entity.id)) {
      return;
    }

    drawnEntityIds.add(entity.id);
    drawEntity(context, entity, draw, activeEvent, latestCue);
  };

  drawOnce(screenEntities.activeOpponent);
  drawOnce(screenEntities.activePlayer);
  drawOnce(screenEntities.pendingCapture);

  if (drawnEntityIds.size === 0) {
    [...screenEntities.opponents, ...screenEntities.players].forEach(drawOnce);
  }

  drawCaptureOverlay(context, frame.scene.capture, draw);
  drawVisualCue(context, activeEvent, latestCue, entitiesById, draw);
  drawBattleSummary(context, frame, activeEvent, latestCue, draw);
  drawTeamStrip(context, draw, screenEntities.players);
}

function drawBattlefield(context: CanvasRenderingContext2D, draw: DrawContext): void {
  const rect = drawScreenFrame(context, draw);
  const grassTop = rect.y + rect.height * 0.52;
  const skyGradient = context.createLinearGradient(0, rect.y, 0, grassTop);
  skyGradient.addColorStop(0, "#8bd8ff");
  skyGradient.addColorStop(1, "#ffe189");
  context.fillStyle = skyGradient;
  context.fillRect(rect.x, rect.y, rect.width, grassTop - rect.y);
  context.fillStyle = "#58b368";
  context.fillRect(rect.x, grassTop, rect.width, rect.height - (grassTop - rect.y));

  drawPlatform(context, draw.width * 0.7, rect.y + rect.height * 0.34, 150, 48);
  drawPlatform(context, draw.width * 0.31, rect.y + rect.height * 0.74, 190, 58);
}

function drawStarterScreen(context: CanvasRenderingContext2D, frame: GameFrame, draw: DrawContext): void {
  const rect = drawScreenFrame(context, draw, "#8bd8ff");
  context.fillStyle = "#69b97a";
  context.fillRect(rect.x, rect.y + rect.height * 0.42, rect.width, rect.height * 0.58);
  drawPlatform(context, draw.width * 0.5, rect.y + rect.height * 0.54, rect.width * 0.72, 62);
  drawTextPanel(context, "함께 시작할 포켓몬을 선택하세요", rect.x + 22, rect.y + 20, rect.width - 44, 36);

  const cardWidth = (rect.width - 48) / 3;
  frame.scene.starterOptions.forEach((option, index) => {
    const x = rect.x + 16 + index * (cardWidth + 8);
    drawStarterCard(context, option, draw, x, rect.y + rect.height - 188, cardWidth, 166);
  });
}

function drawStarterCard(
  context: CanvasRenderingContext2D,
  option: FrameStarterOption,
  draw: DrawContext,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawPanel(context, x, y, width, height, "#fffef4");
  drawImageByPath(context, option.assetPath, draw, x + width / 2 - 34, y + 10, 68, "#48a7c5");
  context.fillStyle = "#17202a";
  context.font = "700 11px sans-serif";
  context.textAlign = "center";
  context.fillText(option.name.slice(0, 10), x + width / 2, y + 94);
  context.font = "700 9px sans-serif";
  context.fillStyle = "#34413c";
  context.fillText(option.typeLabels.join("/").slice(0, 14), x + width / 2, y + 112);
  context.fillText(`전투력 ${option.power}`, x + width / 2, y + 130);
  context.fillText(option.moves[0]?.name.slice(0, 12) ?? "기술", x + width / 2, y + 148);
  context.textAlign = "left";
}

function drawReadyScreen(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  draw: DrawContext,
  screenEntities: ScreenEntities,
): void {
  const rect = drawScreenFrame(context, draw, "#8bd8ff");
  context.fillStyle = "#68aa72";
  context.fillRect(rect.x, rect.y + rect.height * 0.48, rect.width, rect.height * 0.52);
  drawPlatform(context, draw.width * 0.5, rect.y + 170, rect.width * 0.58, 48);
  drawTextPanel(
    context,
    `${formatWave(frame.hud.wave)} 관리 단계`,
    rect.x + 18,
    rect.y + 16,
    rect.width - 36,
    34,
  );
  drawTextPanel(
    context,
    `${frame.scene.subtitle.slice(0, 28)} / ${resolveSelectedRouteLabel(frame.actions)}`,
    rect.x + 18,
    rect.y + 58,
    rect.width - 36,
    34,
    "#eef7ff",
  );

  const lead = screenEntities.activePlayer ?? screenEntities.players[0];
  if (lead) {
    drawPanel(context, rect.x + 54, rect.y + 118, rect.width - 108, 92, "#e8fbff");
    drawImageByPath(context, lead.assetPath, draw, rect.x + 72, rect.y + 126, 70, "#48a7c5");
    context.fillStyle = "#17202a";
    context.font = "700 15px sans-serif";
    context.fillText(lead.name.slice(0, 16), rect.x + 154, rect.y + 150);
    context.font = "700 11px sans-serif";
    context.fillText(`HP ${lead.hp.current}/${lead.hp.max}`, rect.x + 154, rect.y + 170);
    context.fillText(`전투력 ${lead.scores.power}`, rect.x + 154, rect.y + 188);
  }

  const actions = selectReadyShopActions(frame, screenEntities.players);
  const cardWidth = (rect.width - 48) / Math.max(1, actions.length);
  actions.forEach((action, index) => {
    const x = rect.x + 16 + index * (cardWidth + 8);
    drawShopCard(context, action, frame, x, rect.y + rect.height - 116, cardWidth, 96);
  });
}

function drawShopCard(
  context: CanvasRenderingContext2D,
  action: FrameAction,
  frame: GameFrame,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const profile = createShopActionProfile(action, frame);
  const fill =
    profile.kind === "battle"
      ? "#f4d45a"
      : profile.kind === "rest"
        ? "#94d9a1"
        : profile.kind === "item"
          ? "#94c8dd"
          : "#d6b05e";
  drawPanel(context, x, y, width, height, fill);
  context.fillStyle = "#17202a";
  context.font = "700 9px sans-serif";
  context.fillText(profile.kicker.slice(0, 9), x + 8, y + 18);
  context.font = "700 12px sans-serif";
  context.fillText(profile.title.slice(0, 11), x + 8, y + 40);
  context.font = "700 9px sans-serif";
  context.fillText(profile.detail.slice(0, 13), x + 8, y + 61);
  context.fillText(profile.meta.slice(0, 13), x + 8, y + 79);
}

function drawTeamDecisionScreen(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  draw: DrawContext,
  screenEntities: ScreenEntities,
): void {
  const rect = drawScreenFrame(context, draw, "#8bd8ff");
  context.fillStyle = "#7cc06f";
  context.fillRect(rect.x, rect.y + rect.height * 0.34, rect.width, rect.height * 0.66);
  drawCaptureOverlay(context, frame.scene.capture, draw, rect.y + 18);
  const candidate = screenEntities.pendingCapture;

  if (candidate) {
    drawPanel(context, rect.x + 24, rect.y + 116, rect.width - 48, 118, "#fffef4");
    drawImageByPath(context, candidate.assetPath, draw, rect.x + 42, rect.y + 136, 74, "#8161cb");
    context.fillStyle = "#17202a";
    context.font = "700 16px sans-serif";
    context.fillText(candidate.name.slice(0, 16), rect.x + 134, rect.y + 152);
    context.font = "700 11px sans-serif";
    context.fillText(candidate.typeLabels.join(" / ").slice(0, 20), rect.x + 134, rect.y + 174);
    context.fillText(`HP ${candidate.hp.max}  전투력 ${candidate.scores.power}`, rect.x + 134, rect.y + 196);
  }

  drawTextPanel(
    context,
    screenEntities.players.length >= 6 ? "팀이 가득 찼습니다" : "새 동료 후보",
    rect.x + 28,
    rect.y + rect.height - 100,
    rect.width - 56,
    36,
    "#fff0a6",
  );
  drawTeamStrip(context, draw, screenEntities.players, rect.y + rect.height - 48);
}

function drawGameOverScreen(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  draw: DrawContext,
  screenEntities: ScreenEntities,
): void {
  const rect = drawScreenFrame(context, draw, "#708aa6");
  context.fillStyle = "#2b4056";
  context.fillRect(rect.x, rect.y + rect.height * 0.52, rect.width, rect.height * 0.48);
  drawTextPanel(context, "도전 종료", rect.x + 46, rect.y + 72, rect.width - 92, 36, "#ffe2de");
  drawTextPanel(
    context,
    `${formatWave(frame.hud.wave)} / ${frame.hud.gameOverReason ?? frame.scene.subtitle}`.slice(
      0,
      34,
    ),
    rect.x + 28,
    rect.y + 124,
    rect.width - 56,
    52,
    "#fffef4",
  );
  drawTeamStrip(context, draw, screenEntities.players, rect.y + rect.height - 66);
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
  activeEvent: FrameBattleReplayEvent | undefined,
  latestCue: FrameVisualCue | undefined,
): void {
  const position = entityPosition(entity, draw);
  const image = getImage(entity, draw);
  const effect = resolveBattleEffect(entity, activeEvent, latestCue);
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

function resolveCueOffset(
  entity: FrameEntity,
  latestCue: FrameVisualCue | undefined,
  effect: FrameBattleEffect,
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

function drawPanel(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): void {
  context.fillStyle = fill;
  context.strokeStyle = "#101722";
  context.lineWidth = 3;
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);
}

function drawTextPanel(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = "#fffef4",
): void {
  drawPanel(context, x, y, width, height, fill);
  context.fillStyle = "#17202a";
  context.font = "700 12px sans-serif";
  context.textAlign = "center";
  context.fillText(text.slice(0, 34), x + width / 2, y + height / 2 + 4);
  context.textAlign = "left";
}

function drawImageByPath(
  context: CanvasRenderingContext2D,
  assetPath: string,
  draw: DrawContext,
  x: number,
  y: number,
  size: number,
  fallback: string,
): void {
  const image = getImageByPath(assetPath, draw);

  if (image.complete && image.naturalWidth > 0) {
    context.drawImage(image, x, y, size, size);
    return;
  }

  context.fillStyle = fallback;
  context.fillRect(x + size * 0.16, y + size * 0.16, size * 0.68, size * 0.68);
}

function drawCaptureOverlay(
  context: CanvasRenderingContext2D,
  capture: FrameCaptureScene | undefined,
  draw: DrawContext,
  yOverride?: number,
): void {
  if (!capture) {
    return;
  }

  const width = 220;
  const height = 66;
  const x = draw.width / 2 - width / 2;
  const y = yOverride ?? screenBounds(draw).y + screenBounds(draw).height * 0.42;
  const fill =
    capture.result === "success" ? "#e9ffd8" : capture.result === "failure" ? "#ffe2de" : "#e8fbff";

  drawPanel(context, x, y, width, height, fill);
  context.fillStyle = capture.ball === "greatBall" ? "#557eea" : "#e25248";
  context.fillRect(x + 15, y + 16, 34, 18);
  context.fillStyle = "#f7f7f2";
  context.fillRect(x + 15, y + 34, 34, 18);
  context.strokeStyle = "#101722";
  context.lineWidth = 2;
  context.strokeRect(x + 15, y + 16, 34, 36);
  context.fillStyle = "#17202a";
  context.font = "700 11px sans-serif";
  context.fillText(capture.label.slice(0, 24), x + 60, y + 28);
  context.font = "700 9px sans-serif";
  const chance = capture.chance === undefined ? "" : `성공률 ${Math.round(capture.chance * 100)}%`;
  context.fillText(chance || `${capture.shakes}회 흔들림`, x + 60, y + 48);
}

function drawVisualCue(
  context: CanvasRenderingContext2D,
  activeEvent: FrameBattleReplayEvent | undefined,
  latestCue: FrameVisualCue | undefined,
  entitiesById: ReadonlyMap<string, FrameEntity>,
  draw: DrawContext,
): void {
  if (!latestCue && !activeEvent) {
    return;
  }

  const targetId =
    latestCue?.type === "battle.hit" || latestCue?.type === "battle.miss"
      ? latestCue.targetEntityId
      : latestCue?.type === "creature.faint"
        ? latestCue.entityId
        : latestCue?.type === "capture.success" || latestCue?.type === "capture.fail"
          ? latestCue.targetEntityId
          : (activeEvent?.targetEntityId ?? activeEvent?.entityId);
  const target = targetId ? entitiesById.get(targetId) : undefined;
  const position = target ? entityPosition(target, draw) : undefined;
  const cue = createBattleCueText(activeEvent, latestCue);

  if (!cue) {
    return;
  }

  const colors = visualCueColors(cue.kind);
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
  context.fillText(cue.text.slice(0, 14), x, y + 3);
  context.textAlign = "left";
}

function drawBattleSummary(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  activeEvent: FrameBattleReplayEvent | undefined,
  latestCue: FrameVisualCue | undefined,
  draw: DrawContext,
): void {
  const event =
    activeEvent ??
    (latestCue
      ? frame.battleReplay.events.find((candidate) => candidate.sequence === latestCue.sequence)
      : frame.battleReplay.events.at(-1));
  const summary = createBattleEventSummary(event, latestCue, frame.entities);
  const label = summary
    ? `${summary.title} / ${summary.result}`
    : latestCue?.label ?? event?.label ?? frame.scene.subtitle;
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
  draw: DrawContext,
  entities: readonly FrameEntity[],
  yOverride?: number,
): void {
  const dotSize = 10;
  const gap = 5;
  const x = draw.width - 24 - 6 * dotSize - 5 * gap;
  const y = yOverride ?? draw.height - 119;

  Array.from({ length: 6 }, (_, index) => entities[index]).forEach((entity, index) => {
    context.fillStyle = !entity ? "#fffef4" : entity.hp.current <= 0 ? "#ba4f46" : "#4fc46b";
    context.strokeStyle = "#17202a";
    context.lineWidth = 2;
    context.fillRect(x + index * (dotSize + gap), y, dotSize, dotSize);
    context.strokeRect(x + index * (dotSize + gap), y, dotSize, dotSize);
  });
}

function visualCueColors(kind: string): { fill: string; text: string } {
  if (kind === "miss") {
    return { fill: "#eef7ff", text: "#315d91" };
  }

  if (kind === "critical" || kind === "super-effective") {
    return { fill: "#fff0a6", text: "#8b2420" };
  }

  if (kind === "resisted") {
    return { fill: "#edf4f0", text: "#3f6b55" };
  }

  if (kind === "faint" || kind === "capture-fail") {
    return { fill: "#ffe2de", text: "#7f2720" };
  }

  if (kind === "capture-success") {
    return { fill: "#e9ffd8", text: "#2f7e54" };
  }

  return { fill: "#fffef4", text: "#17202a" };
}

function drawCommandPanel(
  context: CanvasRenderingContext2D,
  frame: GameFrame,
  draw: DrawContext,
  screenEntities: ScreenEntities,
): void {
  const commands = selectCommandItems(frame, screenEntities.players, screenEntities.pendingCapture);

  if (commands.length === 0) {
    return;
  }

  const top = draw.height - 106;
  context.fillStyle = "#fff4ce";
  context.fillRect(12, top, draw.width - 24, 94);
  context.strokeStyle = "#17202a";
  context.lineWidth = 3;
  context.strokeRect(12, top, draw.width - 24, 94);
  context.fillStyle = "#17202a";
  context.font = "700 12px sans-serif";

  commands.slice(0, 3).forEach((command, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 28 + column * ((draw.width - 56) / 2);
    const y = top + 28 + row * 32;
    context.fillText(commandLabel(command).slice(0, 18), x, y);
  });
}

function commandLabel(command: CommandItem): string {
  return command.action.label;
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
  return getImageByPath(entity.assetPath, draw);
}

function getImageByPath(assetPath: string, draw: DrawContext): HTMLImageElement {
  const src = draw.resolveAssetPath(assetPath);
  const cached = draw.imageCache.get(src);

  if (cached) {
    return cached;
  }

  const image = new Image();
  image.src = src;
  draw.imageCache.set(src, image);
  return image;
}
