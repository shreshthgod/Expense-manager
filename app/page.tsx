import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FEATURES: { title: string; body: string }[] = [
  { title: "Accounts that add up", body: "Bank, cash, wallets, cards and loans. Balances are rebuilt from an opening balance and every posted entry, so they can be checked and reconciled against statements." },
  { title: "Budgets with pace", body: "Weekly, monthly, yearly or custom limits, per category or overall, with rollover. See when you're spending faster than time is passing." },
  { title: "Bills and subscriptions", body: "Reminders before due dates, one tap to mark paid, and the true yearly cost of every subscription." },
  { title: "Cash-flow forecast", body: "Your cash day by day for the next weeks, a safe-to-spend figure with its working shown, and what-if scenarios." },
  { title: "Statement import", body: "Bring in CSV statements from your bank. Every row is reviewed, duplicates are flagged, and an import can be undone." },
  { title: "Reports and an assistant", body: "Monthly reviews and printable reports. Ask questions in plain words — answers are computed from your records, never guessed." },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.onboardedAt ? "/dashboard" : "/onboarding");
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 7h14M5 12h10M5 17h6" /></svg>
          </span>
          Expense Manager
        </span>
        <nav className="flex items-center gap-2 text-sm" aria-label="Account">
          <Link href="/login" className="rounded-md px-3 py-2 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sign in</Link>
          <Link href="/register" className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Create account</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
          <div>
            <h1 className="max-w-xl text-4xl font-semibold leading-[1.1] sm:text-5xl">A personal ledger that always balances.</h1>
            <p className="mt-5 max-w-lg text-lg text-muted-foreground">
              Record what comes in and goes out across all your accounts. Budgets, bills, goals and reports are calculated from those records — nothing is estimated behind your back.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">Start your ledger</Link>
              <Link href="/login" className="rounded-md border bg-card px-5 py-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">I have an account</Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Free to use. No bank passwords, ever — you record entries or import statements you download.</p>
          </div>

          <figure className="rounded-2xl border bg-card p-6 shadow-sm" aria-labelledby="example-caption">
            <figcaption id="example-caption" className="mb-4 text-xs font-medium text-muted-foreground">Example month (illustration)</figcaption>
            <dl className="space-y-3 text-sm">
              {[
                ["Opening balance", "₹42,000", ""],
                ["Salary", "₹85,000", "in"],
                ["Rent", "₹22,000", "out"],
                ["Groceries & food", "₹14,300", "out"],
                ["Refund from a return", "₹1,200", "in"],
                ["Moved to savings", "₹20,000", "out"],
              ].map(([label, amount, dir]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 border-b border-dashed pb-2">
                  <dt>{label}</dt>
                  <dd className={`num font-medium ${dir === "in" ? "text-inflow" : dir === "out" ? "text-outflow" : ""}`}>
                    {dir === "in" ? "+" : dir === "out" ? "−" : ""}
                    {amount}
                  </dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-4 pt-1 text-base font-semibold">
                <dt>Bank balance</dt>
                <dd className="num">₹71,900</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              The ₹20,000 moved to savings isn't spending — it's still yours. The refund reduces spending on the day it arrives.
            </p>
          </figure>
        </section>

        <section className="border-t bg-card/50" aria-labelledby="features-title">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="features-title" className="max-w-xl text-2xl font-semibold">What it does</h2>
            <dl className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title}>
                  <dt className="font-semibold">{f.title}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-8 text-xs text-muted-foreground sm:px-6">
        <span>Expense Manager</span>
        <span>Informational tool — not financial advice.</span>
      </footer>
    </div>
  );
}
