import { describe, expect, it } from "vitest";

import { buildMetadata } from "../buildMetadata";

describe("development harness", () => {
  it("keeps the project identity available to tooling", () => {
    expect(buildMetadata).toMatchObject({
      name: "비동기 포켓 트레이너",
      harnessVersion: 2,
      gameVersion: 2,
      architecture: "headless-core-with-html-renderer",
    });
  });
});
