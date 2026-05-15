import animateTab from "../../resources/lottie/animate-tab.json";
import favoriteBurst from "../../resources/lottie/favorite-burst.json";
import paginationPulse from "../../resources/lottie/pagination-pulse.json";
import tabTransition from "../../resources/lottie/tab-transition.json";
import type { EffectDescriptor, ElementPalette, ShapeKind } from "./types";

export type LottieTemplateId = "arc-swipe" | "lane-sweep" | "impact-star" | "pulse-rings";

export interface LottieTemplate {
  id: LottieTemplateId;
  animationData: LottieAnimationData;
  sourcePath: string;
}

export type LottieAnimationData = Record<string, unknown>;

const TEMPLATES: Record<LottieTemplateId, LottieTemplate> = {
  "arc-swipe": {
    id: "arc-swipe",
    animationData: tabTransition as LottieAnimationData,
    sourcePath: "spemer/lottie-animations-json/animate_tab/animate_tab_1_example.json",
  },
  "lane-sweep": {
    id: "lane-sweep",
    animationData: animateTab as LottieAnimationData,
    sourcePath: "spemer/lottie-animations-json/animate_tab/animate_tab_1.json",
  },
  "impact-star": {
    id: "impact-star",
    animationData: favoriteBurst as LottieAnimationData,
    sourcePath: "spemer/lottie-animations-json/ic_fav/ic_fav.json",
  },
  "pulse-rings": {
    id: "pulse-rings",
    animationData: paginationPulse as LottieAnimationData,
    sourcePath: "spemer/lottie-animations-json/pagination_indicator/pagination_indicator.json",
  },
};

const TEMPLATE_POOL_BY_SHAPE: Record<ShapeKind, LottieTemplateId[]> = {
  projectile: ["arc-swipe", "lane-sweep", "impact-star"],
  beam: ["lane-sweep", "arc-swipe", "pulse-rings"],
  strike: ["impact-star", "pulse-rings"],
  burst: ["pulse-rings", "impact-star"],
  aura: ["pulse-rings", "impact-star"],
};

export function resolveLottieTemplate(descriptor: EffectDescriptor): LottieTemplate {
  const pool = TEMPLATE_POOL_BY_SHAPE[descriptor.shape];
  const seed = `${descriptor.meta.type}:${descriptor.meta.category}:${descriptor.motion}`;
  const templateId = pool[hashString(seed) % pool.length];

  return TEMPLATES[templateId];
}

export function cloneTintedLottieData(
  template: LottieTemplate,
  palette: ElementPalette,
): LottieAnimationData {
  const data = cloneLottieData(template.animationData);
  const colors = [
    hexToLottieColor(palette.primary),
    hexToLottieColor(palette.secondary),
    hexToLottieColor(palette.accent),
  ];
  let colorIndex = 0;

  visitLottieNode(data, (record) => {
    const color = record.c;

    if (isStaticColorProperty(color)) {
      color.k = colors[colorIndex % colors.length];
      colorIndex += 1;
    }
  });

  return data;
}

export function getLottieTemplateDurationMs(template: LottieTemplate): number {
  const frameRate = readNumber(template.animationData.fr, 30);
  const startFrame = readNumber(template.animationData.ip, 0);
  const endFrame = readNumber(template.animationData.op, startFrame + frameRate);

  return Math.max(1, ((endFrame - startFrame) / frameRate) * 1000);
}

export function lottieTemplateIdsForShape(shape: ShapeKind): readonly LottieTemplateId[] {
  return TEMPLATE_POOL_BY_SHAPE[shape];
}

export function lottieSourcePaths(): string[] {
  return Object.values(TEMPLATES).map((template) => template.sourcePath);
}

function cloneLottieData(data: LottieAnimationData): LottieAnimationData {
  if (typeof structuredClone === "function") {
    return structuredClone(data) as LottieAnimationData;
  }

  return JSON.parse(JSON.stringify(data)) as LottieAnimationData;
}

function visitLottieNode(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => visitLottieNode(entry, visitor));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  visitor(value);
  Object.values(value).forEach((entry) => visitLottieNode(entry, visitor));
}

function isStaticColorProperty(value: unknown): value is { k: number[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.k) &&
    value.k.length >= 3 &&
    value.k.slice(0, 3).every((entry) => typeof entry === "number")
  );
}

function hexToLottieColor(hex: string): number[] {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;

  return [red, green, blue, 1];
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
