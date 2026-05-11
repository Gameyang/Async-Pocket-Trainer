import "./style.css";

export const buildMetadata = {
  name: "Async Pocket Trainer",
  harnessVersion: 1,
} as const;

const app = typeof document === "undefined" ? null : document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <main class="shell" aria-label="Async Pocket Trainer">
      <section class="hero">
        <p class="eyebrow">Development Harness</p>
        <h1>Async Pocket Trainer</h1>
        <p class="summary">GitHub Pages, TypeScript, Vite, Vitest, ESLint 기반으로 시작합니다.</p>
        <div class="status-grid" aria-label="검증 항목">
          <span>TypeScript</span>
          <span>Lint</span>
          <span>Test</span>
          <span>Build</span>
        </div>
      </section>
    </main>
  `;
}
