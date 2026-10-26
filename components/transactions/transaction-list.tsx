"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download, Filter, Receipt, Sparkles, Tag, Trash2, X, FolderInput, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, ListSkeleton, Refreshing } from "@/components/app/states";
import { useUrlState } from "@/components/app/kit";
import { AccountSelect, CategorySelect } from "@/components/app/pickers";
import { Field } from "@/components/app/field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Amount } from "@/components/app/amount";
import { useFormat } from "@/components/providers/app-context";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { TransactionDetailDialog } from "@/components/transactions/transaction-detail";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { api, errorMessage } from "@/lib/client/api";
import { useFinanceMutation } from "@/lib/client/query";
import { useAccounts, useCategories, useTransactions } from "@/lib/client/hooks";
import type { TransactionDTO } from "@/server/services/transaction.types";

const FILTER_DEFAULTS = {
  search: "",
  type: "",
  status: "",
  categoryId: "",
  uncategorized: "",
  accountId: "",
  tag: "",
  merchant: "",
  minAmount: "",
  maxAmount: "",
  startDate: "",
  endDate: "",
  sortBy: "transactionDate",
  sortDir: "desc",
  page: "1",
  pageSize: "50",
};

type Filters = typeof FILTER_DEFAULTS;

const TYPE_LABELS: Record<string, string> = { EXPENSE: "Expenses", INCOME: "Income", TRANSFER: "Transfers", REFUND: "Refunds", ADJUSTMENT: "Adjustments" };

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function groupByDate(items: TransactionDTO[]) {
  const groups: { date: string; items: TransactionDTO[] }[] = [];
  for (const t of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.transactionDate) last.items.push(t);
    else groups.push({ date: t.transactionDate, items: [t] });
  }
  return groups;
}

