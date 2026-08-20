"use client";

import { Sparkles, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { Separator } from "@/components/ui/primitives/Separator";
import { SearchBar } from "@/components/ui/primitives/SearchBar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives/Popover";
import { AlsoInCard } from "@/components/ui/detail-views/AlsoInCard";
import { NewCollectionModal } from "@/components/ui/modals/NewCollectionModal";

interface ActionToolbarCollection {
  id: string;
  /** Collection name, e.g. "KL with the boys". */
  name: string;
  /** Number of locations in the collection, rendered as "N Locations". */
  locationCount?: number;
  /** Cover image URL; falls back to a muted placeholder when absent. */
  thumbnailUrl?: string;
  /** ISO timestamp used to sort the combined "Save to" list (latest first). */
  updatedAt?: string;
}

interface ActionToolbarItinerary {
  id: string;
  /** Itinerary name, e.g. "Tokyo 2026". */
  name: string;
  /** Number of activities in the itinerary, rendered as "N Activities". */
  activityCount?: number;
  /** Cover image URL; falls back to a muted placeholder when absent. */
  thumbnailUrl?: string;
  /** Backing collection that selected locations are saved into. Always present —
   *  every itinerary has a companion collection (DB enforces NOT NULL). */
  collectionId: string;
  /** ISO timestamp used to sort the combined "Save to" list (latest first). */
  updatedAt?: string;
}

interface ActionToolbarProps {
  /** Number of selected items, rendered as "N Selected". */
  count: number;
  /** Collections offered in the "Save to" menu. */
  collections: ActionToolbarCollection[];
  /** Called with the chosen collection id when a "Save to" row is clicked. */
  onSaveToCollection: (collectionId: string) => void;
  /**
   * Itineraries offered in the "Save to" menu. When provided, they are merged
   * into the same list as collections; picking one saves the selection into the
   * itinerary's backing collection.
   */
  itineraries?: ActionToolbarItinerary[];
  /** Called with the chosen itinerary when a "Save to" itinerary row is clicked. */
  onSaveToItinerary?: (itinerary: ActionToolbarItinerary) => void;
  /**
   * Create a new collection inline from the "Save to" menu (UXR-013/014).
   * Receives the NewCollectionModal form data; must perform the real create and
   * resolve with the new collection's `{ id, name }` so the current selection can
   * be saved straight into it via `onSaveToCollection`. When omitted, the "Add to
   * new collection" row is hidden.
   */
  onCreateCollection?: (data: {
    name: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    tags?: string[];
  }) => Promise<{ id: string; name: string } | null | void>;
  /** Sparkles / generate-itinerary action. Hidden when omitted. */
  onGenerate?: () => void;
  /** Delete the selected items from the collection. Hidden when omitted. */
  onDelete?: () => void;
  /** Dismiss the toolbar (clear selection). */
  onClose: () => void;
  /** Controlled open state for the "Save to" menu (falls back to internal state). */
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * ActionToolbar — floating bottom-centre toolbar shown while location cards are
 * multi-selected (rubber-band selection). Mirrors Figma Argo-v4 ActionToolbar
 * (node 1744:14669) and its "Save to" menu (node 1744:14679).
 *
 * Layout: `[N Selected] | [Save to] [✦] | [✕]`. The "Save to" button opens a
 * Popover menu 8px above the toolbar (anchored to the toolbar so the gap is
 * measured from its edge) containing a search bar and a single list that merges
 * collections and itineraries, sorted by most-recently-updated.
 *
 * Positioning (fixed, 16px from the bottom, horizontally centred) is baked in
 * and can be overridden via `className`.
 */
function ActionToolbar({
  count,
  collections,
  onSaveToCollection,
  itineraries,
  onSaveToItinerary,
  onCreateCollection,
  onGenerate,
  onDelete,
  onClose,
  menuOpen: controlledMenuOpen,
  onMenuOpenChange,
  className,
}: ActionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [internalMenuOpen, setInternalMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Inline create-collection (UXR-013/014): modal open + its controlled name
  // field, seeded from the picker search so a typed query carries into create.
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const menuOpen = controlledMenuOpen ?? internalMenuOpen;
  const setMenuOpen = (open: boolean) => {
    setInternalMenuOpen(open);
    onMenuOpenChange?.(open);
  };

  const handlePickCollection = (id: string) => {
    onSaveToCollection(id);
    setMenuOpen(false);
  };

  const handlePickItinerary = (itinerary: ActionToolbarItinerary) => {
    onSaveToItinerary?.(itinerary);
    setMenuOpen(false);
  };

  // Typed search text, used to seed the new-collection name in the modal.
  const trimmedQuery = query.trim();

  // Open the create-collection modal, seeding its name from the picker search.
  const handleOpenCreateModal = () => {
    setCreateName(trimmedQuery);
    setMenuOpen(false);
    setCreateModalOpen(true);
  };

  // UXR-013/014: completing the modal creates the collection AND saves the
  // current selection straight into it — no second "Save to" step. Resolves with
  // the new collection so we can route the save to its real id.
  const handleCreateSubmit = async (data: {
    name: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    tags?: string[];
  }) => {
    const created = await onCreateCollection?.(data);
    setQuery("");
    setCreateName("");
    setCreateModalOpen(false);
    if (created?.id) {
      onSaveToCollection(created.id);
    }
  };

  // Collections and itineraries share one list, sorted latest-updated first.
  // ISO timestamps sort correctly with a plain string comparison.
  const rows = [
    ...collections.map((c) => ({
      key: `collection-${c.id}`,
      title: c.name,
      type: "Collection",
      count: c.locationCount,
      countLabel: "Locations",
      thumbnailUrl: c.thumbnailUrl,
      updatedAt: c.updatedAt ?? "",
      disabled: false,
      onPick: () => handlePickCollection(c.id),
    })),
    // Itineraries always render when present; without an onSaveToItinerary
    // handler the row is shown disabled rather than silently dropped.
    ...(itineraries ?? []).map((i) => ({
      key: `itinerary-${i.id}`,
      title: i.name,
      type: "Itinerary",
      count: i.activityCount,
      countLabel: "Activities",
      thumbnailUrl: i.thumbnailUrl,
      updatedAt: i.updatedAt ?? "",
      disabled: !onSaveToItinerary,
      onPick: () => handlePickItinerary(i),
    })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const filteredRows = query
    ? rows.filter((r) => r.title.toLowerCase().includes(query.toLowerCase()))
    : rows;

  return (
    <div
      ref={toolbarRef}
      data-region="action-toolbar"
      // The toolbar lives inside the page's rubber-band mousedown surface; stop
      // propagation so interacting with it never starts a selection or clears one.
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className={cn(
        "action-toolbar fixed inset-x-2 bottom-4 z-50 sm:left-1/2 sm:right-auto sm:-translate-x-1/2",
        "flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-edge bg-surface px-2 py-2 sm:w-auto sm:justify-start sm:gap-4 sm:px-3",
        "shadow-[0px_1px_4px_0px_rgba(0,0,0,0.04),0px_4px_16px_0px_rgba(0,0,0,0.08)]",
        "animate-in fade-in slide-in-from-bottom-4 duration-[var(--motion-duration-normal)] motion-reduce:animate-none",
        className,
      )}
    >
      {/* Selection Count */}
      <div className="action-toolbar-count flex min-w-0 items-center px-1 sm:px-2">
        <span className="type-body-2 font-medium text-content whitespace-nowrap tabular-nums">
          {count}<span className="hidden min-[360px]:inline"> Selected</span>
        </span>
      </div>

      <div className="flex self-stretch shrink-0">
        <Separator orientation="vertical" />
      </div>

      {/* Action Buttons */}
      <div className="action-toolbar-actions flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger render={<Button variant="primary" size="sm" />}>
            Save to
          </PopoverTrigger>
          {/* Save To Menu */}
          <PopoverContent
            anchor={toolbarRef}
            side="top"
            align="start"
            sideOffset={8}
            className="w-[min(20rem,calc(100vw-1rem))] gap-1 rounded-2xl p-2"
          >
            <div className="p-3">
              <SearchBar
                placeholder="Search"
                className="w-full"
                autoFocus
                onSearch={setQuery}
              />
            </div>

            <Separator orientation="horizontal" />

            {/* New Collection Row — opens the real NewCollectionModal (UXR-014) */}
            {onCreateCollection && (
              <button
                type="button"
                onClick={handleOpenCreateModal}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors",
                  "hover:bg-surface-muted focus-visible:bg-surface-muted",
                )}
              >
                {/* Empty collection cover — the 2×2 image-grid shape, all gray */}
                <span className="flex size-9 shrink-0 rounded-lg border border-edge bg-surface p-0.5">
                  <span className="grid size-full grid-cols-2 grid-rows-2 gap-[2px] overflow-hidden rounded-md">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <span key={i} className="bg-surface-muted" />
                    ))}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="type-body-2 font-medium text-content">
                    {trimmedQuery
                      ? `Add to "${trimmedQuery}"`
                      : "Add to new collection"}
                  </span>
                  <span className="type-body-3 text-content-secondary">
                    Your place to organize spots
                  </span>
                </span>
              </button>
            )}

            {/* Destinations List (collections + itineraries) */}
            {filteredRows.length > 0 ? (
              <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                {filteredRows.map((row) => (
                  <AlsoInCard
                    key={row.key}
                    title={row.title}
                    type={row.type}
                    count={row.count}
                    countLabel={row.countLabel}
                    thumbnailUrl={row.thumbnailUrl}
                    className="w-full"
                    role="button"
                    disabled={row.disabled}
                    onClick={row.disabled ? undefined : row.onPick}
                  />
                ))}
              </div>
            ) : !onCreateCollection ? (
              <p className="px-3 py-2 type-body-2 text-content-secondary">
                No results found
              </p>
            ) : null}
          </PopoverContent>
        </Popover>

        {onGenerate && (
          <Button
            variant="secondary"
            size="sm"
            icon="only"
            aria-label="Generate itinerary"
            onClick={onGenerate}
          >
            <Sparkles className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex self-stretch shrink-0">
        <Separator orientation="vertical" />
      </div>

      {/* Delete + Close */}
      <div className="action-toolbar-dismiss flex shrink-0 items-center gap-1 sm:gap-2">
        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            icon="only"
            aria-label="Delete selected"
            onClick={onDelete}
            className="sm:w-auto sm:px-3"
          >
            <Trash2 className="size-4 sm:hidden" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon="only"
          aria-label="Clear selection"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* New Collection Modal — the real design-system create flow (UXR-014) */}
      {onCreateCollection && (
        <NewCollectionModal
          open={createModalOpen}
          onOpenChange={(open) => {
            if (!open) setCreateName("");
            setCreateModalOpen(open);
          }}
          collectionValue={createName}
          onCollectionChange={setCreateName}
          onSubmit={handleCreateSubmit}
          onCancel={() => {
            setCreateName("");
            setCreateModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

export { ActionToolbar };
export type { ActionToolbarProps, ActionToolbarCollection, ActionToolbarItinerary };
