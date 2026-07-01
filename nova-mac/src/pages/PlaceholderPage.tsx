interface PlaceholderPageProps {
  title: string;
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div className="flex items-center justify-center h-full text-[--nova-text-secondary] text-sm">
      {title} — coming soon
    </div>
  );
}
