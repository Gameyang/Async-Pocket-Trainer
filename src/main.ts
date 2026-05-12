import "./style.css";

import {
  clearClientSnapshot,
  loadClientSnapshotResult,
  saveClientSnapshot,
} from "./browser/clientStorage";
import { BrowserSyncController } from "./browser/browserSync";
import { loadSyncSettings, saveSyncSettings, type SyncSettings } from "./browser/syncSettings";
import { buildMetadata } from "./buildMetadata";
import { HeadlessGameClient } from "./game/headlessClient";
import { mountHtmlRenderer } from "./ui/htmlRenderer";

export { buildMetadata };

const PLAYER_ID_STORAGE_KEY = "apt:player-id:v1";
const app = typeof document === "undefined" ? null : document.querySelector<HTMLDivElement>("#app");

if (app) {
  const storage = window.localStorage;
  const loaded = loadClientSnapshotResult(storage);
  const client = loaded.snapshot
    ? HeadlessGameClient.fromSnapshot(loaded.snapshot)
    : new HeadlessGameClient({
        seed: "browser-preview",
        trainerName: "Browser Trainer",
      });
  const syncController = new BrowserSyncController(client, loadSyncSettings(storage), {
    playerId: getBrowserPlayerId(storage),
  });
  let saveNotice = loaded.recovered
    ? `Recovered invalid save${loaded.error ? `: ${loaded.error}` : ""}`
    : "";

  mountHtmlRenderer(
    app,
    {
      getFrame: () => client.getFrame(),
      async dispatch(action) {
        await syncController.beforeDispatch(action);
        const state = client.dispatch(action);
        saveClientSnapshot(client.saveSnapshot(), storage);
        await syncController.afterDispatch(action);
        saveClientSnapshot(client.saveSnapshot(), storage);
        return state;
      },
    },
    {
      getStatusView: () => ({
        saveNotice,
        sync: {
          settings: syncController.getSettings(),
          status: syncController.getStatus(),
        },
      }),
      onSyncSettingsSubmit(settings: SyncSettings) {
        const normalized = saveSyncSettings(settings, storage);
        syncController.updateSettings(normalized);
        saveNotice = "Sync settings saved";
      },
      onClearSave() {
        clearClientSnapshot(storage);
        saveNotice = "Browser save cleared";
      },
    },
  );
}

function getBrowserPlayerId(storage: Storage): string {
  const existing = storage.getItem(PLAYER_ID_STORAGE_KEY);

  if (existing) {
    return existing;
  }

  const created =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `player-${Date.now().toString(36)}`;
  storage.setItem(PLAYER_ID_STORAGE_KEY, created);
  return created;
}
