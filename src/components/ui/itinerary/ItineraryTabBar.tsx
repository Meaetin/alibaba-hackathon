"use client";

import type { ReactNode } from "react";
import { Map, Plane, House, NotebookText, Wallet, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tab } from "@/components/ui/primitives/Tab";

const TAB_CONFIG = [
  { label: "Itinerary", icon: <Map className="size-4" /> },
  { label: "Flight", icon: <Plane className="size-4" /> },
  { label: "Lodging", icon: <House className="size-4" /> },
  { label: "Bookings", icon: <NotebookText className="size-4" /> },
  { label: "Expenses", icon: <Wallet className="size-4" /> },
  { label: "Notes", icon: <StickyNote className="size-4" /> },
] as const satisfies readonly { label: string; icon: ReactNode }[];

export type ItineraryTab = (typeof TAB_CONFIG)[number]["label"];

const CLICKABLE_TABS_VIEW = new Set<ItineraryTab>(["Flight", "Lodging", "Notes"]);
const CLICKABLE_TABS_EDIT = new Set<ItineraryTab>(["Itinerary", "Flight", "Lodging", "Notes"]);
const DISABLED_TABS = new Set<ItineraryTab>(["Bookings", "Expenses"]);

interface ItineraryTabBarProps {
  mode?: "view" | "edit";
  activeTab?: ItineraryTab;
  openTab?: ItineraryTab | null;
  onTabClick?: (tab: ItineraryTab) => void;
  className?: string;
}

/**
 * Underline tab strip for the itinerary edit-mode header — six tabs with leading
 * icons (Itinerary / Flight / Lodging / Bookings / Expenses / Notes). Rendered in
 * the control-row left slot (swapped in for the DataPills) by `ItineraryControls`.
 * Pure presentation: selection + clickability are driven by props.
 */
export function ItineraryTabBar({
  mode = "edit",
  activeTab = "Itinerary",
  openTab,
  onTabClick,
  className,
}: ItineraryTabBarProps) {
  return (
    <div
      data-slot="itinerary-tab-bar"
      data-region="itinerary-edit-tabbar"
      className={cn("itinerary-tab-bar flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-none", className)}
    >
      {TAB_CONFIG.map(({ label, icon }) => {
        const isItinerary = label === "Itinerary";
        const isOpen = label === openTab;
        const clickableTabs = mode === "edit" ? CLICKABLE_TABS_EDIT : CLICKABLE_TABS_VIEW;
        const isDisabled = DISABLED_TABS.has(label);
        const isClickable = !isDisabled && clickableTabs.has(label);
        const isActive =
          (mode === "edit" && label === activeTab) ||
          (mode === "view" && isItinerary && !openTab) ||
          (mode === "view" && isOpen);

        return (
          <Tab
            key={label}
            size="md"
            icon="leading"
            leadingIcon={icon}
            selected={isActive}
            disabled={isDisabled}
            onClick={() => {
              if (isClickable) {
                onTabClick?.(label);
              } else if (isItinerary && openTab) {
                onTabClick?.("Itinerary");
              }
            }}
            title={isDisabled ? "Coming soon" : undefined}
            className={cn(
              "itinerary-tab-bar-tab",
              !isDisabled && (isClickable || (isItinerary && !!openTab))
                ? "cursor-pointer"
                : !isDisabled && "cursor-default",
            )}
          >
            {label}
          </Tab>
        );
      })}
    </div>
  );
}
