import type { EffectDescriptor, EffectGeometry, ShapeKind } from "./types";

type MotionLayer =
  | "root"
  | "projectile-core"
  | "projectile-trail"
  | "projectile-impact"
  | "beam-core"
  | "beam-glow"
  | "beam-flash"
  | "strike-slash"
  | "strike-flash"
  | "burst-ring"
  | "burst-core"
  | "burst-wave"
  | "shockwave"
  | "aura-glow"
  | "aura-ring"
  | "aura-particle"
  | "spark";

interface MotionStep {
  layer: MotionLayer;
  keyframes: Keyframe[];
  delay?: number;
  durationRatio?: number;
  easing?: string;
  targetIndex?: number;
}

type MotionPreset = Record<ShapeKind, (context: MotionContext) => MotionStep[]>;

interface MotionContext {
  descriptor: EffectDescriptor;
  geometry: EffectGeometry;
  durationMs: number;
  intensity: number;
}

const LAYER_SELECTORS: Record<MotionLayer, string | undefined> = {
  root: undefined,
  "projectile-core": ".fx-projectile-core",
  "projectile-trail": ".fx-projectile-trail",
  "projectile-impact": ".fx-projectile-impact",
  "beam-core": ".fx-beam-core",
  "beam-glow": ".fx-beam-glow",
  "beam-flash": ".fx-beam-flash",
  "strike-slash": ".fx-strike-slash",
  "strike-flash": ".fx-strike-flash",
  "burst-ring": ".fx-burst-ring",
  "burst-core": ".fx-burst-core",
  "burst-wave": ".fx-burst-wave",
  shockwave: ".fx-shockwave",
  "aura-glow": ".fx-aura-glow",
  "aura-ring": ".fx-aura-ring",
  "aura-particle": ".fx-aura-particle",
  spark: ".fx-spark",
};

