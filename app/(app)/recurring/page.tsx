"use client";

import * as React from "react";
import { PageHeader } from "@/components/app/states";
import { RecurringManager } from "@/components/recurring/recurring-manager";

export default function RecurringPage() {
  return (
    <>
      <PageHeader title="Recurring" description="Everything that repeats: salary, transfers, SIPs, bills and subscriptions. Nothing is recorded automatically unless you turn it on." />
      <React.Suspense>
        <RecurringManager kind="ALL" />
      </React.Suspense>
    </>
  );
}
