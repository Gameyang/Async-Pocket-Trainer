import { describe, expect, it } from "vitest";

import { buildMetadata } from "../main";

describe("development harness", () => {
  it("keeps the project identity available to tooling", () => {
    expect(buildMetadata).toMatchObject({
      name: "Async Pocket Trainer",
      harnessVersion: 1,
    });
  });
});
