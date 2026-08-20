import { expect, test } from "@playwright/test";

test.describe("JavaScript-enhanced flow", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName === "chromium" && testInfo.project.name === "chromium-no-js",
      "enhanced flow needs JavaScript",
    );
  });

  test("uses native filtering, links, and browser history", async ({ page }) => {
    await page.goto("/products");
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator(".product-card")).toHaveCount(2);
    await page.goBack();

    await page.getByLabel("Category").selectOption("home");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/category=home/);
    await expect(page.locator(".product-card")).toHaveCount(2);

    await page.getByRole("heading", { name: "Desk Lamp" }).click();
    await expect(page).toHaveURL(/\/products\/desk-lamp$/);
    await expect(page.getByRole("heading", { level: 1, name: "Desk Lamp" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/category=home/);
    await page.goForward();
    await expect(page).toHaveURL(/\/products\/desk-lamp$/);
  });

  test("enhances add-to-cart through JSON and refreshes only the badge fragment", async ({
    page,
  }) => {
    await page.goto("/products/desk-lamp");
    await expect(page.locator(".cart-badge span")).toHaveText("0");

    await page.getByRole("button", { name: "Add one" }).click();
    await expect(page).toHaveURL(/\/products\/desk-lamp$/);
    await expect(page.locator(".cart-badge span")).toHaveText("1");

    await page.locator(".cart-badge").click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByText("Desk Lamp × 1")).toBeVisible();
  });

  test("native GET and POST forms preserve browser semantics", async ({ page }) => {
    await page.goto("/forms");
    await page.getByRole("button", { name: "Preview values" }).click();
    await expect(page).toHaveURL(/action=base/);
    await expect(page.locator("output")).toHaveText("base | preview | linen | home");

    await page.getByRole("button", { name: "Exercise native fallback" }).click();
    await expect(page.getByText("native fallback: fallback")).toBeVisible();
  });

  test("does not fetch an Island chunk when the document has no matching marker", async ({
    page,
  }) => {
    const islandRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.includes("AddToCart")) islandRequests.push(pathname);
    });

    await page.goto("/forms");
    await expect(page.locator(".cart-badge span")).toHaveText("0");

    expect(islandRequests).toEqual([]);
  });
});

test.describe("JavaScript-disabled flow", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName === "chromium" && testInfo.project.name !== "chromium-no-js",
      "native flow disables JavaScript",
    );
  });

  test("add-to-cart form follows POST/Redirect/GET", async ({ page }) => {
    await page.goto("/products/linen-tote");
    await page.getByRole("button", { name: "Add one" }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByText("Linen Tote × 1")).toBeVisible();

    await page.getByRole("button", { name: "Place demo order" }).click();
    await expect(page).toHaveURL(/\/orders\//);
    await expect(page.getByRole("heading", { name: "Thank you." })).toBeVisible();
  });
});
