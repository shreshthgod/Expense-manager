"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { dialogVariants, overlayVariants, sheetVariants } from "@/lib/motion/tokens";

/**
 * Accessible modal dialog.
 *  - role="dialog", aria-modal, labelled by its title
 *  - focus moves in on open, is trapped (Tab / Shift+Tab), returns to the
 *    trigger on close; the app root is `inert` while open
 *  - Escape and overlay click close unless `onRequestClose` vetoes it (dirty forms)
 *  - phones (< 640px) get a bottom sheet with safe-area padding
 *  - the exiting dialog never intercepts clicks (pointer-events: none on exit)
 */

interface DialogContextValue {
  open: boolean;
  requestClose: () => void;
  titleId: string;
  descriptionId: string;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog parts must be used inside <Dialog>");
  return ctx;
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Return false to keep the dialog open (e.g. confirm discarding a dirty form). */
  onRequestClose?: () => boolean;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, onRequestClose, children }: DialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const requestClose = React.useCallback(() => {
    if (onRequestClose && onRequestClose() === false) return;
    onOpenChange(false);
  }, [onOpenChange, onRequestClose]);
  return <DialogContext.Provider value={{ open, requestClose, titleId, descriptionId }}>{children}</DialogContext.Provider>;
}

function useIsSmallScreen() {
  const [small, setSmall] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setSmall(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return small;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openDialogs = 0;

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  showCloseButton?: boolean;
  /** Force a presentation; default is dialog on desktop, sheet on phones. */
  presentation?: "auto" | "dialog" | "sheet";
  /** Element to focus first (defaults to the first focusable field). */
  initialFocusRef?: React.RefObject<HTMLElement>;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZES = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" } as const;

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  presentation = "auto",
  initialFocusRef,
  size = "md",
  ...props
}: DialogContentProps) {
  const { open, requestClose, titleId, descriptionId } = useDialogContext();
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const small = useIsSmallScreen();
  const asSheet = presentation === "sheet" || (presentation === "auto" && small);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const root = document.getElementById("app-root");
    openDialogs += 1;
    root?.setAttribute("inert", "");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = initialFocusRef?.current ?? panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? panel).focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      openDialogs = Math.max(0, openDialogs - 1);
      if (openDialogs === 0) {
        root?.removeAttribute("inert");
        document.body.style.overflow = prevOverflow;
      }
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, requestClose, initialFocusRef]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" key="dialog-root">
          <motion.div
            className="absolute inset-0 bg-foreground/40 dark:bg-black/60"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={requestClose}
            aria-hidden="true"
          />
          <div className={cn("pointer-events-none absolute inset-0 flex p-0 sm:p-4", asSheet ? "items-end" : "items-center justify-center")}>
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              tabIndex={-1}
              variants={asSheet ? sheetVariants : dialogVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={cn(
                "pointer-events-auto relative flex w-full flex-col border bg-popover text-popover-foreground shadow-xl outline-none",
                asSheet
                  ? "max-h-[92dvh] rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
                  : cn("max-h-[88dvh] rounded-xl", SIZES[size]),
                className
              )}
              {...(props as React.ComponentProps<typeof motion.div>)}
            >
              {asSheet && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-5 sm:p-6">{children}</div>
              {showCloseButton && (
                <button
                  type="button"
                  onClick={requestClose}
                  className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </button>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1 pr-8", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky bottom-0 -mx-5 -mb-5 mt-5 flex flex-col-reverse gap-2 border-t bg-popover px-5 py-4 sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6",
        className
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialogContext();
  return <h2 id={titleId} className={cn("text-lg font-semibold leading-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialogContext();
  return <p id={descriptionId} className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
