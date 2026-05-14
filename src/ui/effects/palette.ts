import type { ElementType } from "../../game/types";
import type { ElementPalette } from "./types";

export const ELEMENT_TYPES = [
  "normal",
  "fire",
  "water",
  "grass",
  "electric",
  "poison",
  "ground",
  "flying",
  "bug",
  "fighting",
  "psychic",
  "rock",
  "ghost",
  "ice",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const satisfies readonly ElementType[];

export const ELEMENT_PALETTE: Record<ElementType, ElementPalette> = {
  normal: { primary: "#bfb3a4", secondary: "#e3d9c8", accent: "#f7f1e3" },
  fire: { primary: "#ff7044", secondary: "#ffba4a", accent: "#fff2c2" },
  water: { primary: "#3aa6ff", secondary: "#6fd8ff", accent: "#d6f1ff" },
  grass: { primary: "#6fc24a", secondary: "#b6e07a", accent: "#eaf9c5" },
  electric: { primary: "#ffd83a", secondary: "#fff48a", accent: "#fffadf" },
  poison: { primary: "#9c5cc4", secondary: "#c290da", accent: "#ecd9f4" },
  ground: { primary: "#c69a5b", secondary: "#e2c089", accent: "#f5e8cc" },
  flying: { primary: "#8fb6e8", secondary: "#c0d6f3", accent: "#e8f0fb" },
  bug: { primary: "#9ec23a", secondary: "#c8db70", accent: "#ecf3c2" },
  fighting: { primary: "#c64a4a", secondary: "#e08080", accent: "#f5cccc" },
  psychic: { primary: "#ff5c9a", secondary: "#ffa5c8", accent: "#ffe2ee" },
  rock: { primary: "#a8946a", secondary: "#cdb88e", accent: "#ece2c8" },
  ghost: { primary: "#7a5cff", secondary: "#b59cff", accent: "#efe6ff" },
  ice: { primary: "#6fd5e0", secondary: "#a8e8ee", accent: "#def6f8" },
  dragon: { primary: "#4a6cff", secondary: "#7e9bff", accent: "#d8e1ff" },
  dark: { primary: "#5a4a66", secondary: "#8c7a98", accent: "#d6cfdc" },
  steel: { primary: "#8fa8b8", secondary: "#b8c9d4", accent: "#e2eaef" },
  fairy: { primary: "#ff8fc8", secondary: "#ffb8dc", accent: "#ffe1f0" },
};

export function getElementPalette(type: ElementType | string | undefined): ElementPalette {
  return type && type in ELEMENT_PALETTE
    ? ELEMENT_PALETTE[type as ElementType]
    : ELEMENT_PALETTE.normal;
}
