import {validateRuntimeBattleData} from '../core/runtimeValidation';
import {escapeHtml} from '../ui/html';
import {mountBattleApp} from './BattleApp';

export function bootstrapApp(rootSelector = '#app'): void {
  const appRoot = document.querySelector<HTMLElement>(rootSelector);
  if (!appRoot) {
    throw new Error(`App root not found: ${rootSelector}`);
  }

  try {
    validateBattleData();
    const app = mountBattleApp(appRoot);
    window.addEventListener('beforeunload', () => app.dispose());
  } catch (error) {
    renderBootstrapError(appRoot, error);
    throw error;
  }
}

function validateBattleData(): void {
  const validation = validateRuntimeBattleData();
  if (!validation.ok) {
    throw new Error(`Battle data validation failed:\n${validation.errors.join('\n')}`);
  }
}

function renderBootstrapError(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  root.innerHTML = `
    <main class="game-shell">
      <section class="message-box" style="position: static;">
        <p>${escapeHtml(message)}</p>
      </section>
    </main>
  `;
}
