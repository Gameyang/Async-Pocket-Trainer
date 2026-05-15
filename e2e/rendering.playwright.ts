import { expect, test, type Page } from "@playwright/test";

import { CLIENT_SNAPSHOT_STORAGE_KEY } from "../src/browser/clientStorage";
import { STARTER_SPECIES_CACHE_STORAGE_KEY } from "../src/browser/starterSpeciesCache";
import { speciesCatalog } from "../src/game/data/catalog";
import { HeadlessGameClient, type HeadlessClientSnapshot } from "../src/game/headlessClient";
import {
  SHEET_TRAINER_ROW_COLUMNS,
  sheetTrainerRowToValues,
} from "../src/game/sync/googleSheetsAdapter";
import { createTrainerSnapshot, serializeTrainerSnapshot } from "../src/game/sync/trainerSnapshot";

const E2E_BATTLE_REPLAY_STEP_MS = 540;
const clockInstalledPages = new WeakSet<Page>();
const replayClockTimes = new WeakMap<Page, number>();

test("renders phase-specific screens with stable responsive layout", async ({ page }, testInfo) => {
  await openFresh(page);
  await assertPhaseScreen(page, "starterChoice", ".starter-screen");
  await expect(page.locator(".starter-option")).toHaveCount(speciesCatalog.length);
  await expect(page.locator('.starter-option[data-starter-state="unlocked"]')).toHaveCount(3);
  await expect(page.locator('.starter-option[data-starter-state="locked"]')).toHaveCount(
    speciesCatalog.length - 3,
  );
  await expectStarterDexScrollContainment(page);
  await expect(page.locator("[data-starter-reroll]")).toHaveCount(0);
  await expect(page.locator(".drawer[open]")).toHaveCount(0);

  await seedStarterSpeciesCache(page, [1, 4, 7, 10, 16, 19, 25, 35, 39, 52]);
  await assertPhaseScreen(page, "starterChoice", ".starter-screen");
  await expect(page.locator(".starter-option")).toHaveCount(speciesCatalog.length);
  await expect(page.locator('.starter-option[data-starter-state="unlocked"]')).toHaveCount(10);
  await expect(page.locator(".starter-choice-row")).toHaveAttribute("data-starter-density", "dex");

  const firstStarter = page.locator('.starter-option[data-starter-state="unlocked"]').first();
  await expect(firstStarter.locator(".pokemon-level-badge")).toContainText("Lv. 1");
  await firstStarter.locator("[data-starter-pick]").click();
  await expect(page.locator(".starter-choice-row")).toHaveAttribute(
    "data-selection-active",
    "true",
  );
  await expect(firstStarter).toHaveAttribute("data-starter-selected", "true");
  await expect(firstStarter.locator(".starter-confirm")).toBeVisible();
  await expect(firstStarter.locator(".starter-cancel")).toBeVisible();
  await firstStarter.locator("[data-starter-cancel]").click();
  await expect(page.locator(".starter-choice-row")).not.toHaveAttribute(
    "data-selection-active",
    "true",
  );
  await selectStarterAndConfirm(page);
  await assertPhaseScreen(page, "ready", ".ready-screen");
  await expect(page.locator(".shop-screen")).toBeVisible();
  const shopCardCount = await page.locator(".shop-card[data-action-id]").count();
  expect(shopCardCount).toBe(9);
  await expect(page.locator('.shop-card[data-action-id="encounter:next"]')).toHaveCount(0);
  await expect(page.locator('.shop-start-action[data-action-id="encounter:next"]')).toBeVisible();
  await expect(page.locator(".shop-money")).toContainText("🪙");
  await expect(page.locator(".shop-trainer-points")).toContainText("💎");
  await expect(page.locator(".shop-team-slot")).toHaveCount(6);
  await expect(page.locator(".shop-team-slot .reward-alert-badge").first()).toBeVisible();
  await expect(page.locator(".shop-team-slot .reward-alert-badge").first()).toContainText("💎");
  await expect(page.locator(".shop-team-slot .pokemon-level-badge").first()).toContainText(/Lv\./);
  await expect(page.locator(".shop-slot-stats").first()).toBeVisible();
  await expect(page.locator(".shop-slot-moves span").first()).toBeVisible();
  await expect(page.locator(".command-band")).toHaveCount(0);
  await assertLoadedImage(page.locator(".shop-team-slot img").first());
  await page.locator("[data-team-detail-id]").first().click();
  await expect(page.locator('.team-detail-popup[data-open="true"]')).toBeVisible();
  await expect(page.locator(".team-detail-stats")).toBeVisible();
  await expect(page.locator(".team-detail-card .pokemon-level-badge").first()).toContainText(
    /Lv\./,
  );
  await expect(page.locator(".team-detail-move-card").first()).toBeVisible();
  await expect(page.locator(".move-detail-type").first()).toBeVisible();
  await expect(page.locator(".move-detail-power").first()).toBeVisible();
  await expect(page.locator(".move-detail-accuracy").first()).toBeVisible();
  await expect(page.locator(".move-detail-effect").first()).toBeVisible();
  await expect(page.locator(".move-detail-effect").first()).not.toContainText(
    /Inflicts|Has a|Lowers|Raises|target/i,
  );
  await page.locator("[data-team-detail-close]").click();
  await expect(page.locator('.team-detail-popup[data-open="true"]')).toHaveCount(0);

  await openSnapshot(page, shopTargetSelectionSnapshot());
  await assertPhaseScreen(page, "ready", ".ready-screen");
  await expect(page.locator(".shop-team-slot")).toHaveCount(6);
  const beforeTargetHeal = await readShellState(page);
  await page.locator('[data-action-id="shop:heal:single:1"]').click();
  await expect(page.locator(".shop-screen")).toHaveAttribute("data-shop-targeting", "true");
  await page.locator("[data-shop-target-id]:not(:disabled)").first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect(page.locator(".coin-spend-burst span").first()).toBeVisible();
  await expect(page.locator(".shop-screen")).toHaveAttribute("data-shop-targeting", "false");
  await expect
    .poll(async () => (await readShellState(page)).money)
    .toBeLessThan(beforeTargetHeal.money);
  const itemToast = page.locator('.feedback-toast[data-toast-kind="item"]').first();
  await expect(itemToast).toBeVisible();
  await expect(itemToast).toContainText("회복");
  await expect(page.locator(".feedback-toast")).toHaveCount(1);

  await openSnapshot(page, premiumGemShopSnapshot());
  await assertPhaseScreen(page, "ready", ".ready-screen");
  await expect(page.locator(".shop-trainer-points")).toContainText("💎");
  await page.locator('[data-action-id="shop:premium:ball:ultraball"]').click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect(
    page.locator('.currency-spend-burst[data-currency="gem"] span').first(),
  ).toBeVisible();

  await openSnapshot(page, captureDecisionSnapshot());
  await assertPhaseScreen(page, "captureDecision", ".encounter-panel");
  await expect(page.locator('.capture-overlay[data-capture-result="choosing"]')).toBeVisible();

  await openSnapshot(page, teamDecisionSnapshot());
  await assertPhaseScreen(page, "teamDecision", ".team-decision-screen");
  await expect(page.locator('.capture-overlay[data-capture-result="success"]')).toBeVisible();
  await expect(page.locator(".candidate-card")).toBeVisible();
  await expect(page.locator(".candidate-card .pokemon-level-badge").first()).toContainText(/Lv\./);
  await expect(page.locator(".team-compare-panel")).toBeVisible();
  await expect(page.locator(".team-compare-slot")).toHaveCount(6);
  await expect(page.locator(".team-compare-slot .pokemon-level-badge").first()).toContainText(
    /Lv\./,
  );
  await expect(page.locator(".command-band button")).toHaveCount(2);

  await openSnapshot(page, failedCaptureReadySnapshot());
  await assertPhaseScreen(page, "ready", ".ready-screen");
  await expect(page.locator('.capture-overlay[data-capture-result="failure"]')).toBeVisible();
  await expect(page.locator(".command-band")).toHaveCount(0);
  await expect(page.locator('.shop-start-action[data-action-id="encounter:next"]')).toBeVisible();
  await clickAction(page, '[data-action-id="encounter:next"]');

  await openSnapshot(page, gameOverSnapshot());
  await assertPhaseScreen(page, "gameOver", ".game-over-screen");
  await expect(page.locator(".final-team-panel")).toBeVisible();
  await expect(page.locator(".final-team-slot")).toHaveCount(6);
  await expect(page.locator(".final-team-slot .pokemon-level-badge").first()).toContainText(/Lv\./);
  await expect(page.locator('[data-action-id="restart:team:0"]')).toBeVisible();
  await expect(page.locator('[data-action-id="restart:starter-choice"]')).toBeVisible();
  await expect(page.locator(".result-board")).toContainText("웨이브");

  await assertResponsiveLayout(page, testInfo.project.name);
});

