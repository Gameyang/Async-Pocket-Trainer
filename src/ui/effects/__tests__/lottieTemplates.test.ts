import { describe, expect, it } from "vitest";

import { resolveEffectDescriptor } from "../mapping";
import {
  cloneTintedLottieData,
  getLottieTemplateDurationMs,
  lottieSourcePaths,
  lottieTemplateIdsForShape,
  resolveLottieTemplate,
} from "../lottieTemplates";

describe("lottie battle templates", () => {
  it("maps every effect shape to at least two reusable templates", () => {
    expect(lottieTemplateIdsForShape("projectile").length).toBeGreaterThanOrEqual(2);
    expect(lottieTemplateIdsForShape("beam").length).toBeGreaterThanOrEqual(2);
    expect(lottieTemplateIdsForShape("strike").length).toBeGreaterThanOrEqual(2);
    expect(lottieTemplateIdsForShape("burst").length).toBeGreaterThanOrEqual(2);
    expect(lottieTemplateIdsForShape("aura").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps downloaded sample attribution paths visible to tests", () => {
    expect(lottieSourcePaths()).toEqual(
      expect.arrayContaining([
        "spemer/lottie-animations-json/animate_tab/animate_tab_1.json",
        "spemer/lottie-animations-json/animate_tab/animate_tab_1_example.json",
        "spemer/lottie-animations-json/ic_fav/ic_fav.json",
        "spemer/lottie-animations-json/pagination_indicator/pagination_indicator.json",
      ]),
    );
  });

  it("clones and tints a template without mutating the original JSON import", () => {
    const descriptor = resolveEffectDescriptor({ category: "special", type: "fire" });
    const template = resolveLottieTemplate(descriptor);
    const before = JSON.stringify(template.animationData);
    const tinted = cloneTintedLottieData(template, descriptor.palette);

    expect(tinted).not.toBe(template.animationData);
    expect(JSON.stringify(template.animationData)).toBe(before);
    expect(JSON.stringify(tinted)).toContain("0.26666666666666666");
  });

  it("reads a playable duration from each template", () => {
    const descriptor = resolveEffectDescriptor({ category: "status", type: "electric" });
    const template = resolveLottieTemplate(descriptor);

    expect(getLottieTemplateDurationMs(template)).toBeGreaterThan(100);
  });
});