const PRESETS: MotionPreset = {
  projectile: ({ descriptor, geometry, intensity }) => {
    const arcY =
      descriptor.motion === "arc" ? geometry.dy * 0.52 + resolveArcLift(geometry) : geometry.dy;
    const midX = descriptor.motion === "arc" ? geometry.dx * 0.52 : geometry.dx * 0.58;
    const midY = descriptor.motion === "arc" ? arcY : geometry.dy * 0.58;
    const angle = `rotate(${geometry.angleDeg}deg)`;

    return [
      {
        layer: "root",
        keyframes: [
          { opacity: 0 },
          { opacity: 1, offset: 0.12 },
          { opacity: 1, offset: 0.82 },
          { opacity: 0 },
        ],
      },
      {
        layer: "projectile-core",
        keyframes: [
          { transform: `translate(0px, 0px) ${angle} scale(${0.82 + intensity * 0.1})` },
          {
            transform: `translate(${midX}px, ${midY}px) ${angle} scale(${1 + intensity * 0.12})`,
            offset: 0.56,
          },
          { transform: `translate(${geometry.dx}px, ${geometry.dy}px) ${angle} scale(0.9)` },
        ],
        easing: "cubic-bezier(0.18, 0.84, 0.18, 1)",
      },
      {
        layer: "projectile-trail",
        keyframes: [
          { opacity: 0, transform: `translate(0px, 0px) ${angle} scaleX(0.65)` },
          {
            opacity: 0.82,
            transform: `translate(${midX}px, ${midY}px) ${angle} scaleX(1.12)`,
            offset: 0.5,
          },
          {
            opacity: 0,
            transform: `translate(${geometry.dx}px, ${geometry.dy}px) ${angle} scaleX(0.45)`,
          },
        ],
      },
      {
        layer: "projectile-impact",
        keyframes: [
          {
            opacity: 0,
            transform: `translate(${geometry.dx}px, ${geometry.dy}px) scale(0.18)`,
          },
          {
            opacity: 0,
            transform: `translate(${geometry.dx}px, ${geometry.dy}px) scale(0.22)`,
            offset: 0.58,
          },
          {
            opacity: 0.9,
            transform: `translate(${geometry.dx}px, ${geometry.dy}px) scale(${0.86 + intensity * 0.42})`,
            offset: 0.74,
          },
          {
            opacity: 0,
            transform: `translate(${geometry.dx}px, ${geometry.dy}px) scale(${1.22 + intensity * 0.35})`,
          },
        ],
      },
      ...sparkSteps(10, geometry, "spark", 0.62),
    ];
  },
  beam: ({ intensity }) => [
    {
      layer: "root",
      keyframes: [
        { opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { opacity: 1, offset: 0.78 },
        { opacity: 0 },
      ],
    },
    {
      layer: "beam-core",
      keyframes: [
        { transform: "scaleX(0)", filter: "brightness(1)" },
        { transform: "scaleX(1)", filter: `brightness(${1.08 + intensity * 0.2})`, offset: 0.24 },
        { transform: "scaleX(1)", filter: `brightness(${1.12 + intensity * 0.25})`, offset: 0.72 },
        { transform: "scaleX(0.96)", filter: "brightness(1)" },
      ],
      easing: "ease-out",
    },
    {
      layer: "beam-glow",
      keyframes: [
        { opacity: 0, transform: "scaleX(0.08) scaleY(0.75)" },
        { opacity: 0.78, transform: "scaleX(1) scaleY(1.12)", offset: 0.28 },
        { opacity: 0, transform: "scaleX(1.04) scaleY(0.88)" },
      ],
    },
    {
      layer: "beam-flash",
      keyframes: [
        { opacity: 0, transform: "scale(0.42)" },
        { opacity: 0.78, transform: `scale(${1.05 + intensity * 0.3})`, offset: 0.24 },
        { opacity: 0, transform: "scale(1.4)" },
      ],
    },
  ],
  strike: ({ intensity, geometry }) => [
    {
      layer: "root",
      keyframes: [
        { opacity: 0, transform: "rotate(-22deg) scale(0.7)" },
        { opacity: 1, transform: "rotate(-10deg) scale(1.02)", offset: 0.22 },
        { opacity: 0, transform: `rotate(10deg) scale(${1.06 + intensity * 0.18})` },
      ],
    },
    {
      layer: "strike-slash",
      keyframes: [
        { transform: "scaleX(0) translateX(-16px)" },
        { transform: "scaleX(1.08) translateX(0)", offset: 0.42 },
        { transform: "scaleX(1.18) translateX(10px)" },
      ],
    },
    {
      layer: "strike-flash",
      keyframes: [
        { opacity: 0, transform: "scale(0.5)" },
        { opacity: 0.85, transform: `scale(${1.1 + intensity * 0.26})`, offset: 0.28 },
        { opacity: 0, transform: "scale(1.6)" },
      ],
    },
    ...sparkSteps(8, geometry, "spark", 0.4),
  ],
  burst: ({ intensity, geometry }) => [
    {
      layer: "root",
      keyframes: [
        { opacity: 0, transform: "scale(0.78)" },
        { opacity: 1, transform: "scale(1)", offset: 0.18 },
        { opacity: 0, transform: `scale(${1.04 + intensity * 0.16})` },
      ],
    },
    expandStep("burst-ring", 0.18, 1.42 + intensity * 0.24),
    {
      layer: "burst-core",
      keyframes: [
        { opacity: 0.92, transform: "scale(0.2)" },
        { opacity: 0.54, transform: "scale(0.86)", offset: 0.56 },
        { opacity: 0, transform: `scale(${1.08 + intensity * 0.24})` },
      ],
    },
    expandStep("burst-wave", 0.12, 1.62 + intensity * 0.28),
    expandStep("shockwave", 0.1, 1.82 + intensity * 0.36),
    ...sparkSteps(9, geometry, "spark", 0.35),
  ],
  aura: ({ intensity, geometry }) => [
    {
      layer: "root",
      keyframes: [
        { opacity: 0, transform: "scale(0.88)" },
        { opacity: 0.95, transform: "scale(1)", offset: 0.18 },
        { opacity: 0.82, transform: `scale(${1.02 + intensity * 0.08})`, offset: 0.72 },
        { opacity: 0, transform: "scale(1.12)" },
      ],
    },
    {
      layer: "aura-glow",
      keyframes: [
        { opacity: 0.48, transform: "scale(0.82)" },
        { opacity: 0.96, transform: `scale(${1.05 + intensity * 0.08})`, offset: 0.52 },
        { opacity: 0.42, transform: "scale(0.92)" },
      ],
      durationRatio: 0.62,
    },
    expandStep("aura-ring", 0.74, 1.08 + intensity * 0.08),
    ...sparkSteps(8, geometry, "aura-particle", 0.55),
  ],
};

export function applyDomMotionPreset(
  rootEl: HTMLElement,
  descriptor: EffectDescriptor,
  geometry: EffectGeometry,
): Animation[] {
  if (typeof rootEl.animate !== "function") {
    return [];
  }

  rootEl.dataset.fxDirected = "true";
  const context: MotionContext = {
    descriptor,
    geometry,
    durationMs: descriptor.meta.durationMs,
    intensity: descriptor.meta.intensity,
  };
  const steps = PRESETS[descriptor.shape](context);
  const animations: Animation[] = [];

  for (const step of steps) {
    const targets = resolveLayerTargets(rootEl, step.layer, step.targetIndex);

    for (const target of targets) {
      if (typeof target.animate !== "function") {
        continue;
      }

      animations.push(
        target.animate(step.keyframes, {
          delay: step.delay ?? 0,
          duration: Math.max(1, context.durationMs * (step.durationRatio ?? 1)),
          easing: step.easing ?? "cubic-bezier(0.18, 0.86, 0.22, 1)",
          fill: "forwards",
        }),
      );
    }
  }

  return animations;
}

function resolveLayerTargets(
  rootEl: HTMLElement,
  layer: MotionLayer,
  targetIndex: number | undefined,
): HTMLElement[] {
  if (layer === "root") {
    return [rootEl];
  }

  const selector = LAYER_SELECTORS[layer];
  const targets = selector ? Array.from(rootEl.querySelectorAll<HTMLElement>(selector)) : [];

  if (targetIndex === undefined) {
    return targets;
  }

  return targets[targetIndex] ? [targets[targetIndex]] : [];
}

function expandStep(layer: MotionLayer, startScale: number, endScale: number): MotionStep {
  return {
    layer,
    keyframes: [
      { opacity: 0.68, transform: `scale(${startScale})` },
      { opacity: 0, transform: `scale(${endScale})` },
    ],
    easing: "ease-out",
  };
}

function sparkSteps(
  count: number,
  geometry: EffectGeometry,
  layer: "spark" | "aura-particle",
  radiusScale: number,
): MotionStep[] {
  const radius = Math.max(22, Math.min(74, geometry.distance * radiusScale));

  return Array.from({ length: count }, (_unused, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.62;

    return {
      layer,
      targetIndex: index,
      delay: index * 16,
      durationRatio: 0.82,
      keyframes: [
        { opacity: 0, transform: "translate(0px, 0px) scale(0.42)" },
        { opacity: 1, transform: `translate(${x * 0.45}px, ${y * 0.45}px) scale(1)`, offset: 0.34 },
        { opacity: 0, transform: `translate(${x}px, ${y}px) scale(0.22)` },
      ],
      easing: "ease-out",
    };
  });
}

function resolveArcLift(geometry: EffectGeometry): number {
  const direction = geometry.source.centerY > geometry.target.centerY ? -1 : 1;
  return direction * Math.max(34, Math.min(72, geometry.distance * 0.18));
}
