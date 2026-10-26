"use client";

import * as React from "react";
import { PageHeader } from "@/components/app/states";
import { RecurringManager } from "@/components/recurring/recurring-manager";

export default function BillsPage() {
  return (
    <>
      <PageHeader title="Bills" description="Rent, utilities, phone, insurance and card payments. Mark them paid when the money leaves — that records the transaction." />
      <React.Suspense>
        <RecurringManager kind="BILL" />
      </React.Suspense>
    </>
  );
}
