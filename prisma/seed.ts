/**
 * Demo data seed — SAFE BY DESIGN.
 *
 *  - Only the demo tenant (DEMO_EMAIL) is ever deleted/recreated. No other user
 *    or row is touched (v1 wiped every table — KNOWN_ISSUES B19).
 *  - Refuses to run when NODE_ENV=production unless ALLOW_DEMO_SEED=true is set
 *    explicitly (e.g. a public demo instance).
 *  - Deterministic (seeded PRNG), so the demo looks the same on every run.
 *  - Ledger-consistent: transactions are inserted, then every balance is
 *    rebuilt as openingBalance + Σ ledger effects — the same invariant the app
 *    enforces.
 *
 * Demo login: demo@expensemanager.in / Demo@1234
 */
import { PrismaClient, Prisma, type AccountType, type TransactionType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_CATEGORIES } from "../lib/constants/categories";
import { addDays, addMonthsClamped, makeISODate, parseISODate, todayISO, toDbDate, type ISODate } from "../lib/dates/date-only";

export const DEMO_EMAIL = "demo@expensemanager.in";
export const DEMO_PASSWORD = "Demo@1234";

const prisma = new PrismaClient();

function assertSafeToSeed() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    console.error("Refusing to seed: NODE_ENV=production. Set ALLOW_DEMO_SEED=true to create the demo tenant on purpose.");
    process.exit(1);
  }
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260927);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const between = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 100) / 100;

interface TxRow {
  type: TransactionType;
  amount: number;
  date: ISODate;
  account: string;
  destination?: string;
  category?: string;
  merchant?: string;
  description?: string;
  paymentMethod?: string;
  tags?: string[];
  status?: "PLANNED" | "POSTED";
  recurring?: string;
}

