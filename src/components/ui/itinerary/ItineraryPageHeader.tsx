"use client";

import type { Ref } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/primitives/Menu";
import { buttonVariants } from "@/components/ui/primitives/Button";
import { ItineraryHeader } from "./ItineraryHeader";
import { ItineraryControls, type ItineraryViewMode } from "./ItineraryControls";
import type { ItineraryTab } from "./ItineraryTabBar";

interface CollaboratorProfile {
  id: string;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

interface Collaborator {
  user_id: string;
  role: string;
}

interface ItineraryPageHeaderProps {
  bannerUrl: string | null;
  name: string;
  region: string | null;
  country: string;
  dateLabel: string;
  totalSpots: number;
  totalDays: number;
  totalAttachments: number;
  lastEdited?: string | null;
  collaboratorProfiles: CollaboratorProfile[];
  collaborators: Collaborator[];
  ownerId: string;
  /** View/edit mode — controlled by the page (single source of truth). */
  viewMode: ItineraryViewMode;
  onViewModeChange: (mode: ItineraryViewMode) => void;
  onInviteClick: () => void;
  onDelete: () => void;
  /** Active edit-mode tab + handler — the tab strip replaces the pills in edit mode. */
  activeTab?: ItineraryTab;
  onTabClick?: (tab: ItineraryTab) => void;
  /** Ref to the controls row — auto-scroll target when entering edit mode. */
  controlsRef?: Ref<HTMLDivElement>;
  className?: string;
}

/**
 * Itinerary page header region (Figma `1734:13504`). Composes the presentational
 * Header row (banner + title + kebab menu) and the controlled Controls row
 * (pills + collaborators + invite + View/Edit toggle). Holds no business state —
 * all interaction is wired through callbacks to the page.
 */
export function ItineraryPageHeader({
  bannerUrl,
  name,
  region,
  country,
  dateLabel,
  totalSpots,
  totalDays,
  totalAttachments,
  lastEdited,
  collaboratorProfiles,
  collaborators,
  ownerId,
  viewMode,
  onViewModeChange,
  onInviteClick,
  onDelete,
  activeTab,
  onTabClick,
  controlsRef,
  className,
}: ItineraryPageHeaderProps) {
  return (
    <div
      data-region="itinerary-detail-header"
      className={cn(
        "itinerary-page-header mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-3 pt-3 md:px-8 lg:px-10",
        className,
      )}
    >
      {/* Header Row */}
      <ItineraryHeader
        bannerUrl={bannerUrl}
        name={name}
        region={region}
        country={country}
        dateLabel={dateLabel}
        menu={
          <Menu>
            <MenuTrigger
              aria-label="Itinerary options"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm", icon: "only" }),
                "itinerary-header-menu-trigger size-11 shrink-0 md:size-9",
              )}
            >
              <MoreVertical className="size-4" />
            </MenuTrigger>
            <MenuContent align="end" side="bottom" sideOffset={4}>
              <MenuItem
                size="md"
                icon="leading"
                leadingIcon={<Trash2 className="size-4" />}
                onClick={onDelete}
              >
                Delete
              </MenuItem>
            </MenuContent>
          </Menu>
        }
      />

      {/* Controls Row */}
      <ItineraryControls
        totalSpots={totalSpots}
        totalDays={totalDays}
        totalAttachments={totalAttachments}
        lastEdited={lastEdited}
        collaboratorProfiles={collaboratorProfiles}
        collaborators={collaborators}
        ownerId={ownerId}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        onInviteClick={onInviteClick}
        activeTab={activeTab}
        onTabClick={onTabClick}
        controlsRef={controlsRef}
      />
    </div>
  );
}
