export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-night-50/60 ${className}`} aria-hidden />;
}

export function MatchCardSkeleton() {
  return (
    <div className="rounded-xl border border-night-50/60 bg-night-200 p-3">
      <Skeleton className="mb-3 h-3 w-2/3" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-night-50 bg-night-200/50 p-8 text-center">
      <p className="font-display text-lg text-mist">{title}</p>
      {hint && <p className="mt-2 text-sm text-mist/70">{hint}</p>}
    </div>
  );
}
