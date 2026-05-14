import type { ElementType, MoveCategory, MoveDefinition } from "../../game/types";
import { getElementPalette } from "./palette";
import type {
  BattleEffectSide,
  EffectDescriptor,
  ModifierKind,
  MotionKind,
  ShapeKind,
} from "./types";

export interface EffectShapeMapping {
  shape: ShapeKind;
  motion: MotionKind;
  modifiers: ModifierKind[];
}

export interface EffectCueInput {
  critical?: boolean;
  effectiveness?: number;
  originSide?: BattleEffectSide;
  targetSide?: BattleEffectSide;
}

const DEFAULT_BY_CATEGORY: Record<MoveCategory, EffectShapeMapping> = {
  physical: { shape: "strike", motion: "shake", modifiers: ["flash"] },
  special: { shape: "beam", motion: "pulse", modifiers: ["trail"] },
  status: { shape: "aura", motion: "pulse", modifiers: ["ring"] },
};

const TYPE_CATEGORY_OVERRIDES: Partial<
  Record<ElementType, Partial<Record<MoveCategory, EffectShapeMapping>>>
> = {
  normal: {
    special: { shape: "projectile", motion: "linear", modifiers: ["trail"] },
  },
  fire: {
    physical: { shape: "strike", motion: "shake", modifiers: ["sparks"] },
    special: { shape: "beam", motion: "pulse", modifiers: ["trail"] },
    status: { shape: "aura", motion: "pulse", modifiers: ["sparks"] },
  },
  water: {
    special: { shape: "beam", motion: "pulse", modifiers: ["trail"] },
    status: { shape: "aura", motion: "pulse", modifiers: ["ring"] },
  },
  grass: {
    special: { shape: "beam", motion: "pulse", modifiers: ["sparks"] },
    status: { shape: "aura", motion: "pulse", modifiers: ["sparks"] },
  },
  electric: {
    physical: { shape: "strike", motion: "shake", modifiers: ["flash", "sparks"] },
    special: { shape: "beam", motion: "pulse", modifiers: ["flash"] },
    status: { shape: "aura", motion: "pulse", modifiers: ["flash"] },
  },
  poison: {
    special: { shape: "projectile", motion: "arc", modifiers: ["trail"] },
    status: { shape: "burst", motion: "pulse", modifiers: ["trail"] },
  },
  ground: {
    physical: { shape: "burst", motion: "shake", modifiers: ["shockwave"] },
    special: { shape: "burst", motion: "pulse", modifiers: ["shockwave"] },
  },
  flying: {
    physical: { shape: "strike", motion: "arc", modifiers: ["flash"] },
    special: { shape: "projectile", motion: "arc", modifiers: ["trail"] },
    status: { shape: "aura", motion: "spin", modifiers: ["ring"] },
  },
  bug: {
    special: { shape: "projectile", motion: "arc", modifiers: ["trail"] },
    status: { shape: "aura", motion: "pulse", modifiers: ["sparks"] },
  },
  fighting: {
    physical: { shape: "strike", motion: "shake", modifiers: ["flash", "shockwave"] },
    special: { shape: "strike", motion: "shake", modifiers: ["flash"] },
  },
  psychic: {
    special: { shape: "aura", motion: "spin", modifiers: ["ring"] },
    status: { shape: "aura", motion: "spin", modifiers: ["ring"] },
  },
  rock: {
    physical: { shape: "burst", motion: "shake", modifiers: ["shockwave"] },
    special: { shape: "burst", motion: "shake", modifiers: ["shockwave"] },
  },
  ghost: {
    physical: { shape: "strike", motion: "spin", modifiers: ["flash"] },
    special: { shape: "aura", motion: "spin", modifiers: ["trail"] },
    status: { shape: "aura", motion: "spin", modifiers: ["ring"] },
  },
  ice: {
    special: { shape: "projectile", motion: "arc", modifiers: ["trail"] },
    status: { shape: "aura", motion: "pulse", modifiers: ["ring"] },
  },
  dragon: {
    physical: { shape: "strike", motion: "arc", modifiers: ["flash"] },
    special: { shape: "projectile", motion: "arc", modifiers: ["trail"] },
  },
  dark: {
    physical: { shape: "strike", motion: "spin", modifiers: ["flash"] },
    special: { shape: "aura", motion: "spin", modifiers: ["trail"] },
    status: { shape: "aura", motion: "spin", modifiers: ["ring"] },
  },
  steel: {
    physical: { shape: "strike", motion: "shake", modifiers: ["flash", "shockwave"] },
    special: { shape: "beam", motion: "pulse", modifiers: ["flash"] },
  },
  fairy: {
    special: { shape: "projectile", motion: "arc", modifiers: ["sparks"] },
    status: { shape: "aura", motion: "pulse", modifiers: ["sparks", "ring"] },
  },
};

export function resolveEffectShape(
  category: MoveCategory,
  type: ElementType | string | undefined,
): EffectShapeMapping {
  const normalizedType = isElementType(type) ? type : "normal";
  const base = DEFAULT_BY_CATEGORY[category] ?? DEFAULT_BY_CATEGORY.status;
  const override = TYPE_CATEGORY_OVERRIDES[normalizedType]?.[category];

  return override ? cloneMapping(override) : cloneMapping(base);
}

export function resolveEffectDescriptor(
  move: Pick<MoveDefinition, "category" | "type">,
  cue: EffectCueInput = {},
): EffectDescriptor {
  const mapping = resolveEffectShape(move.category, move.type);

  return {
    ...mapping,
    palette: getElementPalette(move.type),
    meta: {
      durationMs: defaultDurationFor(mapping.shape),
      intensity: resolveIntensity(cue),
      originSide: cue.originSide ?? "player",
      targetSide: cue.targetSide ?? "enemy",
      type: move.type,
      category: move.category,
    },
  };
}

export function defaultDurationFor(shape: ShapeKind): number {
  switch (shape) {
    case "strike":
    case "burst":
      return 360;
    case "projectile":
      return 420;
    case "beam":
      return 480;
    case "aura":
      return 720;
  }
}

function resolveIntensity(cue: EffectCueInput): number {
  if (cue.critical) {
    return 1;
  }

  if ((cue.effectiveness ?? 1) > 1) {
    return 0.88;
  }

  if ((cue.effectiveness ?? 1) > 0 && (cue.effectiveness ?? 1) < 1) {
    return 0.58;
  }

  return 0.72;
}

function cloneMapping(mapping: EffectShapeMapping): EffectShapeMapping {
  return {
    shape: mapping.shape,
    motion: mapping.motion,
    modifiers: [...mapping.modifiers],
  };
}

function isElementType(type: ElementType | string | undefined): type is ElementType {
  return (
    type === "normal" ||
    type === "fire" ||
    type === "water" ||
    type === "grass" ||
    type === "electric" ||
    type === "poison" ||
    type === "ground" ||
    type === "flying" ||
    type === "bug" ||
    type === "fighting" ||
    type === "psychic" ||
    type === "rock" ||
    type === "ghost" ||
    type === "ice" ||
    type === "dragon" ||
    type === "dark" ||
    type === "steel" ||
    type === "fairy"
  );
}
