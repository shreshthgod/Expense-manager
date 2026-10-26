/**
 * RFC 4180 CSV parsing (quoted fields, escaped quotes, CRLF/LF, BOM) with
 * delimiter detection. Pure — used by the browser wizard and by tests.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

const CANDIDATES = [",", ";", "\t", "|"];

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join("\n");
  let best = ",";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = sample.split("\n").filter(Boolean).map((line) => splitLine(line, d).length);
    if (counts.length === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = (consistent ? 1000 : 0) + counts[0]!;
    if (counts[0]! > 1 && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitLine(line: string, delimiter: string): string[] {
  return parseRecords(line, delimiter)[0] ?? [];
}

export function parseRecords(text: string, delimiter = ","): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === delimiter) {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsv(input: string, opts: { delimiter?: string; hasHeader?: boolean } = {}): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const records = parseRecords(text, delimiter)
    .map((r) => r.map((v) => v.trim()))
    .filter((r) => r.some((v) => v !== ""));
  // Bank exports often start with account-info lines: the header is the first
  // row that has as many columns as the data rows below it.
  let headerIndex = 0;
  if (opts.hasHeader !== false) {
    const widths = records.map((r) => r.length);
    const common = mode(widths.slice(Math.min(5, widths.length - 1)));
    headerIndex = Math.max(0, widths.findIndex((w) => w === common));
  }
  const width = records[headerIndex]?.length ?? 0;
  const headers = opts.hasHeader === false ? Array.from({ length: width }, (_, i) => `Column ${i + 1}`) : (records[headerIndex] ?? []).map((h, i) => h || `Column ${i + 1}`);
  const body = records.slice(opts.hasHeader === false ? 0 : headerIndex + 1).filter((r) => r.length >= Math.max(2, width - 1));
  return { headers, rows: body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")), delimiter };
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
