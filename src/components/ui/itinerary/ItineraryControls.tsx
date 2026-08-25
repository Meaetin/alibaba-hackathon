"use client";

import type { Ref } from "react";
import { MapPin, CalendarDays, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataPill } from "@/components/ui/primitives/DataPill";
import { ToggleGroup } from "@/components/ui/primitives/ToggleGroup";
import { ItineraryTabBar, type ItineraryTab } from "./ItineraryTabBar";

export type ItineraryViewMode = "view" | "edit";

interface ItineraryControlsProps {
  totalSpots: number;
  totalDays: number;
  totalAttachments: number;
  lastEdited?: string | null;
  /** Current view/edit mode — controlled by the page (single source of truth). */
  viewMode: ItineraryViewMode;
  onViewModeChange: (mode: ItineraryViewMode) => void;
  /** Active edit-mode tab — drives the tab strip that replaces the pills in edit mode. */
  activeTab?: ItineraryTab;
  onTabClick?: (tab: ItineraryTab) => void;
  /** Ref to the controls row — the auto-scroll target when entering edit mode. */
  controlsRef?: Ref<HTMLDivElement>;
  className?: string;
}

const VIEW_MODE_OPTIONS: { value: ItineraryViewMode; label: string }[] = [
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
];

/**
 * Controls row of the itinerary page header region (Figma `1734:13373`):
 * DataPills on the left; AvatarGroup + Invite + View/Edit ToggleGroup on the
 * right. Controlled — view/edit state lives in the page.
 */
export function ItineraryControls({
  totalSpots,
  totalDays,
  totalAttachments,
  lastEdited,
  viewMode,
  onViewModeChange,
  activeTab,
  onTabClick,
  controlsRef,
  className,
}: ItineraryControlsProps) {
  return (
    <div
      ref={controlsRef}
      data-region="itinerary-detail-controls"
      className={cn(
        "itinerary-controls flex flex-col items-stretch gap-3 pt-3 lg:flex-row lg:items-center lg:justify-between lg:pt-4",
        className,
      )}
    >
      {/* Left Slot — DataPills (view) ↔ Tab strip (edit) occupy the same slot */}
      {viewMode === "edit" ? (
        <ItineraryTabBar
          mode="edit"
          activeTab={activeTab}
          onTabClick={onTabClick}
          className="itinerary-controls-tabs"
        />
      ) : (
        <div
          data-region="itinerary-detail-data-pills"
          className="itinerary-controls-pills hidden min-w-0 items-center gap-2 overflow-x-auto pb-1 scrollbar-none md:flex lg:pb-0"
        >
          <DataPill
            leading="both"
            icon={<MapPin className="itinerary-controls-locations-icon size-4" />}
            data={totalSpots}
            label="Locations"
          />
          <DataPill
            leading="both"
            icon={<CalendarDays className="itinerary-controls-days-icon size-4" />}
            data={totalDays}
            label="Days"
          />
          <DataPill
            leading="both"
            icon={<FileText className="itinerary-controls-attachments-icon size-4" />}
            data={totalAttachments}
            label="Attachments"
          />
          {lastEdited && <DataPill leading="none" label={`Last edited on ${lastEdited}`} />}
        </div>
      )}

      {/* Right Group — AvatarGroup, Invite, and toggle are flat siblings at gap-2 (8px) */}
      <div className="itinerary-controls-right flex min-w-0 items-center justify-between gap-2 md:justify-end">
        {/* Collaborators and Invite lived here. Auth is removed, so there is no
            owner to show an avatar for and nobody to invite. */}

        {/* View / Edit Toggle */}
        <div
          data-region="itinerary-detail-mode-toggle"
          className="itinerary-controls-mode-toggle hidden md:block"
        >
          <ToggleGroup
            options={VIEW_MODE_OPTIONS}
            value={viewMode}
            onChange={onViewModeChange}
          />
        </div>
      </div>
    </div>
  );
}