test("confirms battle replay, capture feedback, and ball count rendering", async ({ page }) => {
  await openSnapshot(page, captureDecisionSnapshot());
  const shell = page.locator(".app-shell");
  const commandBand = page.locator(".command-band");
  const before = await readShellState(page);

  await expect(page.locator(".battlefield")).toBeVisible();
  await expect(page.locator(".enemy-mon img")).toBeVisible();
  await expect(page.locator(".battle-card.enemy")).toBeVisible();
  await expect(page.locator(".battle-card.hero")).toBeVisible();
  await expect(page.locator(".battle-card .pokemon-level-badge").first()).toContainText(/Lv\./);
  await expect(page.locator(".battle-log")).toBeVisible();
  await expect(page.locator(".log-line")).not.toContainText(/[0-9a-f]{8}/);

  await page.locator('[data-action-id="capture:pokeball"]').first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect.poll(async () => (await readShellState(page)).pokeBalls).toBe(before.pokeBalls - 1);
  const after = await readShellState(page);
  expect(after.pokeBalls).toBe(before.pokeBalls - 1);

  if (after.phase === "teamDecision") {
    await expect(page.locator('.capture-overlay[data-capture-result="success"]')).toBeVisible();
  } else {
    await expect(page.locator('.capture-overlay[data-capture-result="failure"]')).toBeVisible();
    await expect(page.locator(".ready-screen")).toBeVisible();
  }

  await openFresh(page);
  await selectStarterAndConfirm(page);
  await page.locator('[data-action-id="encounter:next"]').first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect(shell).toHaveAttribute("data-battle-playback", "playing");
  await expect(page.locator(".capture-overlay")).toHaveCount(0);
  await expect(page.locator("[data-replay-skip]")).toHaveCount(0);
  await expect(page.locator(".battle-team-grid-panel .shop-team-grid")).toBeVisible();
  await expect(page.locator(".battle-team-grid-panel .shop-team-slot")).toHaveCount(6);
  await expect(page.locator(".battle-team-grid-panel .pokemon-level-badge").first()).toContainText(
    /Lv\./,
  );
  await expect(page.locator(".battle-team-grid-panel .shop-slot-stats").first()).toBeVisible();
  await expect(page.locator(".battle-team-grid-panel button.shop-team-slot")).toHaveCount(0);
  await expect(page.locator(".battle-team-grid-panel [data-team-detail-id]")).toHaveCount(0);
  await expect(page.locator(".battle-team-grid-panel .team-detail-popup")).toHaveCount(0);
  await expect(page.locator(".battle-team-grid-panel .reward-alert-badge")).toHaveCount(0);
  await advanceBattleReplayUntilEvent(page, /^(damage\.apply|move\.miss|creature\.faint)$/);
  await expect(page.locator(".battle-float").first()).toBeVisible();
  const firstSequence = Number(await shell.getAttribute("data-battle-sequence"));
  await runReplayClock(page, E2E_BATTLE_REPLAY_STEP_MS);
  await expect
    .poll(async () => Number(await shell.getAttribute("data-battle-sequence")))
    .toBeGreaterThan(firstSequence);
  await expect(page.locator(".screen-monster[data-battle-effect]").first()).toBeVisible();
  await waitForBattleReplay(page);
  if ((await readShellState(page)).phase === "captureDecision") {
    await expect(page.locator('.feedback-toast[data-toast-kind="reward"]').first()).toBeVisible();
    await expect(page.locator('.capture-overlay[data-capture-result="choosing"]')).toBeVisible();
  }

  const screenBox = await page.locator(".screen").boundingBox();
  const commandBox = (await commandBand.count()) > 0 ? await commandBand.boundingBox() : null;
  expect(screenBox).not.toBeNull();
  if (commandBox) {
    expect(commandBox.y).toBeGreaterThan(screenBox?.y ?? 0);
  }
});

