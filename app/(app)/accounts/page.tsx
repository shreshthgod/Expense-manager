"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, ChevronRight, Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { StatTile } from "@/components/app/kit";
import { AccountFormDialog } from "@/components/accounts/account-dialogs";
import { useFormat } from "@/components/providers/app-context";
import { useAccounts } from "@/lib/client/hooks";
import { accountTypeMeta } from "@/lib/constants";
import type { AccountDTO } from "@/server/services/account.service";

function AccountRow({ a }: { a: AccountDTO }) {
  const f = useFormat();
  const meta = accountTypeMeta(a.type);
  return (
    <Link href={`/accounts/${a.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{a.name}</span>
          {a.archived && <Badge variant="secondary"><Archive className="h-3 w-3" aria-hidden="true" /> Archived</Badge>}
          {!a.includeInNetWorth && <Badge variant="outline">Not in net worth</Badge>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta.label}
          {a.institution ? ` · ${a.institution}` : ""}
          {a.card?.maskedNumber ? ` · •••• ${a.card.maskedNumber}` : ""}
        </span>
        {a.card?.utilization != null && (
          <span className="mt-1.5 flex items-center gap-2">
            <Progress value={a.card.utilization} className="h-1.5 max-w-[10rem]" tone={a.card.utilization > 75 ? "outflow" : a.card.utilization > 30 ? "warning" : "default"} label={`${a.card.utilization}% of limit used`} />
            <span className="text-xs text-muted-foreground num">{a.card.utilization}% used</span>
          </span>
        )}
      </span>
      <span className="text-right">
        {a.group === "LIABILITY" ? (
          <>
            <span className="block font-semibold num">{f.money(a.outstanding ?? 0)}</span>
            <span className="text-xs text-muted-foreground">owed</span>
          </>
        ) : (
          <span className={`block font-semibold num ${a.balance < 0 ? "text-outflow" : ""}`}>{f.money(a.balance)}</span>
        )}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

export default function AccountsPage() {
  const [showArchived, setShowArchived] = React.useState(false);
  const q = useAccounts({ includeArchived: true });
  const f = useFormat();
  const params = useSearchParams();
  const router = useRouter();
  const [creating, setCreating] = React.useState(params.get("new") === "1");
  const navigated = React.useRef(false);
  const all = q.data?.accounts ?? [];
  const visible = all.filter((a) => showArchived || !a.archived);
  const assets = visible.filter((a) => a.group === "ASSET");
  const liabilities = visible.filter((a) => a.group === "LIABILITY");
  const archivedCount = all.filter((a) => a.archived).length;
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Balances are calculated from each account's opening balance plus every posted transaction."
        actions={<Button onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Add account</Button>}
      />
      <AccountFormDialog
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
          // Don't clear ?new=1 if saving already navigated to the new account.
          if (!o && params.get("new") && !navigated.current) router.replace("/accounts");
        }}
        onSaved={(a) => {
          navigated.current = true;
          router.push(`/accounts/${a.id}`);
        }}
      />
      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState icon={Landmark} title="No accounts yet" description="Add your bank accounts, cash, wallets and cards. Transactions need an account to belong to." action={<Button onClick={() => setCreating(true)}>Add your first account</Button>} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Net worth" value={f.money(q.data!.summary.netWorth)} emphasis hint={<Link href="/net-worth" className="text-primary hover:underline">See how it's changed</Link>} />
            <StatTile label="What you own" value={f.money(q.data!.summary.totalAssets)} hint={`${f.money(q.data!.summary.liquid)} in cash and bank`} />
            <StatTile label="What you owe" value={f.money(q.data!.summary.totalLiabilities)} hint="Cards and loans" />
          </div>
          {assets.length > 0 && (
            <section aria-labelledby="assets-title">
              <h2 id="assets-title" className="mb-2 text-sm font-medium text-muted-foreground">What you own</h2>
              <Card className="divide-y overflow-hidden">{assets.map((a) => <AccountRow key={a.id} a={a} />)}</Card>
            </section>
          )}
          {liabilities.length > 0 && (
            <section aria-labelledby="liab-title">
              <h2 id="liab-title" className="mb-2 text-sm font-medium text-muted-foreground">What you owe</h2>
              <Card className="divide-y overflow-hidden">{liabilities.map((a) => <AccountRow key={a.id} a={a} />)}</Card>
            </section>
          )}
          {archivedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((s) => !s)}>
              {showArchived ? "Hide archived accounts" : `Show ${archivedCount} archived account(s)`}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
