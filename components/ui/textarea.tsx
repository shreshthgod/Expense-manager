import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { inputClass } from "./input";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea className={cn(inputClass, "h-auto min-h-[80px] resize-y py-2", className)} ref={ref} {...props} />
));
Textarea.displayName = "Textarea";

export { Textarea };
