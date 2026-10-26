"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { DURATION, EASE } from "@/lib/motion/tokens";

/**
 * Toasts for committed outcomes and general failures (field errors are shown
 * inline, not here). Announced to screen readers, paused while hovered or
 * focused, optional action (e.g. Undo) with a longer lifetime.
 */

type ToastType = "success" | "error" | "info";

interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  duration: number;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType, options?: { action?: ToastAction; duration?: number }) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const addToast = React.useCallback<ToastContextValue["addToast"]>((message, type = "info", options) => {
    const id = Math.random().toString(36).slice(2);
    const duration = options?.duration ?? (options?.action ? 8000 : type === "error" ? 6500 : 4500);
    setToasts((prev) => [...prev.slice(-2), { id, message, type, action: options?.action, duration }]);
    return id;
  }, []);

  const value = React.useMemo(() => ({ addToast, dismiss }), [addToast, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = React.useState(false);
  const remaining = React.useRef(toast.duration);
  const startedAt = React.useRef(Date.now());

  React.useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const t = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(t);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, onDismiss, toast.id]);

  const Icon = toast.type === "success" ? CheckCircle2 : toast.type === "error" ? AlertCircle : Info;
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.entry, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-popover p-3.5 text-popover-foreground shadow-lg"
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          toast.type === "success" && "text-inflow",
          toast.type === "error" && "text-outflow",
          toast.type === "info" && "text-primary"
        )}
        aria-hidden="true"
      />
      <p className="flex-1 text-sm leading-snug">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          className="shrink-0 rounded px-1.5 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={async () => {
            onDismiss(toast.id);
            await toast.action?.onClick();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">Dismiss</span>
      </button>
    </motion.div>
  );
}

function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[100] mx-auto flex w-full max-w-sm flex-col gap-2 px-4 md:bottom-4 md:right-4 md:left-auto md:mx-0"
      role="region"
      aria-label="Notifications"
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {toasts.at(-1)?.message}
      </div>
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>,
    document.body
  );
}
