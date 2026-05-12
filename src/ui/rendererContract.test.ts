import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("renderer contract boundaries", () => {
  it("keeps HTML renderer events on FrameAction.action dispatch", () => {
    const source = readSource("htmlRenderer.ts");

    expect(source).not.toMatch(/getSnapshot|autoStep|autoPlay/);
    expect(source).toContain("client.dispatch(action.action)");
  });

  it("keeps renderers consuming GameFrame instead of raw GameState", () => {
    const html = readSource("htmlRenderer.ts");
    const canvas = readSource("canvasRenderer.ts");

    expect(html).not.toMatch(/GameState|HeadlessGameClient/);
    expect(canvas).not.toMatch(/GameState|HeadlessGameClient/);
    expect(canvas).toContain("GameFrame");
    expect(canvas).toContain("entity.assetPath");
  });
});

function readSource(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}
