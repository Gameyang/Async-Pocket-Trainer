import "./style.css";

import {
  type GameAssetPreloadProgress,
  preloadGameAssets,
} from "./browser/assetPreloader";
import { createBrowserGameRuntime } from "./browser/gameRuntime";
import { buildMetadata } from "./buildMetadata";
import { mountHtmlRenderer } from "./ui/htmlRenderer";

export { buildMetadata };

const app = typeof document === "undefined" ? null : document.querySelector<HTMLDivElement>("#app");

if (app) {
  void bootGame(app);
}

async function bootGame(app: HTMLDivElement): Promise<void> {
  renderAssetLoadingScreen(app, {
    phase: "checking",
    total: 0,
    completed: 0,
    loaded: 0,
    cached: 0,
    failed: 0,
    currentLabel: "전투 리소스 확인",
  });

  try {
    await preloadGameAssets({
      storage: window.localStorage,
      onProgress: (progress) => renderAssetLoadingScreen(app, progress),
    });
  } catch (error) {
    console.warn("Unable to preload game assets:", error);
  }

  mountGame(app);
}

function mountGame(app: HTMLDivElement): void {
  const runtime = createBrowserGameRuntime({
    storage: window.localStorage,
  });

  if (runtime.loadedSnapshot.error) {
    console.warn(
      "Recovered browser save data after validation error:",
      runtime.loadedSnapshot.error,
    );
  }

  if (runtime.dailyBonusMessage && typeof document !== "undefined") {
    queueMicrotask(() => showDailyBonusBanner(runtime.dailyBonusMessage!));
  }

  mountHtmlRenderer(app, runtime.frameClient, {
    getStatusView: runtime.getStatusView,
    onTeamRecordSubmit: runtime.submitTeamRecord,
    onStarterReroll: runtime.rerollStarterChoices,
  });
}

function renderAssetLoadingScreen(
  app: HTMLDivElement,
  progress: GameAssetPreloadProgress,
): void {
  const percent =
    progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  const loader = document.createElement("main");
  loader.className = "boot-loader";
  loader.setAttribute("aria-busy", progress.phase === "complete" ? "false" : "true");

  const panel = document.createElement("section");
  panel.className = "boot-loader__panel";
  panel.setAttribute("aria-label", "게임 리소스 로딩");

  const ball = document.createElement("div");
  ball.className = "boot-loader__ball";
  ball.setAttribute("aria-hidden", "true");

  const heading = document.createElement("h1");
  heading.textContent = progress.phase === "complete" ? "준비 완료" : "리소스 준비 중";

  const status = document.createElement("p");
  status.className = "boot-loader__status";
  status.textContent = progress.currentLabel;

  const meter = document.createElement("div");
  meter.className = "boot-loader__meter";
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", String(percent));

  const meterBar = document.createElement("span");
  meterBar.style.inlineSize = `${percent}%`;
  meter.append(meterBar);

  const counts = document.createElement("div");
  counts.className = "boot-loader__counts";

  const percentage = document.createElement("strong");
  percentage.textContent = `${percent}%`;

  const assetCount = document.createElement("span");
  assetCount.textContent =
    progress.total > 0 ? `${progress.completed}/${progress.total}` : "대기 중";

  counts.append(percentage, assetCount);

  const cacheStatus = document.createElement("small");
  cacheStatus.className = "boot-loader__cache";
  cacheStatus.textContent =
    progress.cached > 0
      ? `로컬 캐시 ${progress.cached}개 재사용`
      : progress.phase === "complete"
        ? "로컬 저장 완료"
        : "로컬 저장 준비";

  panel.append(ball, heading, status, meter, counts, cacheStatus);
  loader.append(panel);
  app.replaceChildren(loader);
}

function showDailyBonusBanner(message: string): void {
  const existing = document.querySelector(".daily-bonus-banner");
  if (existing) {
    existing.remove();
  }

  const banner = document.createElement("div");
  banner.className = "daily-bonus-banner";
  banner.setAttribute("role", "status");
  banner.textContent = message;
  banner.addEventListener("click", () => banner.remove(), { once: true });
  setTimeout(() => banner.remove(), 6000);
  document.body.appendChild(banner);
}
