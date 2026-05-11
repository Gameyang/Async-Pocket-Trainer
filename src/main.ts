import "./style.css";

import { buildMetadata } from "./buildMetadata";
import { HeadlessGameClient } from "./game/headlessClient";
import { mountHtmlRenderer } from "./ui/htmlRenderer";

export { buildMetadata };

const app = typeof document === "undefined" ? null : document.querySelector<HTMLDivElement>("#app");

if (app) {
  const client = new HeadlessGameClient({
    seed: "browser-preview",
    trainerName: "Browser Trainer",
  });
  mountHtmlRenderer(app, client);
}
