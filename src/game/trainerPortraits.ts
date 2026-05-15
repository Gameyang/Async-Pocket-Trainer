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

const trainerPortraitLabelOverrides: Record<string, string> = {
  "field-scout": "필드 정찰대",
  "checkpoint-captain": "체크포인트 대장",
  "sheet-rival": "시트 라이벌",
  "hf-trainer-01-harley-quinn": "광대 악동",
  "hf-trainer-02-summer-dress": "여름 원피스",
  "hf-trainer-03-evil-fairy": "장난 요정",
  "hf-trainer-04-turtle-step": "거북 스텝",
  "hf-trainer-05-dragon-queen": "드래곤 여왕",
  "hf-trainer-06-long-coat": "롱코트 승부사",
  "hf-trainer-07-red-suit": "레드 슈트",
  "hf-trainer-08-silent-comic": "무언극 코미디언",
  "hf-trainer-09-card-trickster": "카드 트릭스터",
  "hf-trainer-10-forest-sword": "숲의 검사",
  "hf-trainer-11-armored-hero": "갑옷 영웅",
  "hf-trainer-12-kimono-sakura": "벚꽃 기모노",
  "hf-trainer-13-blue-flame-witch": "푸른 불꽃 마녀",
  "hf-trainer-14-hooded-solo": "후드 방랑자",
  "hf-trainer-15-pirate-captain": "해적 선장",
  "hf-trainer-16-winged-angel": "날개 천사",
};

