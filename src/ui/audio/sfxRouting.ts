const directLocalSfxStems = {
  "sfx.battle.hit": "battle-hit",
  "sfx.battle.critical.hit": "battle-critical-hit",
  "sfx.battle.miss": "battle-miss",
  "sfx.capture.success": "capture-success",
  "sfx.capture.fail": "capture-fail",
  "sfx.creature.faint": "creature-faint",
  "sfx.phase.change": "phase-change",
} as const;

const battleTypeSfxPattern = /^sfx\.battle\.type\.([a-z-]+)(?:\.(critical))?$/;
const battleSupportSfxPattern = /^sfx\.battle\.support\.type\.([a-z-]+)$/;

export function resolveLocalSfxStem(soundKey: string): string | undefined {
  const directStem = directLocalSfxStems[soundKey as keyof typeof directLocalSfxStems];
  if (directStem) {
    return directStem;
  }

  const supportMatch = battleSupportSfxPattern.exec(soundKey);
  if (supportMatch) {
    return `battle-support-type-${supportMatch[1]}`;
  }

  const typeMatch = battleTypeSfxPattern.exec(soundKey);
  if (typeMatch) {
    return `battle-type-${typeMatch[1]}${typeMatch[2] ? "-critical" : ""}`;
  }

  return undefined;
}
