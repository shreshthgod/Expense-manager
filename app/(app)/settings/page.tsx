"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/app/states";
import { AppearanceSection, FinancialSection, NotificationsSection, ProfileSection } from "@/components/settings/general";
import { CategoriesSection, MerchantsSection, RulesSection, TemplatesSection } from "@/components/settings/organise";
import { DataSection, SecuritySection } from "@/components/settings/security-data";
import { cn } from "@/lib/utils/cn";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "money", label: "Money & periods" },
  { id: "categories", label: "Categories" },
  { id: "automation", label: "Merchants & rules" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "security", label: "Security" },
  { id: "data", label: "Data & backup" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "profile") as Tab;
  const go = (id: Tab) => router.replace(id === "profile" ? "/settings" : `/settings?tab=${id}`, { scroll: false });
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin lg:flex-col lg:overflow-visible">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === t.id ? "bg-primary-soft text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-5">
          {tab === "profile" && <ProfileSection />}
          {tab === "money" && <FinancialSection />}
          {tab === "categories" && <CategoriesSection />}
          {tab === "automation" && (
            <>
              <RulesSection />
              <MerchantsSection />
              <TemplatesSection />
            </>
          )}
          {tab === "notifications" && <NotificationsSection />}
          {tab === "appearance" && <AppearanceSection />}
          {tab === "security" && <SecuritySection />}
          {tab === "data" && <DataSection />}
        </div>
      </div>
    </>
  );
}
