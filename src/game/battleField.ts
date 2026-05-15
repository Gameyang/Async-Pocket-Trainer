import type { BattleFieldId, BattleFieldState, BattleFieldTimeOfDay, ElementType } from "./types";
import type { SeededRng } from "./rng";

export const BATTLE_FIELD_WAVE_SPAN = 5;

export interface BattleFieldDefinition {
  id: BattleFieldId;
  label: string;
  element: ElementType;
  canvas: BattleFieldCanvasPalette;
}

export interface BattleFieldCanvasPalette {
  skyTop: string;
  skyBottom: string;
  groundTop: string;
  groundBottom: string;
  platform: string;
}

export const battleFieldDefinitions: readonly BattleFieldDefinition[] = [
  {
    id: "forest",
    label: "숲",
    element: "grass",
    canvas: {
      skyTop: "#8bd8ff",
      skyBottom: "#ffe189",
      groundTop: "#75bb68",
      groundBottom: "#4c9a5f",
      platform: "#70b865",
    },
  },
  {
    id: "volcano",
    label: "화산",
    element: "fire",
    canvas: {
      skyTop: "#ffb06d",
      skyBottom: "#5e2732",
      groundTop: "#a85238",
      groundBottom: "#3b2630",
      platform: "#c46b3a",
    },
  },
  {
    id: "ocean",
    label: "바다",
    element: "water",
    canvas: {
      skyTop: "#8fdcff",
      skyBottom: "#7be0d5",
      groundTop: "#4ea6c8",
      groundBottom: "#21649a",
      platform: "#6fc1be",
    },
  },
  {
    id: "city",
    label: "도시",
    element: "electric",
    canvas: {
      skyTop: "#8ec6ff",
      skyBottom: "#f8df6a",
      groundTop: "#8793a0",
      groundBottom: "#4a5665",
      platform: "#d6c24c",
    },
  },
  {
    id: "swamp",
    label: "늪",
    element: "poison",
    canvas: {
      skyTop: "#a8b9a0",
      skyBottom: "#d6c678",
      groundTop: "#667f48",
      groundBottom: "#354a36",
      platform: "#7e9a50",
    },
  },
  {
    id: "desert",
    label: "사막",
    element: "ground",
    canvas: {
      skyTop: "#7fcdf3",
      skyBottom: "#f4cc74",
      groundTop: "#d4a04c",
      groundBottom: "#9b6930",
      platform: "#dcb260",
    },
  },
  {
    id: "highland",
    label: "고원",
    element: "flying",
    canvas: {
      skyTop: "#9edcff",
      skyBottom: "#d5f0ff",
      groundTop: "#91a96f",
      groundBottom: "#526f5b",
      platform: "#9dbc77",
    },
  },
  {
    id: "jungle",
    label: "밀림",
    element: "bug",
    canvas: {
      skyTop: "#7ed5b2",
      skyBottom: "#d5da76",
      groundTop: "#5da654",
      groundBottom: "#244f35",
      platform: "#75b454",
    },
  },
  {
    id: "dojo",
    label: "도장",
    element: "fighting",
    canvas: {
      skyTop: "#ffcf8d",
      skyBottom: "#f6e3bd",
      groundTop: "#b36b55",
      groundBottom: "#6c4938",
      platform: "#c28359",
    },
  },
  {
    id: "ruins",
    label: "유적",
    element: "psychic",
    canvas: {
      skyTop: "#d4b9ff",
      skyBottom: "#f5cfe9",
      groundTop: "#8f7db0",
      groundBottom: "#51466c",
      platform: "#b98fce",
    },
  },
  {
    id: "crags",
    label: "암산",
    element: "rock",
    canvas: {
      skyTop: "#97c6dd",
      skyBottom: "#ded0aa",
      groundTop: "#93835f",
      groundBottom: "#514b3d",
      platform: "#a7966a",
    },
  },
  {
    id: "haunted-ruins",
    label: "폐허",
    element: "ghost",
    canvas: {
      skyTop: "#8c8db5",
      skyBottom: "#b3aac6",
      groundTop: "#5f6078",
      groundBottom: "#313245",
      platform: "#77708d",
    },
  },
  {
    id: "tundra",
    label: "빙원",
    element: "ice",
    canvas: {
      skyTop: "#bcecff",
      skyBottom: "#f2fbff",
      groundTop: "#a8dde6",
      groundBottom: "#5b9eb4",
      platform: "#c0edf2",
    },
  },
  {
    id: "dragon-cave",
    label: "용의 동굴",
    element: "dragon",
    canvas: {
      skyTop: "#565075",
      skyBottom: "#ac7e5b",
      groundTop: "#6e4d5e",
      groundBottom: "#2f2b44",
      platform: "#8a6272",
    },
  },
  {
    id: "back-alley",
    label: "뒷골목",
    element: "dark",
    canvas: {
      skyTop: "#56606f",
      skyBottom: "#8d7d70",
      groundTop: "#454d58",
      groundBottom: "#242933",
      platform: "#5e6470",
    },
  },
  {
    id: "factory",
    label: "공장",
    element: "steel",
    canvas: {
      skyTop: "#b5c7d6",
      skyBottom: "#d4d8cf",
      groundTop: "#8c9aa1",
      groundBottom: "#59656d",
      platform: "#a5b2b6",
    },
  },
  {
    id: "flower-field",
    label: "꽃밭",
    element: "fairy",
    canvas: {
      skyTop: "#ffd1ef",
      skyBottom: "#fff2a3",
      groundTop: "#82c96c",
      groundBottom: "#5d9b69",
      platform: "#f2a9c8",
    },
  },
  {
    id: "plains",
    label: "평원",
    element: "normal",
    canvas: {
      skyTop: "#9fd8ff",
      skyBottom: "#ffe4a6",
      groundTop: "#98b96a",
      groundBottom: "#607d48",
      platform: "#a8bc6e",
    },
  },
];

