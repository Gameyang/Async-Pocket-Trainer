import type { ShapeBuilder } from "../types";
import { appendLayer, createShapeRoot } from "./common";

export const buildBeamShape: ShapeBuilder = (descriptor, geometry) => {
  const root = createShapeRoot(descriptor, "beam");

  root.style.left = `${geometry.source.centerX}px`;
  root.style.top = `${geometry.source.centerY - 16}px`;
  root.style.width = `${geometry.distance}px`;
  root.style.height = "32px";
  root.style.transform = `rotate(${geometry.angleDeg}deg)`;
  appendLayer(root, "fx-beam-glow");
  appendLayer(root, "fx-beam-core");

  if (descriptor.modifiers.includes("flash")) {
    appendLayer(root, "fx-beam-flash");
  }

  return root;
};
