import { expect, test } from "@playwright/test";

test("presents the library and a usable quick start", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/zogan/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Render the page");
  await expect(
    page.getByRole("heading", { name: "Four explicit boundaries. Nothing hidden." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the quick start" })).toHaveAttribute(
    "href",
    "#quick-start",
  );

  const copyButton = page.getByRole("button", { name: "Copy install command" });
  await expect(copyButton).toHaveAttribute("data-copy", "pnpm add zogan hono preact");
  await copyButton.click();
  await expect(copyButton).toHaveText("Copied");
});

test("defaults to the English page and links to Japanese", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(/explicit HTML responses/);
  await expect(page.getByRole("link", { name: "日本語" })).toHaveAttribute("href", "./ja/");
});

test("provides the Japanese page with a link back to English", async ({ page }) => {
  await page.goto("/ja/");

  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page).toHaveTitle(/HonoとPreact/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ページを描画する");
  await expect(page.getByRole("link", { name: "English" }).first()).toHaveAttribute("href", "../");
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
