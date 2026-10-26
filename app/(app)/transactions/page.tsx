"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/states";
import { TransactionExplorer } from "@/components/transactions/transaction-list";
import { useTransactionDialog } from "@/components/transactions/transaction-dialog";

export default function TransactionsPage() {
  const tx = useTransactionDialog();
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Everything you've recorded. Filters stay in the address bar, so you can bookmark or share a view."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/import"><Upload aria-hidden="true" /> Import</Link>
            </Button>
            <Button onClick={() => tx.openCreate()}><Plus aria-hidden="true" /> Add transaction</Button>
          </>
        }
      />
      <React.Suspense>
        <TransactionExplorer />
      </React.Suspense>
    </>
  );
}
