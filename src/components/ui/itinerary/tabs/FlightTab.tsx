"use client";

import { cn } from "@/lib/utils";
import { FlightSidebar } from "@/components/ui/detail-views/FlightSidebar";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import { FilePillHeader, type FilePillHeaderFile } from "@/components/ui/detail-views/FilePillHeader";

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
  className?: string;
}

export function FlightTab({ flights, loading, files, onAddFile, onRemoveFile, onAddManual, onFlightEdit, onFlightDelete, onFlightOpen, className }: FlightTabProps) {
  return (
    <div data-slot="flight-tab" className={cn("flight-tab-root flex flex-col gap-3 h-full", className)}>
      {/* File Pills */}
      {files && files.length > 0 && (
        <FilePillHeader files={files} onAddFile={onAddFile} onRemoveFile={onRemoveFile} />
      )}

      {/* Flight List */}
      <FlightSidebar flights={flights} loading={loading} onAddManual={onAddManual} onUpload={onAddFile} onFlightEdit={onFlightEdit} onFlightDelete={onFlightDelete} onFlightOpen={onFlightOpen} />
    </div>
  );
}
