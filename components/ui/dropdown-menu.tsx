"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { DURATION, EASE } from "@/lib/motion/tokens";

/**
 * Menu button (WAI-ARIA): Enter/Space/ArrowDown opens, arrows move, Escape
 * closes and returns focus, typing a letter jumps. Rendered in a portal and
 * positioned against the trigger so it never gets clipped by tables.
 */

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
  menuId: string;
}

const MenuContext = React.createContext<MenuContextValue | null>(null);

function useMenu() {
  const ctx = React.useContext(MenuContext);
  if (!ctx) throw new Error("DropdownMenu parts must be used inside <DropdownMenu>");
  return ctx;
}

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuId = React.useId();
  return <MenuContext.Provider value={{ open, setOpen, triggerRef, menuId }}>{children}</MenuContext.Provider>;
}

export const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, onKeyDown, ...props }, _ref) => {
    const { open, setOpen, triggerRef, menuId } = useMenu();
    return (
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          onClick?.(e);
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        {...props}
      />
    );
  }
);
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

export function DropdownMenuContent({
  className,
  children,
  align = "end",
}: {
  className?: string;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const { open, setOpen, triggerRef, menuId } = useMenu();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; placeAbove: boolean } | null>(null);

  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      const width = 208;
      const left = align === "end" ? Math.max(8, r.right - width) : Math.min(window.innerWidth - width - 8, r.left);
      const placeAbove = r.bottom + 260 > window.innerHeight && r.top > 260;
      setPos({ top: placeAbove ? r.top - 4 : r.bottom + 4, left, placeAbove });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, triggerRef]);

  React.useEffect(() => {
    if (!open) return;
    const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    requestAnimationFrame(() => items()[0]?.focus());
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const i = list.findIndex((el) => el === document.activeElement);
      if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(i + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(i - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        list[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        list[list.length - 1]?.focus();
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        const match = list.find((el, idx) => idx > i && el.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()))
          ?? list.find((el) => el.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()));
        match?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, triggerRef]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <motion.div
          ref={menuRef}
          id={menuId}
          role="menu"
          initial={{ opacity: 0, y: pos.placeAbove ? 4 : -4 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DURATION.disclosure, ease: EASE.out } }}
          exit={{ opacity: 0, transition: { duration: DURATION.exit } }}
          style={{ top: pos.top, left: pos.left, position: "fixed", ...(pos.placeAbove ? { transform: "translateY(-100%)" } : {}) }}
          className={cn("z-[60] w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export function DropdownMenuItem({
  className,
  onSelect,
  destructive,
  disabled,
  children,
}: {
  className?: string;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { setOpen, triggerRef } = useMenu();
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        setOpen(false);
        triggerRef.current?.focus();
        onSelect?.();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
          onSelect?.();
        }
      }}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none transition-colors focus:bg-accent [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
        destructive ? "text-outflow focus:bg-outflow-soft" : "focus:text-accent-foreground",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">{children}</div>;
}
