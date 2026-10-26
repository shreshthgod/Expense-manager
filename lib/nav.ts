import {
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  CreditCard,
  FileText,
  Goal,
  Inbox,
  Landmark,
  LayoutDashboard,
  LineChart,
  PieChart,
  Receipt,
  Repeat,
  Scale,
  Settings,
  Upload,
  Wallet,
  Waves,
  CalendarCheck,
  TrendingUp,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  /** Shown in the phone bottom bar. */
  mobile?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Every entry points at a working page (no placeholder destinations). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, mobile: true },
      { label: "Review inbox", href: "/inbox", icon: Inbox },
      { label: "Calendar", href: "/calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Transactions", href: "/transactions", icon: Receipt, mobile: true },
      { label: "Income", href: "/income", icon: TrendingUp },
      { label: "Accounts", href: "/accounts", icon: Landmark },
      { label: "Bills", href: "/bills", icon: CalendarCheck },
      { label: "Subscriptions", href: "/subscriptions", icon: CreditCard },
      { label: "Recurring", href: "/recurring", icon: Repeat },
      { label: "Import", href: "/import", icon: Upload },
    ],
  },
  {
    label: "Planning",
    items: [
      { label: "Budgets", href: "/budgets", icon: PieChart, mobile: true },
      { label: "Goals", href: "/goals", icon: Goal },
      { label: "Net worth", href: "/net-worth", icon: Scale },
      { label: "Cash flow", href: "/cash-flow", icon: Waves },
    ],
  },
  {
    label: "Insights",
    items: [
      { label: "Analytics", href: "/analytics", icon: BarChart3 },
      { label: "Monthly review", href: "/review", icon: LineChart },
      { label: "Reports", href: "/reports", icon: FileText },
      { label: "Assistant", href: "/assistant", icon: Bot },
    ],
  },
];

export const FOOTER_NAV: NavItem[] = [
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Settings", href: "/settings", icon: Settings },
];

export const ALL_NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), ...FOOTER_NAV];

export const WalletIcon = Wallet;
