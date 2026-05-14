import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ELEMENT_PALETTE, ELEMENT_TYPES, getElementPalette } from "../palette";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

describe("effect element palette", () => {
  it("defines primary, secondary, and accent colors for every element type", () => {
    expect(ELEMENT_TYPES).toHaveLength(18);

    for (const type of ELEMENT_TYPES) {
      expect(ELEMENT_PALETTE[type]).toEqual({
        primary: expect.stringMatching(HEX_COLOR),
        secondary: expect.stringMatching(HEX_COLOR),
        accent: expect.stringMatching(HEX_COLOR),
      });
    }
  });

  it("falls back to normal for unknown element values", () => {
    expect(getElementPalette("unknown")).toBe(ELEMENT_PALETTE.normal);
  });

  it("exposes matching CSS variables for every palette entry", () => {
    const css = readFileSync(new URL("../effects.css", import.meta.url), "utf8");

    for (const type of ELEMENT_TYPES) {
      expect(css).toContain(`--type-${type}-primary: ${ELEMENT_PALETTE[type].primary}`);
      expect(css).toContain(`--type-${type}-secondary: ${ELEMENT_PALETTE[type].secondary}`);
      expect(css).toContain(`--type-${type}-accent: ${ELEMENT_PALETTE[type].accent}`);
    }
  });
});
