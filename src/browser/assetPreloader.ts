import { buildMetadata } from "../buildMetadata";

const pokemonAssetUrls = import.meta.glob<string>("../resources/pokemon/*.webp", {
  eager: true,
  import: "default",
  query: "?url",
});

const lottieAssetUrls = import.meta.glob<string>("../resources/lottie/*.json", {
  eager: true,
  import: "default",
  query: "?url",
});

const sceneBgmAssetUrls = import.meta.glob<string>(
  "../resources/audio/bgm/{starter-ready,battle-capture,team-decision,game-over}/*.m4a",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

const legacyBgmAssetUrls = import.meta.glob<string>("../resources/audio/bgm/*.m4a", {
  eager: true,
  import: "default",
  query: "?url",
});

const showdownBgmAssetUrls = import.meta.glob<string>("../resources/audio/bgm/showdown/*.m4a", {
  eager: true,
  import: "default",
  query: "?url",
});

const localSfxAssetUrls = import.meta.glob<string>("../resources/audio/sfx/*.m4a", {
  eager: true,
  import: "default",
  query: "?url",
});

const showdownCryAssetUrls = import.meta.glob<string>("../resources/audio/cries/showdown/*.m4a", {
  eager: true,
  import: "default",
  query: "?url",
});

const GAME_ASSET_CACHE_VERSION = String(buildMetadata.gameVersion);
const GAME_ASSET_CACHE_PREFIX = "apt-game-assets-";
export const GAME_ASSET_CACHE_NAME = `${GAME_ASSET_CACHE_PREFIX}v${GAME_ASSET_CACHE_VERSION}`;
export const GAME_ASSET_PRELOAD_MANIFEST_KEY = `apt.gameAssetPreloadManifest.v${GAME_ASSET_CACHE_VERSION}`;

const DEFAULT_PRELOAD_CONCURRENCY = 6;
const DEFAULT_DELAYED_PRELOAD_CONCURRENCY = 2;

export type GameAssetPreloadKind = "pokemon-sprite" | "ui-motion" | "bgm" | "sfx" | "pokemon-cry";

export interface GameAssetPreloadItem {
  readonly id: string;
  readonly sourcePath: string;
  readonly url: string;
  readonly kind: GameAssetPreloadKind;
  readonly label: string;
}

export interface GameAssetPreloadFailure {
  readonly sourcePath: string;
  readonly url: string;
  readonly reason: string;
}

export interface GameAssetPreloadProgress {
  readonly phase: "checking" | "loading" | "complete";
  readonly total: number;
  readonly completed: number;
  readonly loaded: number;
  readonly cached: number;
  readonly failed: number;
  readonly currentLabel: string;
}

export interface GameAssetPreloadResult {
  readonly total: number;
  readonly loaded: number;
  readonly cached: number;
  readonly failed: number;
  readonly failures: readonly GameAssetPreloadFailure[];
}

export interface PreloadGameAssetsOptions {
  readonly concurrency?: number;
  readonly onProgress?: (progress: GameAssetPreloadProgress) => void;
  readonly signal?: AbortSignal;
  readonly storage?: Storage;
}

interface AssetPreloadState {
  completed: number;
  loaded: number;
  cached: number;
  failed: number;
}

interface StoredAssetPreloadManifest {
  cacheName: string;
  assetCount: number;
  cachedCount: number;
  failedCount: number;
  updatedAt: string;
}

export function getPreloadableGameAssets(): readonly GameAssetPreloadItem[] {
  const assets = [
    ...entriesToAssets(pokemonAssetUrls, "pokemon-sprite", "포켓몬 이미지"),
    ...entriesToAssets(lottieAssetUrls, "ui-motion", "모션 효과"),
    ...entriesToAssets(legacyBgmAssetUrls, "bgm", "배경음"),
    ...entriesToAssets(sceneBgmAssetUrls, "bgm", "배경음"),
    ...entriesToAssets(showdownBgmAssetUrls, "bgm", "배경음"),
    ...entriesToAssets(localSfxAssetUrls, "sfx", "효과음"),
  ];

  const dedupedByUrl = new Map<string, GameAssetPreloadItem>();
  for (const asset of assets) {
    if (!dedupedByUrl.has(asset.url)) {
      dedupedByUrl.set(asset.url, asset);
    }
  }

  return [...dedupedByUrl.values()];
}

export function getDelayedGameAssets(): readonly GameAssetPreloadItem[] {
  const assets = [...entriesToAssets(showdownCryAssetUrls, "pokemon-cry", "Pokemon cry")];

  const dedupedByUrl = new Map<string, GameAssetPreloadItem>();
  for (const asset of assets) {
    if (!dedupedByUrl.has(asset.url)) {
      dedupedByUrl.set(asset.url, asset);
    }
  }

  return [...dedupedByUrl.values()];
}

export async function preloadGameAssets(
  options: PreloadGameAssetsOptions = {},
): Promise<GameAssetPreloadResult> {
  await registerGameAssetServiceWorker();
  await purgeLegacyGameAssetCaches();

  const assets = getPreloadableGameAssets();
  const state: AssetPreloadState = {
    completed: 0,
    loaded: 0,
    cached: 0,
    failed: 0,
  };
  const failures: GameAssetPreloadFailure[] = [];
  const cache = await openGameAssetCache();
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_PRELOAD_CONCURRENCY, assets.length || 1),
  );

  emitProgress(options.onProgress, "checking", assets.length, state, "로컬 리소스 확인");

  await runWithConcurrency(assets, concurrency, async (asset) => {
    try {
      const preloadResult = await preloadAsset(asset, cache, options.signal);
      state.completed += 1;
      state.loaded += 1;
      state.cached += preloadResult.fromCache ? 1 : 0;
      emitProgress(options.onProgress, "loading", assets.length, state, asset.label);
    } catch (error) {
      state.completed += 1;
      state.failed += 1;
      failures.push({
        sourcePath: asset.sourcePath,
        url: asset.url,
        reason: getErrorMessage(error),
      });
      emitProgress(options.onProgress, "loading", assets.length, state, asset.label);
    }
  });

  const result: GameAssetPreloadResult = {
    total: assets.length,
    loaded: state.loaded,
    cached: state.cached,
    failed: state.failed,
    failures,
  };

  writePreloadManifest(options.storage, result);
  emitProgress(
    options.onProgress,
    "complete",
    assets.length,
    state,
    state.failed > 0 ? "일부 리소스는 플레이 중 다시 확인" : "준비 완료",
  );

  return result;
}

