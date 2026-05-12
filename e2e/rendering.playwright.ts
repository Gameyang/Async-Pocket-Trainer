import { expect, test, type Page } from "@playwright/test";

test("confirms the mobile game-frame rendering path", async ({ page }) => {
  await openFresh(page);

  const shell = page.locator(".app-shell");
  await expect(shell).toBeVisible();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".command-band")).toBeVisible();

  await page.locator('[data-action-id^="start:"]').first().click();

  const teamImage = page.locator(".team-panel .creature img").first();
  await expect(teamImage).toBeVisible();
  await expect
    .poll(() =>
      teamImage.evaluate(
        (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);

  await page.locator('[data-action-id="encounter:next"]').click();

  const encounterPanel = page.locator(".encounter-panel");
  const commandBand = page.locator(".command-band");
  await expect(encounterPanel).toBeVisible();
  await expect(page.locator(".battle-log")).toBeVisible();

  const dashboardBox = await page.locator(".dashboard").boundingBox();
  const commandBox = await commandBand.boundingBox();
  expect(dashboardBox).not.toBeNull();
  expect(commandBox).not.toBeNull();
  expect(commandBox?.y).toBeGreaterThan(dashboardBox?.y ?? 0);

  const battlefieldBackground = await encounterPanel.evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  expect(battlefieldBackground).toContain("gradient");
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
  const disabledGreatBall = page.locator('[data-action-id="capture:greatball"]');
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
  await page.route("**/gviz/tq**", async (route) => {
    requests.push(route.request().method());
    await route.fulfill({
      contentType: "text/csv",
      body: '"version,","playerId","trainerName","wave","createdAt","seed","teamPower","teamJson","runSummaryJson"\n',
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
  await page.locator('input[name="enabled"]').check();
  await page.locator('select[name="mode"]').selectOption("publicCsv");
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
  await expect(page.locator("[data-sync-status]")).toContainText("Apps Script ready");

  await clickAction(page, '[data-action-id^="start:"]');
  await playUntilWave(page, 5);
  await expect(page.locator("[data-sync-status]")).toContainText("submitted");

  await clickAction(page, '[data-action-id="encounter:next"]');
  await expect(page.locator("[data-sync-status]")).toContainText(/No sheet trainer|ended/);
  expect(requests).toContain("GET");
  expect(requests).toContain("POST");
});

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

async function openFresh(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
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
