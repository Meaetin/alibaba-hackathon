import { CardGridSkeleton, FilterToolbarSkeleton } from "@/components/ui/skeletons";

export default function DashboardLoading() {
  return (
    <div className="dashboard-loading flex flex-col min-h-full">
      {/* Navigation Bar */}
      <div className="dashboard-loading-nav flex items-center gap-1 px-3 py-2 bg-surface">
        <div className="flex items-center gap-1">
          <div className="size-8 rounded-lg bg-surface-muted animate-pulse" />
          <div className="size-8 rounded-lg bg-surface-muted animate-pulse" />
        </div>
        <div className="flex items-center gap-1 h-8 px-2 py-1">
          <div className="size-5 rounded-full bg-surface-muted animate-pulse" />
          <div className="h-4 w-10 rounded bg-surface-muted animate-pulse" />
        </div>
      </div>

      {/* Main Content */}
      <div className="dashboard-loading-main flex-1 flex flex-col gap-8 px-6 py-3 overflow-auto">
        {/* Header */}
        <div className="dashboard-loading-header flex items-end justify-between">
          <div className="h-7 w-48 rounded-lg bg-action-secondary animate-pulse" />
          <div className="h-9 w-64 rounded-lg bg-action-secondary animate-pulse" />
        </div>

        {/* Create Section - 3 cards */}
        <div className="dashboard-loading-create flex gap-2 h-60">
          <div className="flex-1 rounded-xl bg-action-secondary animate-pulse" />
          <div className="flex-1 rounded-xl bg-action-secondary animate-pulse" />
          <div className="flex-1 rounded-xl bg-action-secondary animate-pulse" />
        </div>

        {/* Map */}
        <div className="dashboard-loading-map flex flex-col p-1 rounded-xl border border-edge bg-surface">
          <div className="h-[40vh] w-full rounded-lg bg-action-secondary animate-pulse" />
        </div>

        {/* Upcoming Trips */}
        <div className="dashboard-loading-trips flex flex-col gap-3">
          <div className="h-5 w-28 rounded bg-surface-muted animate-pulse" />
          <CardGridSkeleton />
        </div>

        {/* Recent Section */}
        <div className="dashboard-loading-recent flex flex-col gap-3">
          <FilterToolbarSkeleton pillCount={7} />
          <CardGridSkeleton />
        </div>
      </div>
    </div>
  );
}
