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
import { DEFAULT_BROWSER_TRAINER_NAME } from "./game/localization";
import { mountHtmlRenderer } from "./ui/htmlRenderer";

export { buildMetadata };

const PLAYER_ID_STORAGE_KEY = "apt:player-id:v1";
const TRAINER_NAME_STORAGE_KEY = "apt:trainer-name:v1";
const app = typeof document === "undefined" ? null : document.querySelector<HTMLDivElement>("#app");

if (app) {
  const storage = window.localStorage;
  const loaded = loadClientSnapshotResult(storage);
  const client = loaded.snapshot
    ? HeadlessGameClient.fromSnapshot(loaded.snapshot)
    : new HeadlessGameClient({
        seed: "browser-preview",
        trainerName: getBrowserTrainerName(storage),
      });
  const syncController = new BrowserSyncController(client, loadSyncSettings(storage), {
    playerId: getBrowserPlayerId(storage),
  });
  if (loaded.error) {
    console.warn("Recovered browser save data after validation error:", loaded.error);
  }

  let saveNotice = loaded.recovered ? "손상된 저장 데이터를 복구했습니다." : "";

  mountHtmlRenderer(
    app,
    {
      getFrame: () => client.getFrame(),
      async dispatch(action) {
        const resolvedAction =
          action.type === "START_RUN"
            ? { ...action, trainerName: getBrowserTrainerName(storage) }
            : action;
        await syncController.beforeDispatch(resolvedAction);
        const state = client.dispatch(resolvedAction);
        saveClientSnapshot(client.saveSnapshot(), storage);
        await syncController.afterDispatch(resolvedAction);
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
        saveNotice = "동기화 설정을 저장했습니다.";
      },
      onClearSave() {
        clearClientSnapshot(storage);
        saveNotice = "브라우저 저장 데이터를 삭제했습니다.";
      },
      onNewRun() {
        clearClientSnapshot(storage);
        window.location.reload();
      },
      onTrainerNameSubmit(trainerName: string) {
        saveBrowserTrainerName(storage, trainerName);
        saveNotice = "트레이너 이름을 저장했습니다.";
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

function getBrowserTrainerName(storage: Storage): string {
  const saved = storage.getItem(TRAINER_NAME_STORAGE_KEY)?.trim();
  return saved || DEFAULT_BROWSER_TRAINER_NAME;
}

function saveBrowserTrainerName(storage: Storage, trainerName: string): void {
  const normalized = trainerName.trim() || DEFAULT_BROWSER_TRAINER_NAME;
  storage.setItem(TRAINER_NAME_STORAGE_KEY, normalized);
}
