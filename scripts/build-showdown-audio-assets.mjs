import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const audioRoot = "https://play.pokemonshowdown.com/audio/";
const criesRoot = "https://play.pokemonshowdown.com/audio/cries/";
const cacheRoot = path.join(repoRoot, "tmp", "showdown-audio");
const resourcesRoot = path.join(repoRoot, "src", "resources");
const rootAudioOutDir = path.join(resourcesRoot, "audio", "bgm", "showdown");
const criesOutDir = path.join(resourcesRoot, "audio", "cries", "showdown");
const manifestPath = path.join(resourcesRoot, "audio", "showdownAudioManifest.json");

const force = process.argv.includes("--force");
const concurrency = Math.max(
  1,
  Math.min(Number.parseInt(process.env.APT_AUDIO_CONCURRENCY ?? "4", 10) || 4, 8),
);

const audioExtensions = new Set(["ogg", "mp3", "wav"]);
const preferredExtensionOrder = new Map([
  ["ogg", 0],
  ["mp3", 1],
  ["wav", 2],
]);

async function main() {
  assertNodeFetch();

  const [rootFiles, cryFiles] = await Promise.all([
    fetchIndexFiles(audioRoot),
    fetchIndexFiles(criesRoot),
  ]);
  const selectedRootFiles = selectPreferredSources(rootFiles);
  const selectedCryFiles = selectPreferredSources(cryFiles);

  const rootEntries = selectedRootFiles.map((sourceFile) =>
    createEntry({
      baseUrl: audioRoot,
      cacheDir: path.join(cacheRoot, "root"),
      outputDir: rootAudioOutDir,
      sourceFile,
      kind: sourceFile === "notification.wav" ? "sfx" : "bgm",
    }),
  );
  const cryEntries = selectedCryFiles.map((sourceFile) =>
    createEntry({
      baseUrl: criesRoot,
      cacheDir: path.join(cacheRoot, "cries"),
      outputDir: criesOutDir,
      sourceFile,
      kind: "cry",
    }),
  );

  log(
    `Showdown audio: ${rootEntries.length} root files, ${cryEntries.length} cries, concurrency ${concurrency}`,
  );

  await runLimited([...rootEntries, ...cryEntries], async (entry, index) => {
    await downloadSource(entry);
    await convertSource(entry);

    const completed = index + 1;
    if (completed % 50 === 0 || completed === rootEntries.length + cryEntries.length) {
      log(`Processed ${completed}/${rootEntries.length + cryEntries.length}`);
    }
  });

  const manifest = {
    source: {
      audioRoot,
      criesRoot,
      selectedRootFiles: rootEntries.length,
      selectedCryFiles: cryEntries.length,
      rule: "Prefer .ogg over .mp3 over .wav for duplicate stems; convert selected files to AAC/M4A.",
    },
    rootAudio: rootEntries.map(toManifestRecord),
    cries: cryEntries.map(toManifestRecord),
  };

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  log(`Wrote ${path.relative(repoRoot, manifestPath)}`);
}

function assertNodeFetch() {
  if (typeof fetch !== "function") {
    throw new Error("This script requires Node.js fetch support.");
  }
}

async function fetchIndexFiles(baseUrl) {
  const response = await fetch(baseUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${baseUrl}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const files = [...html.matchAll(/href="(?:\.\/)?([^"#?]+\.(?:ogg|mp3|wav))"/g)]
    .map((match) => decodeURIComponent(match[1]))
    .filter((fileName) => {
      const extension = path.extname(fileName).slice(1).toLowerCase();
      return audioExtensions.has(extension) && !fileName.includes("/");
    });

  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function selectPreferredSources(files) {
  const byStem = new Map();

  for (const fileName of files) {
    const extension = path.extname(fileName).slice(1).toLowerCase();
    const stem = fileName.slice(0, -extension.length - 1);
    const existing = byStem.get(stem);

    if (!existing || comparePreferred(fileName, existing) < 0) {
      byStem.set(stem, fileName);
    }
  }

  return [...byStem.values()].sort((left, right) => left.localeCompare(right));
}

function comparePreferred(left, right) {
  const leftExtension = path.extname(left).slice(1).toLowerCase();
  const rightExtension = path.extname(right).slice(1).toLowerCase();
  const leftRank = preferredExtensionOrder.get(leftExtension) ?? 99;
  const rightRank = preferredExtensionOrder.get(rightExtension) ?? 99;
  return leftRank - rightRank || left.localeCompare(right);
}

function createEntry({ baseUrl, cacheDir, outputDir, sourceFile, kind }) {
  const stem = sourceFile.slice(0, -path.extname(sourceFile).length);
  const outputFile = `${stem}.m4a`;

  return {
    kind,
    sourceFile,
    sourceUrl: new URL(sourceFile, baseUrl).href,
    cachePath: path.join(cacheDir, sourceFile),
    outputPath: path.join(outputDir, outputFile),
    resourcePath: toResourcePath(path.join(outputDir, outputFile)),
  };
}

async function downloadSource(entry) {
  if (!force && (await hasUsableFile(entry.cachePath, 32))) {
    return;
  }

  const response = await fetch(entry.sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${entry.sourceUrl}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength < 32) {
    throw new Error(`Downloaded file is unexpectedly small: ${entry.sourceUrl}`);
  }

  await mkdir(path.dirname(entry.cachePath), { recursive: true });
  await writeFile(entry.cachePath, bytes);
}

async function convertSource(entry) {
  if (!force && (await hasUsableFile(entry.outputPath, 512))) {
    return;
  }

  await mkdir(path.dirname(entry.outputPath), { recursive: true });

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    entry.cachePath,
    "-vn",
    "-map_metadata",
    "-1",
    "-ar",
    "44100",
    "-c:a",
    "aac",
  ];

  if (entry.kind === "bgm") {
    args.push("-ac", "2", "-b:a", "96k");
  } else {
    args.push("-ac", "1", "-b:a", "64k");
  }

  args.push("-movflags", "+faststart", entry.outputPath);
  await runProcess("ffmpeg", args);

  if (!(await hasUsableFile(entry.outputPath, 512))) {
    throw new Error(`Converted file is unexpectedly small: ${entry.outputPath}`);
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

async function hasUsableFile(filePath, minimumBytes) {
  try {
    const stats = await stat(filePath);
    return stats.isFile() && stats.size >= minimumBytes;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function runLimited(items, worker) {
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index], index);
      }
    }),
  );
}

function toManifestRecord(entry) {
  return {
    kind: entry.kind,
    sourceFile: entry.sourceFile,
    sourceUrl: entry.sourceUrl,
    outputPath: entry.resourcePath,
  };
}

function toResourcePath(absolutePath) {
  return path
    .relative(resourcesRoot, absolutePath)
    .split(path.sep)
    .join("/");
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
