"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";
import { FlightRouteSection } from "./FlightRouteSection";
import { FlightDetailsSection } from "./FlightDetailsSection";

interface FlightCardProps extends ComponentPropsWithoutRef<"div"> {
  id?: string;
  fromCode: string;
  fromCity: string;
  fromCountry?: string;
  toCode: string;
  toCity: string;
  toCountry?: string;
  time: string;
  cost: string;
  confirmation: string;
  flightNumber: string;

  departTime?: string;
  departDate?: string;
  arriveDate?: string;
  arriveTime?: string;
  airline?: string;
  fareClass?: string;
  flightDuration?: string;
  terminal?: string;
  baggageAllowance?: string;
  currency?: string;
  ticketNumber?: string;
  /** Attachment id this flight was extracted from. Drives card clickability. */
  sourceAttachmentId?: string | null;
  /** Muted, non-interactive state (Figma State=Disabled). */
  disabled?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Fires when the card body (not the menu) is clicked. */
  onCardClick?: () => void;
}

const FlightCard = forwardRef<HTMLDivElement, FlightCardProps>(
  (
    {
      className,
      fromCode,
      fromCity,
      fromCountry,
      toCode,
      toCity,
      toCountry,
      time,
      cost,
      confirmation,
      flightNumber,
      departTime,
      departDate,
      arriveDate,
      arriveTime,
      airline,
      // Destructured only to keep it out of the DOM spread below.
      fareClass: _fareClass,
      flightDuration,
      terminal,
      baggageAllowance,
      currency,
      ticketNumber,
      sourceAttachmentId,
      disabled = false,
      onEdit,
      onDelete,
      onCardClick,
      ...props
    },
    ref
  ) => {
    const isInteractive = Boolean(sourceAttachmentId && onCardClick) && !disabled;
    const flightLabel = [airline, flightNumber].filter(Boolean).join(" ") || "flight";

    return (
      <div
        ref={ref}
        data-slot="flight-card"
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? `Open source document for ${flightLabel}` : undefined}
        aria-disabled={disabled || undefined}
        onClick={isInteractive ? onCardClick : undefined}
        onKeyDown={
          isInteractive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCardClick?.();
                }
              }
            : undefined
        }
        className={cn(
          "flight-card group/flight flex flex-col gap-0 p-2 border border-edge bg-surface rounded-2xl overflow-clip transition-shadow hover:shadow-default",
          isInteractive && "flight-card-interactive cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong",
          disabled && "flight-card-disabled opacity-50 pointer-events-none",
          className
        )}
        {...props}
      >
        {/* Route Section */}
        <FlightRouteSection
          fromCode={fromCode}
          fromCity={fromCity}
          fromCountry={fromCountry}
          toCode={toCode}
          toCity={toCity}
          toCountry={toCountry}
          flightDuration={flightDuration}
        />

        {/* Details Section */}
        <FlightDetailsSection
          time={time}
          cost={cost}
          confirmation={confirmation}
          flightNumber={flightNumber}
          departTime={departTime}
          departDate={departDate}
          arriveDate={arriveDate}
          arriveTime={arriveTime}
          baggageAllowance={baggageAllowance}
          terminal={terminal}
          ticketNumber={ticketNumber}
          currency={currency}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    );
  }
);

FlightCard.displayName = "FlightCard";

export { FlightCard };
export type { FlightCardProps };
