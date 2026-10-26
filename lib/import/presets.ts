import type { ImportMappingConfig } from "@/lib/validation/schemas";

/**
 * Built-in column mapping presets. Header names differ between exports, so
 * each preset lists candidate header names; `resolvePreset` picks the ones that
 * exist in the uploaded file. Users can edit and save their own presets.
 * (These describe common CSV exports — there is no live bank connection.)
 */

export interface PresetDefinition {
  id: string;
  name: string;
  dateFormat: ImportMappingConfig["dateFormat"];
  amountMode: ImportMappingConfig["amountMode"];
  positiveIsExpense?: boolean;
  columns: Partial<Record<"date" | "description" | "merchant" | "amount" | "debit" | "credit" | "type" | "category" | "reference", string[]>>;
}

export const IMPORT_PRESETS: PresetDefinition[] = [
  {
    id: "hdfc",
    name: "HDFC Bank statement",
    dateFormat: "DD/MM/YY",
    amountMode: "DEBIT_CREDIT",
    columns: { date: ["Date"], description: ["Narration"], debit: ["Withdrawal Amt.", "Withdrawal Amount"], credit: ["Deposit Amt.", "Deposit Amount"], reference: ["Chq./Ref.No.", "Chq/Ref Number"] },
  },
  {
    id: "icici",
    name: "ICICI Bank statement",
    dateFormat: "DD/MM/YYYY",
    amountMode: "DEBIT_CREDIT",
    columns: { date: ["Transaction Date", "Value Date"], description: ["Transaction Remarks", "Remarks"], debit: ["Withdrawal Amount (INR )", "Withdrawal Amount(INR)", "Withdrawal Amount"], credit: ["Deposit Amount (INR )", "Deposit Amount(INR)", "Deposit Amount"], reference: ["Cheque Number"] },
  },
  {
    id: "sbi",
    name: "SBI statement",
    dateFormat: "DD MMM YYYY",
    amountMode: "DEBIT_CREDIT",
    columns: { date: ["Txn Date", "Transaction Date"], description: ["Description", "Narration"], debit: ["Debit"], credit: ["Credit"], reference: ["Ref No./Cheque No.", "Ref No"] },
  },
  {
    id: "axis",
    name: "Axis Bank statement",
    dateFormat: "DD-MM-YYYY",
    amountMode: "DEBIT_CREDIT",
    columns: { date: ["Tran Date", "Transaction Date"], description: ["PARTICULARS", "Particulars"], debit: ["DR", "Debit"], credit: ["CR", "Credit"], reference: ["CHQNO"] },
  },
  {
    id: "card",
    name: "Credit card statement",
    dateFormat: "DD/MM/YYYY",
    amountMode: "TYPE_COLUMN",
    columns: { date: ["Date", "Transaction Date"], description: ["Description", "Transaction Details"], amount: ["Amount", "Amount (in Rs.)"], type: ["Type", "Cr/Dr", "Debit/Credit"] },
  },
  {
    id: "generic",
    name: "Generic (date, description, amount)",
    dateFormat: "YYYY-MM-DD",
    amountMode: "SIGNED",
    columns: { date: ["date", "Date", "Transaction Date"], description: ["description", "Description", "Details", "Narration"], merchant: ["merchant", "Merchant", "Payee"], amount: ["amount", "Amount"], category: ["category", "Category"] },
  },
];

const KEYWORDS: Record<string, RegExp> = {
  date: /date/i,
  description: /(narration|description|particulars|remarks|details)/i,
  merchant: /(merchant|payee)/i,
  debit: /(withdrawal|debit|\bdr\b)/i,
  credit: /(deposit|credit|\bcr\b)/i,
  amount: /amount/i,
  type: /(type|cr\/dr|dr\/cr)/i,
  category: /category/i,
  reference: /(ref|cheque|chq)/i,
};

/** Applies a preset to the file's headers (exact names first, then keywords). */
export function resolvePreset(preset: PresetDefinition, headers: string[]): ImportMappingConfig {
  const find = (key: keyof PresetDefinition["columns"]) => {
    for (const name of preset.columns[key] ?? []) {
      const hit = headers.find((h) => h.trim().toLowerCase() === name.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };
  return {
    date: find("date") ?? "",
    description: find("description"),
    merchant: find("merchant"),
    amount: find("amount"),
    debit: find("debit"),
    credit: find("credit"),
    type: find("type"),
    category: find("category"),
    reference: find("reference"),
    dateFormat: preset.dateFormat,
    amountMode: preset.amountMode,
    positiveIsExpense: preset.positiveIsExpense ?? false,
  };
}

/** Guesses a mapping from header keywords (used when no preset fits). */
export function detectMapping(headers: string[]): ImportMappingConfig {
  const pick = (re: RegExp, exclude: (string | null)[] = []) => headers.find((h) => re.test(h) && !exclude.includes(h)) ?? null;
  const date = pick(KEYWORDS.date!) ?? "";
  const debit = pick(KEYWORDS.debit!);
  const credit = pick(KEYWORDS.credit!, [debit]);
  const amount = pick(KEYWORDS.amount!, [debit, credit]);
  const type = pick(KEYWORDS.type!, [date]);
  const amountMode: ImportMappingConfig["amountMode"] = debit && credit ? "DEBIT_CREDIT" : type && amount ? "TYPE_COLUMN" : "SIGNED";
  return {
    date,
    description: pick(KEYWORDS.description!),
    merchant: pick(KEYWORDS.merchant!),
    amount: amountMode === "DEBIT_CREDIT" ? null : amount,
    debit: amountMode === "DEBIT_CREDIT" ? debit : null,
    credit: amountMode === "DEBIT_CREDIT" ? credit : null,
    type: amountMode === "TYPE_COLUMN" ? type : null,
    category: pick(KEYWORDS.category!),
    reference: pick(KEYWORDS.reference!, [date]),
    dateFormat: "DD/MM/YYYY",
    amountMode,
    positiveIsExpense: false,
  };
}

/** Picks the preset that matches the most headers exactly. */
export function suggestPreset(headers: string[]): PresetDefinition | null {
  let best: { preset: PresetDefinition; score: number } | null = null;
  for (const p of IMPORT_PRESETS) {
    const score = Object.values(p.columns)
      .flat()
      .filter((name) => headers.some((h) => h.trim().toLowerCase() === name!.toLowerCase())).length;
    if (score >= 3 && (!best || score > best.score)) best = { preset: p, score };
  }
  return best?.preset ?? null;
}
