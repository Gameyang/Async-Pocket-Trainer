import trainerPortraitManifest from "../resources/trainers/trainerPortraitManifest.json" with { type: "json" };
import { SeededRng } from "./rng";
import type { MetaCurrencyState } from "./types";

export const DEFAULT_TRAINER_PORTRAIT_ID = "field-scout";
export const DEFAULT_TRAINER_PORTRAIT_PATH = "resources/trainers/field-scout.webp";

export type TrainerPortraitSource = "local" | "huggingFace" | "pokemonShowdown";

export interface TrainerPortraitCatalogItem {
  id: string;
  label: string;
  assetPath: string;
  source: TrainerPortraitSource;
  tpCost: number;
}

const localPortraits = [
  ...trainerPortraitManifest.procedural.map((assetPath) => toCatalogItem(assetPath, "local")),
];
const purchasablePortraits = [
  ...trainerPortraitManifest.huggingFace.map((assetPath) =>
    toCatalogItem(assetPath, "huggingFace"),
  ),
  ...trainerPortraitManifest.pokemonShowdown.map((assetPath) =>
    toCatalogItem(assetPath, "pokemonShowdown"),
  ),
];
const allPortraits = [...localPortraits, ...purchasablePortraits];
const portraitById = new Map(allPortraits.map((portrait) => [portrait.id, portrait]));

export const trainerPortraitCatalog: readonly TrainerPortraitCatalogItem[] = allPortraits;
export const purchasableTrainerPortraits: readonly TrainerPortraitCatalogItem[] =
  purchasablePortraits;

export function getTrainerPortrait(id: string | undefined): TrainerPortraitCatalogItem {
  return portraitById.get(id ?? "") ?? portraitById.get(DEFAULT_TRAINER_PORTRAIT_ID)!;
}

export function getTrainerPortraitAssetPath(id: string | undefined): string {
  return getTrainerPortrait(id).assetPath;
}

export function isValidTrainerPortraitId(id: string | undefined): id is string {
  return typeof id === "string" && portraitById.has(id);
}

export function isTrainerPortraitPurchasable(id: string): boolean {
  const portrait = portraitById.get(id);
  return Boolean(portrait && portrait.source !== "local");
}

export function getOwnedTrainerPortraitIds(meta: MetaCurrencyState | undefined): string[] {
  const owned = new Set<string>([DEFAULT_TRAINER_PORTRAIT_ID]);

  for (const id of meta?.ownedTrainerPortraitIds ?? []) {
    if (isValidTrainerPortraitId(id)) {
      owned.add(id);
    }
  }

  return [...owned];
}

export function isTrainerPortraitOwned(
  meta: MetaCurrencyState | undefined,
  portraitId: string,
): boolean {
  return getOwnedTrainerPortraitIds(meta).includes(portraitId);
}

export function getSelectedTrainerPortraitId(meta: MetaCurrencyState | undefined): string {
  const selected = meta?.selectedTrainerPortraitId;
  return selected && isTrainerPortraitOwned(meta, selected)
    ? selected
    : DEFAULT_TRAINER_PORTRAIT_ID;
}

export function getSelectedTrainerPortraitPath(meta: MetaCurrencyState | undefined): string {
  return getTrainerPortraitAssetPath(getSelectedTrainerPortraitId(meta));
}

export function createTrainerPortraitShopOffers(
  seed: string,
  wave: number,
  meta: MetaCurrencyState | undefined,
  count = 1,
): TrainerPortraitCatalogItem[] {
  const owned = new Set(getOwnedTrainerPortraitIds(meta));
  const selected = getSelectedTrainerPortraitId(meta);
  const rng = new SeededRng(`${seed}:portrait-shop:${wave}`);
  const candidates = rng.shuffle([...purchasablePortraits]);
  const preferred = candidates.filter((portrait) => !owned.has(portrait.id));
  const fallback = candidates.filter(
    (portrait) => owned.has(portrait.id) && portrait.id !== selected,
  );

  return [...preferred, ...fallback].slice(0, count);
}

export function trainerPortraitActionId(portraitId: string): string {
  return `shop:portrait:${portraitId}`;
}

export function trainerPortraitIdFromActionId(actionId: string): string | undefined {
  return actionId.startsWith("shop:portrait:")
    ? actionId.slice("shop:portrait:".length)
    : undefined;
}

function toCatalogItem(
  assetPath: string,
  source: TrainerPortraitSource,
): TrainerPortraitCatalogItem {
  const id = portraitIdFromAssetPath(assetPath);

  return {
    id,
    label: titleCase(
      id
        .replace(/^hf-trainer-\d+-/, "")
        .replace(/^ps-trainer-/, "")
        .replaceAll("-", " "),
    ),
    assetPath,
    source,
    tpCost: source === "local" ? 0 : calculatePortraitCost(id, source),
  };
}

function portraitIdFromAssetPath(assetPath: string): string {
  return (
    assetPath
      .split("/")
      .at(-1)
      ?.replace(/\.webp$/i, "") ?? DEFAULT_TRAINER_PORTRAIT_ID
  );
}

function calculatePortraitCost(id: string, source: TrainerPortraitSource): number {
  const hash = hashString(id);

  if (source === "huggingFace") {
    return 12 + (hash % 7);
  }

  if (source === "pokemonShowdown") {
    return 4 + (hash % 5);
  }

  return 0;
}

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
