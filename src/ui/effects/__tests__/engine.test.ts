import { afterEach, describe, expect, it, vi } from "vitest";

import { createEffectEngine } from "../engine";
import { resolveEffectDescriptor } from "../mapping";
import type { EffectDescriptor } from "../types";

describe("effect engine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an overlay lazily and dedupes the same cue/effect pair", () => {
    const dom = installFakeDom();
    const { source, target } = createBattleDom(dom);
    const raf = createRafController();
    const engine = createEffectEngine({
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });
    const descriptor = testDescriptor();

    engine.spawn(descriptor, source, target, "cue-1", "battle.hit");
    engine.spawn(descriptor, source, target, "cue-1", "battle.hit");

    expect(dom.querySelector(".fx-overlay")).toBeTruthy();
    expect(dom.querySelectorAll(".fx-instance")).toHaveLength(1);
  });

  it("allows different cue/effect pairs to overlap", () => {
    const dom = installFakeDom();
    const { source, target } = createBattleDom(dom);
    const raf = createRafController();
    const engine = createEffectEngine({
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });
    const descriptor = testDescriptor();

    engine.spawn(descriptor, source, target, "cue-1", "battle.hit");
    engine.spawn(descriptor, source, target, "cue-2", "battle.hit");

    expect(dom.querySelectorAll(".fx-instance")).toHaveLength(2);
  });

  it("applies element palettes and centers projectiles on zero-height sprites", () => {
    const dom = installFakeDom();
    const { source, target } = createBattleDom(dom);
    const raf = createRafController();
    const engine = createEffectEngine({
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });
    const descriptor = resolveEffectDescriptor({ category: "special", type: "poison" });

    setRect(source as unknown as FakeElement, { left: 40, top: 240, width: 120, height: 0 });
    engine.spawn(descriptor, source, target, "cue-1", "battle.hit");

    const instance = dom.querySelector(".fx-instance");

    expect(instance?.style.getPropertyValue("--fx-primary")).toBe("#9c5cc4");
    expect(instance?.style.getPropertyValue("--fx-accent")).toBe("#ecd9f4");
    expect(instance?.style.getPropertyValue("left")).toBe("100px");
    expect(instance?.style.getPropertyValue("top")).toBe("300px");
  });

  it("uses directed HTML motion presets and cancels them on cleanup", () => {
    const dom = installFakeDom();
    const { source, target } = createBattleDom(dom);
    const raf = createRafController();
    const engine = createEffectEngine({
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });
    const descriptor = resolveEffectDescriptor({ category: "special", type: "poison" });

    engine.spawn(descriptor, source, target, "cue-1", "battle.hit");

    const instance = dom.querySelector(".fx-instance");
    const projectileCore = dom.querySelector(".fx-projectile-core");
    const animation = projectileCore?.animations[0];

    expect(instance?.dataset.fxDirected).toBe("true");
    expect(projectileCore?.animations.length).toBeGreaterThan(0);

    engine.clear();

    expect(animation?.cancelled).toBe(true);
  });

  it("removes expired instances and stops scheduling frames when idle", () => {
    const dom = installFakeDom();
    const { source, target } = createBattleDom(dom);
    const raf = createRafController();
    let now = 0;
    const engine = createEffectEngine({
      now: () => now,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });
    const descriptor = testDescriptor();

    engine.spawn(descriptor, source, target, "cue-1", "battle.hit");
    expect(raf.pendingCount()).toBe(1);

    raf.step(0);
    expect(dom.querySelectorAll(".fx-instance")).toHaveLength(1);
    expect(raf.pendingCount()).toBe(1);

    now = descriptor.meta.durationMs + 1;
    raf.step(now);
    expect(dom.querySelectorAll(".fx-instance")).toHaveLength(0);
    expect(raf.pendingCount()).toBe(0);
  });
});

function testDescriptor(): EffectDescriptor {
  return resolveEffectDescriptor({ category: "physical", type: "normal" });
}

