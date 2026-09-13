import { readFileSync } from "node:fs";

import { type Page } from "@playwright/test";

import { test, expect } from "./fixtures/auth.fixture";
import { API_BASE_URL } from "./utils/test-data";

/**
 * Rooms can only be created by HOST/ADMIN accounts (POST /rooms requires
 * Role.HOST|ADMIN, new registrations default to USER), so the host side of
 * these tests signs in with the seeded admin from the server env.
 */
function adminCredentials(): { email: string; password: string } {
  const env = readFileSync("../../apps/server/.env.development", "utf8");
  const email = env.match(/ADMIN_EMAIL=(.+)/)?.[1]?.trim() as string;
  const password = env.match(/ADMIN_PASSWORD=(.+)/)?.[1]?.trim() as string;
  return { email, password };
}

async function loginAdmin(page: Page) {
  const { email, password } = adminCredentials();
  const response = await page.request.post(`${API_BASE_URL}/auth/login`, {
    data: { email, password },
  });
  expect(response.ok()).toBeTruthy();
}

async function createRoomViaUi(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a new room" }).click();
  await expect(page).toHaveURL(/\/room\/[^/]+$/, { timeout: 15_000 });
  return page.url().split("/").pop() as string;
}

async function joinFrom(page: Page, slug: string, name: string | null, awaitEntry = true) {
  await page.goto(`/room/${slug}`);
  const nameInput = page.getByPlaceholder("Your name");
  await nameInput.waitFor({ state: "visible", timeout: 15_000 });
  if (name !== null) {
    await nameInput.fill(name);
  }
  await page.getByRole("button", { name: "Join Room" }).click();
  if (awaitEntry) {
    await page.getByRole("button", { name: "Turn off microphone" }).waitFor({
      state: "visible",
      timeout: 20_000,
    });
  }
}

test.describe("Participant departure", () => {
  test("guest leaving the call is removed from the host list", async ({ page, browser }) => {
    await loginAdmin(page);
    const slug = await createRoomViaUi(page);
    await joinFrom(page, slug, null);
    await page.getByRole("button", { name: "Toggle participants" }).click();

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await joinFrom(guestPage, slug, "GuestTester", false);
    // The owner must approve the guest's join request before they enter.
    await page.getByRole("button", { name: "Accept" }).click({ timeout: 15_000 });
    await guestPage.getByRole("button", { name: "Turn off microphone" }).waitFor({
      state: "visible",
      timeout: 20_000,
    });

    // Sync point: host sees the guest.
    const hostList = page.getByRole("list", { name: "Participants list" });
    await expect(hostList).toContainText("GuestTester", { timeout: 15_000 });

    await guestPage.getByRole("link", { name: "Leave room" }).click();

    await expect(hostList).not.toContainText("GuestTester", { timeout: 15_000 });
  });

  test("guest hard disconnect is removed after the rejoin grace window", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await loginAdmin(page);
    const slug = await createRoomViaUi(page);
    await joinFrom(page, slug, null);
    await page.getByRole("button", { name: "Toggle participants" }).click();

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await joinFrom(guestPage, slug, "GuestTester", false);
    await page.getByRole("button", { name: "Accept" }).click({ timeout: 15_000 });
    await guestPage.getByRole("button", { name: "Turn off microphone" }).waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const hostList = page.getByRole("list", { name: "Participants list" });
    await expect(hostList).toContainText("GuestTester", { timeout: 15_000 });
    // Hard disconnect: the guest closes the tab without leaving gracefully.
    // Spec (openspec/specs/sfu): the seat is held for a 30s rejoin grace
    // window with no departure events; the leave flow runs on expiry.
    await guestContext.close();

    // The ghost row is flagged disconnected for the rest of the grace window.
    await expect(page.getByRole("listitem", { name: /Participant GuestTester/ })).toContainText(
      "Disconnected",
      { timeout: 15_000 },
    );

    await expect(hostList).not.toContainText("GuestTester", { timeout: 45_000 });
  });
});
