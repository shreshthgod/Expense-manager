"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bot, MessageSquarePlus, MoreHorizontal, Pin, PinOff, Send, Trash2, Pencil, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ErrorState, PageHeader } from "@/components/app/states";
import { useFormat } from "@/components/providers/app-context";
import { api, errorMessage } from "@/lib/client/api";
import { qk, useFinanceMutation, useInvalidate } from "@/lib/client/query";
import type { ConversationDTO, MessageDTO } from "@/server/services/chat.service";
import type { AgentChatResponse, ProposedAction, Recommendation } from "@/types";
import { cn } from "@/lib/utils/cn";

const SUGGESTIONS = [
  "Where did most of my money go this month?",
  "How are my budgets doing?",
  "Can I afford a ₹25,000 phone?",
  "Which subscriptions cost me the most?",
  "Am I on track with my goals?",
  "Generate a report for last month",
];

type Meta = { findings?: string[]; recommendations?: Recommendation[]; evidence?: { label: string; value: string }[]; confidence?: string; usedAI?: boolean; reportId?: string | null; actions?: ProposedAction[] };

function ActionButton({ a }: { a: ProposedAction }) {
  const f = useFormat();
  const { addToast } = useToast();
  const [confirm, setConfirm] = React.useState(false);
  const create = useFinanceMutation({
    affects: ["budget"],
    mutationFn: (body: unknown) => api.post("/api/budgets", body),
    onSuccess: () => addToast("Budget created", "success"),
  });
  if (a.kind === "open") return <Button asChild size="xs" variant="outline"><Link href={a.href}>{a.label}</Link></Button>;
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setConfirm(true)}>{a.label}</Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        destructive={false}
        confirmLabel="Create budget"
        title={a.label}
        description={`${a.reason} This creates a monthly budget of ${f.money(a.payload.amount)} for ${a.payload.name}, starting ${f.date(a.payload.startDate)}. You can edit it afterwards.`}
        onConfirm={async () => {
          try {
            await create.mutateAsync(a.payload);
          } catch (e) {
            addToast(errorMessage(e), "error");
          }
        }}
      />
    </>
  );
}

function AssistantMessage({ content, meta }: { content: string; meta: Meta | null }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>
      {meta?.findings && meta.findings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{meta.findings.map((x) => <li key={x}>{x}</li>)}</ul>}
      {meta?.recommendations && meta.recommendations.length > 0 && (
        <div className="space-y-2">
          {meta.recommendations.map((r) => (
            <div key={r.title} className="rounded-lg border bg-card p-3 text-sm">
              <p className="font-medium">{r.title}</p>
              <p className="text-muted-foreground">{r.detail}</p>
              {r.expectedImpact && <p className="mt-1 text-xs text-muted-foreground">{r.expectedImpact}</p>}
            </div>
          ))}
        </div>
      )}
      {meta?.reportId && <Button asChild size="xs"><Link href={`/reports/${meta.reportId}`}>Open the report</Link></Button>}
      {meta?.actions && meta.actions.length > 0 && <div className="flex flex-wrap gap-2">{meta.actions.map((a) => <ActionButton key={a.label} a={a} />)}</div>}
      {meta?.evidence && meta.evidence.length > 0 && (
        <div>
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Figures used <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
          {open && (
            <dl className="mt-2 grid gap-1 rounded-lg bg-muted/60 p-2.5 text-xs sm:grid-cols-2">
              {meta.evidence.map((e) => <div key={e.label} className="flex justify-between gap-2"><dt className="text-muted-foreground">{e.label}</dt><dd className="num">{e.value}</dd></div>)}
            </dl>
          )}
        </div>
      )}
      {meta && (
        <p className="text-[11px] text-muted-foreground">
          {meta.usedAI ? "Phrased by the AI model from computed figures" : "Computed answer"}{meta.confidence ? ` · confidence ${meta.confidence}` : ""} · informational, not financial advice
        </p>
      )}
    </div>
  );
}

