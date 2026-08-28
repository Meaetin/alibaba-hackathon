"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowRightLeft,
  Bell,
  CalendarDays,
  Clock3,
  MapPin,
  Plane,
  PlaneTakeoff,
  Radar,
} from "lucide-react";

import { Button } from "@/components/ui/primitives/Button";
import { PlaneSeatSelector } from "@/components/ui/flights/PlaneSeatSelector";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { Input } from "@/components/ui/primitives/Input";
import { useToast } from "@/contexts/ToastContext";
import { cn } from "@/lib/utils";

type FlightMode = "discover" | "track";

const FLIGHT_MODES: Array<{
  value: FlightMode;
  label: string;
  icon: typeof PlaneTakeoff;
}> = [
  { value: "discover", label: "Discover flights", icon: PlaneTakeoff },
  { value: "track", label: "Track a flight", icon: Radar },
];

export default function FlightsPage() {
  const { showToast } = useToast();
  const [mode, setMode] = useState<FlightMode>("discover");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    showToast({
      title: mode === "discover" ? "Flight search is nearly ready" : "Flight tracking is nearly ready",
      description: "This page is ready for the live flight-data connection.",
    });
  };

  return (
    <div
      className={cn("min-h-full bg-surface-alt pt-[var(--navbar-height)]")}
      data-region="flights-page"
    >
      <div
        className={cn("mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-8 md:px-8 lg:px-12")}
        data-region="flights-shell"
      >
        {/* Page Header */}
        <header
          className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between")}
          data-region="flights-header"
        >
          <div className={cn("flex max-w-2xl flex-col gap-3")}>
            <CategoryBadge category="flight" className={cn("size-10")} iconSize={20} />
            <div className={cn("flex flex-col gap-1")}>
              <h1 className={cn("type-h2 font-secondary font-semibold text-content")}>Flights</h1>
              <p className={cn("type-body-1 text-content-secondary")}>
                Discover the right route, then keep every departure update alongside your trip.
              </p>
            </div>
          </div>
          <Button variant="outline" size="md" icon="leading" onClick={() => setMode("track")}>
            <Bell className={cn("size-4")} />
            Track a flight
          </Button>
        </header>

        {/* Flight Search */}
        <section
          className={cn("overflow-hidden rounded-2xl bg-surface shadow-default")}
          data-region="flights-search"
        >
          <div
            className={cn("flex border-b border-edge px-3 pt-3")}
            role="tablist"
            aria-label="Flight tools"
          >
            {FLIGHT_MODES.map((item) => {
              const Icon = item.icon;
              const active = item.value === mode;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMode(item.value)}
                  className={cn(
                    "relative inline-flex h-11 items-center gap-2 px-3 type-body-2 font-medium text-content-secondary transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong",
                    active && "text-content",
                  )}
                >
                  <Icon className={cn("size-4")} />
                  {item.label}
                  {active && (
                    <span
                      className={cn("absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-action-brand")}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <form className={cn("flex flex-col gap-5 p-4 md:p-6")} onSubmit={handleSubmit}>
            {mode === "discover" ? (
              <>
                <div className={cn("grid gap-3 md:grid-cols-[1fr_auto_1fr]")}>
                  <label className={cn("flex flex-col gap-2")}>
                    <span className={cn("type-body-3 font-medium text-content-tertiary")}>From</span>
                    <Input
                      icon={<MapPin />}
                      placeholder="City or airport"
                      name="origin"
                      required
                      aria-label="Departure city or airport"
                    />
                  </label>
                  <div className={cn("hidden items-end pb-1 md:flex")}>
                    <Button variant="secondary" size="md" icon="only" type="button" aria-label="Swap airports">
                      <ArrowRightLeft className={cn("size-4")} />
                    </Button>
                  </div>
                  <label className={cn("flex flex-col gap-2")}>
                    <span className={cn("type-body-3 font-medium text-content-tertiary")}>To</span>
                    <Input
                      icon={<MapPin />}
                      placeholder="City or airport"
                      name="destination"
                      required
                      aria-label="Arrival city or airport"
                    />
                  </label>
                </div>

                <div className={cn("grid gap-3 md:grid-cols-2")}>
                  <label className={cn("flex flex-col gap-2")}>
                    <span className={cn("type-body-3 font-medium text-content-tertiary")}>Departure</span>
                    <Input icon={<CalendarDays />} type="date" name="departure" required aria-label="Departure date" />
                  </label>
                  <label className={cn("flex flex-col gap-2")}>
                    <span className={cn("type-body-3 font-medium text-content-tertiary")}>Return</span>
                    <Input icon={<CalendarDays />} type="date" name="return" aria-label="Return date" />
                  </label>
                </div>

                <div className={cn("flex justify-end")}>
                  <Button variant="primary" size="md" icon="leading" type="submit">
                    <PlaneTakeoff className={cn("size-4")} />
                    Search flights
                  </Button>
                </div>
              </>
            ) : (
              <div className={cn("grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]")}>
                <label className={cn("flex flex-col gap-2")}>
                  <span className={cn("type-body-3 font-medium text-content-tertiary")}>Flight number</span>
                  <Input icon={<Plane />} placeholder="e.g. SQ 12" name="flightNumber" required />
                </label>
                <label className={cn("flex flex-col gap-2")}>
                  <span className={cn("type-body-3 font-medium text-content-tertiary")}>Departure date</span>
                  <Input icon={<CalendarDays />} type="date" name="flightDate" required />
                </label>
                <Button variant="primary" size="md" icon="leading" type="submit">
                  <Radar className={cn("size-4")} />
                  Track flight
                </Button>
              </div>
            )}
          </form>
        </section>

        {/* Tracked Flights */}
        <section className={cn("flex flex-col gap-3")} data-region="flights-tracked">
          <div className={cn("flex items-center justify-between")}>
            <div className={cn("flex flex-col gap-0.5")}>
              <h2 className={cn("type-h4 font-secondary font-semibold text-content")}>Tracked flights</h2>
              <p className={cn("type-body-2 text-content-secondary")}>Live updates for flights you choose to follow.</p>
            </div>
          </div>
          <div
            className={cn("flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-edge bg-surface p-8 text-center")}
          >
            <div className={cn("flex size-12 items-center justify-center rounded-xl bg-cal-flight-bg-subtle text-cal-flight-marker")}>
              <Clock3 className={cn("size-6")} />
            </div>
            <div className={cn("flex max-w-md flex-col gap-1")}>
              <p className={cn("type-body-1 font-medium text-content")}>No flights tracked yet</p>
              <p className={cn("type-body-2 text-content-secondary")}>
                Search by flight number to keep departure times, gates, and status changes in one place.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setMode("track")}>
              Track your first flight
            </Button>
          </div>
        </section>

        {/* Seat Map Prototype */}
        <PlaneSeatSelector />
      </div>
    </div>
  );
}