const trainerBaseLabels: Record<string, string> = {
  acetrainer: "엘리트 트레이너",
  acetrainerf: "여성 엘리트 트레이너",
  acetrainercouple: "엘리트 커플",
  acetrainersnow: "설원 엘리트 트레이너",
  acetrainersnowf: "여성 설원 엘리트 트레이너",
  aetheremployee: "에테르 직원",
  aetheremployeef: "여성 에테르 직원",
  aetherfoundation: "에테르 재단",
  aetherfoundation2: "에테르 재단",
  aetherfoundationf: "여성 에테르 재단",
  aquagrunt: "아쿠아단 조무래기",
  aquagruntf: "여성 아쿠아단 조무래기",
  aquasuit: "아쿠아 슈트",
  aromalady: "아로마 아가씨",
  artist: "화가",
  artistf: "여성 화가",
  backers: "응원단",
  backersf: "여성 응원단",
  backpacker: "배낭여행객",
  backpackerf: "여성 배낭여행객",
  baker: "제빵사",
  ballguy: "볼가이",
  battlegirl: "배틀걸",
  beauty: "아가씨",
  bellhop: "벨보이",
  biker: "폭주족",
  birdkeeper: "새 조련사",
  blackbelt: "태권왕",
  boarder: "보더",
  bodybuilder: "보디빌더",
  bodybuilderf: "여성 보디빌더",
  bugcatcher: "곤충채집 소년",
  bugmaniac: "곤충마니아",
  burglar: "도둑",
  butler: "집사",
  cabbie: "택시기사",
  cafemaster: "카페 마스터",
  cameraman: "카메라맨",
  camper: "캠프보이",
  caretaker: "관리인",
  channeler: "무당",
  chef: "요리사",
  clerk: "점원",
  clerkf: "여성 점원",
  "clerk-boss": "점장",
  clown: "광대",
  collector: "수집가",
  cook: "요리사",
  cowgirl: "카우걸",
  crushgirl: "격투소녀",
  cueball: "불량배",
  cyclist: "사이클리스트",
  cyclistf: "여성 사이클리스트",
  dancer: "댄서",
  delinquent: "불량배",
  delinquentf: "불량소녀",
  delinquentf2: "불량소녀",
  depotagent: "역무원",
  diamondclanmember: "금강단 단원",
  doctor: "의사",
  doctorf: "여의사",
  doubleteam: "더블팀",
  dragontamer: "드래곤 조련사",
  engineer: "엔지니어",
  expert: "달인",
  expertf: "여성 달인",
  fairytalegirl: "동화소녀",
  firebreather: "불놀이꾼",
  firefighter: "소방관",
  fisher: "낚시꾼",
  fisherman: "낚시꾼",
  flaregrunt: "플레어단 조무래기",
  flaregruntf: "여성 플레어단 조무래기",
  freediver: "프리다이버",
  furisodegirl: "기모노 소녀",
  galacticgrunt: "갤럭시단 조무래기",
  galacticgruntf: "여성 갤럭시단 조무래기",
  gambler: "도박사",
  gamer: "게이머",
  garcon: "웨이터",
  gardener: "정원사",
  gentleman: "신사",
  guitarist: "기타리스트",
  hexmaniac: "오컬트마니아",
  hiker: "등산가",
  hoopster: "농구선수",
  idol: "아이돌",
  janitor: "청소부",
  jogger: "조깅남",
  journalist: "기자",
  kimono: "기모노",
  kimonogirl: "기모노 소녀",
  lass: "짧은치마",
  lineworker: "라인 작업자",
  madame: "마담",
  maid: "메이드",
  magmaadmin: "마그마단 간부",
  magmagrunt: "마그마단 조무래기",
  magmagruntf: "여성 마그마단 조무래기",
  model: "모델",
  musician: "뮤지션",
  ninja: "닌자",
  nurse: "간호사",
  officeworker: "회사원",
  officeworkerf: "여성 회사원",
  officer: "경찰관",
  parasollady: "우산 아가씨",
  picnicker: "피크닉걸",
  pilot: "파일럿",
  pokefan: "포켓몬팬",
  pokefanf: "여성 포켓몬팬",
  pokekid: "포켓몬 키드",
  pokekidf: "여성 포켓몬 키드",
  pokemaniac: "괴수마니아",
  pokemonbreeder: "포켓몬 브리더",
  pokemonbreederf: "여성 포켓몬 브리더",
  preschooler: "유치원생",
  preschoolerf: "여자 유치원생",
  psychic: "초능력자",
  psychicf: "여성 초능력자",
  ranger: "포켓몬 레인저",
  rangerf: "여성 포켓몬 레인저",
  reporter: "리포터",
  richboy: "도련님",
  rocker: "락커",
  rocketexecutive: "로켓단 간부",
  rocketexecutivef: "여성 로켓단 간부",
  rocketgrunt: "로켓단 조무래기",
  rocketgruntf: "여성 로켓단 조무래기",
  ruinmaniac: "유적마니아",
  sailor: "선원",
  sage: "스님",
  schoolboy: "남학생",
  schoolgirl: "여학생",
  schoolkid: "학생",
  schoolkidf: "여학생",
  scientist: "과학자",
  scientistf: "여성 과학자",
  skier: "스키어",
  skierf: "여성 스키어",
  swimmer: "수영팬",
  swimmerf: "여성 수영팬",
  swimmerm: "남성 수영팬",
  tamer: "맹수조련사",
  teacher: "선생님",
  tourist: "관광객",
  touristf: "여성 관광객",
  tuber: "튜브보이",
  tuberf: "튜브걸",
  twins: "쌍둥이",
  unknown: "정체불명 트레이너",
  unknownf: "정체불명 여성 트레이너",
  veteran: "베테랑 트레이너",
  veteranf: "여성 베테랑 트레이너",
  waitress: "웨이트리스",
  waiter: "웨이터",
  worker: "작업원",
  workerf: "여성 작업원",
  youngster: "반바지 꼬마",
  youngathlete: "어린 선수",
  youngathletef: "여성 어린 선수",
  youngcouple: "젊은 커플",
};

const trainerProperNameLabels: Record<string, string> = {
  agatha: "국화",
  ash: "지우",
  barry: "용식",
  bea: "채두",
  bede: "비트",
  bianca: "벨",
  blaine: "강연",
  blue: "그린",
  brock: "웅",
  bruno: "시바",
  caitlin: "카틀레야",
  candice: "무청",
  cheren: "체렌",
  cynthia: "난천",
  dawn: "빛나",
  elesa: "카밀레",
  erika: "민화",
  ethan: "금선",
  giovanni: "비주기",
  gladion: "글라디오",
  iris: "아이리스",
  jasmine: "규리",
  lance: "목호",
  leon: "단델",
  lillie: "릴리에",
  lucas: "광휘",
  misty: "이슬",
  marnie: "마리",
  may: "봄이",
  nessa: "야청",
  oak: "오박사",
  red: "레드",
  rosa: "명희",
  serena: "세레나",
  silver: "실버",
  steven: "성호",
  wallace: "윤진",
  whitney: "꼭두",
  yellow: "옐로",
};