export default function AssistantPage() {
  const f = useFormat();
  const { addToast } = useToast();
  const invalidate = useInvalidate();
  const [active, setActive] = React.useState<string | null>(null);
  const [input, setInput] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = React.useState<ConversationDTO | null>(null);
  const [showList, setShowList] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const status = useQuery({ queryKey: qk("conversations", "status"), queryFn: () => api.get<{ available: boolean; model: string | null }>("/api/ai/status"), staleTime: 10 * 60_000 });
  const list = useQuery({ queryKey: qk("conversations", "list"), queryFn: () => api.get<ConversationDTO[]>("/api/ai/conversations") });
  const convo = useQuery({
    queryKey: qk("conversations", "detail", active),
    queryFn: () => api.get<ConversationDTO & { messages: MessageDTO[] }>(`/api/ai/conversations/${active}`),
    enabled: !!active,
  });
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an
  // effect must not return anything but a clean-up function.
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [convo.data?.messages.length, pending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    setPending(message);
    setInput("");
    try {
      const res = await api.post<AgentChatResponse>("/api/ai/chat", { message, conversationId: active ?? undefined });
      setActive(res.data.conversationId);
      await invalidate("conversation");
      if (res.data.reportId) await invalidate("report");
    } catch (e) {
      addToast(errorMessage(e), "error");
      setInput(message);
    } finally {
      setPending(null);
    }
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await api.patch(`/api/ai/conversations/${id}`, body);
      await invalidate("conversation");
    } catch (e) {
      addToast(errorMessage(e), "error");
    }
  };
  const messages = active ? convo.data?.messages ?? [] : [];

  const sidebar = (
    <nav aria-label="Conversations" className="space-y-1">
      <Button variant="outline" size="sm" className="mb-2 w-full" onClick={() => { setActive(null); setShowList(false); }}>
        <MessageSquarePlus aria-hidden="true" /> New conversation
      </Button>
      {list.isLoading ? <Skeleton className="h-24" /> : (list.data ?? []).length === 0 ? <p className="px-2 text-xs text-muted-foreground">No conversations yet.</p> : (
        list.data!.map((c) => (
          <div key={c.id} className={cn("group flex items-center gap-1 rounded-md", active === c.id && "bg-primary-soft")}>
            <button type="button" onClick={() => { setActive(c.id); setShowList(false); }} className="min-w-0 flex-1 rounded-md px-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-current={active === c.id ? "true" : undefined}>
              <span className="flex items-center gap-1 truncate font-medium">{c.pinned && <Pin className="h-3 w-3 shrink-0 text-primary" aria-label="Pinned" />}{c.title}</span>
              <span className="block text-xs text-muted-foreground">{f.timeAgo(c.updatedAt)}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Actions for ${c.title}`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => void patch(c.id, { pinned: !c.pinned })}>{c.pinned ? <><PinOff aria-hidden="true" /> Unpin</> : <><Pin aria-hidden="true" /> Pin</>}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRenaming({ id: c.id, title: c.title })}><Pencil aria-hidden="true" /> Rename</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDeleting(c)}><Trash2 aria-hidden="true" /> Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))
      )}
    </nav>
  );

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Ask about your money. Answers are calculated from your records first; the AI (when configured) only phrases them."
        actions={
          <>
            {status.data && <Badge variant={status.data.available ? "inflow" : "secondary"}>{status.data.available ? "AI connected" : "Computed answers only"}</Badge>}
            <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setShowList((s) => !s)} aria-expanded={showList}>History</Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className={cn("lg:block", showList ? "block" : "hidden")}>{sidebar}</aside>
        <Card className="flex min-h-[60vh] flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5" aria-live="polite">
            {active && convo.isLoading ? (
              <Skeleton className="h-32" />
            ) : active && convo.isError ? (
              <ErrorState error={convo.error} onRetry={() => convo.refetch()} />
            ) : messages.length === 0 && !pending ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary"><Bot className="h-6 w-6" aria-hidden="true" /></span>
                <p className="max-w-sm text-sm text-muted-foreground">Try one of these, or ask in your own words.</p>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => <Button key={s} size="xs" variant="outline" onClick={() => void send(s)}>{s}</Button>)}
                </div>
              </div>
            ) : (
              <>
                {messages.filter((m) => m.role === "USER" || m.role === "ASSISTANT").map((m) => (
                  <div key={m.id} className={cn("flex", m.role === "USER" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[85%] rounded-2xl px-4 py-3", m.role === "USER" ? "bg-primary text-primary-foreground" : "bg-muted/60")}>
                      {m.role === "USER" ? <p className="whitespace-pre-wrap text-sm">{m.content}</p> : <AssistantMessage content={m.content} meta={m.metadata as Meta | null} />}
                    </div>
                  </div>
                ))}
                {pending && (
                  <>
                    <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground">{pending}</div></div>
                    <div className="flex justify-start"><div className="rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground" role="status">Looking at your data…</div></div>
                  </>
                )}
              </>
            )}
            <div ref={endRef} />
          </div>
          <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <Textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              placeholder="Ask about spending, budgets, goals, subscriptions…"
              aria-label="Message"
              maxLength={2000}
              className="min-h-10 resize-none"
            />
            <Button type="submit" size="icon" loading={!!pending} disabled={!input.trim()} aria-label="Send"><Send aria-hidden="true" /></Button>
          </form>
        </Card>
      </div>
      <ConfirmDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        destructive={false}
        confirmLabel="Rename"
        title="Rename conversation"
        onConfirm={async () => { if (renaming?.title.trim()) await patch(renaming.id, { title: renaming.title.trim() }); }}
      >
        <Input value={renaming?.title ?? ""} onChange={(e) => setRenaming((r) => (r ? { ...r, title: e.target.value } : r))} aria-label="Title" maxLength={80} />
      </ConfirmDialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this conversation?"
        description="Messages are removed permanently. Reports it generated are kept."
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api.delete(`/api/ai/conversations/${deleting.id}`);
            if (active === deleting.id) setActive(null);
            await invalidate("conversation");
          } catch (e) {
            addToast(errorMessage(e), "error");
          }
        }}
      />
    </>
  );
}
