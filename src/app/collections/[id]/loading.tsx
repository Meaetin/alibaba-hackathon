export default function CollectionDetailLoading() {
  return (
    <div className="collection-detail-loading flex flex-col flex-1 min-h-full relative pt-[var(--navbar-height)]">
      {/* Scrollable Content */}
      <div className="collection-detail-loading-content flex-1 overflow-auto">
        <div className="flex flex-col items-center px-3 pt-3 pb-10 md:px-8 lg:px-12 xl:px-20">
          <div className="flex w-full max-w-[1600px] flex-col gap-6">
            {/* Hero Section */}
            <div className="collection-detail-loading-hero flex w-full flex-col items-center gap-5">
              {/* Map + Avatar */}
              <div className="flex w-full flex-col items-center">
                <div className="-mb-20 h-60 w-full rounded-2xl bg-surface-muted animate-pulse opacity-50" />
                <div className="relative size-[180px] rounded-full border border-edge bg-surface p-1">
                  <div className="size-full rounded-full bg-surface-muted animate-pulse" />
                </div>
              </div>

              {/* Title + Description */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="h-6 w-48 rounded-lg bg-surface-muted animate-pulse" />
                <div className="h-4 w-64 rounded bg-surface-muted animate-pulse" />
              </div>

              {/* Action Bar */}
              <div className="flex items-center gap-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex w-[50px] flex-col items-center gap-1">
                    <div className="size-9 rounded-xl bg-surface-muted animate-pulse" />
                    <div className="h-3 w-9 rounded bg-surface-muted animate-pulse" />
                  </div>
                ))}
              </div>
            </div>

            {/* Cards Grid */}
            <div className="@container w-full">
              <div className="collection-detail-loading-grid bento-grid [--cols:2] sm:[--cols:3] lg:[--cols:4] xl:[--cols:5] [--ratio:calc(320/243)]">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-full rounded-2xl bg-surface-muted animate-pulse"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
