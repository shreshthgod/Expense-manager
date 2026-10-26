import { describe, it, expect } from "vitest";
import { call, newActor, type Actor } from "../helpers/api";
import * as accountsRoute from "@/app/api/accounts/route";
import * as txRoute from "@/app/api/transactions/route";
import * as txIdRoute from "@/app/api/transactions/[id]/route";
import * as categoriesRoute from "@/app/api/categories/route";
import * as importRoute from "@/app/api/import/route";
import * as confirmRoute from "@/app/api/import/[id]/confirm/route";
import * as undoRoute from "@/app/api/import/[id]/undo/route";
import * as recRoute from "@/app/api/reconciliations/route";
import * as recCompleteRoute from "@/app/api/reconciliations/[id]/complete/route";
import * as attachRoute from "@/app/api/transactions/[id]/attachments/route";
import * as attachmentRoute from "@/app/api/attachments/[id]/route";
import { verifyLedger } from "@/server/services/account.service";
import { addDays, todayISO } from "@/lib/dates/date-only";
import { detectMapping } from "@/lib/import/presets";
import { cookieStore } from "../helpers/cookies";

const today = todayISO("Asia/Kolkata");
const d = (n: number) => addDays(today, -n);
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

async function setup(name: string) {
  const a = await newActor(name);
  const bank = (await call(accountsRoute.POST, "POST", "/x", { as: a, body: { name: "Bank", type: "BANK", openingBalance: 10000 } })).body.data.id as string;
  const card = (await call(accountsRoute.POST, "POST", "/x", { as: a, body: { name: "Card", type: "CREDIT_CARD", openingBalance: -2000 } })).body.data.id as string;
  const cats = (await call(categoriesRoute.GET, "GET", "/x", { as: a })).body.data as { id: string; name: string }[];
  return { a, bank, card, cat: (n: string) => cats.find((c) => c.name === n)!.id };
}

async function balance(a: Actor, name: string) {
  const res = await call(accountsRoute.GET, "GET", "/x", { as: a });
  return res.body.data.accounts.find((x: { name: string }) => x.name === name).balance as number;
}

const headers = ["Date", "Description", "Debit", "Credit", "Category"];
const mapping = { ...detectMapping(headers), dateFormat: "DD/MM/YYYY" as const };

describe("statement import", () => {
  it("validates rows, flags duplicates, applies decisions, is retry-safe and undoable", async () => {
    const { a, bank, card, cat } = await setup("Import");
    // Existing transaction that the file also contains.
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 450, transactionDate: d(2), accountId: bank, categoryId: cat("Food"), merchant: "SWIGGY" } });
    const rows = [
      [dmy(d(2)), "UPI/1/SWIGGY/food", "450.00", "", "Food"], // 0 likely duplicate of existing
      [dmy(d(3)), "SALARY SEP", "", "50,000.00", "Salary"], // 1 income
      [dmy(d(4)), "Coffee beans", "300", "", "Unknown Cat"], // 2 unknown category → uncategorised
      ["31/02/2026", "Bad date", "100", "", ""], // 3 malformed date
      [dmy(d(5)), "Bad amount", "abc", "", ""], // 4 invalid amount
      [dmy(d(6)), "CARD PAYMENT", "2,000.00", "", ""], // 5 will be classified as a transfer to the card
      [dmy(d(3)), "SALARY SEP", "", "50,000.00", "Salary"], // 6 duplicate within the file
    ];
    const preview = await call(importRoute.POST, "POST", "/x", {
      as: a,
      body: { accountId: bank, fileName: "sep.csv", fileHash: "abcdef0123456789", mapping, headers, rows },
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    const job = preview.body.data;
    const r = job.rows as { rowIndex: number; errors: string[]; duplicate: { level: string }; categoryId: string | null; defaultAction: string; warnings: string[] }[];
    expect(r[0]!.duplicate.level).toBe("likely");
    expect(r[0]!.defaultAction).toBe("skip");
    expect(r[1]!.categoryId).toBe(cat("Salary"));
    expect(r[2]!.categoryId).toBeNull();
    expect(r[2]!.warnings[0]).toMatch(/not found/);
    expect(r[3]!.errors[0]).toMatch(/Unrecognised date/);
    expect(r[4]!.errors[0]).toMatch(/Invalid amount|No debit/);
    expect(r[6]!.duplicate.level).not.toBe("unique");
    expect(await balance(a, "Bank")).toBe(10000 - 450); // preview never touches the ledger

    const decisions = [
      { rowIndex: 0, action: "skip" },
      { rowIndex: 1, action: "import" },
      { rowIndex: 2, action: "import", categoryId: cat("Groceries") },
      { rowIndex: 3, action: "import" },
      { rowIndex: 4, action: "skip" },
      { rowIndex: 5, action: "import", transferAccountId: card },
      { rowIndex: 6, action: "skip" },
    ];
    const [c1, c2] = await Promise.all([
      call(confirmRoute.POST, "POST", "/x", { as: a, params: { id: job.id }, body: { decisions } }),
      call(confirmRoute.POST, "POST", "/x", { as: a, params: { id: job.id }, body: { decisions } }),
    ]);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    const final = c1.body.data.status === "PROCESSING" ? c2.body.data : c1.body.data;
    expect(final.importedCount).toBe(3);
    expect(final.status).toBe("PARTIAL"); // row 3 was rejected (bad date)
    // Retrying after completion changes nothing.
    await call(confirmRoute.POST, "POST", "/x", { as: a, params: { id: job.id }, body: { decisions } });
    expect(await balance(a, "Bank")).toBe(10000 - 450 + 50000 - 300 - 2000);
    expect(await balance(a, "Card")).toBe(0); // transfer paid the card, not an expense
    expect(await verifyLedger(a.userId)).toEqual([]);

    const undo = await call(undoRoute.POST, "POST", "/x", { as: a, params: { id: job.id } });
    expect(undo.body.data.deleted).toBe(3);
    expect(await balance(a, "Bank")).toBe(10000 - 450);
    expect(await balance(a, "Card")).toBe(-2000);
    expect(await verifyLedger(a.userId)).toEqual([]);
  });

  it("imports a large file (2,000 rows) in chunks", async () => {
    const { a, bank } = await setup("Large import");
    const rows = Array.from({ length: 2000 }, (_, i) => [dmy(d(i % 60)), `Item ${i}`, "10.00", "", ""]);
    const preview = await call(importRoute.POST, "POST", "/x", { as: a, body: { accountId: bank, fileName: "big.csv", fileHash: "bigfile-hash-000", mapping, headers, rows } });
    expect(preview.status).toBe(201);
    const confirm = await call(confirmRoute.POST, "POST", "/x", {
      as: a,
      params: { id: preview.body.data.id },
      body: { decisions: rows.map((_, i) => ({ rowIndex: i, action: "import" })) },
    });
    expect(confirm.body.data.importedCount).toBe(2000);
    expect(await balance(a, "Bank")).toBe(10000 - 20000);
  }, 120_000);

  it("rejects an unknown account", async () => {
    const { a } = await setup("Unknown account");
    const res = await call(importRoute.POST, "POST", "/x", {
      as: a,
      body: { accountId: "clx0000000000000000000000", fileName: "x.csv", fileHash: "abcdef0123456789", mapping, headers, rows: [[dmy(today), "x", "1", "", ""]] },
    });
    expect(res.status).toBe(400);
  });
});