const battleFieldDefinitionById = new Map<BattleFieldId, BattleFieldDefinition>(
  battleFieldDefinitions.map((definition) => [definition.id, definition]),
);

export function createBattleFieldOrder(rng: Pick<SeededRng, "shuffle">): BattleFieldId[] {
  return rng.shuffle(battleFieldDefinitions.map((definition) => definition.id));
}

export function normalizeBattleFieldOrder(order?: readonly BattleFieldId[]): BattleFieldId[] {
  const normalized: BattleFieldId[] = [];
  const seen = new Set<BattleFieldId>();

  for (const id of order ?? []) {
    if (battleFieldDefinitionById.has(id) && !seen.has(id)) {
      normalized.push(id);
      seen.add(id);
    }
  }

  for (const definition of battleFieldDefinitions) {
    if (!seen.has(definition.id)) {
      normalized.push(definition.id);
      seen.add(definition.id);
    }
  }

  return normalized;
}

export function resolveBattleFieldForWave(
  wave: number,
  order?: readonly BattleFieldId[],
): BattleFieldState {
  const normalizedWave = Math.max(1, Math.floor(wave));
  const waveBlock = Math.floor((normalizedWave - 1) / BATTLE_FIELD_WAVE_SPAN);
  const battleFieldOrder = normalizeBattleFieldOrder(order);
  const fieldId = battleFieldOrder[waveBlock % battleFieldOrder.length];
  const definition = battleFieldDefinitionById.get(fieldId) ?? battleFieldDefinitions[0];
  const timeOfDay: BattleFieldTimeOfDay = waveBlock % 2 === 0 ? "day" : "night";
  const waveStart = waveBlock * BATTLE_FIELD_WAVE_SPAN + 1;

  return {
    id: definition.id,
    label: definition.label,
    element: definition.element,
    timeOfDay,
    timeLabel: timeOfDay === "day" ? "낮" : "밤",
    waveBlock,
    waveStart,
    waveEnd: waveStart + BATTLE_FIELD_WAVE_SPAN - 1,
  };
}

export function formatBattleFieldLabel(field: BattleFieldState): string {
  return `${field.label} ${field.timeLabel}`;
}

export function getBattleFieldCanvasPalette(field: BattleFieldState): BattleFieldCanvasPalette {
  const definition = battleFieldDefinitionById.get(field.id) ?? battleFieldDefinitions[0];

  if (field.timeOfDay === "day") {
    return { ...definition.canvas };
  }

  return {
    skyTop: shadeColor(definition.canvas.skyTop, 0.42),
    skyBottom: shadeColor(definition.canvas.skyBottom, 0.34),
    groundTop: shadeColor(definition.canvas.groundTop, 0.58),
    groundBottom: shadeColor(definition.canvas.groundBottom, 0.52),
    platform: shadeColor(definition.canvas.platform, 0.6),
  };
}

function shadeColor(hex: string, factor: number): string {
  const value = hex.replace("#", "");
  const red = Math.round(parseInt(value.slice(0, 2), 16) * factor);
  const green = Math.round(parseInt(value.slice(2, 4), 16) * factor);
  const blue = Math.round(parseInt(value.slice(4, 6), 16) * factor);

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}
