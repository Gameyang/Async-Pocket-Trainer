import { describe, expect, it } from "vitest";

import { selectJosa, withJosa } from "./localization";

describe("Korean localization helpers", () => {
  it("selects Korean particles from the final syllable", () => {
    expect(withJosa("피카츄", "이/가")).toBe("피카츄가");
    expect(withJosa("딱충이", "을/를")).toBe("딱충이를");
    expect(withJosa("깨비참", "와/과")).toBe("깨비참과");
    expect(withJosa("이상해씨", "은/는")).toBe("이상해씨는");
  });

  it("handles digit endings for compact combat text", () => {
    expect(selectJosa("10", "을/를")).toBe("을");
    expect(selectJosa("2", "을/를")).toBe("를");
    expect(selectJosa("7", "으로/로")).toBe("로");
  });
});
