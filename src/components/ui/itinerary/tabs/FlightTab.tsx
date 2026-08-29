"use client";

import { Bell, BellOff, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { FlightSidebar } from "@/components/ui/detail-views/FlightSidebar";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import { FilePillHeader, type FilePillHeaderFile } from "@/components/ui/detail-views/FilePillHeader";
import type { FlightPriceWatch } from "@/lib/flights/atlas";

interface FlightTabProps {
  flights: FlightCardProps[];
  loading?: boolean;
  files?: FilePillHeaderFile[];
  onAddFile?: () => void;
  onRemoveFile?: (id: string) => void;
  onAddManual?: () => void;
  onFlightEdit?: (flightId: string) => void;
  onFlightDelete?: (flightId: string) => void;
  onFlightOpen?: (flightId: string) => void;
  priceWatches?: FlightPriceWatch[];
  onPriceWatchSelect?: (watch: FlightPriceWatch) => void;
  onPriceWatchRemove?: (watch: FlightPriceWatch) => void;
  className?: string;
}

function priceLabel(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(price);
  } catch {
    return `${currency} ${price.toFixed(0)}`;
  }
}

export function FlightTab({ flights, loading, files, onAddFile, onRemoveFile, onAddManual, onFlightEdit, onFlightDelete, onFlightOpen, priceWatches = [], onPriceWatchSelect, onPriceWatchRemove, className }: FlightTabProps) {
  return (
    <div data-slot="flight-tab" className={cn("flight-tab-root flex flex-col gap-3 h-full", className)}>
      {/* File Pills */}
      {files && files.length > 0 && (
        <FilePillHeader files={files} onAddFile={onAddFile} onRemoveFile={onRemoveFile} />
      )}

      {/* Tracked Fares */}
      {priceWatches.length > 0 && (
        <section className={cn("flex flex-col gap-2 px-1")} data-region="itinerary-flight-price-watches">
          <div className={cn("flex items-center justify-between px-1")}>
            <div className={cn("flex items-center gap-1.5")}>
              <Bell className={cn("size-3.5 text-cal-flight-marker")} aria-hidden="true" />
              <h3 className={cn("type-body-3 font-medium text-content-secondary")}>Tracked fares</h3>
            </div>
            <span className={cn("type-body-4 text-content-tertiary")}>Every 15 min</span>
          </div>
          {priceWatches.map((watch) => {
            const change = watch.latestPrice - watch.initialPrice;
            return (
              <div
                key={watch.offer.offerKey}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border border-edge-subtle bg-surface p-3 text-left outline-none",
                  "transition-[border-color,box-shadow] hover:border-edge-muted hover:shadow-xs",
                )}
              >
                <button
                  type="button"
                  onClick={() => onPriceWatchSelect?.(watch)}
                  className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none active:translate-y-px focus-visible:ring-2 focus-visible:ring-edge-strong/50")}
                >
                  <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5")}>
                    <span className={cn("type-body-2 font-semibold text-content")}>{watch.offer.flightNumbers.join(" · ")}</span>
                    <span className={cn("type-body-3 text-content-secondary")}>{watch.offer.departureAirport} → {watch.offer.arrivalAirport}</span>
                    <span className={cn("flex items-center gap-1 type-body-4", watch.status === "error" || watch.status === "unavailable" ? "text-content-error" : "text-content-tertiary")}>
                      {watch.status === "changed" && change < 0 ? <TrendingDown className={cn("size-3")} /> : null}
                      {watch.status === "changed" && change > 0 ? <TrendingUp className={cn("size-3")} /> : null}
                      {watch.status === "unavailable" ? "Currently unavailable" : watch.status === "error" ? "Refresh failed" : change === 0 ? "No price change" : `${change < 0 ? "Down" : "Up"} ${priceLabel(Math.abs(change), watch.offer.currency)}`}
                    </span>
                  </span>
                  <span className={cn("flex shrink-0 items-center gap-2")}>
                    <span className={cn("type-body-2 font-semibold text-content tabular-nums")}>{priceLabel(watch.latestPrice, watch.offer.currency)}</span>
                    <ChevronRight className={cn("size-4 text-content-tertiary")} aria-hidden="true" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onPriceWatchRemove?.(watch)}
                  aria-label={`Stop tracking ${watch.offer.flightNumbers.join(" · ")}`}
                  title="Stop tracking"
                  className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg text-glyph-secondary outline-none transition-colors hover:bg-surface-muted hover:text-glyph focus-visible:ring-2 focus-visible:ring-edge-strong/50")}
                >
                  <BellOff className={cn("size-4")} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </section>
      )}

      {/* Flight List */}
      <FlightSidebar flights={flights} loading={loading} onAddManual={onAddManual} onUpload={onAddFile} onFlightEdit={onFlightEdit} onFlightDelete={onFlightDelete} onFlightOpen={onFlightOpen} />
    </div>
  );
}
