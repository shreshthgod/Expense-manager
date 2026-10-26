"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/app/states";
import { useFormat, usePreferences, useUser } from "@/components/providers/app-context";
import { api } from "@/lib/client/api";
import { emptyTransactionForm, transactionFormFromDTO, type EntryType, type TransactionFormState } from "@/lib/forms/transaction";
import type { TransactionDTO } from "@/server/services/transaction.types";
import { recallLastEntry, TransactionForm } from "./transaction-form";

type OpenRequest =
  | { mode: "create"; defaults?: Partial<Omit<TransactionFormState, "tags">> & { tags?: string[] }; lockType?: boolean }
  | { mode: "edit"; id: string }
  | { mode: "duplicate"; id: string };

interface TransactionDialogApi {
  openCreate: (defaults?: Partial<TransactionFormState> & { type?: EntryType }, opts?: { lockType?: boolean }) => void;
  openEdit: (id: string) => void;
  openDuplicate: (id: string) => void;
}

const Ctx = React.createContext<TransactionDialogApi | null>(null);

export function useTransactionDialog(): TransactionDialogApi {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useTransactionDialog must be used inside <TransactionDialogProvider>");
  return ctx;
}

type Loaded =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; initial: TransactionFormState; existing?: TransactionDTO };

export function TransactionDialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<OpenRequest | null>(null);
  const [loaded, setLoaded] = React.useState<Loaded>({ status: "loading" });
  const [dirty, setDirty] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [formKey, setFormKey] = React.useState(0);
  const f = useFormat();
  const prefs = usePreferences();
  const user = useUser();

  const load = React.useCallback(
    async (req: OpenRequest) => {
      setDirty(false);
      setConfirmDiscard(false);
      if (req.mode === "create") {
        const last = recallLastEntry(user.id);
        const type = (req.defaults?.type ?? "EXPENSE") as EntryType;
        const initial = emptyTransactionForm({
          today: f.today(),
          accountId: req.defaults?.accountId ?? prefs.defaultAccountId ?? last.accountId ?? "",
          categoryId: req.defaults?.categoryId ?? (type !== "TRANSFER" ? last.category?.[type] ?? "" : ""),
          ...req.defaults,
          type,
        });
        setLoaded({ status: "ready", initial });
        return;
      }
      setLoaded({ status: "loading" });
      try {
        if (req.mode === "edit") {
          const tx = await api.get<TransactionDTO>(`/api/transactions/${req.id}`);
          setLoaded({ status: "ready", initial: transactionFormFromDTO(tx), existing: tx });
        } else {
          const draft = await api.get<Parameters<typeof transactionFormFromDTO>[0]>(`/api/transactions/${req.id}/duplicate`);
          setLoaded({ status: "ready", initial: { ...transactionFormFromDTO({ ...draft, status: "POSTED" }), status: "AUTO" } });
        }
      } catch (error) {
        setLoaded({ status: "error", error });
      }
      setFormKey((k) => k + 1);
    },
    [f, prefs.defaultAccountId, user.id]
  );

  const apiValue = React.useMemo<TransactionDialogApi>(
    () => ({
      openCreate: (defaults, opts) => {
        const req: OpenRequest = { mode: "create", defaults, lockType: opts?.lockType };
        setRequest(req);
        void load(req);
        setFormKey((k) => k + 1);
      },
      openEdit: (id) => {
        const req: OpenRequest = { mode: "edit", id };
        setRequest(req);
        void load(req);
      },
      openDuplicate: (id) => {
        const req: OpenRequest = { mode: "duplicate", id };
        setRequest(req);
        void load(req);
      },
    }),
    [load]
  );

  const close = () => {
    setRequest(null);
    setDirty(false);
    setConfirmDiscard(false);
  };

  const title =
    request?.mode === "edit" ? "Edit transaction" : request?.mode === "duplicate" ? "Duplicate transaction" : "New transaction";
  const description =
    request?.mode === "duplicate"
      ? "A copy dated today. Adjust anything before saving — nothing is saved until you confirm."
      : request?.mode === "edit"
        ? "Changes update balances, budgets and reports for both the old and the new values."
        : "Record money that left, arrived, or moved between your accounts.";

  return (
    <Ctx.Provider value={apiValue}>
      {children}
      <Dialog
        open={request !== null}
        onOpenChange={(o) => !o && close()}
        onRequestClose={() => {
          if (dirty) {
            setConfirmDiscard(true);
            return false;
          }
          return true;
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {confirmDiscard && (
            <div role="alert" className="mb-4 flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>Discard your unsaved changes?</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </Button>
                <Button size="sm" variant="destructive" onClick={close}>
                  Discard
                </Button>
              </div>
            </div>
          )}
          {loaded.status === "loading" && (
            <div className="space-y-4" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </div>
          )}
          {loaded.status === "error" && request && <ErrorState error={loaded.error} onRetry={() => void load(request)} />}
          {loaded.status === "ready" && request && (
            <TransactionForm
              key={formKey}
              mode={request.mode}
              initial={loaded.initial}
              existing={loaded.existing}
              lockType={request.mode === "create" ? request.lockType : request.mode === "edit" && loaded.existing?.type === "ADJUSTMENT"}
              onDirtyChange={setDirty}
              onCancel={() => {
                if (dirty) setConfirmDiscard(true);
                else close();
              }}
              onSaved={close}
              onReloadRequested={() => void load(request)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
