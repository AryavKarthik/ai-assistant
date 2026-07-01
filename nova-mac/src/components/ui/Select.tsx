import { cn } from "../../lib/utils";
import type { SelectHTMLAttributes } from "react";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-[--nova-text]",
        "focus:outline-none focus:ring-2 focus:ring-[--nova-accent]/40",
        "appearance-none cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}
