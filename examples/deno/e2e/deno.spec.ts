import { expect, test } from "@playwright/test";

test("pagination performs ordinary document navigation with or without JavaScript", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Page 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Next" })).not.toHaveAttribute("data-partial");
  const initialDocument = await page.evaluate(() => performance.timeOrigin);

  await page.getByRole("link", { name: "Next" }).click();

  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("heading", { name: "Page 2" })).toBeVisible();
  await expect(page.getByText("Confirmed page: 2")).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(initialDocument);
});

test("RefreshClock Island refreshes the explicit clock FragmentSlot", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "chromium-no-js", "Island activation requires JavaScript");

  await page.goto("/");
  const clock = page.locator('[data-zogan-fragment="/fragments/clock"] time');
  await expect(clock).toHaveText("Waiting for a refresh");

  const refresh = page.getByRole("button", { name: "Refresh server time" });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(clock).not.toHaveText("Waiting for a refresh");
  const first = await clock.textContent();

  await page.waitForTimeout(10);
  await refresh.click();
  await expect.poll(() => clock.textContent()).not.toBe(first);
});
