import { getMove, getSpecies } from "./data/catalog";
import type { Creature, ElementType, MoveDefinition } from "./types";

export function getLearnableLevelUpMoves(
  creature: Creature,
  element: ElementType,
  options: { grade?: 1 | 2 | 3 } = {},
): MoveDefinition[] {
  const knownMoveIds = new Set(creature.moves.map((move) => move.id));
  const seen = new Set<string>();
  const candidates = getSpecies(creature.speciesId).levelUpMoves
    .map((entry) => getMove(entry.moveId))
    .filter((move) => {
      if (move.type !== element || knownMoveIds.has(move.id) || seen.has(move.id)) {
        return false;
      }

      seen.add(move.id);
      return true;
    });

  if (!options.grade || candidates.length <= 1) {
    return candidates;
  }

  const ranked = candidates.slice().sort(compareMoveLearningValue);
  const poolSize =
    options.grade === 3
      ? Math.max(1, Math.ceil(ranked.length * 0.34))
      : options.grade === 2
        ? Math.max(1, Math.ceil(ranked.length * 0.67))
        : ranked.length;

  return ranked.slice(0, poolSize);
}

export function canLearnLevelUpMoveType(creature: Creature, element: ElementType): boolean {
  return getLearnableLevelUpMoves(creature, element).length > 0;
}

function compareMoveLearningValue(left: MoveDefinition, right: MoveDefinition): number {
  const scoreDiff = scoreMoveLearningValue(right) - scoreMoveLearningValue(left);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  if (right.power !== left.power) {
    return right.power - left.power;
  }

  return (right.accuracyPercent ?? 100) - (left.accuracyPercent ?? 100);
}

function scoreMoveLearningValue(move: MoveDefinition): number {
  const power = move.category === "status" ? 30 : Math.max(1, move.power);
  const effectBonus =
    move.statusEffect ||
    move.statChanges.length > 0 ||
    move.meta.drain > 0 ||
    move.meta.healing > 0 ||
    move.meta.flinchChance > 0 ||
    move.meta.critRate > 0
      ? 18
      : 0;
  const accuracy = move.accuracyPercent ?? 100;

  return power + effectBonus + accuracy / 10 + move.priority * 5;
}
