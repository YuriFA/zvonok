import { expect, test, type Page } from "@playwright/test";

/** Waits for fonts, animations, and the fake media pipeline to settle. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

test.describe("widget visual baselines", () => {
  test("widget prejoin card", async ({ page }) => {
    await page.goto("/dev/widget");
    await expect(page.getByText("Join room")).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("widget-prejoin.png");
  });
});
