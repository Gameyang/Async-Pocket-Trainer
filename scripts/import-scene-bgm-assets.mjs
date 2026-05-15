import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultSourceRoot = path.join(repoRoot, "tmp", "scene-bgm");
const outputRoot = path.join(repoRoot, "src", "resources", "audio", "bgm");

const sceneNames = ["starter-ready", "battle-capture", "team-decision", "game-over"];
const sceneNameSet = new Set(sceneNames);
const sourceExtensions = new Set([".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac"]);

const options = parseArgs(process.argv.slice(2));

async function main() {
  const sourceRoot = path.resolve(repoRoot, options.src ?? defaultSourceRoot);
  const entries = await collectEntries(sourceRoot, options.scene);

  if (entries.length === 0) {
    log(`No supported audio files found under ${path.relative(repoRoot, sourceRoot)}.`);
    log(`Expected extensions: ${[...sourceExtensions].join(", ")}`);
    log(`Scene folders: ${sceneNames.join(", ")}`);
    return;
  }

  log(`Importing ${entries.length} BGM file(s) from ${path.relative(repoRoot, sourceRoot)}.`);

  const usedOutputPaths = new Set();
  let converted = 0;
  let skipped = 0;

  for (const entry of entries) {
    const outputDir = path.join(outputRoot, entry.scene);
    const outputPath = await createOutputPath(outputDir, entry.sourcePath, usedOutputPaths);

    if (!options.force && (await hasUsableFile(outputPath, 512))) {
      skipped += 1;
      log(`skip ${formatPath(outputPath)}`);
      continue;
    }

    await convertToM4a(entry.sourcePath, outputPath);
    converted += 1;
    log(`ok ${formatPath(entry.sourcePath)} -> ${formatPath(outputPath)}`);
  }

  log(`Done. converted=${converted}, skipped=${skipped}`);
}

async function collectEntries(sourceRoot, forcedScene) {
  if (forcedScene && !sceneNameSet.has(forcedScene)) {
    throw new Error(`Invalid scene "${forcedScene}". Use one of: ${sceneNames.join(", ")}`);
  }

  const rootStats = await stat(sourceRoot).catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!rootStats) {
    return [];
  }

  if (rootStats.isFile()) {
    if (!forcedScene) {
      throw new Error("Use --scene when --src points to a single audio file.");
    }
    return isSupportedAudio(sourceRoot) ? [{ scene: forcedScene, sourcePath: sourceRoot }] : [];
  }

  if (forcedScene) {
    return (await findAudioFiles(sourceRoot)).map((sourcePath) => ({
      scene: forcedScene,
      sourcePath,
    }));
  }

  const entries = [];
  for (const scene of sceneNames) {
    const sceneDir = path.join(sourceRoot, scene);
    for (const sourcePath of await findAudioFiles(sceneDir)) {
      entries.push({ scene, sourcePath });
    }
  }
  return entries.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

async function findAudioFiles(dir) {
  const dirStats = await stat(dir).catch((error) => {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (!dirStats?.isDirectory()) {
    return [];
  }

  const results = [];
  const pending = [dir];

  while (pending.length > 0) {
    const current = pending.pop();
    const children = await readdir(current, { withFileTypes: true });

    for (const child of children) {
      const childPath = path.join(current, child.name);
      if (child.isDirectory()) {
        pending.push(childPath);
      } else if (child.isFile() && isSupportedAudio(childPath)) {
        results.push(childPath);
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
}

async function createOutputPath(outputDir, sourcePath, usedOutputPaths) {
  await mkdir(outputDir, { recursive: true });

  const baseName = slugify(path.basename(sourcePath, path.extname(sourcePath)));
  let candidate = path.join(outputDir, `${baseName}.m4a`);
  let suffix = 2;

  while (usedOutputPaths.has(candidate)) {
    candidate = path.join(outputDir, `${baseName}-${suffix}.m4a`);
    suffix += 1;
  }

  usedOutputPaths.add(candidate);
  return candidate;
}

async function convertToM4a(inputPath, outputPath) {
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-map_metadata",
    "-1",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "112k",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  await runProcess("ffmpeg", args);

  if (!(await hasUsableFile(outputPath, 512))) {
    throw new Error(`Converted file is unexpectedly small: ${outputPath}`);
  }
}

function parseArgs(args) {
  const parsed = {
    force: args.includes("--force"),
    scene: undefined,
    src: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      continue;
    }
    if (arg === "--scene") {
      parsed.scene = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--src") {
      parsed.src = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  log(`Usage:
  node scripts/import-scene-bgm-assets.mjs
  node scripts/import-scene-bgm-assets.mjs --src "D:\\Music\\Pokemon" --scene battle-capture
  node scripts/import-scene-bgm-assets.mjs --src "D:\\Music\\track.flac" --scene game-over

Default input:
  tmp/scene-bgm/{starter-ready,battle-capture,team-decision,game-over}/

Options:
  --src <path>      Input root, scene folder, or single audio file.
  --scene <name>    Force all input files into one scene.
  --force           Re-encode even if the target .m4a already exists.
`);
}

function isSupportedAudio(filePath) {
  return sourceExtensions.has(path.extname(filePath).toLowerCase());
}

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "track";
}

async function hasUsableFile(filePath, minimumBytes) {
  try {
    const stats = await stat(filePath);
    return stats.isFile() && stats.size >= minimumBytes;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
      }
    });
  });
}

function formatPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
