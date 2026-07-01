"use client";

import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

interface LoadingScreenProps {
  className?: string;
  fullPage?: boolean;
}

export function LoadingScreen({ className, fullPage }: LoadingScreenProps) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center",
        fullPage && "min-h-dvh",
        className,
      )}
    >
      <Loader variant="dots" size="md" />
    </div>
  );
}
