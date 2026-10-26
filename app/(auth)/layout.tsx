import Link from "next/link";

/** Sign-in / registration shell: the ledger rule on one side, the form on the other. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <Link href="/" className="text-sm font-semibold tracking-tight">Expense Manager</Link>
        <div className="space-y-6">
          <p className="max-w-sm text-3xl font-semibold leading-tight">Every figure comes from one rule.</p>
          <div className="max-w-sm space-y-2 font-medium" aria-label="Opening balance plus money in minus money out equals balance">
            {[
              ["Opening balance", ""],
              ["Money in", "+"],
              ["Money out", "−"],
            ].map(([label, sign]) => (
              <div key={label} className="flex items-baseline justify-between border-b border-primary-foreground/20 pb-2 text-primary-foreground/85">
                <span>{label}</span>
                <span aria-hidden="true" className="text-xl">{sign}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-1 text-lg">
              <span>Balance</span>
              <span aria-hidden="true">=</span>
            </div>
          </div>
          <p className="max-w-sm text-sm text-primary-foreground/75">
            Budgets, reports and the assistant all read from the same ledger — so they always agree with each other.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">Your data stays in your account. No bank logins are ever requested.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