function createBattleDom(dom: FakeDocument): { source: HTMLElement; target: HTMLElement } {
  const screen = dom.createElement("section");
  const source = dom.createElement("div");
  const target = dom.createElement("div");

  screen.className = "screen";
  source.className = "screen-monster";
  target.className = "screen-monster";
  screen.append(source, target);
  dom.body.appendChild(screen);
  setRect(screen, { left: 0, top: 0, width: 430, height: 390 });
  setRect(source, { left: 40, top: 240, width: 120, height: 120 });
  setRect(target, { left: 260, top: 90, width: 110, height: 110 });
  return {
    source: source as unknown as HTMLElement,
    target: target as unknown as HTMLElement,
  };
}

function setRect(
  element: FakeElement,
  rect: { left: number; top: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

function createRafController() {
  const callbacks: FrameRequestCallback[] = [];

  return {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }),
    cancelAnimationFrame: vi.fn(),
    pendingCount: () => callbacks.length,
    step: (timestamp: number) => {
      const callback = callbacks.shift();

      if (!callback) {
        throw new Error("No pending RAF callback.");
      }

      callback(timestamp);
    },
  };
}

class FakeStyle {
  private readonly values = new Map<string, string>();

  set left(value: string) {
    this.setProperty("left", value);
  }

  get left(): string {
    return this.getPropertyValue("left");
  }

  set top(value: string) {
    this.setProperty("top", value);
  }

  get top(): string {
    return this.getPropertyValue("top");
  }

  set width(value: string) {
    this.setProperty("width", value);
  }

  get width(): string {
    return this.getPropertyValue("width");
  }

  set height(value: string) {
    this.setProperty("height", value);
  }

  get height(): string {
    return this.getPropertyValue("height");
  }

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? "";
  }
}

class FakeAnimation {
  cancelled = false;

  constructor(
    readonly keyframes: Keyframe[],
    readonly options: KeyframeAnimationOptions | number | undefined,
  ) {}

  cancel(): void {
    this.cancelled = true;
  }
}

class FakeElement {
  className = "";
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly animations: FakeAnimation[] = [];
  readonly style = new FakeStyle();
  parentElement?: FakeElement;
  private readonly attributes = new Map<string, string>();

  get classList() {
    return {
      contains: (className: string) => this.className.split(/\s+/).includes(className),
    };
  }

  get isConnected(): boolean {
    if (this === fakeDocument?.body) {
      return true;
    }

    for (
      let parent: FakeElement | undefined = this.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent === fakeDocument?.body) {
        return true;
      }
    }

    return false;
  }

  append(...children: FakeElement[]): void {
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    const siblings = this.parentElement?.children;

    if (!siblings) {
      return;
    }

    const index = siblings.indexOf(this);

    if (index >= 0) {
      siblings.splice(index, 1);
    }

    this.parentElement = undefined;
  }

  closest(selector: string): FakeElement | null {
    const className = selector.startsWith(".") ? selector.slice(1) : selector;

    if (this.classList.contains(className)) {
      return this;
    }

    for (
      let parent: FakeElement | undefined = this.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.classList.contains(className)) {
        return parent;
      }
    }

    return null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const className = selector.startsWith(".") ? selector.slice(1) : selector;
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      if (element.classList.contains(className)) {
        matches.push(element);
      }

      element.children.forEach(visit);
    };

    visit(this);
    return matches;
  }

  animate(
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ): Animation {
    const animation = new FakeAnimation(Array.isArray(keyframes) ? keyframes : [], options);
    this.animations.push(animation);
    return animation as unknown as Animation;
  }

  getBoundingClientRect(): DOMRect {
    return {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
}

class FakeDocument {
  readonly body = new FakeElement();

  createElement(_tagName?: string): FakeElement {
    return new FakeElement();
  }

  querySelector(selector: string): FakeElement | null {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.body.querySelectorAll(selector);
  }
}

let fakeDocument: FakeDocument | undefined;

function installFakeDom(): FakeDocument {
  fakeDocument = new FakeDocument();
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", fakeDocument);
  return fakeDocument;
}
