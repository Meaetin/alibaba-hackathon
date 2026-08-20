import { CardGridSkeleton } from "@/components/ui/skeletons";

export default function CollectionsLoading() {
  return (
    <div className="collections-loading flex flex-col min-h-full">
      {/* Navigation Bar */}
      <div className="collections-loading-nav flex items-center gap-1 px-3 py-2 bg-surface">
        <div className="flex items-center gap-1">
          <div className="size-8 rounded-lg bg-surface-muted animate-pulse" />
          <div className="size-8 rounded-lg bg-surface-muted animate-pulse" />
        </div>
        <div className="flex items-center gap-1 h-8 px-2 py-1">
          <div className="size-5 rounded-full bg-surface-muted animate-pulse" />
          <div className="h-4 w-16 rounded bg-surface-muted animate-pulse" />
        </div>
      </div>

      {/* Main Content */}
      <div className="collections-loading-main flex-1 flex flex-col gap-8 px-6 py-3 overflow-auto">
        {/* Header */}
        <div className="collections-loading-header flex items-center">
          <div className="h-7 w-24 rounded-lg bg-action-secondary animate-pulse" />
        </div>

        {/* Map */}
        <div className="collections-loading-map flex flex-col p-1 rounded-xl border border-edge bg-surface">
          <div className="h-[400px] w-full rounded-lg bg-action-secondary animate-pulse" />
        </div>

        {/* Controls */}
        <div className="collections-loading-controls flex items-center justify-between">
          <div className="flex gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="size-8 rounded-lg bg-surface-muted animate-pulse" />
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <div className="h-9 w-48 rounded-lg bg-surface-muted animate-pulse" />
            <div className="h-9 w-16 rounded-lg bg-surface-muted animate-pulse" />
          </div>
        </div>

        {/* Card Grid */}
        <CardGridSkeleton />
      </div>
    </div>
  );
}
