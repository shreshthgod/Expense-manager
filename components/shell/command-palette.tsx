"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, CalendarCheck, Loader2, PieChart, Search, Sparkles, Star } from "lucide-react";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";
import { useFormat } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { qk } from "@/lib/client/query";
import { useCategories } from "@/lib/client/hooks";
import { ALL_NAV } from "@/lib/nav";
import { parseNaturalFilter, describeFilter } from "@/lib/finance/natural-filter";
import { dialogVariants, overlayVariants } from "@/lib/motion/tokens";
import { cn } from "@/lib/utils/cn";
import type { SearchResult } from "@/server/services/search.service";
import type { TemplateDTO } from "@/server/services/template.service";

// Tiny global store so any component can open the palette.
let openState = false;
const listeners = new Set<(open: boolean) => void>();
function setOpen(open: boolean) {
  openState = open;
  listeners.forEach((l) => l(open));
}

export function useCommandPalette() {
  return React.useMemo(() => ({ open: () => setOpen(true), close: () => setOpen(false) }), []);
}

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string | null;
  icon?: React.ElementType;
  amount?: number;
  run: () => void;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette() {
  const [open, setLocalOpen] = React.useState(openState);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const router = useRouter();
  const tx = useTransactionDialog();
  const f = useFormat();
  const debounced = useDebounced(query.trim(), 180);
  const categories = useCategories();
  const listboxId = React.useId();

  React.useEffect(() => {
    const l = (o: boolean) => setLocalOpen(o);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!openState);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const previousFocus = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      previousFocus.current?.focus?.();
    }
  }, [open]);

  const search = useQuery({
    queryKey: qk("transactions", "search", debounced),
    queryFn: ({ signal }) => api.get<SearchResult[]>("/api/search", { query: { q: debounced }, signal }),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const favourites = useQuery({
    queryKey: qk("transactions", "templates"),
    queryFn: () => api.get<TemplateDTO[]>("/api/templates"),
    enabled: open,
    staleTime: 60_000,
  });

  const close = React.useCallback(() => setOpen(false), []);
  const go = React.useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router]
  );

  const items = React.useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (label: string) => !q || label.toLowerCase().includes(q);
    const actions: Item[] = [
      { id: "a-exp", group: "Quick actions", label: "Add expense", icon: ArrowUpRight, run: () => (close(), tx.openCreate({ type: "EXPENSE" })) },
      { id: "a-inc", group: "Quick actions", label: "Add income", icon: ArrowDownLeft, run: () => (close(), tx.openCreate({ type: "INCOME" })) },
      { id: "a-tr", group: "Quick actions", label: "Transfer money", icon: ArrowRightLeft, run: () => (close(), tx.openCreate({ type: "TRANSFER" })) },
      { id: "a-bud", group: "Quick actions", label: "Create budget", icon: PieChart, run: () => go("/budgets?new=1") },
      { id: "a-bill", group: "Quick actions", label: "Add a bill", icon: CalendarCheck, run: () => go("/bills?new=1") },
    ].filter((a) => matches(a.label));

    const out: Item[] = [...actions];
    for (const t of (favourites.data ?? []).filter((t) => matches(t.name))) {
      out.push({
        id: `fav-${t.id}`,
        group: "Favourites",
        label: t.name,
        hint: t.amount != null ? f.money(t.amount) : null,
        icon: Star,
        run: () => (
          close(),
          tx.openCreate({
            type: t.type,
            amount: t.amount != null ? String(t.amount) : "",
            ...(t.accountId ? { accountId: t.accountId } : {}),
            ...(t.destinationAccountId ? { destinationAccountId: t.destinationAccountId } : {}),
            ...(t.categoryId ? { categoryId: t.categoryId } : {}),
            merchant: t.merchant ?? "",
            description: t.description ?? "",
            tags: t.tags,
          })
        ),
      });
    }
    const natural = q.length >= 3 ? parseNaturalFilter(query, f.today(), categories.data ?? []) : null;
    if (natural && Object.keys(natural.params).length > 0) {
      const params = new URLSearchParams(natural.params as Record<string, string>);
      out.push({
        id: "nl",
        group: "Search transactions",
        label: describeFilter(natural, f.money),
        hint: "Filter",
        icon: Sparkles,
        run: () => go(`/transactions?${params.toString()}`),
      });
    } else if (q.length >= 2) {
      out.push({ id: "s-all", group: "Search transactions", label: `Transactions matching "${query.trim()}"`, icon: Search, run: () => go(`/transactions?search=${encodeURIComponent(query.trim())}`) });
    }
    for (const n of ALL_NAV.filter((n) => matches(n.label))) {
      out.push({ id: `n-${n.href}`, group: "Go to", label: n.label, icon: n.icon, run: () => go(n.href) });
    }
    for (const r of search.data ?? []) {
      out.push({ id: `r-${r.group}-${r.id}`, group: r.group, label: r.title, hint: [r.subtitle, r.date ? f.date(r.date) : null].filter(Boolean).join(", ") || null, amount: r.amount, run: () => go(r.href) });
    }
    return out;
  }, [query, search.data, favourites.data, tx, go, close, f, categories.data]);

  React.useEffect(() => setActive(0), [query]);
  React.useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  if (typeof document === "undefined") return null;
  let lastGroup = "";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65]">
          <motion.div className="absolute inset-0 bg-foreground/40 dark:bg-black/60" variants={overlayVariants} initial="hidden" animate="visible" exit="exit" onClick={close} />
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-3 pt-[10vh]">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Search and commands"
              variants={dialogVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="pointer-events-auto flex max-h-[70dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b px-4">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listboxId}
                  aria-activedescendant={items[active] ? `${listboxId}-${active}` : undefined}
                  aria-autocomplete="list"
                  placeholder='Search, or try "food over 1000 last month"'
                  className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                {search.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
              </div>
              <ul ref={listRef} id={listboxId} role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches "{query}".</li>}
                {items.map((item, i) => {
                  const header = item.group !== lastGroup ? item.group : null;
                  lastGroup = item.group;
                  return (
                    <React.Fragment key={item.id}>
                      {header && (
                        <li role="presentation" className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground first:pt-1">
                          {header}
                        </li>
                      )}
                      <li
                        id={`${listboxId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        data-index={i}
                        onMouseMove={() => setActive(i)}
                        onClick={() => item.run()}
                        className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm", i === active ? "bg-accent text-accent-foreground" : "")}
                      >
                        {item.icon && <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{item.label}</span>
                          {item.hint && <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>}
                        </span>
                        {item.amount != null && <span className={cn("num text-xs", item.amount < 0 ? "text-outflow" : "text-muted-foreground")}>{f.money(item.amount)}</span>}
                      </li>
                    </React.Fragment>
                  );
                })}
              </ul>
              <div className="hidden items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground sm:flex">
                <span>↑↓ to move</span>
                <span>Enter to open</span>
                <span>Esc to close</span>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
