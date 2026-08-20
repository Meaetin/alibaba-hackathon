interface CardGridSkeletonProps {
  count?: number;
  cardHeight?: string;
  className?: string;
}

export function CardGridSkeleton({
  count = 5,
  cardHeight = "h-[var(--card-height)]",
  className,
}: CardGridSkeletonProps) {
  return (
    <div className={`card-grid-skeleton grid grid-cols-5 gap-3 ${className ?? ""}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`card-grid-skeleton-item ${cardHeight} rounded-xl bg-action-secondary animate-pulse`}
        />
      ))}
    </div>
  );
}
