"use client";

// Interaction model:
//  • Collapsed → two icon-only round buttons: [Search] [Filter] (filter on the right).
//  • Clicking Search expands the bar: the search slot's width morphs 40→320px and the
//    icon crossfades to the SearchBar input; the right button crossfades from the Filter
//    menu trigger to an X close button.
//  • Filter is a Base UI Menu listing MAP_SEARCH_CHIPS with icons, an active indicator
//    dot, and an "All categories" clear item.
//  • Persistent DOM (no remount) so all transitions animate on open/close.
//  • The "Search this area" pill stays REMOVED — onSubmit is still called on Enter.

import { useEffect, useRef } from "react";
import {
  Search,
  X,
  SlidersHorizontal,
  Utensils,
  Coffee,
  Camera,
  Landmark,
  Trees,
  Palette,
  ShoppingBag,
  Wine,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SearchBar } from "@/components/ui/primitives/SearchBar";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
} from "@/components/ui/primitives/Menu";
import { MAP_SEARCH_CHIPS } from "@/lib/maps/place-search";

const CHIP_ICONS: Record<string, LucideIcon> = {
  restaurant: Utensils,
  cafe: Coffee,
  attractions: Camera,
  historical: Landmark,
  nature: Trees,
  museums: Palette,
  shopping: ShoppingBag,
  bars: Wine,
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-input-focus-ring";

const EASE = "ease-[var(--motion-ease-standard)]";

// Shared round icon-button shell so Search / Filter / Close read as one family.
const ICON_BUTTON = cn(
  "relative inline-flex size-10 shrink-0 items-center justify-center rounded-full border shadow-default",
  "transition-colors motion-reduce:transition-none cursor-pointer",
  FOCUS_RING,
);

// Crossfade helper for stacked controls that share a slot.
const fade = (visible: boolean) =>
  cn(
    "transition-opacity motion-reduce:transition-none",
    visible ? "opacity-100" : "pointer-events-none opacity-0",
  );

interface MapSearchBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  activeChipId: string | null;
  onChipToggle: (chipId: string) => void;
  onClear: () => void;
  loading?: boolean;
  className?: string;
}

export function MapSearchBar({
  open,
  onOpenChange,
  query,
  onQueryChange,
  onSubmit,
  activeChipId,
  onChipToggle,
  onClear,
  loading = false,
  className,
}: MapSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input when the bar expands.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Persistent DOM (both states mounted) so every action animates instead of
  // snapping. The search slot's width morphs; the right control crossfades.
  return (
    <div className={cn("map-search-bar flex flex-col items-end gap-2", className)}>
      {/* Controls: Search (morphs) + Filter / Close */}
      <div className="map-search-bar-row flex items-center gap-2">
        {/* Search Slot — width animates between the icon button and the input */}
        <div
          className={cn(
            "map-search-bar-search-slot relative h-10 shrink-0",
            "transition-[width] motion-reduce:transition-none",
            EASE,
          )}
          style={{ width: open ? 320 : 40 }}
        >
          {/* Collapsed Search Icon */}
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            aria-label="Search places on map"
            aria-hidden={open}
            tabIndex={open ? -1 : 0}
            className={cn(
              ICON_BUTTON,
              "map-search-bar-search-toggle absolute inset-y-0 right-0",
              "bg-surface border-edge text-glyph hover:bg-action-secondary-hover hover:border-edge-strong",
              fade(!open),
            )}
          >
            <Search className="size-4" />
          </button>

          {/* Expanded Input */}
          <div className={cn("map-search-bar-input-wrap absolute inset-0", fade(open))}>
            <SearchBar
              ref={inputRef}
              size="md"
              tabIndex={open ? 0 : -1}
              aria-hidden={!open}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                } else if (e.key === "Escape") {
                  onOpenChange(false);
                }
              }}
              loading={loading}
              onClear={onClear}
              placeholder="Search this area…"
              aria-label="Search places"
              className="map-search-bar-input h-10 w-full shadow-default"
            />
          </div>
        </div>

        {/* Right Control — Filter menu (collapsed) crossfades with Close/X (expanded) */}
        <div className="map-search-bar-right relative size-10 shrink-0">
          {/* Filter Menu */}
          <div className={cn("map-search-bar-filter-wrap absolute inset-0", fade(!open))}>
            <Menu>
              <MenuTrigger
                aria-label="Filter by category"
                aria-hidden={open}
                tabIndex={open ? -1 : 0}
                className={cn(
                  "map-search-bar-filter-trigger",
                  ICON_BUTTON,
                  activeChipId
                    ? "bg-action-secondary-hover border-edge-strong text-content"
                    : "bg-surface border-edge text-glyph hover:bg-action-secondary-hover hover:border-edge-strong",
                )}
              >
                <SlidersHorizontal className="size-4" />
                {/* Active Indicator Dot */}
                {activeChipId && (
                  <span className="map-search-bar-filter-dot absolute right-1.5 top-1.5 size-2 rounded-full bg-action-brand ring-2 ring-surface" />
                )}
              </MenuTrigger>

              {/* Filter Menu Content */}
              <MenuContent
                align="end"
                side="bottom"
                sideOffset={8}
                className="map-search-bar-filter-menu"
              >
                {MAP_SEARCH_CHIPS.map((chip) => {
                  const Icon = CHIP_ICONS[chip.id] ?? Search;
                  const isSelected = activeChipId === chip.id;
                  return (
                    <MenuItem
                      key={chip.id}
                      icon="leading"
                      size="lg"
                      selected={isSelected}
                      leadingIcon={<Icon className="size-4" />}
                      onClick={() => onChipToggle(chip.id)}
                      aria-pressed={isSelected}
                    >
                      {chip.label}
                    </MenuItem>
                  );
                })}
                {activeChipId && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      icon="leading"
                      size="lg"
                      leadingIcon={<Search className="size-4" />}
                      onClick={() => onChipToggle(activeChipId)}
                    >
                      All categories
                    </MenuItem>
                  </>
                )}
              </MenuContent>
            </Menu>
          </div>

          {/* Close Button */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close search"
            aria-hidden={!open}
            tabIndex={open ? 0 : -1}
            className={cn(
              ICON_BUTTON,
              "map-search-bar-close absolute inset-0",
              "bg-surface border-edge text-glyph hover:bg-action-secondary-hover hover:border-edge-strong",
              fade(open),
            )}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Search Nearby — intentionally removed (frontend hidden) */}
    </div>
  );
}
