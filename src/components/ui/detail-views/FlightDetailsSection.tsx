"use client";

import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/primitives/Menu";

interface FlightDetailsSectionProps extends ComponentPropsWithoutRef<"div"> {
  time: string;
  cost: string;
  confirmation: string;
  flightNumber: string;
  departTime?: string;
  departDate?: string;
  arriveDate?: string;
  arriveTime?: string;
  baggageAllowance?: string;
  terminal?: string;
  ticketNumber?: string;
  /** The seat picked at booking, e.g. "12A". Only a booked fare has one. */
  seat?: string;
  currency?: string;
  airline?: string;
  compactTicket?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flight-detail-field flex flex-col gap-0.5 min-w-0", className)}>
      <span className="type-body-2 font-medium text-content-secondary">{label}</span>
      <span className="type-body-2 font-medium text-content truncate">{value}</span>
    </div>
  );
}

const FlightDetailsSection = forwardRef<HTMLDivElement, FlightDetailsSectionProps>(
  (
    {
      className,
      time,
      cost,
      confirmation,
      flightNumber,
      departTime,
      departDate,
      arriveDate,
      arriveTime,
      baggageAllowance,
      terminal,
      ticketNumber,
      seat,
      currency,
      airline,
      compactTicket = false,
      onEdit,
      onDelete,
      ...props
    },
    ref
  ) => {
    const stripSeconds = (t: string) => t.replace(/(\d{2}:\d{2}):\d{2}/g, "$1");
    const costDisplay = currency ? `${currency} ${cost || "—"}` : (cost || "—");
    const hasSecondaryRow = !!(baggageAllowance || terminal || ticketNumber || seat);
    const hasPerLegTimes = !!(departTime || departDate || arriveTime || arriveDate);
    const departLine = [departDate ?? "", departTime ? stripSeconds(departTime) : ""].filter(Boolean).join(" ").trim();
    const arriveLine = [arriveDate ?? "", arriveTime ? stripSeconds(arriveTime) : ""].filter(Boolean).join(" ").trim();
    const fallbackTime = time ? stripSeconds(time) : "—";

    if (compactTicket) {
      const fields = [
        { label: "Booking Ref.", value: confirmation },
        { label: "Airline", value: airline },
        { label: "Baggage", value: baggageAllowance },
        { label: "Terminal", value: terminal },
        { label: "Ticket No.", value: ticketNumber },
        { label: "Seat", value: seat },
      ].filter((field): field is { label: string; value: string } => Boolean(field.value));

      return (
        <div
          ref={ref}
          data-slot="flight-details-section"
          className={cn("flight-details-section relative grid grid-cols-2 gap-x-3 gap-y-2 p-3", className)}
          {...props}
        >
          {fields.map((field) => <Field key={field.label} label={field.label} value={field.value} />)}
          <div
            className="flight-details-more absolute right-2 top-2 opacity-0 transition-opacity group-hover/flight:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Menu>
              <MenuTrigger className="flex size-7 items-center justify-center rounded-lg hover:bg-surface-muted-hover">
                <MoreVertical className="size-3.5 text-content-tertiary" />
              </MenuTrigger>
              <MenuContent align="end" side="bottom" sideOffset={4}>
                <MenuItem size="sm" icon="leading" leadingIcon={<Pencil className="size-3.5" />} onClick={onEdit}>Edit</MenuItem>
                <MenuItem size="sm" icon="leading" variant="destructive" leadingIcon={<Trash2 className="size-3.5" />} onClick={onDelete}>Delete</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        data-slot="flight-details-section"
        className={cn("flight-details-section relative flex flex-col gap-2 rounded-lg p-3", className)}
        {...props}
      >
        {/* Time */}
        {hasPerLegTimes ? (
          <div className="flight-details-time-per-leg grid grid-cols-2 gap-2">
            <div className="flight-details-time-depart flex flex-col gap-0.5 min-w-0">
              <span className="type-body-3 font-medium text-content-secondary">Depart</span>
              <p className="type-body-2 font-medium text-content truncate">{departLine || "—"}</p>
            </div>
            <div className="flight-details-time-arrive flex flex-col gap-0.5 min-w-0">
              <span className="type-body-3 font-medium text-content-secondary">Arrive</span>
              <p className="type-body-2 font-medium text-content truncate">{arriveLine || "—"}</p>
            </div>
          </div>
        ) : (
          <div className="flight-details-time">
            <span className="type-body-3 font-medium text-content-secondary">Time</span>
            <p className="type-body-2 font-medium text-content mt-0.5">{fallbackTime}</p>
          </div>
        )}

        {/* Primary Fields */}
        <div className="flight-details-primary grid grid-cols-3 gap-2">
          <Field label="Cost" value={costDisplay} />
          <Field label="Booking Ref." value={confirmation || "—"} />
          <Field label="Flight Number" value={flightNumber || "—"} />
        </div>

        {/* Secondary Fields */}
        {hasSecondaryRow && (
          <div className="flight-details-secondary grid grid-cols-3 gap-2">
            {baggageAllowance && <Field label="Baggage" value={baggageAllowance} />}
            {terminal && <Field label="Terminal" value={terminal} />}
            {ticketNumber && <Field label="Ticket No." value={ticketNumber} />}
            {seat && <Field label="Seat" value={seat} />}
          </div>
        )}

        {/* More Menu */}
        <div
          className="flight-details-more absolute top-2 right-2 opacity-0 group-hover/flight:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Menu>
            <MenuTrigger className="flex items-center justify-center size-7 rounded-lg hover:bg-surface-muted-hover">
              <MoreVertical className="size-3.5 text-content-tertiary" />
            </MenuTrigger>
            <MenuContent align="end" side="bottom" sideOffset={4}>
              <MenuItem size="sm" icon="leading" leadingIcon={<Pencil className="size-3.5" />} onClick={onEdit}>
                Edit
              </MenuItem>
              <MenuItem size="sm" icon="leading" variant="destructive" leadingIcon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                Delete
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
    );
  }
);

FlightDetailsSection.displayName = "FlightDetailsSection";

export { FlightDetailsSection };
export type { FlightDetailsSectionProps };
