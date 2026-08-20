"use client";

import { Loader2 } from "lucide-react";

import { FlightCard, type FlightCardProps } from "./FlightCard";
import { PanelEmptyState } from "./PanelEmptyState";

interface FlightSidebarProps {
  flights: FlightCardProps[];
  loading?: boolean;
  onAddManual?: () => void;
  onUpload?: () => void;
  onFlightEdit?: (flightId: string) => void;
  onFlightDelete?: (flightId: string) => void;
  onFlightOpen?: (flightId: string) => void;
}

function FlightSidebar({ flights, loading, onFlightEdit, onFlightDelete, onFlightOpen }: FlightSidebarProps) {
  if (loading) {
    return (
      <div className="flight-loading-state flex flex-col items-center justify-center flex-1 py-16 gap-3">
        <Loader2 className="flight-loading-spinner size-8 text-content-secondary animate-spin" />
        <p className="flight-loading-text type-body-2 text-content-secondary">
          Extracting flight details...
        </p>
      </div>
    );
  }

  if (flights.length === 0) {
    return (
      <div data-region="itinerary-edit-panel-flight-empty" className="flight-empty-state-wrapper flex flex-1 h-full">
        <PanelEmptyState
          imageSrc="/images/stickers/Plane.svg"
          title="No Items Yet"
          description="Add items to get started with your collection."
          className="w-full"
        />
      </div>
    );
  }

  return (
    <div className="flight-sidebar-list flex flex-col gap-2 px-2 pb-3">
      {flights.map((flight, i) => (
        <FlightCard
          key={flight.id ?? `flight-${i}`}
          {...flight}
          onEdit={flight.id ? () => onFlightEdit?.(flight.id!) : undefined}
          onDelete={flight.id ? () => onFlightDelete?.(flight.id!) : undefined}
          onCardClick={
            flight.id && flight.sourceAttachmentId && onFlightOpen
              ? () => onFlightOpen(flight.id!)
              : undefined
          }
        />
      ))}
    </div>
  );
}

export { FlightSidebar };
export type { FlightSidebarProps };
