"use client";

import { useMemo, useState } from "react";
import { Check, CircleDollarSign, Coffee, MoveHorizontal, X } from "lucide-react";

import { AircraftSeatMapSvg } from "@/components/ui/flights/AircraftSeatMapSvg";
import { Button } from "@/components/ui/primitives/Button";
import { useToast } from "@/contexts/ToastContext";
import {
  createSandboxSeatMap,
  SEAT_COLUMNS,
  SEAT_ROWS,
  SEAT_STATE_LABELS,
  seatPositionLabel,
  type SeatState,
} from "@/lib/flights/seat-map";
import { cn } from "@/lib/utils";

export function PlaneSeatSelector() {
  const { showToast } = useToast();
  const seats = useMemo(createSandboxSeatMap, []);
  const [selectedSeatId, setSelectedSeatId] = useState("12A");
  const selectedSeat = seats.find((seat) => seat.id === selectedSeatId) ?? seats[0];

  return (
    <section
      className={cn("flex flex-col gap-5 rounded-2xl border border-edge bg-surface p-4 shadow-default md:p-6")}
      data-region="flights-seat-map-prototype"
    >
      {/* Seat Map Header */}
      <div className={cn("flex flex-col gap-1")}> 
        <p className={cn("type-body-3 font-medium uppercase tracking-wide text-content-tertiary")}>Interactive prototype</p>
        <h2 className={cn("type-h4 font-secondary font-semibold text-content")}>Choose your seat</h2>
        <p className={cn("type-body-2 text-content-secondary")}>Mock Airbus A320 layout · Singapore to Tokyo</p>
      </div>

      {/* Seat Map Workspace */}
      <div
        className={cn("grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]")}
        data-region="flights-seat-map-workspace"
      >
        <div className={cn("overflow-hidden rounded-2xl bg-surface-alt py-6")} data-region="flights-seat-map">
          <div className={cn("relative left-1/2 h-[1584px] w-[800px] -translate-x-1/2")}>
            <AircraftSeatMapSvg className={cn("absolute inset-0")} />

            <div className={cn("absolute left-1/2 top-56 flex w-[152px] -translate-x-1/2 flex-col items-center gap-3")}> 
              <div className={cn("flex h-9 w-16 items-center justify-center rounded-lg border border-edge bg-surface text-content-secondary")}>
                <Coffee className={cn("size-4")} aria-hidden="true" />
                <span className={cn("sr-only")}>Front galley</span>
              </div>

              <div className={cn("grid w-full grid-cols-[repeat(3,1.25rem)_1.25rem_repeat(3,1.25rem)] justify-center gap-x-0.5 gap-y-2")}> 
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

                {SEAT_ROWS.map((row) => {
                  const rowSeats = seats.filter((seat) => seat.row === row);
                  return rowSeats.map((seat, index) => {
                    const selected = seat.id === selectedSeatId;
                    const occupied = seat.state === "occupied";
                    return (
                      <div
                        key={seat.id}
                        className={cn(
                          "contents",
                        )}
                      >
                        {index === 3 && (
                          <span className={cn("col-start-4 row-span-1 flex h-5 items-center justify-center type-body-3 text-content-tertiary")}>
                            {row}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={occupied}
                          onClick={() => setSelectedSeatId(seat.id)}
                          aria-label={`${seat.id}, ${SEAT_STATE_LABELS[seat.state]}${seat.price ? `, SGD ${seat.price}` : ""}`}
                          aria-pressed={selected}
                          className={cn(
                            "flex size-5 items-center justify-center rounded border type-body-3 font-semibold tracking-tight transition-[background-color,border-color,color,transform]",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong focus-visible:ring-offset-1",
                            !occupied && "hover:-translate-y-0.5 hover:border-edge-strong",
                            seat.state === "available" && "border-edge-muted bg-surface text-content",
                            occupied && "cursor-not-allowed border-edge-subtle bg-surface-muted text-content-placeholder",
                            seat.state === "paid" && "border-edge-strong bg-surface text-content",
                            seat.state === "extra-legroom" && "border-edge-strong bg-surface text-content",
                            selected && "border-action-dark-border bg-action-dark text-content-on-dark",
                            index === 3 && "col-start-5",
                          )}
                        >
                          {selected ? (
                            <Check className={cn("size-3")} aria-hidden="true" />
                          ) : occupied ? (
                            <X className={cn("size-3.5")} aria-hidden="true" />
                          ) : seat.state === "paid" ? (
                            <CircleDollarSign className={cn("size-3.5")} aria-hidden="true" />
                          ) : seat.state === "extra-legroom" ? (
                            <MoveHorizontal className={cn("size-3.5")} aria-hidden="true" />
                          ) : (
                            <span className={cn("sr-only")}>Available</span>
                          )}
                        </button>
                      </div>
                    );
                  });
                })}
              </div>

              <div className={cn("flex h-9 w-16 items-center justify-center rounded-lg border border-edge bg-surface text-content-secondary")}>
                <Coffee className={cn("size-4")} aria-hidden="true" />
                <span className={cn("sr-only")}>Rear galley</span>
              </div>
            </div>
          </div>
        </div>

        {/* Seat Selection Summary */}
        <aside
          className={cn("flex flex-col gap-5 rounded-2xl border border-edge bg-surface p-4 lg:sticky lg:top-[calc(var(--navbar-height)+2rem)]")}
          data-region="flights-seat-selection"
        >
          <div className={cn("flex flex-col gap-1")}> 
            <p className={cn("type-body-3 text-content-secondary")}>Selected seat</p>
            <p className={cn("type-h3 font-secondary font-semibold text-content")}>{selectedSeat.id}</p>
            <p className={cn("type-body-2 text-content-secondary")}>
              {seatPositionLabel(selectedSeat.column)}
            </p>
          </div>

          <div className={cn("flex items-center justify-between border-y border-edge-subtle py-4")}> 
            <span className={cn("type-body-2 text-content-secondary")}>{SEAT_STATE_LABELS[selectedSeat.state]}</span>
            <span className={cn("type-body-2 font-semibold text-content")}>{selectedSeat.price ? `SGD ${selectedSeat.price}` : "Included"}</span>
          </div>

          <Button
            variant="dark"
            size="md"
            onClick={() => showToast({
              title: `Seat ${selectedSeat.id} selected`,
              description: "This is a prototype selection and has not been booked.",
            })}
          >
            Select seat {selectedSeat.id}
          </Button>

          <div className={cn("grid grid-cols-2 gap-x-3 gap-y-2 border-t border-edge-subtle pt-4")}> 
            {(["available", "occupied", "extra-legroom", "paid"] as SeatState[]).map((state) => (
              <div key={state} className={cn("flex items-center gap-2 type-body-3 text-content-secondary")}> 
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded border",
                    state === "occupied" ? "border-edge-subtle bg-surface-muted" : "border-edge-muted bg-surface",
                  )}
                  aria-hidden="true"
                >
                  {state === "occupied" && <X className={cn("size-3")} />}
                  {state === "extra-legroom" && <MoveHorizontal className={cn("size-3")} />}
                  {state === "paid" && <CircleDollarSign className={cn("size-3")} />}
                </span>
                {SEAT_STATE_LABELS[state]}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
