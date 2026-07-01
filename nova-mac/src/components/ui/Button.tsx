import { cn } from "../../lib/utils";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-all",
        "focus:outline-none focus:ring-2 focus:ring-[--nova-accent]/40",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-4 py-2 text-sm",
        variant === "primary" && "bg-[--nova-accent] text-white hover:bg-[--nova-accent]/90",
        variant === "secondary" && "bg-white/8 border border-white/10 text-[--nova-text] hover:bg-white/12",
        variant === "ghost" && "text-[--nova-text-secondary] hover:text-[--nova-text] hover:bg-white/6",
        variant === "danger" && "bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/22",
        className,
      )}
      {...props}
    />
  );
}
