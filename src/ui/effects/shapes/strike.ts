import type { ShapeBuilder } from "../types";
import { appendLayer, appendParticles, createShapeRoot, setCenteredBox } from "./common";

export const buildStrikeShape: ShapeBuilder = (descriptor, geometry) => {
  const root = createShapeRoot(descriptor, "strike");
  const size = 86 + descriptor.meta.intensity * 22;

  setCenteredBox(root, geometry.target.centerX, geometry.target.centerY, size, size);
  appendLayer(root, "fx-strike-slash");
  appendLayer(root, "fx-strike-flash");

  if (descriptor.modifiers.includes("sparks")) {
    appendParticles(root, "fx-spark", 8);
  }

  if (descriptor.modifiers.includes("shockwave")) {
    appendLayer(root, "fx-shockwave");
  }

  return root;
};
