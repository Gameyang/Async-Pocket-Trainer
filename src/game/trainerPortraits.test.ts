import { describe, expect, it } from "vitest";

import { getTrainerPortrait, trainerPortraitCatalog } from "./trainerPortraits";

describe("trainer portrait catalog labels", () => {
  it("uses game-like skin names for curated premium trainer portraits", () => {
    expect(getTrainerPortrait("hf-trainer-05-dragon-queen").label).toBe("용왕복");
    expect(getTrainerPortrait("hf-trainer-13-blue-flame-witch").label).toBe("청염마녀");
  });

  it("formats generated trainer portraits as collectible skin names", () => {
    expect(getTrainerPortrait("ps-trainer-red").label).toBe("레드복");
    expect(getTrainerPortrait("ps-trainer-lass-gen1").label).toBe("치마1세");
  });

  it("keeps every trainer skin label within four characters", () => {
    expect(trainerPortraitCatalog.every((portrait) => portrait.label.length <= 4)).toBe(true);
  });
});
