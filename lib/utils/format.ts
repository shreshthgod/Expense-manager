import { SUPPORTED_CURRENCIES, type DateFormat } from "@/lib/constants";
import { isValidISODate, parseISODate, todayISO, diffDays, type ISODate } from "@/lib/dates/date-only";

/**
 * Formatting shared by server (notification text, exports) and client (via the
 * PreferencesProvider). Currency and date format always come from the user's
 * preferences — never hardcode INR / en-IN at call sites.
 */

export const DEFAULT_CURRENCY = "INR";

export function localeForCurrency(currency: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === currency)?.locale ?? "en-IN";
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function numberFormat(currency: string, precise: boolean, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${precise}|${compact}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(localeForCurrency(currency), {
      style: "currency",
      currency,
      ...(compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : precise
          ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
          : { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    });
    formatterCache.set(key, f);
  }
  return f;
}

export interface MoneyFormatOptions {
  /** Always show 2 decimals. */
  precise?: boolean;
  /** 1.2L / 3.4K style (Indian compact notation for INR). */
  compact?: boolean;
  /** Prefix "+" for positive values. */
  signed?: boolean;
}

export function formatMoney(value: number, currency: string = DEFAULT_CURRENCY, opts: MoneyFormatOptions = {}): string {
  const safe = Number.isFinite(value) ? value : 0;
  // Whole amounts show no decimals; any paise show both digits (₹1,176.30, never ₹1,176.3).
  const hasFraction = Math.round(Math.abs(safe) * 100) % 100 !== 0;
  const text = numberFormat(currency, !!opts.precise || (!opts.compact && hasFraction), !!opts.compact).format(safe);
  return opts.signed && safe > 0 ? `+${text}` : text;
}

/** Back-compat helper (INR, whole units). Prefer useFormat().money on the client. */
export function formatCurrency(value: number, precise = false, currency: string = DEFAULT_CURRENCY): string {
  return formatMoney(value, currency, { precise });
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatSignedPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Formats a calendar date (YYYY-MM-DD) without any time-zone conversion. */
export function formatISODate(value: ISODate | null | undefined, format: DateFormat | string = "DD MMM YYYY"): string {
  if (!value || !isValidISODate(value)) return "—";
  const { year, month, day } = parseISODate(value);
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  switch (format) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${year}`;
    case "YYYY-MM-DD":
      return value;
    case "DD/MM/YYYY":
      return `${dd}/${mm}/${year}`;
    case "DD MMM YYYY":
    default:
      return `${day} ${MONTHS_SHORT[month - 1]} ${year}`;
  }
}

/** "12 Sep" style short label. */
export function formatISODateShort(value: ISODate | null | undefined): string {
  if (!value || !isValidISODate(value)) return "—";
  const { month, day } = parseISODate(value);
  return `${day} ${MONTHS_SHORT[month - 1]}`;
}

export function formatMonthYear(value: ISODate): string {
  const { year, month } = parseISODate(value);
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/** Today / Yesterday / Tomorrow / In 3 days / 4 days ago / formatted date. */
export function formatRelativeISODate(value: ISODate, today: ISODate = todayISO(), format: DateFormat | string = "DD MMM YYYY"): string {
  if (!isValidISODate(value)) return "—";
  const d = diffDays(today, value);
  if (d === 0) return "Today";
  if (d === -1) return "Yesterday";
  if (d === 1) return "Tomorrow";
  if (d < 0 && d > -7) return `${-d} days ago`;
  if (d > 0 && d < 7) return `In ${d} days`;
  return formatISODate(value, format);
}

/** Formats an instant (audit timestamps, createdAt) in a time zone. */
export function formatInstant(
  value: string | Date,
  opts: { timeZone?: string; format?: DateFormat | string; withTime?: boolean } = {}
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const date = todayISO(opts.timeZone ?? "Asia/Kolkata", d);
  const datePart = formatISODate(date, opts.format ?? "DD MMM YYYY");
  if (!opts.withTime) return datePart;
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: opts.timeZone ?? "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${datePart}, ${time}`;
}

/** Relative time for instants ("5 min ago"). */
export function formatTimeAgo(value: string | Date, now: Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatInstant(d);
}
