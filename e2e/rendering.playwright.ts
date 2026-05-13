import { expect, test, type Page } from "@playwright/test";

import { CLIENT_SNAPSHOT_STORAGE_KEY } from "../src/browser/clientStorage";
import { HeadlessGameClient, type HeadlessClientSnapshot } from "../src/game/headlessClient";
import { createTrainerSnapshot, serializeTrainerSnapshot } from "../src/game/sync/trainerSnapshot";

test("renders phase-specific screens with stable responsive layout", async ({ page }, testInfo) => {
  await openFresh(page);
  await assertPhaseScreen(page, "starterChoice", ".starter-screen");
  await expect(page.locator(".starter-option")).toHaveCount(3);
  await expect(page.locator(".drawer[open]")).toHaveCount(0);

  await clickAction(page, '[data-action-id^="start:"]');
  await assertPhaseScreen(page, "ready", ".ready-screen");
  await expect(page.locator(".shop-screen")).toBeVisible();
  await expect(page.locator(".shop-card[data-action-id]")).toHaveCount(3);
  await expect(page.locator(".command-band")).toHaveCount(0);
  await assertLoadedImage(page.locator(".camp-lead img"));

  await openSnapshot(page, captureDecisionSnapshot());
  await assertPhaseScreen(page, "captureDecision", ".encounter-panel");
  await expect(page.locator('.capture-overlay[data-capture-result="choosing"]')).toBeVisible();

  await openSnapshot(page, teamDecisionSnapshot());
  await assertPhaseScreen(page, "teamDecision", ".team-decision-screen");
  await expect(page.locator('.capture-overlay[data-capture-result="success"]')).toBeVisible();
  await expect(page.locator(".candidate-card")).toBeVisible();
  await expect(page.locator(".reward-board")).toBeVisible();
  await expect(page.locator(".command-band button")).toHaveCount(2);

  await openSnapshot(page, gameOverSnapshot());
  await assertPhaseScreen(page, "gameOver", ".game-over-screen");
  await expect(page.locator(".result-board")).toContainText("웨이브");

  await toggleAudio(page);
  await assertResponsiveLayout(page, testInfo.project.name);
});

test("confirms battle replay, capture feedback, and ball count rendering", async ({ page }) => {
  await openSnapshot(page, captureDecisionSnapshot());
  const shell = page.locator(".app-shell");
  const commandBand = page.locator(".command-band");
  const before = await readShellState(page);

  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".battlefield")).toBeVisible();
  await expect(page.locator(".enemy-mon img")).toBeVisible();
  await expect(page.locator(".battle-card.enemy")).toBeVisible();
  await expect(page.locator(".battle-card.hero")).toBeVisible();
  await expect(page.locator(".battle-log")).toBeVisible();
  await expect(page.locator(".log-line")).not.toContainText(/[0-9a-f]{8}/);

  await page.locator('[data-action-id="capture:pokeball"]').first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect.poll(async () => (await readShellState(page)).pokeBalls).toBe(before.pokeBalls - 1);
  const after = await readShellState(page);
  await expect(page.locator(".run-status")).toContainText(`몬스터볼 ${after.pokeBalls}`);

  if (after.phase === "teamDecision") {
    await expect(page.locator('.capture-overlay[data-capture-result="success"]')).toBeVisible();
  } else {
    await expect(page.locator('.capture-overlay[data-capture-result="failure"]')).toBeVisible();
    await expect(page.locator(".enemy-mon img")).toBeVisible();
  }

  await openFresh(page);
  await clickAction(page, '[data-action-id^="start:"]');
  await page.locator('[data-action-id="encounter:next"]').first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect(shell).toHaveAttribute("data-battle-playback", "playing");
  await expect(page.locator("[data-replay-skip]")).toBeVisible();
  const firstSequence = Number(await shell.getAttribute("data-battle-sequence"));
  await expect(page.locator(".battle-float").first()).toBeVisible();
  await expect
    .poll(async () => Number(await shell.getAttribute("data-battle-sequence")))
    .toBeGreaterThan(firstSequence);
  await expect(page.locator(".screen-monster[data-battle-effect]").first()).toBeVisible();
  await skipBattleReplay(page);

  const screenBox = await page.locator(".screen").boundingBox();
  const commandBox = (await commandBand.count()) > 0 ? await commandBand.boundingBox() : null;
  expect(screenBox).not.toBeNull();
  if (commandBox) {
    expect(commandBox.y).toBeGreaterThan(screenBox?.y ?? 0);
  }
});

test("drives browser input through frame actions, disabled actions, and reload save", async ({
  page,
}) => {
  await openFresh(page);

  await clickAction(page, '[data-action-id^="start:"]');
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
  await playUntilWave(page, 6);

  const beforeReload = await readShellState(page);
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect.poll(() => readShellState(page)).toEqual(beforeReload);
});

