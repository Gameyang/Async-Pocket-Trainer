import type { EffectDescriptor, EffectGeometry, EffectRect, ShapeBuilder } from "./types";
import { buildAuraShape } from "./shapes/aura";
import { buildBeamShape } from "./shapes/beam";
import { buildBurstShape } from "./shapes/burst";
import { buildProjectileShape } from "./shapes/projectile";
import { buildStrikeShape } from "./shapes/strike";

export interface EffectInstance {
  id: string;
  cueId: string;
  effectKey: string;
  rootEl: HTMLElement;
  startedAt: number;
  durationMs: number;
}

export interface EffectEngine {
  spawn(
    descriptor: EffectDescriptor,
    sourceEl: HTMLElement,
    targetEl: HTMLElement,
    cueId: string,
    effectKey: string,
  ): void;
  clear(): void;
}

interface EffectEngineOptions {
  now?: () => number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

const SHAPE_BUILDERS: Record<EffectDescriptor["shape"], ShapeBuilder> = {
  strike: buildStrikeShape,
  projectile: buildProjectileShape,
  beam: buildBeamShape,
  burst: buildBurstShape,
  aura: buildAuraShape,
};

export function createEffectEngine(options: EffectEngineOptions = {}): EffectEngine {
  const active: EffectInstance[] = [];
  const activeKeys = new Set<string>();
  const clock = options.now ?? (() => performance.now());
  const raf =
    options.requestAnimationFrame ??
    ((callback: FrameRequestCallback) => window.requestAnimationFrame(callback));
  const cancelRaf =
    options.cancelAnimationFrame ?? ((handle: number) => window.cancelAnimationFrame(handle));
  let rafHandle: number | undefined;
  let nextInstanceId = 1;

  const removeInstance = (instance: EffectInstance) => {
    instance.rootEl.remove();
    activeKeys.delete(dedupeKey(instance.cueId, instance.effectKey));
    const index = active.indexOf(instance);

    if (index >= 0) {
      active.splice(index, 1);
    }
  };

  const pruneDisconnectedInstances = () => {
    [...active].forEach((instance) => {
      if (!instance.rootEl.isConnected) {
        removeInstance(instance);
      }
    });
  };

  const tick = (timestamp: number) => {
    rafHandle = undefined;
    const now = Number.isFinite(timestamp) ? timestamp : clock();

    [...active].forEach((instance) => {
      if (!instance.rootEl.isConnected || now - instance.startedAt >= instance.durationMs) {
        removeInstance(instance);
      }
    });

    if (active.length > 0) {
      rafHandle = raf(tick);
    }
  };

  const startLoop = () => {
    if (rafHandle === undefined && active.length > 0) {
      rafHandle = raf(tick);
    }
  };

  return {
    spawn(descriptor, sourceEl, targetEl, cueId, effectKey) {
      if (typeof document === "undefined") {
        return;
      }

      pruneDisconnectedInstances();
      const key = dedupeKey(cueId, effectKey);

      if (activeKeys.has(key)) {
        return;
      }

      const overlay = ensureOverlay(sourceEl, targetEl);
      const geometry = measureGeometry(sourceEl, targetEl, overlay);
      const rootEl = SHAPE_BUILDERS[descriptor.shape](descriptor, geometry);

      applyPalette(rootEl, descriptor);
      overlay.appendChild(rootEl);
      active.push({
        id: `fx-${nextInstanceId}`,
        cueId,
        effectKey,
        rootEl,
        startedAt: clock(),
        durationMs: descriptor.meta.durationMs,
      });
      nextInstanceId += 1;
      activeKeys.add(key);
      startLoop();
    },
    clear() {
      [...active].forEach(removeInstance);
      activeKeys.clear();

      if (rafHandle !== undefined) {
        cancelRaf(rafHandle);
        rafHandle = undefined;
      }
    },
  };
}

export const effectEngine = createEffectEngine();

function dedupeKey(cueId: string, effectKey: string): string {
  return `${cueId}::${effectKey}`;
}

function ensureOverlay(sourceEl: HTMLElement, targetEl: HTMLElement): HTMLElement {
  const owner =
    sourceEl.closest<HTMLElement>(".screen") ??
    targetEl.closest<HTMLElement>(".screen") ??
    document.body;
  const existing = Array.from(owner.children).find((child) =>
    child.classList.contains("fx-overlay"),
  );

  if (existing instanceof HTMLElement) {
    return existing;
  }

  const overlay = document.createElement("div");
  overlay.className = "fx-overlay";
  overlay.setAttribute("aria-hidden", "true");
  owner.appendChild(overlay);
  return overlay;
}

function applyPalette(rootEl: HTMLElement, descriptor: EffectDescriptor): void {
  rootEl.style.setProperty("--fx-primary", descriptor.palette.primary);
  rootEl.style.setProperty("--fx-secondary", descriptor.palette.secondary);
  rootEl.style.setProperty("--fx-accent", descriptor.palette.accent);
}

function measureGeometry(
  sourceEl: HTMLElement,
  targetEl: HTMLElement,
  overlay: HTMLElement,
): EffectGeometry {
  const overlayRect = overlay.getBoundingClientRect();
  const source = toEffectRect(sourceEl.getBoundingClientRect(), overlayRect);
  const target = toEffectRect(targetEl.getBoundingClientRect(), overlayRect);
  const dx = target.centerX - source.centerX;
  const dy = target.centerY - source.centerY;
  const distance = Math.max(1, Math.hypot(dx, dy));

  return {
    source,
    target,
    overlay: toEffectRect(overlayRect, overlayRect),
    dx,
    dy,
    distance,
    angleDeg: Math.atan2(dy, dx) * (180 / Math.PI),
  };
}

function toEffectRect(rect: DOMRect, overlayRect: DOMRect): EffectRect {
  const x = rect.left - overlayRect.left;
  const y = rect.top - overlayRect.top;

  return {
    x,
    y,
    width: rect.width,
    height: rect.height,
    centerX: x + rect.width / 2,
    centerY: y + rect.height / 2,
  };
}
