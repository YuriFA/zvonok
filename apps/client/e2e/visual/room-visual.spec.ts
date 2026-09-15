import { expect, test, type Page } from "@playwright/test";

/**
 * Visual regression over the dev-only harness route: production room
 * components rendered against a fake SFU connection. The browser's fake
 * video device animates, so <video> regions are masked; everything around
 * them - tile layout, labels, badges, controls, panels, alerts - is
 * compared pixel-for-pixel.
 */

const SCENES = ["prejoin", "grid-1", "grid-2", "grid-4", "grid-6", "spotlight", "alert-kicked"];

/**
 * Waits out every transient UI state (camera/mic acquisition, peer event
 * propagation) so the screenshot always captures the same settled scene.
 */
async function settle(page: Page, scene: string): Promise<void> {
  await page.goto(`/dev/visual?scene=${scene}`);
  await expect(page.getByTestId("visual-root")).toBeVisible();
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some((b) =>
          /starting/i.test(b.getAttribute("aria-label") ?? ""),
        ),
      undefined,
      { timeout: 20000 },
    )
    .catch(() => {
      // Scenes without capture controls (alerts) settle immediately.
    });
  await page.waitForTimeout(500);
}

test.describe("room visual states", () => {
  for (const scene of SCENES) {
    test(`${scene} matches baseline`, async ({ page }) => {
      await settle(page, scene);
      await expect(page).toHaveScreenshot(`${scene}.png`, {
        mask: [page.locator("video")],
      });
    });
  }

  test("participants panel matches baseline", async ({ page }) => {
    await settle(page, "grid-4");
    await page.getByRole("button", { name: "Toggle participants" }).click();
    await expect(page).toHaveScreenshot("panel-participants.png", {
      mask: [page.locator("video")],
    });
  });
});
