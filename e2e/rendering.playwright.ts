import { expect, test } from "@playwright/test";

test("confirms the mobile game-frame rendering path", async ({ page }) => {
  await page.goto("/");

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
