"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

interface FlightRouteSectionProps extends ComponentPropsWithoutRef<"div"> {
  fromCode: string;
  fromCity: string;
  fromCountry?: string;
  toCode: string;
  toCity: string;
  toCountry?: string;
  flightDuration?: string;
}

/** Show "City, Country" beneath the IATA code, falling back to "City" alone
 *  when the extraction didn't capture a country. The wider container width
 *  accommodates the longer string. */
function joinCityCountry(city: string, country?: string): string {
  const c = city.trim();
  const ctry = (country ?? "").trim();
  if (c && ctry) return `${c}, ${ctry}`;
  return c || "—";
}

const FlightRouteSection = forwardRef<HTMLDivElement, FlightRouteSectionProps>(
  ({ className, fromCode, fromCity, fromCountry, toCode, toCity, toCountry, flightDuration, ...props }, ref) => {
    const fromLabel = joinCityCountry(fromCity, fromCountry);
    const toLabel = joinCityCountry(toCity, toCountry);

    return (
      <div
        ref={ref}
        data-slot="flight-route-section"
        className={cn(
          "flight-route-section flex items-center gap-2 rounded-xl bg-surface p-3 shadow-default",
          className
        )}
        {...props}
      >
        {/* Origin */}
        <div className="flight-route-origin flex flex-col items-start shrink-0 min-w-[64px] max-w-[120px]">
          <span className="flight-route-origin-code type-h3 type-secondary font-bold text-content tracking-tight">
            {fromCode || "—"}
          </span>
          <span className="flight-route-origin-city type-body-3 text-content-tertiary truncate max-w-full">
            {fromLabel}
          </span>
        </div>

        {/* Center Path */}
        <div className="flight-route-path flex flex-1 flex-col items-center gap-0.5 min-w-0">
          <div className="flight-route-path-track flex w-full items-center gap-1.5">
            <div className="flight-route-path-dot size-1.5 rounded-full bg-content-tertiary shrink-0" />
            <div className="flight-route-path-line flex-1 h-px border-t border-dashed border-content-tertiary/40" />
            <div className="flight-route-plane-wrapper relative shrink-0 size-16">
              <img
                src="/images/plane-3d.png"
                alt=""
                className="flight-route-plane-image absolute inset-0 size-full object-cover rounded-[7.2px] rotate-[155deg] -scale-y-100"
              />
            </div>
            <div className="flight-route-path-line flex-1 h-px border-t border-dashed border-content-tertiary/40" />
            <div className="flight-route-path-dot size-1.5 rounded-full bg-content-tertiary shrink-0" />
          </div>
          {flightDuration && (
            <span className="flight-route-duration type-body-3 text-content-tertiary">
              {flightDuration}
            </span>
          )}
        </div>

        {/* Destination */}
        <div className="flight-route-destination flex flex-col items-end shrink-0 min-w-[64px] max-w-[120px]">
          <span className="flight-route-destination-code type-h3 type-secondary font-bold text-content tracking-tight">
            {toCode || "—"}
          </span>
          <span className="flight-route-destination-city type-body-3 text-content-tertiary truncate max-w-full text-right">
            {toLabel}
          </span>
        </div>
      </div>
    );
  }
);

FlightRouteSection.displayName = "FlightRouteSection";

export { FlightRouteSection };
export type { FlightRouteSectionProps };