describe("reconciliation", () => {
  it("compares the statement with the balance AS OF its date and reopens on later edits", async () => {
    const { a, bank, cat } = await setup("Reconcile");
    const t1 = (await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 1000, transactionDate: d(10), accountId: bank, categoryId: cat("Food") } })).body.data;
    // A later transaction must NOT affect a statement dated before it.
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 500, transactionDate: d(1), accountId: bank, categoryId: cat("Food") } });

    const start = await call(recRoute.POST, "POST", "/x", { as: a, body: { accountId: bank, statementDate: d(5), statementBalance: 8900 } });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    expect(start.body.data).toMatchObject({ appBalance: 9000, difference: -100 });
    expect(start.body.data.unreconciled).toHaveLength(1);

    const blocked = await call(recCompleteRoute.POST, "POST", "/x", { as: a, params: { id: start.body.data.id }, body: {} });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error?.code).toBe("DIFFERENCE_REMAINS");

    const done = await call(recCompleteRoute.POST, "POST", "/x", { as: a, params: { id: start.body.data.id }, body: { createAdjustment: true, reason: "Bank charges" } });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data.status).toBe("COMPLETED");
    expect(await balance(a, "Bank")).toBe(10000 - 1000 - 500 - 100);

    // Editing a reconciled transaction requires explicit confirmation, then reopens.
    const cur = (await call(txIdRoute.GET, "GET", "/x", { as: a, params: { id: t1.id } })).body.data;
    expect(cur.reconciled).toBe(true);
    const guarded = await call(txIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id: t1.id }, body: { version: cur.version, amount: 1200 } });
    expect(guarded.status).toBe(409);
    expect(guarded.body.error?.code).toBe("RECONCILED_CHANGE");
    const edited = await call(txIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id: t1.id }, body: { version: cur.version, amount: 1200, confirmReconciledChange: true } });
    expect(edited.status).toBe(200);
    expect(edited.body.data.warnings[0]).toMatch(/reopened/);
    const list = await call(recRoute.GET, "GET", "/x", { as: a, query: { accountId: bank } });
    expect(list.body.data[0].status).toBe("REOPENED");
    expect(await verifyLedger(a.userId)).toEqual([]);
  });
});

describe("attachments", () => {
  async function upload(a: Actor, txId: string, bytes: Uint8Array, name: string) {
    const form = new FormData();
    form.set("file", new File([bytes as BlobPart], name, { type: "image/png" }));
    const previous = cookieStore.active();
    cookieStore.use(a.jar);
    try {
      const request = new Request(`http://localhost:3000/api/transactions/${txId}/attachments`, { method: "POST", body: form, headers: { host: "localhost:3000" } });
      const res = await attachRoute.POST(request, { params: { id: txId } });
      return { status: res.status, body: await res.json() };
    } finally {
      cookieStore.use(previous);
    }
  }

  it("accepts real images/PDFs by content, rejects disguised files, and is owner-only", async () => {
    const { a, bank, cat } = await setup("Attachments");
    const tx = (await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 99, transactionDate: today, accountId: bank, categoryId: cat("Food") } })).body.data;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
    const ok = await upload(a, tx.id, png, "receipt.png");
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data).toMatchObject({ contentType: "image/png", fileName: "receipt.png" });

    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const bad = await upload(a, tx.id, html, "evil.png");
    expect(bad.status).toBe(400);

    const download = await call(attachmentRoute.GET, "GET", "/x", { as: a, params: { id: ok.body.data.id } });
    expect(download.status).toBe(200);
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("content-security-policy")).toContain("sandbox");

    const other = await newActor("Snoop");
    expect((await call(attachmentRoute.GET, "GET", "/x", { as: other, params: { id: ok.body.data.id } })).status).toBe(404);
    expect((await upload(other, tx.id, png, "x.png")).status).toBe(404);
    expect((await call(attachmentRoute.DELETE, "DELETE", "/x", { as: a, params: { id: ok.body.data.id } })).status).toBe(200);
  });
});
