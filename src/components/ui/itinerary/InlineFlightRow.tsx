"use client";

import { ArrowRight } from "lucide-react";

import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import { cn } from "@/lib/utils";

interface InlineFlightRowProps {
  flight?: FlightCardProps | null;
  onClick: () => void;
  className?: string;
}

function flightSummary(flight: FlightCardProps): string {
  const route = `${flight.fromCode} → ${flight.toCode}`;
  const arrival = flight.arriveTime ? ` · Lands ${flight.arriveTime}` : "";
  return `${flight.flightNumber} · ${route}${arrival}`;
}

export function InlineFlightRow({ flight, onClick, className }: InlineFlightRowProps) {
  const label = flight ? flightSummary(flight) : "Add flight";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={flight ? `Open Flight tab for ${flight.flightNumber}` : "Open Flight tab to add a flight"}
      data-region="itinerary-inline-flight"
      className={cn(
        "group flex h-11 w-full items-center justify-between rounded-xl border border-edge bg-surface pl-2 pr-4 text-left shadow-xs",
        "transition-[border-color,box-shadow] duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)]",
        "hover:border-edge-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-brand",
        className,
      )}
    >
      <span className={cn("flex min-w-0 items-center gap-3")}>
        <CategoryBadge category="flight" iconSize={14} />
        <span className={cn("truncate type-body-2 font-medium text-content")}>{label}</span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className={cn(
          "ml-4 size-4 shrink-0 text-glyph-secondary transition-transform duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)] group-hover:translate-x-0.5",
        )}
      />
    </button>
  );
}
