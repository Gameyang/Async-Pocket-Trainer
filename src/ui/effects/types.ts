import type { ElementType, MoveCategory } from "../../game/types";

export type ShapeKind = "strike" | "projectile" | "beam" | "burst" | "aura";
export type MotionKind = "linear" | "arc" | "pulse" | "spin" | "shake";
export type ModifierKind = "trail" | "flash" | "ring" | "sparks" | "shockwave";
export type BattleEffectSide = "player" | "enemy";

export interface ElementPalette {
  primary: string;
  secondary: string;
  accent: string;
}

export interface EffectDescriptor {
  shape: ShapeKind;
  motion: MotionKind;
  palette: ElementPalette;
  modifiers: ModifierKind[];
  meta: {
    durationMs: number;
    intensity: number;
    originSide: BattleEffectSide;
    targetSide: BattleEffectSide;
    type: ElementType;
    category: MoveCategory;
  };
}

export interface EffectRect {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface EffectGeometry {
  source: EffectRect;
  target: EffectRect;
  overlay: EffectRect;
  dx: number;
  dy: number;
  distance: number;
  angleDeg: number;
}

export interface EffectAnimationHandle {
  cancel(): void;
}

export type ShapeBuilder = (descriptor: EffectDescriptor, geometry: EffectGeometry) => HTMLElement;
