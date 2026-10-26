"use client";

import * as React from "react";
import { PageHeader } from "@/components/app/states";
import { RecurringManager } from "@/components/recurring/recurring-manager";

export default function SubscriptionsPage() {
  return (
    <>
      <PageHeader title="Subscriptions" description="What your memberships and apps cost you each month and year. Cancel one here once you've cancelled it with the provider." />
      <React.Suspense>
        <RecurringManager kind="SUBSCRIPTION" />
      </React.Suspense>
    </>
  );
}
