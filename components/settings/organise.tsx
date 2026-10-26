"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/app/field";
import { Swatch } from "@/components/app/kit";
import { MoneyInput } from "@/components/app/money-input";
import { AccountSelect, CategorySelect } from "@/components/app/pickers";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ErrorState } from "@/components/app/states";
import { useFormat } from "@/components/providers/app-context";
import { api, errorMessage } from "@/lib/client/api";
import { qk, useFinanceMutation } from "@/lib/client/query";
import { useFormErrors } from "@/lib/client/form";
import { useCategories } from "@/lib/client/hooks";
import { categoryCreateSchema, merchantSchema, ruleCreateSchema, templateSchema } from "@/lib/validation/schemas";
import type { CategoryDTO } from "@/server/services/category.service";
import type { MerchantDTO } from "@/server/services/merchant.service";
import type { RuleDTO } from "@/server/services/rules.service";
import type { TemplateDTO } from "@/server/services/template.service";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b", "#0ea5e9", "#a16207"];

function CategoryDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (o: boolean) => void; existing: CategoryDTO | null }) {
  const { addToast } = useToast();
  const [s, setS] = React.useState({ name: "", type: "EXPENSE", color: COLORS[0]!, spendingClass: "", costBehavior: "" });
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  React.useEffect(() => {
    if (open) {
      setS(existing ? { name: existing.name, type: existing.type, color: existing.color ?? COLORS[0]!, spendingClass: existing.spendingClass ?? "", costBehavior: existing.costBehavior ?? "" } : { name: "", type: "EXPENSE", color: COLORS[0]!, spendingClass: "", costBehavior: "" });
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);
  const m = useFinanceMutation({ affects: ["category"], mutationFn: (body: unknown) => (existing ? api.patch(`/api/categories/${existing.id}`, body) : api.post("/api/categories", body)) });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = { name: s.name.trim(), type: s.type, color: s.color, spendingClass: s.spendingClass || null, costBehavior: s.costBehavior || null };
    if (!validate(categoryCreateSchema, body)) return;
    try {
      await m.mutateAsync(body);
      addToast(existing ? "Category updated" : "Category created", "success");
      onOpenChange(false);
    } catch (err) {
      handleError(err);
    }
  };
  const spending = s.type !== "INCOME";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>{existing ? `Edit ${existing.name}` : "New category"}</DialogTitle><DialogDescription>Renaming updates every past transaction's label; amounts don't change.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={errors.name} required>{(p) => <Input {...p} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} data-autofocus />}</Field>
            <Field label="Used for" error={errors.type}>
              {(p) => <Select {...p} value={s.type} onChange={(e) => setS({ ...s, type: e.target.value })} disabled={!!existing?.isSystem}><option value="EXPENSE">Spending</option><option value="INCOME">Income</option><option value="BOTH">Both</option></Select>}
            </Field>
            {spending && (
              <>
                <Field label="Kind of spending" hint="Used for essential spending and the emergency fund.">
                  {(p) => <Select {...p} value={s.spendingClass} onChange={(e) => setS({ ...s, spendingClass: e.target.value })}><option value="">Not set</option><option value="ESSENTIAL">Essential</option><option value="DISCRETIONARY">Discretionary</option></Select>}
                </Field>
                <Field label="Cost pattern">
                  {(p) => <Select {...p} value={s.costBehavior} onChange={(e) => setS({ ...s, costBehavior: e.target.value })}><option value="">Not set</option><option value="FIXED">Fixed (same each month)</option><option value="VARIABLE">Variable</option></Select>}
                </Field>
              </>
            )}
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setS({ ...s, color: c })} aria-label={`Colour ${c}`} aria-pressed={s.color === c} className={`h-7 w-7 rounded-full ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${s.color === c ? "ring-2 ring-foreground" : ""}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>{existing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CategoriesSection() {
  const q = useCategories({ includeArchived: true, withUsage: true });
  const { addToast } = useToast();
  const [editing, setEditing] = React.useState<CategoryDTO | null | "new">(null);
  const [deleting, setDeleting] = React.useState<CategoryDTO | null>(null);
  const [reassign, setReassign] = React.useState("");
  const archive = useFinanceMutation({
    affects: ["category"],
    mutationFn: (c: CategoryDTO) => api.patch(`/api/categories/${c.id}`, { archived: !c.archived }),
    onSuccess: (res) => addToast(res.message ?? "Saved", "success"),
    onError: (e) => addToast(e.message, "error"),
  });
  const del = useFinanceMutation({
    affects: ["category"],
    mutationFn: ({ id, to }: { id: string; to?: string }) => api.delete(`/api/categories/${id}`, { query: { reassignTo: to } }),
    onSuccess: (res) => { addToast(res.message ?? "Deleted", "success"); setDeleting(null); },
  });
  const all = q.data ?? [];
  const used = (c: CategoryDTO) => (c.usage ? c.usage.transactions + c.usage.budgets + c.usage.recurring : 0);
  const group = (label: string, list: CategoryDTO[]) => (
    <div>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <ul className="divide-y rounded-lg border">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <Swatch color={c.color} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            {c.spendingClass && <Badge variant="secondary">{c.spendingClass === "ESSENTIAL" ? "Essential" : "Discretionary"}</Badge>}
            {c.archived && <Badge variant="outline">Archived</Badge>}
            <span className="hidden text-xs text-muted-foreground sm:inline">{c.usage?.transactions ?? 0} txns</span>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}><Pencil aria-hidden="true" /></Button>
            <Button size="icon-sm" variant="ghost" onClick={() => archive.mutate(c)} aria-label={c.archived ? `Restore ${c.name}` : `Archive ${c.name}`}>{c.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}</Button>
            {!c.isSystem && <Button size="icon-sm" variant="ghost" onClick={() => { setDeleting(c); setReassign(""); }} aria-label={`Delete ${c.name}`}><Trash2 aria-hidden="true" /></Button>}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div><CardTitle>Categories</CardTitle><CardDescription>Archive categories you no longer use; history keeps them.</CardDescription></div>
        <Button size="sm" onClick={() => setEditing("new")}><Plus aria-hidden="true" /> New</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? <Skeleton className="h-48" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            {group("Spending", all.filter((c) => c.type !== "INCOME"))}
            {group("Income", all.filter((c) => c.type === "INCOME"))}
          </>
        )}
      </CardContent>
      <CategoryDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} existing={editing === "new" ? null : editing} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? ""}?`}
        description={deleting && used(deleting) > 0 ? `It's used by ${deleting.usage?.transactions ?? 0} transaction(s), ${deleting.usage?.budgets ?? 0} budget(s) and ${deleting.usage?.recurring ?? 0} recurring item(s). Choose where to move them.` : "It isn't used anywhere."}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync({ id: deleting.id, to: reassign || undefined });
          } catch (e) {
            addToast(errorMessage(e), "error");
          }
        }}
      >
        {deleting && used(deleting) > 0 && (
          <Field label="Move them to">{(p) => <CategorySelect control={p} kind={deleting.type === "INCOME" ? "INCOME" : "EXPENSE"} value={reassign} onChange={setReassign} />}</Field>
        )}
      </ConfirmDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

