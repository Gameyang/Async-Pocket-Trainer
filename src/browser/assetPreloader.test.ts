import { describe, expect, it } from "vitest";

import { getDelayedGameAssets, getPreloadableGameAssets } from "./assetPreloader";

describe("getPreloadableGameAssets", () => {
  it("includes launch-critical assets and excludes delayed resources", () => {
    const assets = getPreloadableGameAssets();

    expect(assets.length).toBeGreaterThan(0);
    expect(assets.some((asset) => asset.kind === "pokemon-sprite")).toBe(true);
    expect(assets.some((asset) => asset.kind === "sfx")).toBe(true);
    expect(assets.some((asset) => asset.kind === "bgm")).toBe(true);
    expect(assets.some((asset) => asset.kind === "ui-motion")).toBe(true);
    expect(
      assets
        .filter((asset) => asset.kind === "sfx")
        .every((asset) => asset.sourcePath.includes("../resources/audio/sfx/")),
    ).toBe(true);
    expect(assets.some((asset) => asset.sourcePath.includes("../resources/trainers/"))).toBe(
      false,
    );
    expect(
      assets.some((asset) => asset.sourcePath.includes("../resources/audio/cries/")),
    ).toBe(false);
  });

  it("keeps delayed background downloads scoped to Pokemon cries", () => {
    const assets = getDelayedGameAssets();

    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((asset) => asset.kind === "pokemon-cry")).toBe(true);
    expect(
      assets.every((asset) => asset.sourcePath.includes("../resources/audio/cries/")),
    ).toBe(true);
    expect(
      assets.some((asset) => asset.sourcePath.includes("../resources/audio/sfx/")),
    ).toBe(false);
    expect(assets.some((asset) => asset.sourcePath.includes("../resources/trainers/"))).toBe(
      false,
    );
  });

  it("deduplicates generated asset urls before preloading", () => {
    const assets = getPreloadableGameAssets();
    const urls = new Set(assets.map((asset) => asset.url));

    expect(urls.size).toBe(assets.length);
  });

  it("deduplicates delayed asset urls before background preloading", () => {
    const assets = getDelayedGameAssets();
    const urls = new Set(assets.map((asset) => asset.url));

    expect(urls.size).toBe(assets.length);
  });
});