test("pauses battle replay and audio while the page is backgrounded", async ({ page }) => {
  await installAudioProbe(page);
  await openFresh(page);
  await selectStarterAndConfirm(page);

  await page.locator('[data-action-id="encounter:next"]').first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();

  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-battle-playback", "playing");

  await resetAudioProbe(page);
  await setPageVisibility(page, "hidden");
  const pausedSequence = Number(await shell.getAttribute("data-battle-sequence"));
  await page.waitForTimeout(1_200);

  expect(Number(await shell.getAttribute("data-battle-sequence"))).toBe(pausedSequence);
  expect((await readAudioProbe(page)).some((event) => event.startsWith("pause:"))).toBe(true);

  await setPageVisibility(page, "visible");
  await runReplayClock(page, E2E_BATTLE_REPLAY_STEP_MS);
  await expect
    .poll(async () => Number(await shell.getAttribute("data-battle-sequence")))
    .toBeGreaterThan(pausedSequence);
});

test("drives browser input through frame actions, disabled actions, and reload save", async ({
  page,
}) => {
  await openFresh(page);

  await selectStarterAndConfirm(page);
  const started = await readShellState(page);
  expect(started.frameId).toBe(1);
  expect(started.teamSize).toBe(1);

  await clickAction(page, '[data-action-id="encounter:next"]');
  await clickAction(page, '[data-action-id="capture:greatball"]');
  await resolveNonReadyPhase(page);
  await clickAction(page, '[data-action-id="encounter:next"]');

  const disabledState = await readShellState(page);
  const disabledGreatBall = page.locator('[data-action-id="capture:greatball"]').first();
  await expect(disabledGreatBall).toBeDisabled();
  await disabledGreatBall.click({ force: true });
  await expect.poll(() => readShellState(page)).toEqual(disabledState);

  await clickAction(page, '[data-action-id="capture:skip"]');
  await playUntilWave(page, 4);

  const beforeReload = await readShellState(page);
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect.poll(() => readShellState(page)).toEqual(beforeReload);
});

