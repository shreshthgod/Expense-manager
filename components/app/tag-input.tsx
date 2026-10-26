"use client";

import * as React from "react";
import { X } from "lucide-react";
import { inputClass } from "@/components/ui/input";
import { useTags } from "@/lib/client/hooks";
import { cn } from "@/lib/utils/cn";
import type { FieldControlProps } from "./field";

/**
 * Tags answer "what context does this belong to?" (Travel, Reimbursable…),
 * unlike categories ("what kind of spending?"). Enter or comma adds a tag;
 * existing tags autocomplete.
 */
export function TagInput({ value, onChange, control }: { value: string[]; onChange: (tags: string[]) => void; control?: FieldControlProps }) {
  const [draft, setDraft] = React.useState("");
  const { data } = useTags();
  const listId = React.useId();
  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, "").slice(0, 40);
    if (!tag) return;
    if (value.some((t) => t.toLowerCase() === tag.toLowerCase())) return setDraft("");
    const existing = data?.find((t) => t.tag.toLowerCase() === tag.toLowerCase())?.tag;
    onChange([...value, existing ?? tag].slice(0, 20));
    setDraft("");
  };
  return (
    <div className={cn(inputClass, "flex h-auto min-h-10 flex-wrap items-center gap-1.5 py-1.5")}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="rounded-full hover:text-outflow" aria-label={`Remove tag ${t}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        {...control}
        list={listId}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        placeholder={value.length ? "" : "Add tags, e.g. Travel"}
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80"
      />
      <datalist id={listId}>
        {(data ?? []).map((t) => (
          <option key={t.tag} value={t.tag} />
        ))}
      </datalist>
    </div>
  );
}
