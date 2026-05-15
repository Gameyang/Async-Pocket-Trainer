import { describe, expect, it } from "vitest";

import { getTrainerPortrait } from "./trainerPortraits";

describe("trainer portrait catalog labels", () => {
  it("uses game-like skin names for curated premium trainer portraits", () => {
    expect(getTrainerPortrait("hf-trainer-05-dragon-queen").label).toBe("드래곤 퀸 로브");
    expect(getTrainerPortrait("hf-trainer-13-blue-flame-witch").label).toBe(
      "블루 플레임 위치",
    );
  });

  it("formats generated trainer portraits as collectible skin names", () => {
    expect(getTrainerPortrait("ps-trainer-red").label).toBe("레드 클래식");
    expect(getTrainerPortrait("ps-trainer-lass-gen1").label).toBe("짧은치마 1세대 드레스");
  });
});