export async function preloadDelayedGameAssets(
  options: PreloadGameAssetsOptions = {},
): Promise<GameAssetPreloadResult> {
  await registerGameAssetServiceWorker();
  await purgeLegacyGameAssetCaches();

  const assets = getDelayedGameAssets();
  const state: AssetPreloadState = {
    completed: 0,
    loaded: 0,
    cached: 0,
    failed: 0,
  };
  const failures: GameAssetPreloadFailure[] = [];
  const cache = await openGameAssetCache();
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_DELAYED_PRELOAD_CONCURRENCY, assets.length || 1),
  );

  emitProgress(options.onProgress, "checking", assets.length, state, "Checking delayed assets");

  await runWithConcurrency(assets, concurrency, async (asset) => {
    try {
      const preloadResult = await preloadAsset(asset, cache, options.signal);
      state.completed += 1;
      state.loaded += 1;
      state.cached += preloadResult.fromCache ? 1 : 0;
      emitProgress(options.onProgress, "loading", assets.length, state, asset.label);
    } catch (error) {
      state.completed += 1;
      state.failed += 1;
      failures.push({
        sourcePath: asset.sourcePath,
        url: asset.url,
        reason: getErrorMessage(error),
      });
      emitProgress(options.onProgress, "loading", assets.length, state, asset.label);
    }
  });

  const result: GameAssetPreloadResult = {
    total: assets.length,
    loaded: state.loaded,
    cached: state.cached,
    failed: state.failed,
    failures,
  };

  emitProgress(options.onProgress, "complete", assets.length, state, "Delayed assets ready");

  return result;
}

