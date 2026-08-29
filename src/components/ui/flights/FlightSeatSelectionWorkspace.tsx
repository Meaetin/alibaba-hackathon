"use client";

import { Check, CircleDollarSign, Coffee, MoveHorizontal, Plane, X } from "lucide-react";
import { useMemo } from "react";

import { AircraftSeatMapSvg } from "@/components/ui/flights/AircraftSeatMapSvg";
import {
  createSandboxSeatMap,
  SEAT_COLUMNS,
  SEAT_ROWS,
  SEAT_STATE_LABELS,
  seatPositionLabel,
  type SeatState,
} from "@/lib/flights/seat-map";
import type { FlightOffer } from "@/lib/flights/atlas";
import { cn } from "@/lib/utils";

interface FlightSeatSelectionWorkspaceProps {
  offer: FlightOffer;
  passengerName: string;
  selectedSeatId: string | null;
  onSeatSelect: (seatId: string) => void;
}

function priceLabel(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

export function FlightSeatSelectionWorkspace({
  offer,
  passengerName,
  selectedSeatId,
  onSeatSelect,
}: FlightSeatSelectionWorkspaceProps) {
  const seats = useMemo(createSandboxSeatMap, []);
  const selectedSeat = seats.find((seat) => seat.id === selectedSeatId) ?? null;

  return (
    <section
      className={cn("flex size-full flex-col bg-surface-alt")}
      data-region="itinerary-flight-seat-workspace"
      aria-label="Choose a flight seat"
    >
      {/* Seat Workspace Header */}
      <header className={cn("flex shrink-0 items-center justify-between gap-4 border-b border-edge bg-surface px-5 py-4")}>
        <div className={cn("flex min-w-0 items-center gap-3")}>
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-cal-flight-bg-subtle text-cal-flight-marker")}>
            <Plane className={cn("size-4")} aria-hidden="true" />
          </span>
          <div className={cn("min-w-0")}>
            <h2 className={cn("type-body-1 font-semibold text-content")}>Choose a seat</h2>
            <p className={cn("truncate type-body-3 text-content-secondary")}>
              {offer.departureAirport} to {offer.arrivalAirport} · {passengerName || "Adult 1"}
            </p>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-full bg-surface-muted px-2.5 py-1 type-body-3 font-medium text-content-secondary")}>
          Airbus A320
        </span>
      </header>

      {/* Seat Map */}
      <div className={cn("relative min-h-0 flex-1 overflow-hidden")}>
        <AircraftSeatMapSvg
          className={cn("pointer-events-none absolute left-1/2 top-1/2 h-[1650px] w-[835px] max-w-none -translate-x-1/2 -translate-y-1/2")}
        />

        <div className={cn("absolute inset-y-4 left-1/2 flex w-[154px] -translate-x-1/2 flex-col items-center justify-between")}>
            <div className={cn("flex h-9 w-20 items-center justify-center rounded-lg border border-edge bg-surface text-content-secondary")}>
              <Coffee className={cn("size-4")} aria-hidden="true" />
              <span className={cn("sr-only")}>Front galley</span>
            </div>

            <div className={cn("grid w-full grid-cols-[repeat(3,1.25rem)_1.25rem_repeat(3,1.25rem)] justify-center gap-x-0.5 gap-y-1")}>
              {SEAT_COLUMNS.map((column, index) => (
                <span
                  key={column}
                  className={cn(
                    "flex h-5 items-center justify-center type-body-3 font-medium text-content-tertiary",
                    index === 3 && "col-start-5",
                  )}
                >
                  {column}
                </span>
              ))}

              {SEAT_ROWS.flatMap((row) => {
                const rowSeats = seats.filter((seat) => seat.row === row);
                return rowSeats.map((seat, index) => {
                  const selected = seat.id === selectedSeatId;
                  const occupied = seat.state === "occupied";
                  return (
                    <div key={seat.id} className={cn("contents")}>
                      {index === 3 && (
                        <span className={cn("col-start-4 flex h-5 items-center justify-center type-body-3 text-content-tertiary")}>
                          {row}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={occupied}
                        onClick={() => onSeatSelect(seat.id)}
                        aria-label={`${seat.id}, ${SEAT_STATE_LABELS[seat.state]}${seat.price ? `, ${priceLabel(seat.price, offer.currency)}` : ", included"}`}
                        aria-pressed={selected}
                        className={cn(
                          "flex size-5 items-center justify-center rounded-md border type-body-3 font-semibold transition-[background-color,border-color,color,transform]",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-brand focus-visible:ring-offset-1",
                          !occupied && "hover:-translate-y-0.5 hover:border-edge-strong",
                          seat.state === "available" && "border-edge-muted bg-surface text-content",
                          occupied && "cursor-not-allowed border-edge-subtle bg-surface-muted text-content-placeholder",
                          seat.state === "paid" && "border-edge-strong bg-surface text-content",
                          seat.state === "extra-legroom" && "border-edge-brand-subtle bg-surface-brand text-content-brand",
                          selected && "border-action-brand-border bg-action-brand text-content-on-brand",
                          index === 3 && "col-start-5",
                        )}
                      >
                        {selected ? (
                          <Check className={cn("size-3")} aria-hidden="true" />
                        ) : occupied ? (
                          <X className={cn("size-3")} aria-hidden="true" />
                        ) : seat.state === "paid" ? (
                          <CircleDollarSign className={cn("size-3")} aria-hidden="true" />
                        ) : seat.state === "extra-legroom" ? (
                          <MoveHorizontal className={cn("size-3")} aria-hidden="true" />
                        ) : (
                          <span className={cn("sr-only")}>Available</span>
                        )}
                      </button>
                    </div>
                  );
                });
              })}
            </div>

            <div className={cn("flex h-9 w-20 items-center justify-center rounded-lg border border-edge bg-surface text-content-secondary")}>
              <Coffee className={cn("size-4")} aria-hidden="true" />
              <span className={cn("sr-only")}>Rear galley</span>
            </div>
        </div>
      </div>

      {/* Seat Selection Footer */}
      <footer className={cn("flex shrink-0 items-center justify-between gap-4 border-t border-edge bg-surface px-5 py-3")} aria-live="polite">
        {selectedSeat ? (
          <>
            <div className={cn("flex min-w-0 items-center gap-3")}>
              <span className={cn("flex size-9 items-center justify-center rounded-lg bg-action-brand type-body-2 font-semibold text-content-on-brand")}>
                {selectedSeat.id}
              </span>
              <div className={cn("min-w-0")}>
                <p className={cn("type-body-2 font-medium text-content")}>{seatPositionLabel(selectedSeat.column)} · {SEAT_STATE_LABELS[selectedSeat.state]}</p>
                <p className={cn("type-body-3 text-content-secondary")}>Selected for {passengerName || "Adult 1"}</p>
              </div>
            </div>
            <span className={cn("type-body-2 font-semibold text-content")}>
              {selectedSeat.price ? priceLabel(selectedSeat.price, offer.currency) : "Included"}
            </span>
          </>
        ) : (
          <p className={cn("type-body-2 text-content-secondary")}>Select a seat, or continue without choosing one.</p>
        )}
      </footer>

      <span className={cn("sr-only")}>
        {(["available", "occupied", "extra-legroom", "paid"] as SeatState[]).map((state) => SEAT_STATE_LABELS[state]).join(", ")}
      </span>
    </section>
  );
}