test("reads public CSV from code sync settings and opens team record prompt", async ({ page }) => {
  const requests: string[] = [];
  const sheetRow = buildSheetTrainerCsv();
  await page.route("**/gviz/tq**", async (route) => {
    requests.push(route.request().method());
    await route.fulfill({
      contentType: "text/csv",
      body: sheetRow,
    });
  });
  let submitAttempts = 0;
  await page.route("https://script.google.com/macros/s/**", async (route) => {
    requests.push(route.request().method());
    submitAttempts += 1;
    if (submitAttempts <= 2) {
      await route.abort("failed");
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "",
    });
  });

  await openSnapshot(page, trainerCheckpointReadySnapshot());

  await page.locator('[data-action-id="encounter:next"]').first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator('.trainer-badge[data-trainer-source="sheet"] img')).toBeVisible();
  await assertLoadedImage(page.locator('.trainer-badge[data-trainer-source="sheet"] img'));
  await expect(page.locator(".trainer-record")).toHaveCount(0);
  await expect(page.locator('.team-record-shift[data-record-placement="battle"]')).toHaveCount(0);
  await waitForBattleReplay(page);
  await expect(page.locator('[data-screen="checkpointVictory"]')).toBeVisible();
  await page.locator('input[name="teamName"]').fill("E2E Team");
  await page.locator('input[name="trainerGreeting"]').fill("E2E greeting");
  await page.locator("[data-team-record-form] button").click();
  await expect(page.locator('[data-screen="checkpointVictory"]')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("apt:trainer-name:v1")))
    .toBe("E2E Team");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("apt:trainer-greeting:v1")))
    .toBe("E2E greeting");
  expect(requests).toContain("GET");
  expect(requests).toContain("POST");
});

