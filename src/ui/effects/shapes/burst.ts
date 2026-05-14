import type { ShapeBuilder } from "../types";
import { appendLayer, appendParticles, createShapeRoot, setCenteredBox } from "./common";

export const buildBurstShape: ShapeBuilder = (descriptor, geometry) => {
  const root = createShapeRoot(descriptor, "burst");
  const size = 96 + descriptor.meta.intensity * 28;

  setCenteredBox(root, geometry.target.centerX, geometry.target.centerY, size, size);
  appendLayer(root, "fx-burst-ring");
  appendLayer(root, "fx-burst-core");
  appendLayer(root, "fx-burst-wave");

  if (descriptor.modifiers.includes("sparks") || descriptor.modifiers.includes("trail")) {
    appendParticles(root, "fx-spark", 9);
  }

  if (descriptor.modifiers.includes("shockwave")) {
    appendLayer(root, "fx-shockwave");
  }

  return root;
};
