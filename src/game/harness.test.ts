import { describe, expect, it } from "vitest";

import { buildMetadata } from "../buildMetadata";

describe("development harness", () => {
  it("keeps the project identity available to tooling", () => {
    expect(buildMetadata).toMatchObject({
      name: "Async Pocket Trainer",
      harnessVersion: 2,
      architecture: "headless-core-with-html-renderer",
    });
  });
});
