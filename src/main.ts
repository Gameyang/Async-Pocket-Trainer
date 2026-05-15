import "./style.css";

import { createBrowserGameRuntime } from "./browser/gameRuntime";
import { buildMetadata } from "./buildMetadata";
import { mountHtmlRenderer } from "./ui/htmlRenderer";

export { buildMetadata };

const app = typeof document === "undefined" ? null : document.querySelector<HTMLDivElement>("#app");

if (app) {
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
