import type { ShapeBuilder } from "../types";
import { appendLayer, appendParticles, createShapeRoot } from "./common";

export const buildProjectileShape: ShapeBuilder = (descriptor, geometry) => {
  const root = createShapeRoot(descriptor, "projectile");
  const arc = geometry.source.centerY > geometry.target.centerY ? -42 : 42;

  root.style.left = `${geometry.source.centerX}px`;
  root.style.top = `${geometry.source.centerY}px`;
  root.style.width = "1px";
  root.style.height = "1px";
  root.style.setProperty("--fx-dx", `${geometry.dx}px`);
  root.style.setProperty("--fx-dy", `${geometry.dy}px`);
  root.style.setProperty("--fx-mid-x", `${geometry.dx * 0.54}px`);
  root.style.setProperty("--fx-mid-y", `${geometry.dy * 0.54 + arc}px`);
  root.style.setProperty("--fx-angle", `${geometry.angleDeg}deg`);
  appendLayer(root, "fx-projectile-trail");
  appendLayer(root, "fx-projectile-core");
  appendLayer(root, "fx-projectile-impact");

  if (descriptor.modifiers.includes("sparks")) {
    appendParticles(root, "fx-spark", 10);
  }

  return root;
};