async function assertPhaseScreen(page: Page, phase: string, screenSelector: string): Promise<void> {
  await expect(page.locator(".app-shell")).toHaveAttribute("data-phase", phase);
  await expect(page.locator(screenSelector)).toBeVisible();
  const screenshot = await page.locator(".screen").screenshot({ animations: "disabled" });
  expect(screenshot.byteLength).toBeGreaterThan(2_000);
  await assertNoHorizontalOverflow(page);
}

async function assertResponsiveLayout(page: Page, projectName: string): Promise<void> {
  await assertNoHorizontalOverflow(page);

  const buttons = await page.locator("button").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    }),
  );

  for (const button of buttons) {
    expect(button.width, `${projectName} button width`).toBeGreaterThan(24);
    expect(button.height, `${projectName} button height`).toBeGreaterThan(20);
    expect(button.scrollWidth, `${projectName} button overflow`).toBeLessThanOrEqual(
      button.clientWidth + 2,
    );
  }
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));

  expect(Math.max(overflow.body, overflow.root)).toBeLessThanOrEqual(overflow.viewport + 2);
}

async function assertLoadedImage(locator: ReturnType<Page["locator"]>): Promise<void> {
  await expect(locator.first()).toBeVisible();
  await expect
    .poll(() =>
      locator
        .first()
        .evaluate(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
}

async function playUntilWave(page: Page, targetWave: number): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const state = await readShellState(page);

    if (state.wave >= targetWave && state.phase !== "gameOver") {
      return;
    }

    if (state.phase === "gameOver") {
      throw new Error(`Run ended before reaching wave ${targetWave}.`);
    }

    await clickNextGameAction(page);
  }

  throw new Error(`Could not reach wave ${targetWave}.`);
}

async function expectStarterDexScrollContainment(page: Page): Promise<void> {
  const metrics = await page.locator(".starter-screen").evaluate((screen) => {
    const row = screen.querySelector<HTMLElement>(".starter-choice-row");
    const shell = screen.closest<HTMLElement>(".app-shell");

    if (!row || !shell) {
      throw new Error("Starter dex scroll elements were not found.");
    }

    return {
      rowCanScroll: row.scrollHeight > row.clientHeight + 1,
      screenCanScroll: screen.scrollHeight > screen.clientHeight + 1,
      shellCanScroll: shell.scrollHeight > shell.clientHeight + 1,
    };
  });

  expect(metrics).toEqual({
    rowCanScroll: true,
    screenCanScroll: false,
    shellCanScroll: false,
  });
}

