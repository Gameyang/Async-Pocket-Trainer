import type { ShapeBuilder } from "../types";
import { appendLayer, appendParticles, createShapeRoot, setCenteredBox } from "./common";

export const buildAuraShape: ShapeBuilder = (descriptor, geometry) => {
  const root = createShapeRoot(descriptor, "aura");
  const size = 102 + descriptor.meta.intensity * 26;
  const target = descriptor.meta.targetSide === "player" ? geometry.target : geometry.target;

  setCenteredBox(root, target.centerX, target.centerY, size, size);
  appendLayer(root, "fx-aura-glow");
  appendLayer(root, "fx-aura-ring");
  appendParticles(root, "fx-aura-particle", descriptor.modifiers.includes("sparks") ? 8 : 5);

  return root;
};
