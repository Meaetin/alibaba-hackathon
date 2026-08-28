"use client";

import Image from "next/image";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

interface FlightRouteSectionProps extends ComponentPropsWithoutRef<"div"> {
  fromCode: string;
  fromCity: string;
  fromCountry?: string;
  toCode: string;
  toCity: string;
  toCountry?: string;
  flightNumber?: string;
  cost?: string;
  currency?: string;
  departTime?: string;
  departDate?: string;
  arriveTime?: string;
  flightDuration?: string;
  stops?: number;
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

function formatPrice(cost?: string, currency?: string): string {
  if (!cost) return "—";
  const amount = Number(cost);
  if (!currency || !Number.isFinite(amount)) return [currency, cost].filter(Boolean).join(" ");
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${cost}`;
  }
}

function formatDate(date?: string): string {
  if (!date) return "";
  const value = new Date(`${date}T00:00:00`);
  return Number.isNaN(value.getTime())
    ? date
    : value.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const FlightRouteSection = forwardRef<HTMLDivElement, FlightRouteSectionProps>(
  ({ className, fromCode, fromCity, fromCountry, toCode, toCity, toCountry, flightNumber, cost, currency, departTime, departDate, arriveTime, flightDuration, stops, ...props }, ref) => {
    const fromLabel = joinCityCountry(fromCity, fromCountry);
    const toLabel = joinCityCountry(toCity, toCountry);

    return (
      <div
        ref={ref}
        data-slot="flight-route-section"
        className={cn(
          "flight-route-section flex flex-col gap-3 rounded-xl bg-surface-alt p-3",
          className
        )}
        {...props}
      >
        {/* Ticket Header */}
        <div className={cn("flex items-center justify-between gap-3 type-body-2 font-semibold text-content")}>
          <span>{flightNumber || "Flight"}</span>
          <span className={cn("tabular-nums")}>{formatPrice(cost, currency)}</span>
        </div>

        {/* Ticket Route */}
        <div className={cn("grid grid-cols-[1fr_auto_1fr] items-center gap-3")}>
          <div className={cn("min-w-0")} title={fromLabel}>
            <p className={cn("type-h4 font-semibold tracking-tight text-content")}>{fromCode || "—"}</p>
            <p className={cn("type-body-2 text-content-secondary")}>{departTime || "—"}</p>
          </div>
          <div className={cn("relative flex h-14 min-w-28 items-end justify-center pb-0.5")} aria-hidden="true">
            <span className={cn("absolute inset-x-2 top-5 border-t border-dashed border-content-tertiary/60")} />
            <span className={cn("absolute left-1.5 top-[1.06rem] size-2 rounded-full border-2 border-content-tertiary/60 bg-surface")} />
            <span className={cn("absolute right-1.5 top-[1.06rem] size-2 rounded-full border-2 border-content-tertiary/60 bg-surface")} />
            <Image
              src="/images/stickers/Plane.svg"
              alt=""
              width={40}
              height={40}
              unoptimized
              className={cn("absolute left-1/2 top-0 size-10 -translate-x-1/2 object-contain")}
            />
            {flightDuration ? <span className={cn("relative type-body-2 tabular-nums text-content-secondary")}>{flightDuration}</span> : null}
          </div>
          <div className={cn("min-w-0 text-right")} title={toLabel}>
            <p className={cn("type-h4 font-semibold tracking-tight text-content")}>{toCode || "—"}</p>
            <p className={cn("type-body-2 text-content-secondary")}>{arriveTime || "—"}</p>
          </div>
        </div>

        {/* Ticket Meta */}
        <div className={cn("flex items-center gap-1.5 type-body-2 text-content-secondary")}>
          {formatDate(departDate) ? <span>{formatDate(departDate)}</span> : null}
          {formatDate(departDate) && typeof stops === "number" ? <span aria-hidden="true">·</span> : null}
          {typeof stops === "number" ? (
            <span>{stops === 0 ? "Direct" : `${stops} stop${stops === 1 ? "" : "s"}`}</span>
          ) : null}
        </div>
      </div>
    );
  }
);

FlightRouteSection.displayName = "FlightRouteSection";

export { FlightRouteSection };
export type { FlightRouteSectionProps };