async function openFresh(page: Page): Promise<void> {
  await installReplayClock(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await pauseReplayClock(page);
}

async function installReplayClock(page: Page): Promise<void> {
  if (clockInstalledPages.has(page)) {
    return;
  }

  const initialTime = Date.now();
  await page.clock.install({ time: initialTime });
  clockInstalledPages.add(page);
  replayClockTimes.set(page, initialTime);
}

async function pauseReplayClock(page: Page): Promise<void> {
  const pageTime = await page.evaluate(() => Date.now()).catch(() => Date.now());
  const nextTime = Math.max(replayClockTimes.get(page) ?? 0, pageTime, Date.now()) + 60_000;
  await page.clock.pauseAt(nextTime);
  replayClockTimes.set(page, nextTime);
}

async function runReplayClock(page: Page, ticks: number): Promise<void> {
  await page.clock.runFor(ticks);
  const pageTime = await page.evaluate(() => Date.now()).catch(() => Date.now());
  replayClockTimes.set(page, pageTime);
}

async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as unknown as { __audioEvents: string[] };
    state.__audioEvents = [];
    HTMLMediaElement.prototype.play = function () {
      state.__audioEvents.push(`play:${this.currentSrc || this.src}`);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      state.__audioEvents.push(`pause:${this.currentSrc || this.src}`);
    };
  });
}

async function resetAudioProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as { __audioEvents?: string[] };
    if (state.__audioEvents) {
      state.__audioEvents.length = 0;
    }
  });
}

async function readAudioProbe(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window as unknown as { __audioEvents?: string[] };
    return [...(state.__audioEvents ?? [])];
  });
}

async function setPageVisibility(page: Page, visibilityState: "hidden" | "visible"): Promise<void> {
  await page.evaluate((nextVisibilityState) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => nextVisibilityState === "hidden",
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => nextVisibilityState,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visibilityState);
}

async function seedStarterSpeciesCache(page: Page, speciesIds: number[]): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    {
      key: STARTER_SPECIES_CACHE_STORAGE_KEY,
      value: JSON.stringify(speciesIds),
    },
  );
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function openSnapshot(page: Page, snapshot: HeadlessClientSnapshot): Promise<void> {
  await installReplayClock(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await setClientSnapshotStorage(page, snapshot);
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await pauseReplayClock(page);
  await waitForBattleReplay(page);
}

async function setClientSnapshotStorage(
  page: Page,
  snapshot: HeadlessClientSnapshot,
): Promise<void> {
  const payload = {
    key: CLIENT_SNAPSHOT_STORAGE_KEY,
    value: JSON.stringify(snapshot),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(({ key, value }) => {
        localStorage.clear();
        localStorage.setItem(key, value);
      }, payload);
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }
  }
}

async function resolveNonReadyPhase(page: Page): Promise<void> {
  for (let guard = 0; guard < 10; guard += 1) {
    const state = await readShellState(page);

    if (state.phase === "ready" || state.phase === "gameOver") {
      return;
    }

    await clickNextGameAction(page);
  }

  throw new Error("Could not resolve current phase.");
}

async function clickNextGameAction(page: Page): Promise<void> {
  const phase = (await page.locator(".app-shell").getAttribute("data-phase")) ?? "";

  if (phase === "ready") {
    const state = await readShellState(page);
    const rest = page.locator('[data-action-id="shop:rest"]:not(:disabled)');

    if (state.teamHpRatio < 0.98 && (await rest.count()) > 0) {
      await clickAction(page, '[data-action-id="shop:rest"]:not(:disabled)');
      return;
    }

    await clickAction(page, '[data-action-id="encounter:next"]');
    return;
  }

  if (phase === "captureDecision") {
    const pokeBall = page.locator('[data-action-id="capture:pokeball"]:not(:disabled)');

    if ((await pokeBall.count()) > 0) {
      await clickAction(page, '[data-action-id="capture:pokeball"]:not(:disabled)');
    } else {
      await clickAction(page, '[data-action-id="capture:skip"]');
    }
    return;
  }

  if (phase === "teamDecision") {
    await clickAction(page, '[data-action-id^="team:"]:not([data-action-id="team:release"])');
    return;
  }

  if (phase === "starterChoice") {
    await selectStarterAndConfirm(page);
    return;
  }

  if (phase === "gameOver") {
    await clickAction(page, '[data-action-id^="restart:team:"]');
    return;
  }

  throw new Error(`Unknown phase: ${phase}`);
}