function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const { addToast } = useToast();
  const [dialog, setDialog] = React.useState<null | "categorize" | "addTag" | "removeTag" | "moveAccount" | "delete">(null);
  const [categoryId, setCategoryId] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [tag, setTag] = React.useState("");
  const m = useFinanceMutation({
    affects: ["transaction"],
    mutationFn: (body: Record<string, unknown>) => api.post<{ updated: number; skipped?: number }>("/api/transactions/bulk", body),
  });
  const run = async (action: NonNullable<typeof dialog>) => {
    try {
      const res = await m.mutateAsync({ action, ids, categoryId: categoryId || undefined, accountId: accountId || undefined, tag: tag || undefined });
      addToast(res.message ?? `${ids.length} transaction(s) updated`, "success");
      setDialog(null);
      onClear();
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  return (
    <>
      <div role="region" aria-label="Bulk actions" className="sticky bottom-20 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-xl border bg-card px-3 py-2 shadow-lg lg:bottom-4">
        <span className="px-1 text-sm font-medium">{ids.length} selected</span>
        <Button size="xs" variant="ghost" onClick={() => setDialog("categorize")}><FolderInput aria-hidden="true" /> Categorise</Button>
        <Button size="xs" variant="ghost" onClick={() => setDialog("addTag")}><Tag aria-hidden="true" /> Tag</Button>
        <Button size="xs" variant="ghost" onClick={() => setDialog("moveAccount")}><ArrowLeftRight aria-hidden="true" /> Move</Button>
        <Button size="xs" variant="ghost" className="text-outflow" onClick={() => setDialog("delete")}><Trash2 aria-hidden="true" /> Delete</Button>
        <Button size="icon-sm" variant="ghost" onClick={onClear} aria-label="Clear selection"><X aria-hidden="true" /></Button>
      </div>
      <Dialog open={dialog !== null && dialog !== "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {dialog === "categorize" ? "Set category" : dialog === "moveAccount" ? "Move to account" : dialog === "removeTag" ? "Remove tag" : "Add tag"}
            </DialogTitle>
            <DialogDescription>Applies to {ids.length} selected transaction(s). Transfers and adjustments are skipped where the change doesn't apply.</DialogDescription>
          </DialogHeader>
          {dialog === "categorize" && <Field label="Category" required>{(p) => <CategorySelect control={p} kind="ANY" value={categoryId} onChange={setCategoryId} />}</Field>}
          {dialog === "moveAccount" && <Field label="Account" required>{(p) => <AccountSelect control={p} value={accountId} onChange={setAccountId} />}</Field>}
          {(dialog === "addTag" || dialog === "removeTag") && (
            <>
              <Field label="Tag" required>{(p) => <Input {...p} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. travel" />}</Field>
              <button type="button" className="text-left text-xs text-primary hover:underline" onClick={() => setDialog(dialog === "addTag" ? "removeTag" : "addTag")}>
                {dialog === "addTag" ? "Remove a tag instead" : "Add a tag instead"}
              </button>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              loading={m.isPending}
              disabled={(dialog === "categorize" && !categoryId) || (dialog === "moveAccount" && !accountId) || ((dialog === "addTag" || dialog === "removeTag") && !tag.trim())}
              onClick={() => dialog && void run(dialog)}
            >
              Apply to {ids.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${ids.length} transaction(s)?`}
        description="Balances, budgets and reports update immediately. Deleted transactions can be restored individually."
        typeToConfirm={ids.length >= 10 ? "DELETE" : undefined}
        onConfirm={() => run("delete")}
      />
    </>
  );
}

function FilterPanel({ filters, set, onClose }: { filters: Filters; set: (p: Partial<Record<keyof Filters, string | null>>) => void; onClose: () => void }) {
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Type">
        {(p) => (
          <Select {...p} value={filters.type} onChange={(e) => set({ type: e.target.value, page: null })}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Account">{(p) => <AccountSelect control={p} allowNone placeholder="All accounts" value={filters.accountId} onChange={(v) => set({ accountId: v, page: null })} />}</Field>
      <Field label="Category">
        {(p) => (
          <CategorySelect control={p} kind="ANY" allowNone noneLabel="All categories" value={filters.categoryId} onChange={(v) => set({ categoryId: v, uncategorized: null, page: null })} />
        )}
      </Field>
      <Field label="Status">
        {(p) => (
          <Select {...p} value={filters.status} onChange={(e) => set({ status: e.target.value, page: null })}>
            <option value="">Posted and planned</option>
            <option value="POSTED">Posted only</option>
            <option value="PLANNED">Planned only</option>
          </Select>
        )}
      </Field>
      <Field label="From">{(p) => <Input {...p} type="date" value={filters.startDate} onChange={(e) => set({ startDate: e.target.value, page: null })} />}</Field>
      <Field label="To">{(p) => <Input {...p} type="date" value={filters.endDate} onChange={(e) => set({ endDate: e.target.value, page: null })} />}</Field>
      <Field label="Min amount">{(p) => <Input {...p} inputMode="decimal" value={filters.minAmount} onChange={(e) => set({ minAmount: e.target.value, page: null })} />}</Field>
      <Field label="Max amount">{(p) => <Input {...p} inputMode="decimal" value={filters.maxAmount} onChange={(e) => set({ maxAmount: e.target.value, page: null })} />}</Field>
      <Field label="Tag">{(p) => <Input {...p} value={filters.tag} onChange={(e) => set({ tag: e.target.value, page: null })} placeholder="e.g. travel" />}</Field>
      <Field label="Merchant">{(p) => <Input {...p} value={filters.merchant} onChange={(e) => set({ merchant: e.target.value, page: null })} />}</Field>
      <Field label="Sort by">
        {(p) => (
          <Select {...p} value={`${filters.sortBy}:${filters.sortDir}`} onChange={(e) => { const [sortBy, sortDir] = e.target.value.split(":"); set({ sortBy, sortDir }); }}>
            <option value="transactionDate:desc">Newest first</option>
            <option value="transactionDate:asc">Oldest first</option>
            <option value="amount:desc">Largest amount</option>
            <option value="amount:asc">Smallest amount</option>
            <option value="createdAt:desc">Recently added</option>
          </Select>
        )}
      </Field>
      <div className="flex items-end gap-2">
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={filters.uncategorized === "true"} onChange={(e) => set({ uncategorized: e.target.checked ? "true" : null, categoryId: null, page: null })} />
          Uncategorised only
        </label>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

/**
 * The transactions list used by /transactions and /income. `fixed` filters
 * are always applied and hidden from the chips (e.g. type=INCOME).
 */
export function TransactionExplorer({ fixed = {}, emptyTitle = "No transactions yet", emptyAction }: { fixed?: Partial<Filters>; emptyTitle?: string; emptyAction?: React.ReactNode }) {
  const [filters, setFilters] = useUrlState(FILTER_DEFAULTS);
  const set = setFilters as (p: Partial<Record<keyof Filters, string | null>>) => void;
  const f = useFormat();
  const { addToast } = useToast();
  const tx = useTransactionDialog();
  const [search, setSearch] = React.useState(filters.search);
  const debounced = useDebounced(search);
  React.useEffect(() => {
    if (debounced !== filters.search) set({ search: debounced, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const [panel, setPanel] = React.useState(false);
  const [smart, setSmart] = React.useState<{ busy: boolean; text: string | null }>({ busy: false, text: null });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [detail, setDetail] = React.useState<string | null>(null);
  React.useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus) setDetail(focus);
  }, []);
  const accounts = useAccounts({ includeArchived: true });
  const categories = useCategories({ includeArchived: true });

  const fixedKey = JSON.stringify(fixed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const query = React.useMemo(() => ({ ...filters, ...fixed }), [filters, fixedKey]);
  const q = useTransactions(query);
  React.useEffect(() => setSelected(new Set()), [JSON.stringify(query)]); // eslint-disable-line react-hooks/exhaustive-deps

  const applySmart = async () => {
    if (search.trim().length < 2) return;
    setSmart({ busy: true, text: null });
    try {
      const res = await api.post<{ matched: boolean; params: Record<string, string>; description: string }>("/api/ai/parse-filter", { text: search });
      const p = res.data.params;
      setSearch(p.search ?? "");
      set({
        search: p.search ?? null,
        type: fixed.type ? null : p.type ?? null,
        categoryId: p.categoryId ?? null,
        minAmount: p.minAmount ?? null,
        maxAmount: p.maxAmount ?? null,
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
        merchant: p.merchant ?? null,
        page: null,
      });
      setSmart({ busy: false, text: res.data.matched ? `Showing: ${res.data.description}` : null });
    } catch (e) {
      setSmart({ busy: false, text: null });
      addToast(errorMessage(e), "error");
    }
  };

  const chips: { key: keyof Filters; label: string }[] = [];
  const name = (list: { id: string; name: string }[] | undefined, id: string) => list?.find((x) => x.id === id)?.name ?? "…";
  if (filters.type && !fixed.type) chips.push({ key: "type", label: TYPE_LABELS[filters.type] ?? filters.type });
  if (filters.status) chips.push({ key: "status", label: filters.status === "PLANNED" ? "Planned" : "Posted" });
  if (filters.accountId) chips.push({ key: "accountId", label: name(accounts.data?.accounts, filters.accountId) });
  if (filters.categoryId) chips.push({ key: "categoryId", label: name(categories.data, filters.categoryId) });
  if (filters.uncategorized) chips.push({ key: "uncategorized", label: "Uncategorised" });
  if (filters.startDate) chips.push({ key: "startDate", label: `From ${f.date(filters.startDate)}` });
  if (filters.endDate) chips.push({ key: "endDate", label: `To ${f.date(filters.endDate)}` });
  if (filters.minAmount) chips.push({ key: "minAmount", label: `≥ ${f.money(Number(filters.minAmount))}` });
  if (filters.maxAmount) chips.push({ key: "maxAmount", label: `≤ ${f.money(Number(filters.maxAmount))}` });
  if (filters.tag) chips.push({ key: "tag", label: `#${filters.tag}` });
  if (filters.merchant) chips.push({ key: "merchant", label: `Merchant: ${filters.merchant}` });

  const exportHref = React.useMemo(() => {
    const p = new URLSearchParams({ type: "transactions" });
    for (const [k, v] of Object.entries(query)) if (v && !["page", "pageSize", "type"].includes(k)) p.set(k, v);
    if (query.type) p.set("transactionType", query.type);
    return `/api/export?${p.toString()}`;
  }, [query]);

  const data = q.data;
  const items = data?.items ?? [];
  const page = Number(filters.page) || 1;
  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <form
          className="relative flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void applySmart();
          }}
        >
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search, or try "food above 1000 last month"'
            aria-label="Search transactions"
            className="flex-1"
          />
          <Button type="submit" variant="outline" loading={smart.busy} disabled={search.trim().length < 2} title="Turn your words into filters">
            <Sparkles aria-hidden="true" /> <span className="hidden sm:inline">Smart filter</span>
          </Button>
        </form>
        <div className="flex gap-2">
          <Button variant={panel ? "secondary" : "outline"} onClick={() => setPanel((p) => !p)} aria-expanded={panel}>
            <Filter aria-hidden="true" /> Filters{chips.length ? ` (${chips.length})` : ""}
          </Button>
          <Button asChild variant="outline">
            <a href={exportHref} download>
              <Download aria-hidden="true" /> <span className="hidden sm:inline">Export CSV</span>
            </a>
          </Button>
        </div>
      </div>
      {smart.text && <p className="text-sm text-muted-foreground" role="status">{smart.text}</p>}
      {panel && <FilterPanel filters={filters} set={set} onClose={() => setPanel(false)} />}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => set({ [c.key]: null, page: null })}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove filter ${c.label}`}
            >
              {c.label} <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setSearch(""); setFilters(Object.fromEntries(Object.keys(FILTER_DEFAULTS).map((k) => [k, null]))); }}>
            Clear all
          </button>
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span className="text-muted-foreground">{data.total} transaction(s)</span>
          {data.totals.income > 0 && <span>In <Amount value={data.totals.income} direction="in" /></span>}
          {data.totals.expense > 0 && <span>Out <Amount value={data.totals.expense} direction="out" /></span>}
          {data.totals.refunds > 0 && <span>Refunds <Amount value={data.totals.refunds} direction="in" /></span>}
          <Refreshing active={q.isFetching && !q.isLoading} />
        </div>
      )}

      {q.isLoading ? (
        <ListSkeleton rows={8} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        chips.length || filters.search ? (
          <EmptyState icon={Filter} title="Nothing matches these filters" description="Try removing a filter or widening the dates." action={<Button variant="outline" onClick={() => { setSearch(""); setFilters(Object.fromEntries(Object.keys(FILTER_DEFAULTS).map((k) => [k, null]))); }}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={Receipt} title={emptyTitle} description="Record what you spend and earn, or import a bank statement." action={emptyAction ?? <Button onClick={() => tx.openCreate(fixed.type ? { type: fixed.type as "INCOME" } : undefined)}>Add a transaction</Button>} />
        )
      ) : (
        // No overflow-hidden here: it would become the sticky headers' scroll container.
        <Card>
          <div className="flex items-center gap-3 rounded-t-xl border-b bg-muted/40 px-3 py-2 sm:px-4">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allSelected}
              onChange={(e) => setSelected(e.target.checked ? new Set(items.map((t) => t.id)) : new Set())}
              aria-label="Select all on this page"
            />
            <span className="text-xs text-muted-foreground">Select all on this page</span>
          </div>
          {groupByDate(items).map((g) => (
            <section key={g.date} aria-label={f.date(g.date)}>
              <h3 className="sticky top-16 z-10 border-b bg-card/95 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">{f.relative(g.date)}</h3>
              <div className="divide-y">
                {g.items.map((t) => (
                  <TransactionRow
                    key={t.id}
                    t={t}
                    showDate={false}
                    selectable
                    selected={selected.has(t.id)}
                    onSelect={(c) => setSelected((s) => { const n = new Set(s); if (c) n.add(t.id); else n.delete(t.id); return n; })}
                    onOpen={(x) => setDetail(x.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </Card>
      )}

      {data && data.totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
          <Select value={filters.pageSize} onChange={(e) => set({ pageSize: e.target.value, page: null })} aria-label="Rows per page" className="w-auto">
            {[20, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
          </Select>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}><ChevronLeft aria-hidden="true" /> Previous</Button>
            <span className="whitespace-nowrap text-sm text-muted-foreground num">Page {page} of {data.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => set({ page: String(page + 1) })}>Next <ChevronRight aria-hidden="true" /></Button>
          </div>
        </nav>
      )}

      {selected.size > 0 && <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())} />}
      <TransactionDetailDialog id={detail} onOpenChange={(o) => !o && setDetail(null)} />
    </div>
  );
}
