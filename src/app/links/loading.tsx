import { LINK_CARD_GRID_ROWS } from "@/components/ui/cards/constants";
import { cn } from "@/lib/utils";

export default function LinksLoading() {
  return (
    <div className="links-loading flex flex-col min-h-full">
      {/* Navigation Bar */}
      <div className="links-loading-nav flex items-center gap-1 px-3 py-2 bg-surface">
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
      <div className="links-loading-main flex-1 flex flex-col items-center px-10 pt-3 pb-10 overflow-auto">
        <div className="links-loading-content flex flex-col gap-6 max-w-[1280px] w-full">
          {/* Header */}
          <div className="links-loading-header flex items-start justify-between w-full">
            <div className="h-7 w-28 rounded-lg bg-action-secondary animate-pulse" />
            <div className="h-14 w-[280px] rounded-2xl bg-action-secondary animate-pulse" />
          </div>

          {/* Cards Grid */}
          <div className={cn("links-loading-grid grid grid-cols-5 gap-3 w-full", LINK_CARD_GRID_ROWS)}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="links-loading-card rounded-2xl bg-action-secondary animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
