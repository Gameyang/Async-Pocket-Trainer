import { describe, expect, it } from "vitest";

import type { MoveCategory } from "../../../game/types";
import { ELEMENT_TYPES } from "../palette";
import { defaultDurationFor, resolveEffectDescriptor, resolveEffectShape } from "../mapping";
import type { ModifierKind, MotionKind, ShapeKind } from "../types";

const CATEGORIES: MoveCategory[] = ["physical", "special", "status"];
const SHAPES: ShapeKind[] = ["strike", "projectile", "beam", "burst", "aura"];
const MOTIONS: MotionKind[] = ["linear", "arc", "pulse", "spin", "shake"];
const MODIFIERS: ModifierKind[] = ["trail", "flash", "ring", "sparks", "shockwave"];

describe("battle effect mapping", () => {
  it("returns a valid shape mapping for all 54 category/type combinations", () => {
    for (const category of CATEGORIES) {
      for (const type of ELEMENT_TYPES) {
        const mapping = resolveEffectShape(category, type);

        expect(SHAPES).toContain(mapping.shape);
        expect(MOTIONS).toContain(mapping.motion);
        expect(mapping.modifiers.length).toBeGreaterThan(0);
        expect(mapping.modifiers.every((modifier) => MODIFIERS.includes(modifier))).toBe(true);
      }
    }
  });

  it("applies documented type/category overrides", () => {
    expect(resolveEffectShape("special", "normal")).toMatchObject({
      shape: "projectile",
      motion: "linear",
    });
    expect(resolveEffectShape("physical", "ground")).toMatchObject({
      shape: "burst",
      modifiers: ["shockwave"],
    });
    expect(resolveEffectShape("status", "poison")).toMatchObject({
      shape: "burst",
      modifiers: ["trail"],
    });
    expect(resolveEffectShape("special", "psychic")).toMatchObject({
      shape: "aura",
      motion: "spin",
    });
  });

  it("builds descriptors with palette, duration, intensity, and side metadata", () => {
    const descriptor = resolveEffectDescriptor(
      { category: "special", type: "fire" },
      { critical: true, originSide: "enemy", targetSide: "player" },
    );

    expect(descriptor.shape).toBe("beam");
    expect(descriptor.palette.primary).toBe("#ff7044");
    expect(descriptor.meta.durationMs).toBe(defaultDurationFor("beam"));
    expect(descriptor.meta.intensity).toBe(1);
    expect(descriptor.meta.originSide).toBe("enemy");
    expect(descriptor.meta.targetSide).toBe("player");
  });

  it("falls back unknown types to normal mapping", () => {
    expect(resolveEffectShape("special", "unknown")).toEqual(
      resolveEffectShape("special", "normal"),
    );
  });
});
