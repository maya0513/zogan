import { expect, test } from "@playwright/test";

test("partial navigation and islands work", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "chromium-no-js", "requires JavaScript");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Page 1" })).toBeVisible();
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("heading", { name: "Page 2" })).toBeVisible();
  await expect(page.getByText("Confirmed page: 2")).toBeVisible();

  await page.getByRole("button", { name: "Refresh server time" }).click();
  await expect(page.locator('[data-island="Clock"] time')).not.toContainText("Waiting");
});

test("native navigation works without JavaScript", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-no-js", "covers the no-JavaScript path");

  await page.goto("/");
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("heading", { name: "Page 2" })).toBeVisible();
  await expect(page.getByText("Confirmed page: 2")).toBeVisible();
});
