interface AppBrandProps {
  size?: "sm" | "md";
}

export function AppBrand({ size = "md" }: AppBrandProps) {
  return (
    <div
      className={`app-brand${size === "sm" ? " app-brand-sm" : ""}`}
      aria-label="Assistant"
    >
      <span className="app-brand-word">Assistant</span>
    </div>
  );
}