export function MerchantsSection() {
  const f = useFormat();
  const { addToast } = useToast();
  const q = useQuery({ queryKey: qk("merchants", "list"), queryFn: () => api.get<MerchantDTO[]>("/api/merchants") });
  const [editing, setEditing] = React.useState<MerchantDTO | "new" | null>(null);
  const [s, setS] = React.useState({ name: "", defaultCategoryId: "", aliases: "" });
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  React.useEffect(() => {
    if (editing) {
      const m = editing === "new" ? null : editing;
      setS({ name: m?.name ?? "", defaultCategoryId: m?.defaultCategoryId ?? "", aliases: (m?.aliases ?? []).join(", ") });
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const save = useFinanceMutation({
    affects: ["transaction"],
    mutationFn: (body: unknown) => (editing && editing !== "new" ? api.patch(`/api/merchants/${editing.id}`, body) : api.post("/api/merchants", body)),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = { name: s.name.trim(), defaultCategoryId: s.defaultCategoryId || null, aliases: s.aliases.split(",").map((a) => a.trim()).filter(Boolean) };
    if (!validate(merchantSchema, body)) return;
    try {
      const res = await save.mutateAsync(body);
      addToast(res.message ?? "Saved", "success");
      setEditing(null);
      await q.refetch();
    } catch (err) {
      handleError(err);
    }
  };
  const remove = async (m: MerchantDTO) => {
    try {
      await api.delete(`/api/merchants/${m.id}`);
      await q.refetch();
      addToast("Merchant removed", "success");
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div><CardTitle>Merchants</CardTitle><CardDescription>Group spellings like “AMZN MKTP” and “Amazon” under one name. Original text on transactions is kept.</CardDescription></div>
        <Button size="sm" onClick={() => setEditing("new")}><Plus aria-hidden="true" /> New</Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No merchants yet. They're created as you record transactions with a merchant name.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {q.data!.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.defaultCategoryName ?? "No default category"}{m.aliases.length ? ` · ${m.aliases.length} alias(es)` : ""} · {m.stats.count} txns · {f.money(m.stats.total)}</span>
                </span>
                <Button size="icon-sm" variant="ghost" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}><Pencil aria-hidden="true" /></Button>
                <Button size="icon-sm" variant="ghost" onClick={() => void remove(m)} aria-label={`Remove ${m.name}`}><Trash2 aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>{editing === "new" ? "New merchant" : "Edit merchant"}</DialogTitle><DialogDescription>Aliases are text that identifies this merchant in descriptions or imports.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError message={formError} />
            <Field label="Name" error={errors.name} required>{(p) => <Input {...p} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />}</Field>
            <Field label="Default category" optional error={errors.defaultCategoryId}>{(p) => <CategorySelect control={p} kind="ANY" allowNone noneLabel="None" value={s.defaultCategoryId} onChange={(v) => setS({ ...s, defaultCategoryId: v })} />}</Field>
            <Field label="Aliases" optional error={errors.aliases} hint="Comma-separated, e.g. AMZN, AMAZON PAY">{(p) => <Input {...p} value={s.aliases} onChange={(e) => setS({ ...s, aliases: e.target.value })} />}</Field>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const EMPTY_RULE = { name: "", mode: "SUGGEST", matchMerchant: "", matchDescription: "", minAmount: "", maxAmount: "", matchAccountId: "", matchType: "", setCategoryId: "", addTags: "", setMerchantName: "", priority: "100", active: true };

export function RulesSection() {
  const { addToast } = useToast();
  const q = useQuery({ queryKey: qk("rules", "list"), queryFn: () => api.get<RuleDTO[]>("/api/rules") });
  const [editing, setEditing] = React.useState<RuleDTO | "new" | null>(null);
  const [s, setS] = React.useState(EMPTY_RULE);
  const [preview, setPreview] = React.useState<{ rule: RuleDTO; willChange: number } | null>(null);
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  React.useEffect(() => {
    if (!editing) return;
    clear();
    if (editing === "new") setS(EMPTY_RULE);
    else
      setS({
        name: editing.name,
        mode: editing.mode,
        matchMerchant: editing.matchMerchant ?? "",
        matchDescription: editing.matchDescription ?? "",
        minAmount: editing.minAmount != null ? String(editing.minAmount) : "",
        maxAmount: editing.maxAmount != null ? String(editing.maxAmount) : "",
        matchAccountId: editing.matchAccountId ?? "",
        matchType: editing.matchType ?? "",
        setCategoryId: editing.setCategoryId ?? "",
        addTags: editing.addTags.join(", "),
        setMerchantName: editing.setMerchantName ?? "",
        priority: String(editing.priority),
        active: editing.active,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const save = useFinanceMutation({ affects: ["rule"], mutationFn: (body: unknown) => (editing && editing !== "new" ? api.patch(`/api/rules/${editing.id}`, body) : api.post("/api/rules", body)) });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = {
      name: s.name.trim(),
      mode: s.mode,
      priority: s.priority,
      active: s.active,
      matchMerchant: s.matchMerchant.trim() || null,
      matchDescription: s.matchDescription.trim() || null,
      minAmount: s.minAmount.replace(/,/g, "") || null,
      maxAmount: s.maxAmount.replace(/,/g, "") || null,
      matchAccountId: s.matchAccountId || null,
      matchType: s.matchType || null,
      setCategoryId: s.setCategoryId || null,
      addTags: s.addTags.split(",").map((t) => t.trim()).filter(Boolean),
      setMerchantName: s.setMerchantName.trim() || null,
    };
    if (!validate(ruleCreateSchema, body)) return;
    try {
      await save.mutateAsync(body);
      addToast("Rule saved", "success");
      setEditing(null);
      await q.refetch();
    } catch (err) {
      handleError(err);
    }
  };
  const apply = async (rule: RuleDTO, dryRun: boolean) => {
    try {
      const res = await api.post<{ willChange: number; applied: number }>(`/api/rules/${rule.id}/apply`, { scope: "uncategorized", dryRun });
      if (dryRun) setPreview({ rule, willChange: res.data.willChange });
      else {
        addToast(res.message ?? "Applied", "success");
        setPreview(null);
        await q.refetch();
      }
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  const remove = async (r: RuleDTO) => {
    try {
      await api.delete(`/api/rules/${r.id}`);
      await q.refetch();
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div><CardTitle>Rules</CardTitle><CardDescription>Categorise and tag transactions automatically. “Suggest” pre-fills the form; “Automatic” applies on save and import.</CardDescription></div>
        <Button size="sm" onClick={() => setEditing("new")}><Plus aria-hidden="true" /> New</Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-32" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No rules yet. Example: merchant contains “swiggy” → category Food.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {q.data!.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium">{r.name}{!r.active && <Badge variant="outline">Off</Badge>}<Badge variant={r.mode === "AUTO" ? "default" : "secondary"}>{r.mode === "AUTO" ? "Automatic" : "Suggest"}</Badge></span>
                  <span className="text-xs text-muted-foreground">
                    {[r.matchMerchant && `merchant has “${r.matchMerchant}”`, r.matchDescription && `description has “${r.matchDescription}”`].filter(Boolean).join(" and ") || "any"} → {[r.setCategoryName, r.addTags.length && `#${r.addTags.join(" #")}`, r.setMerchantName].filter(Boolean).join(", ")} · used {r.appliedCount}×
                  </span>
                </span>
                <Button size="xs" variant="outline" onClick={() => void apply(r, true)}><Play aria-hidden="true" /> Apply to past</Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}><Pencil aria-hidden="true" /></Button>
                <Button size="icon-sm" variant="ghost" onClick={() => void remove(r)} aria-label={`Delete ${r.name}`}><Trash2 aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>{editing === "new" ? "New rule" : "Edit rule"}</DialogTitle><DialogDescription>Matches are case-insensitive. The first matching rule (lowest priority number) wins.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" error={errors.name} required>{(p) => <Input {...p} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />}</Field>
              <Field label="Mode">{(p) => <Select {...p} value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value })}><option value="SUGGEST">Suggest</option><option value="AUTO">Automatic</option></Select>}</Field>
              <Field label="Merchant contains" error={errors.matchMerchant}>{(p) => <Input {...p} value={s.matchMerchant} onChange={(e) => setS({ ...s, matchMerchant: e.target.value })} />}</Field>
              <Field label="Description contains" error={errors.matchDescription}>{(p) => <Input {...p} value={s.matchDescription} onChange={(e) => setS({ ...s, matchDescription: e.target.value })} />}</Field>
              <Field label="Minimum amount" optional error={errors.minAmount}>{(p) => <MoneyInput {...p} value={s.minAmount} onValueChange={(v) => setS({ ...s, minAmount: v })} />}</Field>
              <Field label="Maximum amount" optional error={errors.maxAmount}>{(p) => <MoneyInput {...p} value={s.maxAmount} onValueChange={(v) => setS({ ...s, maxAmount: v })} />}</Field>
              <Field label="Only for account" optional>{(p) => <AccountSelect control={p} allowNone placeholder="Any account" value={s.matchAccountId} onChange={(v) => setS({ ...s, matchAccountId: v })} />}</Field>
              <Field label="Only for type" optional>{(p) => <Select {...p} value={s.matchType} onChange={(e) => setS({ ...s, matchType: e.target.value })}><option value="">Expenses and income</option><option value="EXPENSE">Expenses</option><option value="INCOME">Income</option></Select>}</Field>
              <Field label="Set category" error={errors.setCategoryId}>{(p) => <CategorySelect control={p} kind="ANY" allowNone noneLabel="Don't change" value={s.setCategoryId} onChange={(v) => setS({ ...s, setCategoryId: v })} />}</Field>
              <Field label="Add tags" optional hint="Comma-separated">{(p) => <Input {...p} value={s.addTags} onChange={(e) => setS({ ...s, addTags: e.target.value })} />}</Field>
              <Field label="Set merchant name" optional>{(p) => <Input {...p} value={s.setMerchantName} onChange={(e) => setS({ ...s, setMerchantName: e.target.value })} />}</Field>
              <Field label="Priority" hint="Lower runs first">{(p) => <Input {...p} inputMode="numeric" value={s.priority} onChange={(e) => setS({ ...s, priority: e.target.value.replace(/\D/g, "") })} />}</Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={s.active} onCheckedChange={(c) => setS({ ...s, active: c })} aria-label="Rule is on" /> Rule is on</label>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" loading={save.isPending}>Save rule</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        destructive={false}
        confirmLabel={`Update ${preview?.willChange ?? 0}`}
        title={`Apply “${preview?.rule.name ?? ""}” to past transactions?`}
        description={preview?.willChange ? `${preview.willChange} uncategorised transaction(s) will be updated. Categorised ones are never overwritten.` : "No uncategorised transactions match this rule."}
        onConfirm={() => (preview?.willChange ? apply(preview.rule, false) : setPreview(null))}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Favourites (transaction templates)
// ---------------------------------------------------------------------------

export function TemplatesSection() {
  const f = useFormat();
  const { addToast } = useToast();
  const q = useQuery({ queryKey: qk("transactions", "templates"), queryFn: () => api.get<TemplateDTO[]>("/api/templates") });
  const [open, setOpen] = React.useState(false);
  const [s, setS] = React.useState({ name: "", type: "EXPENSE", amount: "", accountId: "", categoryId: "", merchant: "" });
  const { errors, formError, validate, handleError, clear } = useFormErrors();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    clear();
    const body = { name: s.name.trim(), type: s.type, amount: s.amount.replace(/,/g, "") || null, accountId: s.accountId || null, categoryId: s.categoryId || null, merchant: s.merchant.trim() || null };
    if (!validate(templateSchema, body)) return;
    try {
      await api.post("/api/templates", body);
      addToast("Favourite saved", "success");
      setOpen(false);
      await q.refetch();
    } catch (err) {
      handleError(err);
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div><CardTitle>Favourites</CardTitle><CardDescription>One-tap entries for things you record often (chai, metro recharge…). Find them in the search bar.</CardDescription></div>
        <Button size="sm" onClick={() => { setS({ name: "", type: "EXPENSE", amount: "", accountId: "", categoryId: "", merchant: "" }); clear(); setOpen(true); }}><Plus aria-hidden="true" /> New</Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-24" /> : (q.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No favourites yet.</p> : (
          <ul className="divide-y rounded-lg border">
            {q.data!.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1">{t.name} <span className="text-muted-foreground">· {t.type.toLowerCase()}{t.amount != null ? ` · ${f.money(t.amount)}` : ""}</span></span>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={async () => { try { await api.delete(`/api/templates/${t.id}`); await q.refetch(); } catch (e) { addToast(errorMessage(e), "error"); } }}><Trash2 aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>New favourite</DialogTitle><DialogDescription>Only the name is required; empty fields are filled in when you use it.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" error={errors.name} required>{(p) => <Input {...p} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />}</Field>
              <Field label="Type">{(p) => <Select {...p} value={s.type} onChange={(e) => setS({ ...s, type: e.target.value })}><option value="EXPENSE">Expense</option><option value="INCOME">Income</option></Select>}</Field>
              <Field label="Amount" optional error={errors.amount}>{(p) => <MoneyInput {...p} value={s.amount} onValueChange={(v) => setS({ ...s, amount: v })} />}</Field>
              <Field label="Account" optional>{(p) => <AccountSelect control={p} allowNone placeholder="Choose when used" value={s.accountId} onChange={(v) => setS({ ...s, accountId: v })} />}</Field>
              <Field label="Category" optional>{(p) => <CategorySelect control={p} kind={s.type === "INCOME" ? "INCOME" : "EXPENSE"} allowNone noneLabel="Choose when used" value={s.categoryId} onChange={(v) => setS({ ...s, categoryId: v })} />}</Field>
              <Field label="Merchant" optional>{(p) => <Input {...p} value={s.merchant} onChange={(e) => setS({ ...s, merchant: e.target.value })} />}</Field>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit">Save favourite</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