async function main() {
  assertSafeToSeed();
  const today = todayISO("Asia/Kolkata");
  console.log(`Seeding demo tenant ${DEMO_EMAIL} (today = ${today})…`);

  // Scoped cleanup: only the demo user (cascades to its own data).
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Aarav Sharma",
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      onboardedAt: new Date(),
      preference: { create: { currency: "INR", dateFormat: "DD MMM YYYY", monthStartDay: 1, weekStartsOn: 1 } },
      profile: {
        create: {
          timezone: "Asia/Kolkata",
          monthlyIncome: new Prisma.Decimal("78000"),
          occupation: "Software engineer",
          onboardingState: { completedSteps: ["preferences", "income", "account", "categories", "budget", "goal", "complete"] },
        },
      },
    },
  });
  const userId = user.id;

  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((t) => ({
      userId,
      name: t.name,
      icon: t.icon,
      color: t.color,
      type: t.type,
      isSystem: true,
      spendingClass: t.spendingClass,
      costBehavior: t.costBehavior,
    })),
  });
  const categories = await prisma.category.findMany({ where: { userId } });
  const cat = (name: string) => {
    const c = categories.find((x) => x.name === name);
    if (!c) throw new Error(`Missing category ${name}`);
    return c.id;
  };

  const start = addMonthsClamped(`${today.slice(0, 7)}-01`, -6, 1);
  const accountDefs: { key: string; name: string; type: AccountType; opening: number; institution?: string }[] = [
    { key: "salary", name: "SBI Salary Account", type: "BANK", opening: 42000, institution: "State Bank of India" },
    { key: "savings", name: "HDFC Savings", type: "SAVINGS", opening: 150000, institution: "HDFC Bank" },
    { key: "card", name: "HDFC Millennia Card", type: "CREDIT_CARD", opening: 0, institution: "HDFC Bank" },
    { key: "wallet", name: "PhonePe Wallet", type: "WALLET", opening: 1500 },
    { key: "cash", name: "Cash", type: "CASH", opening: 3000 },
    { key: "invest", name: "Mutual Funds", type: "INVESTMENT", opening: 85000, institution: "Groww" },
  ];
  const accounts = new Map<string, string>();
  for (const def of accountDefs) {
    const a = await prisma.account.create({
      data: {
        userId,
        name: def.name,
        type: def.type,
        openingBalance: new Prisma.Decimal(def.opening.toFixed(2)),
        balance: new Prisma.Decimal(def.opening.toFixed(2)),
        openingDate: toDbDate(start),
        currency: "INR",
        institution: def.institution ?? null,
      },
    });
    accounts.set(def.key, a.id);
  }
  await prisma.userPreference.update({ where: { userId }, data: { defaultAccountId: accounts.get("salary")! } });

  const rows: TxRow[] = [];
  const upto = (d: ISODate) => d <= today;

  for (let m = 0; m <= 6; m++) {
    const monthStart = addMonthsClamped(start, m, 1);
    const { year, month } = parseISODate(monthStart);
    const day = (d: number) => makeISODate(year, month, d);

    const salaryDay = day(1);
    if (upto(salaryDay)) {
      rows.push({ type: "INCOME", amount: 78000, date: salaryDay, account: "salary", category: "Salary", merchant: "Infosys Ltd", description: "Monthly salary", paymentMethod: "Net Banking", recurring: "salary" });
    }
    if (rand() > 0.35 && upto(day(18))) {
      rows.push({ type: "INCOME", amount: between(6000, 22000), date: day(18), account: "salary", category: "Freelance", merchant: "Upwork", description: "Design project", paymentMethod: "Net Banking", tags: ["Side project"] });
    }
    if (upto(day(3))) rows.push({ type: "EXPENSE", amount: 18000, date: day(3), account: "salary", category: "Rent", merchant: "Landlord - Mr. Iyer", description: "House rent", paymentMethod: "UPI", recurring: "rent" });
    if (upto(day(5))) rows.push({ type: "TRANSFER", amount: 25000, date: day(5), account: "salary", destination: "savings", description: "Monthly savings" });
    if (upto(day(10))) rows.push({ type: "TRANSFER", amount: 5000, date: day(10), account: "salary", destination: "invest", description: "SIP - Index fund", recurring: "sip" });
    if (upto(day(7))) rows.push({ type: "EXPENSE", amount: 649, date: day(7), account: "card", category: "Subscriptions", merchant: "Netflix", paymentMethod: "Credit Card", recurring: "netflix" });
    if (upto(day(12))) rows.push({ type: "EXPENSE", amount: between(1100, 2600), date: day(12), account: "salary", category: "Utilities", merchant: "BESCOM Electricity", paymentMethod: "UPI", recurring: "electricity" });
    if (upto(day(15))) rows.push({ type: "EXPENSE", amount: 799, date: day(15), account: "salary", category: "Bills", merchant: "ACT Fibernet", paymentMethod: "Net Banking" });

    for (let i = 0; i < 6; i++) {
      const d = day(1 + Math.floor(rand() * 27));
      if (!upto(d)) continue;
      rows.push({ type: "EXPENSE", amount: between(600, 3800), date: d, account: pick(["salary", "card"]), category: "Groceries", merchant: pick(["BigBasket", "Blinkit", "DMart", "Zepto", "Reliance Fresh"]), paymentMethod: pick(["UPI", "Credit Card"]) });
    }
    for (let i = 0; i < 9; i++) {
      const d = day(1 + Math.floor(rand() * 27));
      if (!upto(d)) continue;
      rows.push({ type: "EXPENSE", amount: between(160, 1300), date: d, account: pick(["card", "wallet", "cash"]), category: "Food", merchant: pick(["Swiggy", "Zomato", "Chai Point", "Truffles", "Third Wave Coffee"]), paymentMethod: pick(["UPI", "Credit Card", "Cash"]) });
    }
    for (let i = 0; i < 7; i++) {
      const d = day(1 + Math.floor(rand() * 27));
      if (!upto(d)) continue;
      rows.push({ type: "EXPENSE", amount: between(90, 900), date: d, account: pick(["wallet", "cash", "card"]), category: "Transport", merchant: pick(["Uber", "Ola", "Rapido", "Namma Metro", "Indian Oil"]), paymentMethod: pick(["UPI", "Cash"]) });
    }
    for (let i = 0; i < 2; i++) {
      const d = day(1 + Math.floor(rand() * 27));
      if (!upto(d)) continue;
      rows.push({ type: "EXPENSE", amount: between(700, 6500), date: d, account: "card", category: "Shopping", merchant: pick(["Amazon", "Myntra", "Decathlon", "Flipkart"]), paymentMethod: "Credit Card", tags: rand() > 0.7 ? ["Gifts"] : [] });
    }
    if (rand() > 0.5) {
      const d = day(1 + Math.floor(rand() * 27));
      if (upto(d)) rows.push({ type: "EXPENSE", amount: between(300, 2400), date: d, account: "salary", category: "Healthcare", merchant: pick(["Apollo Pharmacy", "Practo"]), paymentMethod: "UPI" });
    }
    if (rand() > 0.6) {
      const d = day(1 + Math.floor(rand() * 27));
      if (upto(d)) rows.push({ type: "EXPENSE", amount: between(400, 1800), date: d, account: "card", category: "Entertainment", merchant: pick(["PVR Cinemas", "BookMyShow"]), paymentMethod: "Credit Card" });
    }
    const atm = day(2);
    if (upto(atm)) rows.push({ type: "TRANSFER", amount: 3000, date: atm, account: "salary", destination: "cash", description: "ATM withdrawal" });
    const topUp = day(2);
    if (upto(topUp)) rows.push({ type: "TRANSFER", amount: 4000, date: topUp, account: "salary", destination: "wallet", description: "Wallet top-up" });
  }

  // A one-off large purchase (shows up as an unusual expense) and a trip.
  const bigDay = addDays(today, -9);
  rows.push({ type: "EXPENSE", amount: 42999, date: bigDay, account: "card", category: "Shopping", merchant: "Croma", description: "Laptop", paymentMethod: "Credit Card", tags: ["Work"] });
  rows.push({ type: "EXPENSE", amount: 8450, date: addDays(today, -40), account: "card", category: "Travel", merchant: "IndiGo", description: "Flight to Goa", paymentMethod: "Credit Card", tags: ["Vacation"] });

  // Pay the card in full each month for the previous month's card spend (a transfer, not an expense).
  for (let m = 1; m <= 6; m++) {
    const payDay = addMonthsClamped(start, m, 1).slice(0, 8) + "08";
    if (!upto(payDay)) continue;
    const prevStart = addMonthsClamped(start, m - 1, 1);
    const prevEnd = addMonthsClamped(start, m, 1);
    const owed = rows
      .filter((r) => r.account === "card" && r.type === "EXPENSE" && r.date >= prevStart && r.date < prevEnd)
      .reduce((a, r) => a + Math.round(r.amount * 100), 0) / 100;
    if (owed > 0) rows.push({ type: "TRANSFER", amount: owed, date: payDay, account: "salary", destination: "card", description: "Credit card bill payment" });
  }

  // A planned (future) entry: projections only, no balance effect.
  rows.push({ type: "EXPENSE", amount: 12500, date: addDays(today, 12), account: "salary", category: "Insurance", merchant: "HDFC Ergo", description: "Health insurance renewal", status: "PLANNED" });

  await prisma.transaction.createMany({
    data: rows.map((r) => ({
      userId,
      type: r.type,
      status: r.status ?? "POSTED",
      amount: new Prisma.Decimal(r.amount.toFixed(2)),
      transactionDate: toDbDate(r.date),
      accountId: accounts.get(r.account)!,
      destinationAccountId: r.destination ? accounts.get(r.destination)! : null,
      categoryId: r.category ? cat(r.category) : null,
      merchant: r.merchant ?? null,
      description: r.description ?? null,
      paymentMethod: r.paymentMethod ?? null,
      tags: r.tags ?? [],
      isRecurring: !!r.recurring,
    })),
  });

  // Ledger invariant: balance = opening + Σ effects (same SQL the app uses).
  await prisma.$executeRaw`
    UPDATE "Account" a SET "balance" = a."openingBalance" + COALESCE((
      SELECT SUM(CASE
        WHEN t."accountId" = a."id" AND t."type"::text = 'EXPENSE' THEN -t."amount"
        WHEN t."accountId" = a."id" AND t."type"::text IN ('INCOME','REFUND') THEN t."amount"
        WHEN t."accountId" = a."id" AND t."type"::text IN ('TRANSFER','ADJUSTMENT') THEN -t."amount"
        WHEN t."destinationAccountId" = a."id" AND t."type"::text IN ('TRANSFER','ADJUSTMENT') THEN t."amount"
        ELSE 0 END)
      FROM "Transaction" t
      WHERE t."userId" = ${userId} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL
        AND (t."accountId" = a."id" OR t."destinationAccountId" = a."id")
    ), 0)
    WHERE a."userId" = ${userId}`;

  // Recurring rules, bills and subscriptions (cursor = next occurrence ≥ today).
  const monthAnchor = (d: number) => makeISODate(parseISODate(start).year, parseISODate(start).month, d);
  const nextOn = (anchorDay: number) => {
    let d = makeISODate(parseISODate(today).year, parseISODate(today).month, anchorDay);
    if (d < today) d = addMonthsClamped(d, 1, anchorDay);
    return d;
  };
  const rules: { key: string; data: Prisma.RecurringTransactionUncheckedCreateInput }[] = [
    {
      key: "salary",
      data: { userId, kind: "STANDARD", name: "Salary", type: "INCOME", amount: new Prisma.Decimal("78000"), accountId: accounts.get("salary")!, categoryId: cat("Salary"), merchant: "Infosys Ltd", frequency: "MONTHLY", interval: 1, startDate: toDbDate(monthAnchor(1)), nextExecutionDate: toDbDate(nextOn(1)), autoCreate: false, reminderDaysBefore: 0 },
    },
    {
      key: "rent",
      data: { userId, kind: "BILL", name: "House rent", type: "EXPENSE", amount: new Prisma.Decimal("18000"), accountId: accounts.get("salary")!, categoryId: cat("Rent"), merchant: "Landlord - Mr. Iyer", frequency: "MONTHLY", interval: 1, startDate: toDbDate(monthAnchor(3)), nextExecutionDate: toDbDate(nextOn(3)), autoCreate: false, reminderDaysBefore: 3 },
    },
    {
      key: "electricity",
      data: { userId, kind: "BILL", name: "Electricity", type: "EXPENSE", amount: new Prisma.Decimal("1800"), accountId: accounts.get("salary")!, categoryId: cat("Utilities"), merchant: "BESCOM Electricity", frequency: "MONTHLY", interval: 1, startDate: toDbDate(monthAnchor(12)), nextExecutionDate: toDbDate(nextOn(12)), autoCreate: false, reminderDaysBefore: 5, notes: "Amount varies each month" },
    },
    {
      key: "netflix",
      data: { userId, kind: "SUBSCRIPTION", name: "Netflix", type: "EXPENSE", amount: new Prisma.Decimal("649"), accountId: accounts.get("card")!, categoryId: cat("Subscriptions"), merchant: "Netflix", frequency: "MONTHLY", interval: 1, startDate: toDbDate(monthAnchor(7)), nextExecutionDate: toDbDate(nextOn(7)), autoCreate: true, autopay: true, reminderDaysBefore: 2 },
    },
    {
      key: "spotify",
      data: { userId, kind: "SUBSCRIPTION", name: "Spotify", type: "EXPENSE", amount: new Prisma.Decimal("1189"), accountId: accounts.get("card")!, categoryId: cat("Subscriptions"), merchant: "Spotify", frequency: "YEARLY", interval: 1, startDate: toDbDate(addDays(today, 20)), nextExecutionDate: toDbDate(addDays(today, 20)), autoCreate: true, autopay: true, reminderDaysBefore: 7 },
    },
    {
      key: "sip",
      data: { userId, kind: "STANDARD", name: "Index fund SIP", type: "TRANSFER", amount: new Prisma.Decimal("5000"), accountId: accounts.get("salary")!, destinationAccountId: accounts.get("invest")!, frequency: "MONTHLY", interval: 1, startDate: toDbDate(monthAnchor(10)), nextExecutionDate: toDbDate(nextOn(10)), autoCreate: true, reminderDaysBefore: 1 },
    },
  ];
  for (const rule of rules) {
    const created = await prisma.recurringTransaction.create({ data: rule.data });
    // Link past transactions of this rule as RECORDED occurrences.
    const past = await prisma.transaction.findMany({
      where: {
        userId,
        isRecurring: true,
        ...(rule.data.merchant ? { merchant: rule.data.merchant } : { description: "SIP - Index fund" }),
        ...(rule.key === "sip" ? { type: "TRANSFER" } : {}),
      },
    });
    for (const t of past) {
      await prisma.transaction.update({ where: { id: t.id }, data: { recurringTransactionId: created.id } });
      await prisma.recurringOccurrence.create({
        data: {
          userId,
          recurringId: created.id,
          dueDate: t.transactionDate,
          amount: t.amount,
          status: "RECORDED",
          transactionId: t.id,
          resolvedAt: new Date(),
        },
      });
    }
  }

  const monthStart = `${today.slice(0, 7)}-01`;
  await prisma.budget.createMany({
    data: [
      { userId, name: "Monthly spending", amount: new Prisma.Decimal("45000"), period: "MONTHLY", startDate: toDbDate(start), categoryId: null },
      { userId, name: "Food & dining", amount: new Prisma.Decimal("6000"), period: "MONTHLY", startDate: toDbDate(start), categoryId: cat("Food") },
      { userId, name: "Groceries", amount: new Prisma.Decimal("12000"), period: "MONTHLY", startDate: toDbDate(start), categoryId: cat("Groceries") },
      { userId, name: "Transport", amount: new Prisma.Decimal("3500"), period: "MONTHLY", startDate: toDbDate(start), categoryId: cat("Transport") },
      { userId, name: "Weekend fun", amount: new Prisma.Decimal("1500"), period: "WEEKLY", startDate: toDbDate(monthStart), categoryId: cat("Entertainment") },
    ],
  });

  // Goals keep a contribution ledger: currentAmount = Σ contributions.
  const goalDefs = [
    { name: "Emergency fund", kind: "EMERGENCY_FUND" as const, target: 300000, category: "Emergency Fund", deadline: addMonthsClamped(today, 10), accountId: accounts.get("savings")!, monthly: 10000,
      contributions: [[-5, 120000], [-3, 10000], [-2, 10000], [-1, 10000]] as [number, number][] },
    { name: "Goa trip", kind: "SAVINGS" as const, target: 40000, category: "Vacation", deadline: addMonthsClamped(today, 3), accountId: null, monthly: 5000,
      contributions: [[-4, 5000], [-2, 4000], [-1, 3500]] as [number, number][] },
    { name: "Car insurance", kind: "SINKING_FUND" as const, target: 18000, category: "Insurance", deadline: addMonthsClamped(today, 5), accountId: null, monthly: 1500,
      contributions: [[-3, 1500], [-2, 1500], [-1, 1500]] as [number, number][], repeatsYearly: true },
    { name: "New phone", kind: "SAVINGS" as const, target: 60000, category: "Electronics", deadline: null, accountId: null, monthly: null,
      contributions: [[-2, 8000]] as [number, number][], description: "No rush" },
  ];
  for (const g of goalDefs) {
    const total = g.contributions.reduce((sum, [, amount]) => sum + amount, 0);
    const goal = await prisma.savingsGoal.create({
      data: {
        userId,
        name: g.name,
        kind: g.kind,
        targetAmount: new Prisma.Decimal(g.target.toFixed(2)),
        currentAmount: new Prisma.Decimal(total.toFixed(2)),
        category: g.category,
        deadline: g.deadline ? toDbDate(g.deadline) : null,
        accountId: g.accountId,
        monthlyContribution: g.monthly != null ? new Prisma.Decimal(g.monthly.toFixed(2)) : null,
        repeatsYearly: g.repeatsYearly ?? false,
        description: g.description ?? null,
      },
    });
    await prisma.goalContribution.createMany({
      data: g.contributions.map(([monthOffset, amount]) => ({
        userId,
        goalId: goal.id,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        date: toDbDate(addMonthsClamped(monthStart, monthOffset, 1)),
        note: monthOffset === g.contributions[0][0] && amount > 20000 ? "Already saved" : null,
      })),
    });
  }

  // Credit card details for statements and utilisation.
  await prisma.account.update({
    where: { id: accounts.get("card")! },
    data: { creditLimit: new Prisma.Decimal("150000"), statementDay: 12, paymentDueDay: 2, maskedNumber: "4821" },
  });
  await prisma.budget.updateMany({ where: { userId, name: "Food & dining" }, data: { rolloverMode: "POSITIVE_ONLY" } });

  const counts = await prisma.transaction.count({ where: { userId } });
  const balances = await prisma.account.findMany({ where: { userId }, select: { name: true, balance: true } });
  console.log(`  Transactions: ${counts}`);
  for (const b of balances) console.log(`  ${b.name.padEnd(22)} ${b.balance.toFixed(2)}`);
  console.log(`Done. Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