async function clickAction(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect(page.locator(".app-shell")).toBeVisible();
  await waitForBattleReplay(page);
}

async function selectStarterAndConfirm(page: Page, speciesId = 4): Promise<void> {
  const starter = page.locator(
    `.starter-option[data-starter-id="${speciesId}"][data-starter-state="unlocked"]`,
  );

  await starter.locator("[data-starter-pick]").click();
  await expect(starter).toHaveAttribute("data-starter-selected", "true");
  await expect(page.locator(".starter-choice-row")).toHaveAttribute(
    "data-selection-active",
    "true",
  );
  await clickAction(
    page,
    '.starter-option[data-starter-selected="true"] [data-action-id^="start:"]',
  );
  await expect(page.locator(".app-shell")).toHaveAttribute("data-phase", "ready");
}

async function waitForBattleReplay(page: Page): Promise<void> {
  const shell = page.locator(".app-shell");

  for (let guard = 0; guard < 200; guard += 1) {
    if ((await shell.getAttribute("data-battle-playback")) !== "playing") {
      return;
    }

    await runReplayClock(page, E2E_BATTLE_REPLAY_STEP_MS);
  }

  await expect(shell).toHaveAttribute("data-battle-playback", "idle", { timeout: 1_000 });
}

async function advanceBattleReplayUntilEvent(page: Page, pattern: RegExp): Promise<void> {
  const shell = page.locator(".app-shell");

  for (let guard = 0; guard < 60; guard += 1) {
    const eventType = (await shell.getAttribute("data-battle-event-type")) ?? "";
    if (pattern.test(eventType)) {
      return;
    }

    await runReplayClock(page, E2E_BATTLE_REPLAY_STEP_MS);
  }

  expect((await shell.getAttribute("data-battle-event-type")) ?? "").toMatch(pattern);
}

async function readShellState(page: Page) {
  return page.locator(".app-shell").evaluate((shell) => ({
    frameId: Number(shell.getAttribute("data-frame-id")),
    wave: Number(shell.getAttribute("data-wave")),
    money: Number(shell.getAttribute("data-money")),
    pokeBalls: Number(shell.getAttribute("data-poke-balls")),
    greatBalls: Number(shell.getAttribute("data-great-balls")),
    teamSize: Number(shell.getAttribute("data-team-size")),
    teamHpRatio: Number(shell.getAttribute("data-team-hp-ratio")),
    timelineCount: Number(shell.getAttribute("data-timeline-count")),
    phase: shell.getAttribute("data-phase"),
  }));
}

function captureDecisionSnapshot(): HeadlessClientSnapshot {
  const client = new HeadlessGameClient({ seed: "e2e-capture" });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
  client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
  return client.saveSnapshot();
}

function shopTargetSelectionSnapshot(): HeadlessClientSnapshot {
  const client = new HeadlessGameClient({ seed: "e2e-shop-target" });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
  const snapshot = client.saveSnapshot();
  snapshot.state.money = 12;
  snapshot.state.team = snapshot.state.team.map((creature, index) => ({
    ...creature,
    currentHp: index === 0 ? 1 : creature.currentHp,
  }));
  // Seed deterministic inventory containing single-target heal for shop-target flow
  snapshot.state.shopInventory = {
    wave: snapshot.state.currentWave,
    rerollCount: 0,
    entries: [
      { actionId: "shop:heal:single:1", stock: 1, initialStock: 1 },
      { actionId: "shop:pokeball", stock: 3, initialStock: 3 },
      { actionId: "shop:greatball", stock: 2, initialStock: 2 },
      { actionId: "shop:rest", stock: 1, initialStock: 1 },
    ],
  };
  return snapshot;
}

