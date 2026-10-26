import { expect, test } from "@playwright/test";

/**
 * Every navigable page renders with the seeded demo data, without runtime
 * errors, failed API calls or Content-Security-Policy violations.
 * Requires `npm run db:seed` (demo@expensemanager.in).
 */

const PAGES = [
  "/dashboard", "/inbox", "/calendar", "/transactions", "/income", "/accounts", "/bills", "/subscriptions", "/recurring",
  "/import", "/budgets", "/goals", "/net-worth", "/cash-flow", "/analytics", "/review", "/reports", "/assistant",
  "/notifications", "/settings", "/settings?tab=money", "/settings?tab=categories", "/settings?tab=automation",
  "/settings?tab=notifications", "/settings?tab=appearance", "/settings?tab=security", "/settings?tab=data",
];

test("every page renders cleanly for the demo user", async ({ page }) => {
  test.setTimeout(Number(process.env.E2E_PAGES_TIMEOUT ?? 240_000));
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror ${page.url()}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console ${page.url()}: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@expensemanager.in");
  await page.getByLabel("Password").fill("Demo@1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  for (const path of PAGES) {
    // In `next dev`, compiling a new route can trigger a Fast Refresh reload that
    // aborts the navigation; retry once so only real errors fail the sweep.
    await page.goto(path).catch(async () => {
      await page.waitForTimeout(1500);
      await page.goto(path);
    });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Couldn't load this")).toHaveCount(0);
  }

  // Detail pages reached through the UI.
  await page.goto("/accounts");
  await page.getByRole("link", { name: /HDFC Millennia Card/ }).click();
  await expect(page.getByText("Card statement")).toBeVisible();
  await page.goto("/recurring");
  await page.locator('a[href^="/recurring/"]').first().click();
  await expect(page.getByText("History")).toBeVisible();

  expect(problems, problems.join("\n")).toEqual([]);
});
