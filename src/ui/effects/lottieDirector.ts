import type { AnimationItem } from "lottie-web";
import type { EffectAnimationHandle, EffectDescriptor, EffectGeometry } from "./types";
import {
  cloneTintedLottieData,
  getLottieTemplateDurationMs,
  resolveLottieTemplate,
} from "./lottieTemplates";

interface LottiePlayerModule {
  default: {
    loadAnimation(options: {
      container: Element;
      renderer: "svg";
      loop: boolean;
      autoplay: boolean;
      animationData: unknown;
      rendererSettings: {
        preserveAspectRatio: string;
        progressiveLoad: boolean;
        hideOnTransparent: boolean;
        className: string;
      };
    }): AnimationItem;
  };
}

class LottieMotionHandle implements EffectAnimationHandle {
  private animation: AnimationItem | undefined;
  private cancelled = false;
  private removeCompleteListener: (() => void) | undefined;

  constructor(private readonly host: HTMLElement) {}

  attach(animation: AnimationItem): void {
    if (this.cancelled) {
      animation.destroy();
      return;
    }

    this.animation = animation;
    this.removeCompleteListener = animation.addEventListener("complete", () => this.cancel());
  }

  cancel(): void {
    if (this.cancelled) {
      return;
    }

    this.cancelled = true;
    this.removeCompleteListener?.();
    this.animation?.destroy();
    this.host.remove();
  }
}

export function applyLottieMotionTemplate(
  rootEl: HTMLElement,
  descriptor: EffectDescriptor,
  geometry: EffectGeometry,
): EffectAnimationHandle[] {
  if (!canRenderLottie()) {
    return [];
  }

  const template = resolveLottieTemplate(descriptor);
  const host = document.createElement("div");
  const handle = new LottieMotionHandle(host);

  host.className = `fx-lottie-layer fx-lottie-template-${template.id}`;
  host.dataset.fxLottieTemplate = template.id;
  host.setAttribute("aria-hidden", "true");
  setLottieGeometry(host, descriptor, geometry);
  rootEl.appendChild(host);

  void loadLottieTemplate(host, handle, descriptor, template).catch(() => handle.cancel());
  return [handle];
}

function canRenderLottie(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

async function loadLottieTemplate(
  host: HTMLElement,
  handle: LottieMotionHandle,
  descriptor: EffectDescriptor,
  template: ReturnType<typeof resolveLottieTemplate>,
): Promise<void> {
  const lottie = ((await import("lottie-web/build/player/lottie_light")) as LottiePlayerModule)
    .default;
  const animationData = cloneTintedLottieData(template, descriptor.palette);
  const animation = lottie.loadAnimation({
    container: host,
    renderer: "svg",
    loop: false,
    autoplay: true,
    animationData,
    rendererSettings: {
      preserveAspectRatio: "xMidYMid meet",
      progressiveLoad: true,
      hideOnTransparent: true,
      className: "fx-lottie-svg",
    },
  });
  const targetDurationMs = descriptor.meta.durationMs * resolveDurationRatio(descriptor);
  const sourceDurationMs = getLottieTemplateDurationMs(template);

  animation.setSpeed(Math.max(0.6, Math.min(3.2, sourceDurationMs / targetDurationMs)));
  handle.attach(animation);
}

function setLottieGeometry(
  host: HTMLElement,
  descriptor: EffectDescriptor,
  geometry: EffectGeometry,
): void {
  host.style.setProperty("--fx-lottie-distance", `${geometry.distance}px`);
  host.style.setProperty("--fx-lottie-angle", `${geometry.angleDeg}deg`);
  host.style.setProperty("--fx-lottie-intensity", String(descriptor.meta.intensity));

  if (descriptor.shape === "projectile") {
    host.style.setProperty("--fx-lottie-width", `${Math.max(96, geometry.distance)}px`);
    host.style.setProperty(
      "--fx-lottie-height",
      `${Math.min(150, Math.max(92, geometry.distance * 0.36))}px`,
    );
  }
}

function resolveDurationRatio(descriptor: EffectDescriptor): number {
  switch (descriptor.shape) {
    case "aura":
      return 0.78;
    case "beam":
      return 0.9;
    case "projectile":
      return 1;
    case "burst":
    case "strike":
      return 0.86;
  }
}