const trainerVariantLabels: Record<string, string> = {
  alola: "알로라",
  anime: "애니",
  anime2: "애니 2",
  bb: "블루베리",
  boss: "보스",
  black: "블랙",
  blue: "블루",
  casual: "캐주얼",
  champion: "챔피언",
  contest: "콘테스트",
  dojo: "도장",
  e: "에메랄드",
  festival: "축제",
  gen1: "1세대",
  gen1rb: "1세대 레드/블루",
  gen1rbtwo: "1세대 레드/블루 2",
  gen1rbchampion: "1세대 챔피언",
  gen1two: "1세대 2",
  gen1champion: "1세대 챔피언",
  gen1main: "1세대 메인",
  gen1title: "1세대 타이틀",
  gen2: "2세대",
  gen2c: "2세대 크리스탈",
  gen2jp: "2세대 일본판",
  gen2kanto: "2세대 관동",
  gen3: "3세대",
  gen3jp: "3세대 일본판",
  gen3rs: "루비/사파이어",
  gen3two: "3세대 2",
  gen3champion: "3세대 챔피언",
  gen4: "4세대",
  gen4dp: "디아루가/펄기아",
  gen4jp: "4세대 일본판",
  gen5bw2: "블랙2/화이트2",
  gen6: "6세대",
  gen6xy: "XY",
  gen7: "7세대",
  gen8: "8세대",
  gen9: "9세대",
  hoenn: "호연",
  isekai: "이세계",
  johto: "성도",
  kalos: "칼로스",
  kanto: "관동",
  league: "리그",
  leader: "관장",
  lgpe: "레츠고",
  lza: "레전드 ZA",
  masters: "마스터즈",
  masters2: "마스터즈 2",
  masters3: "마스터즈 3",
  orange: "오렌지",
  pau: "파우",
  pink: "핑크",
  pokeathlon: "포켓슬론",
  pwt: "월드 토너먼트",
  radar: "레이더",
  rs: "루비/사파이어",
  rse: "루비/사파이어/에메랄드",
  s: "스칼렛",
  shuffle: "셔플",
  sinnoh: "신오",
  stance: "배틀 포즈",
  super: "슈퍼",
  tundra: "왕관설원",
  two: "2",
  unite: "유나이트",
  unmasked: "가면 해제",
  unova: "하나",
  usum: "울트라썬/문",
  v: "바이올렛",
  white: "화이트",
  xy: "XY",
};

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
    label: createTrainerPortraitLabel(id, source),
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

function createTrainerPortraitLabel(id: string, source: TrainerPortraitSource): string {
  const override = trainerPortraitLabelOverrides[id];
  if (override) {
    return override;
  }

  if (source === "pokemonShowdown") {
    return createPokemonShowdownPortraitLabel(id);
  }

  return `훈련사 스킨 ${formatPortraitNumber(id)}`;
}

function createPokemonShowdownPortraitLabel(id: string): string {
  const rawId = id.replace(/^ps-trainer-/, "");
  const exactBase = trainerBaseLabels[rawId] ?? trainerProperNameLabels[rawId];
  if (exactBase) {
    return exactBase;
  }

  const baseParts: string[] = [];
  const variantParts: string[] = [];
  const [firstPart, ...restParts] = rawId.split("-");
  const firstPartIsBase = Boolean(
    firstPart && (trainerBaseLabels[firstPart] || trainerProperNameLabels[firstPart]),
  );

  if (firstPart && firstPartIsBase) {
    baseParts.push(firstPart);
  }

  for (const part of firstPartIsBase ? restParts : rawId.split("-")) {
    const variant = trainerVariantLabels[part];
    if (variant) {
      variantParts.push(variant);
    } else {
      baseParts.push(part);
    }
  }

  const baseKey = baseParts.join("-");
  const baseLabel =
    trainerBaseLabels[baseKey] ??
    trainerProperNameLabels[baseKey] ??
    baseParts
      .map((part) => trainerBaseLabels[part] ?? trainerProperNameLabels[part])
      .find(Boolean) ??
    `픽셀 트레이너 ${formatPortraitNumber(id)}`;

  const uniqueVariants = [...new Set(variantParts)];
  return uniqueVariants.length > 0 ? `${baseLabel} · ${uniqueVariants.join(" · ")}` : baseLabel;
}

function formatPortraitNumber(id: string): string {
  return String((hashString(id) % 900) + 100);
}
