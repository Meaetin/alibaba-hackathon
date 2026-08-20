"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ItineraryHeaderProps {
  bannerUrl: string | null;
  name: string;
  region: string | null;
  country: string;
  dateLabel: string;
  /** Optional top-right slot — e.g. the kebab `⋮` menu (kept out of this presentational row). */
  menu?: ReactNode;
  className?: string;
}

/**
 * Header row of the itinerary page header region (Figma `1734:13374`): a 180px
 * circular "PhoneFrame" banner + title/description/date stack on the left, with
 * an optional menu slot pinned top-right. Purely presentational and
 * variant-ready (e.g. a future profile-page variant).
 */
export function ItineraryHeader({
  bannerUrl,
  name,
  region,
  country,
  dateLabel,
  menu,
  className,
}: ItineraryHeaderProps) {
  return (
    <div className={cn("itinerary-header flex items-start justify-between gap-3", className)}>
      {/* Left: Banner + Info */}
      <div className="itinerary-header-left flex min-w-0 items-center gap-4 md:gap-6">
        {/* Banner */}
        <div
          data-region="itinerary-detail-header-thumbnail"
          className="itinerary-header-banner size-24 shrink-0 overflow-hidden rounded-full border-[1.25px] border-edge bg-surface p-1 shadow-default sm:size-32 md:size-[180px]"
        >
          <div className="itinerary-header-banner-inner size-full overflow-hidden rounded-full border-[1.25px] border-edge bg-surface-muted">
            {bannerUrl && (
              <img
                src={bannerUrl}
                alt={name}
                className="itinerary-header-banner-image size-full rounded-full object-cover"
                draggable={false}
              />
            )}
          </div>
        </div>

        {/* Info */}
        <div
          data-region="itinerary-detail-header-title"
          className="itinerary-header-info flex min-w-0 flex-col items-start justify-center gap-1.5"
        >
          <h1 className="itinerary-header-title max-w-full truncate type-h4 type-secondary font-semibold text-content">
            {name}
          </h1>
          <p className="itinerary-header-location max-w-full truncate type-body-2 font-medium text-content-secondary">
            {region ? `${region}, ${country}` : country}
          </p>
          <p className="itinerary-header-dates max-w-full truncate type-body-2 text-content-secondary">{dateLabel}</p>
        </div>
      </div>

      {/* Menu Slot */}
      <div className="shrink-0">{menu}</div>
    </div>
  );
}