test("reads public CSV and submits Apps Script without credentials during checkpoint play", async ({
  page,
}) => {
  const requests: string[] = [];
  const sheetRow = buildSheetTrainerCsv();
  await page.route("**/gviz/tq**", async (route) => {
    requests.push(route.request().method());
    await route.fulfill({
      contentType: "text/csv",
      body: sheetRow,
    });
  });
  await page.route("https://script.google.com/**", async (route) => {
    requests.push(route.request().method());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await openFresh(page);
  await openSync(page);
  await page.locator('input[name="enabled"]').check();
  await page.locator('select[name="mode"]').selectOption("publicCsv");
  await openAdvancedSync(page);
  await page
    .locator('input[name="spreadsheetId"]')
    .fill("14ra0Y0zLORpru3nmT-obu3yD1UuO2kAJP4aJ5IIA0M4");
  await page.locator('input[name="range"]').fill("APT_WAVE_TEAMS");
  await page
    .locator('input[name="appsScriptSubmitUrl"]')
    .fill("https://script.google.com/macros/s/deploy-id/exec");
  await page.locator('input[name="apiKey"]').fill("");
  await page.locator('input[name="accessToken"]').fill("");
  await page.locator('[data-sync-form] button[type="submit"]').click();
  await expect(page.locator("[data-sync-status]")).toContainText("Apps Script 준비됨");

  await clickAction(page, '[data-action-id^="start:"]');
  await playUntilWave(page, 5);
  await expect(page.locator("[data-sync-status]")).toContainText("Apps Script 제출 완료");

  await page.locator('[data-action-id="encounter:next"]').first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[data-sync-status]")).toContainText(/Sheet Rival 불러옴|패배/);
  await expect(page.locator('.trainer-badge[data-trainer-source="sheet"] img')).toBeVisible();
  await assertLoadedImage(page.locator('.trainer-badge[data-trainer-source="sheet"] img'));
  await skipBattleReplay(page);
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
  await expect(page.locator(".audio-toggle")).toBeVisible();

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

async function toggleAudio(page: Page): Promise<void> {
  const shell = page.locator(".app-shell");
  const before = await shell.getAttribute("data-audio-muted");
  await page.locator("[data-audio-toggle]").click();
  await expect(shell).not.toHaveAttribute("data-audio-muted", before ?? "");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("apt:audio-muted:v1")))
    .toMatch(/[01]/);
}

async function playUntilWave(page: Page, targetWave: number): Promise<void> {
  for (let guard = 0; guard < 40; guard += 1) {
    const state = await readShellState(page);

    if (state.wave >= targetWave && state.phase !== "gameOver") {
      return;
    }

    await clickNextGameAction(page);
  }

  throw new Error(`Could not reach wave ${targetWave}.`);
}

async function openSync(page: Page): Promise<void> {
  const sync = page.locator(".sync-panel");

  if ((await sync.getAttribute("open")) === null) {
    await sync.locator(":scope > summary").click();
  }
}

async function openAdvancedSync(page: Page): Promise<void> {
  const advanced = page.locator(".advanced-settings");

  if ((await advanced.getAttribute("open")) === null) {
    await advanced.locator(":scope > summary").click();
  }
}

async function openFresh(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function openSnapshot(page: Page, snapshot: HeadlessClientSnapshot): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ key, value }) => {
      localStorage.clear();
      localStorage.setItem(key, value);
    },
    {
      key: CLIENT_SNAPSHOT_STORAGE_KEY,
      value: JSON.stringify(snapshot),
    },
  );
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await skipBattleReplay(page);
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

  if (phase === "gameOver" || phase === "starterChoice") {
    await clickAction(page, '[data-action-id^="start:"]');
    return;
  }

  throw new Error(`Unknown phase: ${phase}`);
}

async function clickAction(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().click();
  await expect.poll(() => page.locator("#app").getAttribute("data-busy")).toBeNull();
  await expect(page.locator(".app-shell")).toBeVisible();
  await skipBattleReplay(page);
}

async function skipBattleReplay(page: Page): Promise<void> {
  const shell = page.locator(".app-shell");

  if ((await shell.getAttribute("data-battle-playback")) === "playing") {
    await page.locator("[data-replay-skip]").click();
    await expect(shell).toHaveAttribute("data-battle-playback", "idle");
  }
}

async function readShellState(page: Page) {
  return page.locator(".app-shell").evaluate((shell) => ({
    frameId: Number(shell.getAttribute("data-frame-id")),
    wave: Number(shell.getAttribute("data-wave")),
    money: Number(shell.getAttribute("data-money")),
    pokeBalls: Number(shell.getAttribute("data-poke-balls")),
    greatBalls: Number(shell.getAttribute("data-great-balls")),
    teamSize: Number(shell.getAttribute("data-team-size")),
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
  const headers = [
    "version",
    "playerId",
    "trainerName",
    "wave",
    "createdAt",
    "seed",
    "teamPower",
    "teamJson",
    "runSummaryJson",
  ];

  return [headers, Object.values(row).map(String)]
    .map((cells) => cells.map(csvCell).join(","))
    .join("\n");
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
