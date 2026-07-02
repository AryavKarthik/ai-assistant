import { cn } from "../../lib/utils";
import type { SelectHTMLAttributes } from "react";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          "w-full rounded-full border border-white/[0.06] bg-white/[0.06] pl-3.5 pr-8 py-1.5",
          "text-[12.5px] text-[--nova-text] appearance-none cursor-pointer",
          "transition-colors hover:bg-white/[0.09]",
          "focus:outline-none focus:ring-2 focus:ring-[--nova-accent]/40",
        )}
        {...props}
      />
      <svg
        width="9"
        height="9"
        viewBox="0 0 9 9"
        fill="none"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[--nova-text-secondary]"
      >
        <path d="M1 3L4.5 6.5L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
