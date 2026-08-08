import { expect, test } from "@playwright/test";

test("presents the library and a usable quick start", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/zogan/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Keep the whole page");
  await expect(
    page.getByRole("heading", { name: "Four boundaries, one response model." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the quick start" })).toHaveAttribute(
    "href",
    "#quick-start",
  );

  const copyButton = page.getByRole("button", { name: "Copy install command" });
  await copyButton.click();
  await expect(copyButton).toHaveText("Copied");
});

test("mobile navigation exposes the page sections", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile navigation check");
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "Open navigation" });
  await toggle.click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveAttribute(
    "data-open",
    "true",
  );
  await page.getByRole("link", { name: "Model", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
