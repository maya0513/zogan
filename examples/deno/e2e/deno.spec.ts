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

test("clock Fragment is an opt-in one-shot HTML include", async ({ page }, testInfo) => {
  await page.goto("/");
  const clock = page.locator('[data-zogan-fragment="/fragments/clock"] time');
  if (testInfo.project.name === "chromium-no-js") {
    await expect(clock).toHaveText("Server time unavailable");
  } else {
    await expect(clock).not.toHaveText("Server time unavailable");
  }
});
