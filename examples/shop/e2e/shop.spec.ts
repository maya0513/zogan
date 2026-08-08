import { expect, test } from "@playwright/test";

test.describe("JavaScript-enhanced flow", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName === "chromium" && testInfo.project.name === "chromium-no-js",
      "enhanced flow needs JavaScript",
    );
  });

  test("partial filtering, history, optimistic cart, and checkout", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "startViewTransition", {
        value: undefined,
        configurable: true,
      });
    });
    await page.goto("/products");
    await page.getByLabel("Category").selectOption("home");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/category=home/);
    await expect(page.locator(".product-card")).toHaveCount(2);
    await expect(page.locator(".result-count")).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    await page.getByRole("heading", { name: "Desk Lamp" }).click();
    await expect(page.getByRole("heading", { name: "Desk Lamp", level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/category=home/);
    await page.goForward();
    await page.getByRole("button", { name: "Add one" }).click();
    await expect(page.locator(".cart-badge span")).toHaveText("1");
    await page.locator(".cart-badge").click();
    await expect(page.getByText("Desk Lamp × 1")).toBeVisible();
    await page.getByRole("button", { name: "Place demo order" }).click();
    await expect(page.getByRole("heading", { name: "Thank you." })).toBeVisible();
  });

  test("submitter and duplicate values survive GET forms; invalid HTML falls back natively", async ({
    page,
  }) => {
    await page.goto("/forms");
    await page.getByRole("button", { name: "Preview values" }).click();
    await expect(page.locator("output")).toHaveText("base | preview | linen | home");
    await expect(page.locator("[data-form-result]")).toBeFocused();
    await page.getByRole("button", { name: "Exercise native fallback" }).click();
    await expect(page.getByText("native fallback: fallback")).toBeVisible();
  });
});

test.describe("native flow", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName === "chromium" && testInfo.project.name !== "chromium-no-js",
      "native flow disables JavaScript",
    );
  });

  test("browse, add to cart, and complete the demo order", async ({ page }) => {
    await page.goto("/products/linen-tote");
    await page.getByRole("button", { name: "Add one" }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByText("Linen Tote × 1")).toBeVisible();
    await page.getByRole("button", { name: "Place demo order" }).click();
    await expect(page.getByRole("heading", { name: "Thank you." })).toBeVisible();
  });
});
