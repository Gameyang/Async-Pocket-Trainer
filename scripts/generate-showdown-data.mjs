import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {Dex} = require('pokemon-showdown');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputPath = path.join(rootDir, 'src', 'data', 'showdown-gen1.json');

const dex = Dex.forGen(1);

const fallbackMoveIds = new Set([
  'tackle',
  'scratch',
  'vinewhip',
  'ember',
  'watergun',
  'thundershock',
  'confusion',
  'gust',
  'peck',
  'poisonsting',
  'leechlife',
  'lowkick',
  'rockthrow',
  'earthquake',
  'icebeam',
  'twineedle',
  'dragonrage',
  'growl',
  'tailwhip',
  'leer',
  'sandattack',
  'harden',
  'withdraw',
  'doubleteam',
  'agility',
]);

const statKeys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const volatileKeys = [
  'confusion',
  'flinch',
  'leechseed',
  'partiallytrapped',
  'focusenergy',
  'substitute',
  'disable',
  'mist',
  'lightscreen',
  'reflect',
];

function normalizeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function copyStats(stats) {
  return Object.fromEntries(statKeys.map(key => [key, stats[key]]));
}

function clean(value) {
  if (value === undefined || value === null) return null;
  if (value === true || value === false || typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = clean(entry);
      if (cleaned !== null) out[key] = cleaned;
    }
    return out;
  }
  return null;
}

function simplifySecondary(secondary) {
  if (!secondary) return null;
  return {
    chance: secondary.chance ?? 100,
    status: secondary.status ?? null,
    volatileStatus: volatileKeys.includes(secondary.volatileStatus) ? secondary.volatileStatus : null,
    boosts: clean(secondary.boosts),
  };
}

function simplifyMove(move) {
  return {
    id: move.id,
    num: move.num,
    name: move.name,
    type: move.type,
    category: move.category,
    target: move.target,
    accuracy: move.accuracy,
    basePower: move.basePower,
    priority: move.priority ?? 0,
    critRatio: move.critRatio ?? 1,
    ignoreImmunity: Boolean(move.ignoreImmunity),
    damage: clean(move.damage),
    ohko: Boolean(move.ohko),
    status: move.status ?? null,
    boosts: clean(move.boosts),
    volatileStatus: volatileKeys.includes(move.volatileStatus) ? move.volatileStatus : null,
    secondaries: (move.secondaries ?? (move.secondary ? [move.secondary] : []))
      .map(simplifySecondary)
      .filter(Boolean),
    self: clean(move.self),
    drain: clean(move.drain),
    recoil: clean(move.recoil),
    heal: clean(move.heal),
    multihit: clean(move.multihit),
    selfdestruct: move.selfdestruct ?? null,
    forceSwitch: Boolean(move.forceSwitch),
    thawsTarget: Boolean(move.thawsTarget),
    flags: clean(move.flags),
  };
}

const species = dex.species.all()
  .filter(entry => entry.num >= 1 && entry.num <= 151 && entry.name === entry.baseSpecies && entry.forme === '')
  .sort((a, b) => a.num - b.num)
  .map(entry => {
    const learnset = dex.data.Learnsets[entry.id]?.learnset ?? {};
    const movesById = new Map();

    for (const [moveId, sources] of Object.entries(learnset)) {
      for (const source of sources) {
        const match = /^1L(\d+)$/.exec(source);
        if (!match) continue;

        const level = Number(match[1]);
        const existing = movesById.get(moveId);
        movesById.set(moveId, existing === undefined ? level : Math.min(existing, level));
      }
    }

    return {
      id: entry.id,
      num: entry.num,
      name: entry.name,
      types: [...entry.types],
      baseStats: copyStats(entry.baseStats),
      learnset: [...movesById.entries()]
        .map(([move, level]) => ({move, level}))
        .sort((a, b) => a.level - b.level || a.move.localeCompare(b.move)),
    };
  });

const moveIds = new Set(fallbackMoveIds);
for (const entry of species) {
  for (const learn of entry.learnset) moveIds.add(learn.move);
}

const moves = Object.fromEntries(
  [...moveIds]
    .map(id => dex.moves.get(id))
    .filter(move => move.exists && move.num > 0 && move.gen <= 1)
    .sort((a, b) => a.num - b.num || a.id.localeCompare(b.id))
    .map(move => [move.id, simplifyMove(move)])
);

const types = dex.types.names().filter(type => !['???', 'Dark', 'Steel'].includes(type));
const typeChart = {};
for (const attackType of types) {
  typeChart[attackType] = {};
  for (const defenseType of types) {
    const immune = dex.getImmunity(attackType, defenseType);
    const modifier = immune ? dex.getEffectiveness(attackType, defenseType) : -Infinity;
    typeChart[attackType][defenseType] = immune ? 2 ** modifier : 0;
  }
}

const payload = {
  source: {
    name: 'Pokemon Showdown',
    url: 'https://github.com/smogon/pokemon-showdown',
    packageVersion: require('pokemon-showdown/package.json').version,
    generatedAt: new Date().toISOString(),
  },
  species,
  moves,
  types,
  typeChart,
  fallbackMoveIds: [...fallbackMoveIds].filter(id => moves[id]),
};

await mkdir(path.dirname(outputPath), {recursive: true});
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`Generated ${path.relative(rootDir, outputPath)} with ${species.length} species and ${Object.keys(moves).length} moves.`);