export async function registerGameAssetServiceWorker(): Promise<void> {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return;
  }

  try {
    await navigator.serviceWorker.register(
      `${import.meta.env.BASE_URL}asset-cache-sw.js?v=${GAME_ASSET_CACHE_VERSION}`,
      {
        scope: import.meta.env.BASE_URL,
      },
    );
  } catch (error) {
    console.warn("Unable to register asset cache service worker:", error);
  }
}

function entriesToAssets(
  assetUrls: Record<string, string>,
  kind: GameAssetPreloadKind,
  labelPrefix: string,
): GameAssetPreloadItem[] {
  return Object.entries(assetUrls).map(([sourcePath, url]) => {
    const stem = getFileStem(sourcePath);
    return {
      id: `${kind}:${stem}`,
      sourcePath,
      url,
      kind,
      label: `${labelPrefix} ${stem}`,
    };
  });
}

async function preloadAsset(
  asset: GameAssetPreloadItem,
  cache: Cache | null,
  signal: AbortSignal | undefined,
): Promise<{ fromCache: boolean }> {
  if (asset.url.startsWith("data:")) {
    return { fromCache: true };
  }

  const request = createAssetRequest(asset.url);

  if (cache) {
    try {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        return { fromCache: true };
      }
    } catch {
      // Cache Storage can be unavailable per browser profile; the fetch path still works.
    }
  }

  const response = await fetch(request, {
    cache: "force-cache",
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (cache) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Quota or profile restrictions should not block the game from starting.
    }
  }

  await response.arrayBuffer();
  return { fromCache: false };
}

async function openGameAssetCache(): Promise<Cache | null> {
  if (typeof window === "undefined" || !("caches" in window)) {
    return null;
  }

  try {
    return await window.caches.open(GAME_ASSET_CACHE_NAME);
  } catch {
    return null;
  }
}

async function purgeLegacyGameAssetCaches(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) {
    return;
  }

  try {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(GAME_ASSET_CACHE_PREFIX))
        .filter((cacheName) => cacheName !== GAME_ASSET_CACHE_NAME)
        .map((cacheName) => window.caches.delete(cacheName)),
    );
  } catch {
    // Cache cleanup is best effort; a blocked profile should still load the game.
  }
}

function createAssetRequest(url: string): Request {
  const absoluteUrl = new URL(url, window.location.href).toString();
  return new Request(absoluteUrl, {
    credentials: "same-origin",
  });
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]!;
      nextIndex += 1;
      await worker(item);
    }
  });

  await Promise.all(workers);
}

function emitProgress(
  onProgress: ((progress: GameAssetPreloadProgress) => void) | undefined,
  phase: GameAssetPreloadProgress["phase"],
  total: number,
  state: AssetPreloadState,
  currentLabel: string,
): void {
  onProgress?.({
    phase,
    total,
    completed: state.completed,
    loaded: state.loaded,
    cached: state.cached,
    failed: state.failed,
    currentLabel,
  });
}

function writePreloadManifest(storage: Storage | undefined, result: GameAssetPreloadResult): void {
  if (!storage) {
    return;
  }

  const manifest: StoredAssetPreloadManifest = {
    cacheName: GAME_ASSET_CACHE_NAME,
    assetCount: result.total,
    cachedCount: result.cached,
    failedCount: result.failed,
    updatedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(GAME_ASSET_PRELOAD_MANIFEST_KEY, JSON.stringify(manifest));
  } catch {
    // Storage can be disabled in private browsing; the fetched assets still remain browser-cacheable.
  }
}

function getFileStem(sourcePath: string): string {
  return (sourcePath.split("/").pop() ?? sourcePath).replace(/\.[^.]+$/, "");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
