import type { EffectDescriptor, ShapeKind } from "../types";

export function createShapeRoot(descriptor: EffectDescriptor, shape: ShapeKind): HTMLElement {
  const root = document.createElement("div");
  const classes = [
    "fx-instance",
    `fx-shape-${shape}`,
    `fx-motion-${descriptor.motion}`,
    ...descriptor.modifiers.map((modifier) => `fx-mod-${modifier}`),
  ];

  root.className = classes.join(" ");
  root.dataset.fxShape = shape;
  root.dataset.fxMotion = descriptor.motion;
  root.dataset.fxType = descriptor.meta.type;
  root.style.setProperty("--fx-duration", `${descriptor.meta.durationMs}ms`);
  root.style.setProperty("--fx-intensity", String(descriptor.meta.intensity));
  return root;
}

export function setCenteredBox(
  root: HTMLElement,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): void {
  root.style.left = `${centerX - width / 2}px`;
  root.style.top = `${centerY - height / 2}px`;
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
}

export function appendLayer(root: HTMLElement, className: string): HTMLElement {
  const layer = document.createElement("span");
  layer.className = className;
  root.appendChild(layer);
  return layer;
}

export function appendParticles(root: HTMLElement, className: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const particle = appendLayer(root, className);
    particle.style.setProperty("--fx-particle-index", String(index));
  }
}
