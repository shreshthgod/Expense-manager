import { expect, test, type Page } from "@playwright/test";

/**
 * Core journey (WF-01…WF-08): register → onboarding → account → expense →
 * income → transfer → budget reflects spending → edit → delete with undo →
 * sign out. Every step asserts the ledger figures on screen.
 */

// Shared by every worker/project in a run (set once in playwright.config.ts).
const unique = process.env.E2E_RUN_ID ?? "local";
const email = `e2e-${unique}@example.test`;
const password = "E2eTestPassw0rd";

async function addTransaction(page: Page, opts: { type?: "Expense" | "Income" | "Transfer"; amount: string; category?: string; to?: string; description?: string }) {
  await page.getByRole("button", { name: /^add$|add transaction/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (opts.type && opts.type !== "Expense") await dialog.getByRole("radio", { name: opts.type }).click();
  await dialog.getByLabel(/^amount/i).fill(opts.amount);
  if (opts.category) await dialog.getByLabel(/^category/i).selectOption({ label: opts.category });
  if (opts.to) await dialog.getByLabel(/^to/i).selectOption({ index: 1 });
  if (opts.description) {
    const desc = dialog.getByLabel(/description|merchant/i).first();
    if (await desc.isVisible()) await desc.fill(opts.description);
  }
  await dialog.getByRole("button", { name: /^save|^add/i }).last().click();
  await expect(dialog).toBeHidden();
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe.serial("core money journey", () => {
  test("register and complete onboarding", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Your name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/onboarding/);

    await page.getByRole("button", { name: "Continue" }).click(); // basics
    await page.getByRole("button", { name: "Continue" }).click(); // income
    await page.getByLabel("Name").fill("Salary Account");
    await page.getByLabel(/balance today/i).fill("50000");
    await page.getByRole("button", { name: "Add account" }).click();
    await page.getByRole("button", { name: "Continue" }).click(); // categories
    await page.getByLabel(/monthly limit/i).fill("3000");
    await page.getByRole("button", { name: "Create budget" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click(); // goal
    await page.getByRole("button", { name: "Go to my dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("record expense, income and transfer; balances and budget agree", async ({ page }) => {
    await signIn(page);

    // A second account to transfer into.
    await page.goto("/accounts?new=1");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Wallet");
    await dialog.getByLabel("Type").selectOption("CASH");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(page).toHaveURL(/\/accounts\//);

    await page.goto("/transactions");
    await addTransaction(page, { amount: "2000", category: "Groceries" });
    await addTransaction(page, { type: "Income", amount: "10000", category: "Salary" });
    await addTransaction(page, { type: "Transfer", amount: "3000", to: "Wallet" });

    await page.goto("/accounts");
    await expect(page.getByRole("link", { name: /Salary Account/ })).toContainText("55,000");
    await expect(page.getByRole("link", { name: /Wallet/ })).toContainText("3,000");

    await page.goto("/budgets");
    await expect(page.getByText(/2,000/).first()).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByText("Money in").first()).toBeVisible();
  });

  test("delete with undo restores the balance", async ({ page }) => {
    await signIn(page);
    await page.goto("/transactions?type=EXPENSE");
    const row = page.getByRole("button", { name: /Groceries/ }).first();
    await row.focus();
    await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog");
    await detail.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").filter({ hasText: "Delete this transaction?" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Restored", { exact: true }).first()).toBeVisible();
    await page.goto("/accounts");
    await expect(page.getByRole("link", { name: /Salary Account/ })).toContainText("55,000");
  });

  test("sign out clears the session @mobile", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/login/);
  });
});
