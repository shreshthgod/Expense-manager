"use client";

import * as React from "react";
import { Select } from "@/components/ui/select";
import { useAccounts, useCategories } from "@/lib/client/hooks";
import { useFormat } from "@/components/providers/app-context";
import { accountTypeMeta } from "@/lib/constants";
import type { FieldControlProps } from "./field";

/**
 * Category picker. DISPLAY = name, VALUE = database id — always.
 * Archived categories are hidden unless they are the current value (editing
 * history must not silently drop the category — v1 B10).
 */
export function CategorySelect({
  value,
  onChange,
  kind,
  allowNone,
  noneLabel = "Select a category",
  control,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  kind: "EXPENSE" | "INCOME" | "ANY";
  allowNone?: boolean;
  noneLabel?: string;
  control?: FieldControlProps;
  disabled?: boolean;
}) {
  const { data, isLoading, isError } = useCategories({ includeArchived: true });
  const options = (data ?? []).filter(
    (c) => (kind === "ANY" || c.type === kind || c.type === "BOTH") && (!c.archived || c.id === value)
  );
  const expense = options.filter((c) => c.type !== "INCOME");
  const income = options.filter((c) => c.type === "INCOME");
  return (
    <Select {...control} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || isLoading}>
      <option value="" disabled={!allowNone}>
        {isLoading ? "Loading categories…" : isError ? "Couldn't load categories" : noneLabel}
      </option>
      {kind === "ANY" ? (
        <>
          {expense.length > 0 && (
            <optgroup label="Spending">
              {expense.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (archived)" : ""}
                </option>
              ))}
            </optgroup>
          )}
          {income.length > 0 && (
            <optgroup label="Income">
              {income.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (archived)" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </>
      ) : (
        options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.archived ? " (archived)" : ""}
          </option>
        ))
      )}
    </Select>
  );
}

/** Account picker grouped into assets and liabilities, with balances. */
export function AccountSelect({
  value,
  onChange,
  exclude,
  placeholder = "Select an account",
  control,
  disabled,
  allowNone,
}: {
  value: string;
  onChange: (id: string) => void;
  exclude?: string | null;
  placeholder?: string;
  control?: FieldControlProps;
  disabled?: boolean;
  allowNone?: boolean;
}) {
  const { data, isLoading, isError } = useAccounts({ includeArchived: true });
  const f = useFormat();
  const accounts = (data?.accounts ?? []).filter((a) => a.id !== exclude && (!a.archived || a.id === value));
  const label = (a: (typeof accounts)[number]) => {
    const bal = a.group === "LIABILITY" ? `owes ${f.money(Math.max(0, -a.balance))}` : f.money(a.balance);
    return `${a.name} — ${bal}${a.archived ? " (archived)" : ""}`;
  };
  const assets = accounts.filter((a) => accountTypeMeta(a.type).group === "ASSET");
  const liabilities = accounts.filter((a) => accountTypeMeta(a.type).group === "LIABILITY");
  return (
    <Select {...control} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || isLoading}>
      <option value="" disabled={!allowNone}>
        {isLoading ? "Loading accounts…" : isError ? "Couldn't load accounts" : accounts.length === 0 ? "No accounts yet" : placeholder}
      </option>
      {assets.length > 0 && (
        <optgroup label="Accounts">
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {label(a)}
            </option>
          ))}
        </optgroup>
      )}
      {liabilities.length > 0 && (
        <optgroup label="Cards & loans">
          {liabilities.map((a) => (
            <option key={a.id} value={a.id}>
              {label(a)}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