function premiumGemShopSnapshot(): HeadlessClientSnapshot {
  const client = new HeadlessGameClient({ seed: "e2e-premium-gem" });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
  const snapshot = client.saveSnapshot();
  const offerId = "premium:ball:ultraball";
  snapshot.state.metaCurrency = {
    ...(snapshot.state.metaCurrency ?? { claimedAchievements: [] }),
    trainerPoints: 99,
  };
  snapshot.state.premiumOfferIds = {
    wave: snapshot.state.currentWave,
    ids: [offerId],
  };
  snapshot.state.shopInventory = {
    wave: snapshot.state.currentWave,
    rerollCount: 0,
    entries: [{ actionId: `shop:${offerId}`, stock: 1, initialStock: 1 }],
  };
  return snapshot;
}

function teamDecisionSnapshot(): HeadlessClientSnapshot {
  const client = new HeadlessGameClient({ seed: "capture-1" });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
  client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
  client.dispatch({ type: "ATTEMPT_CAPTURE", ball: "greatBall" });
  return client.saveSnapshot();
}

function gameOverSnapshot(): HeadlessClientSnapshot {
  const client = new HeadlessGameClient({ seed: "e2e-game-over" });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 4 });
  const snapshot = client.saveSnapshot();
  snapshot.state.phase = "gameOver";
  snapshot.state.currentWave = 9;
  snapshot.state.gameOverReason = "E2E 게임 오버 화면입니다.";
  return snapshot;
}

function trainerCheckpointReadySnapshot(): HeadlessClientSnapshot {
  const client = new HeadlessGameClient({ seed: "e2e-sheet-checkpoint" });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 149 });
  const snapshot = client.saveSnapshot();
  snapshot.state.phase = "ready";
  snapshot.state.currentWave = 5;
  snapshot.state.money = 999;
  snapshot.state.team = snapshot.state.team.map((creature) => ({
    ...creature,
    currentHp: creature.stats.hp,
  }));
  return snapshot;
}

function failedCaptureReadySnapshot(): HeadlessClientSnapshot {
  for (let index = 0; index < 50; index += 1) {
    const client = new HeadlessGameClient({ seed: `e2e-capture-fail-${index}` });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    if (client.getSnapshot().phase !== "captureDecision") {
      continue;
    }

    client.dispatch({ type: "ATTEMPT_CAPTURE", ball: "pokeBall" });

    const snapshot = client.getSnapshot();
    if (snapshot.phase === "ready" && snapshot.events.at(-1)?.type === "capture_attempted") {
      return client.saveSnapshot();
    }
  }

  throw new Error("Could not create deterministic failed capture snapshot.");
}

function buildSheetTrainerCsv(): string {
  const opponent = new HeadlessGameClient({
    seed: "e2e-sheet-opponent",
    trainerName: "Sheet Rival",
  });
  opponent.dispatch({ type: "START_RUN", starterSpeciesId: 4 });
  const row = serializeTrainerSnapshot(
    createTrainerSnapshot(opponent.getSnapshot(), {
      playerId: "sheet-rival",
      createdAt: "2026-05-12T00:00:00.000Z",
      runSummary: opponent.getRunSummary(),
      wave: 5,
    }),
  );
  const team = JSON.parse(row.teamJson) as Array<{
    stats: Record<string, number>;
    currentHp: number;
    powerScore: number;
    rarityScore: number;
  }>;
  team[0] = {
    ...team[0],
    stats: { hp: 1, attack: 1, defense: 1, special: 1, speed: 1 },
    currentHp: 1,
    powerScore: 1,
    rarityScore: 1,
  };
  const weakRow = {
    ...row,
    teamPower: 1,
    teamJson: JSON.stringify(team),
  };
  return [[...SHEET_TRAINER_ROW_COLUMNS], sheetTrainerRowToValues(weakRow)]
    .map((cells) => cells.map(csvCell).join(","))
    .join("\n");
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
