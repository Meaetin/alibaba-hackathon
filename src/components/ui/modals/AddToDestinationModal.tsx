"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Check, Loader2, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { ActionCard } from "@/components/ui/dashboard/ActionCard";
import { Button } from "@/components/ui/primitives/Button";
import { CollectionCard } from "@/components/ui/cards/CollectionCard";
import { ItineraryCard } from "@/components/ui/cards/ItineraryCard";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { NewCollectionModal } from "@/components/ui/modals/NewCollectionModal";
import { NewItineraryModal } from "@/components/ui/modals/NewItineraryModal";
import { SearchBar } from "@/components/ui/primitives/SearchBar";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";
import { createCollection, getCollections } from "@/lib/api/collections";
import { createItinerary, getItineraries } from "@/lib/api/itineraries";
import type { CollectionWithRole } from "@/lib/api/collections";
import type { ItineraryWithRole } from "@/lib/api/itineraries";
import { useToast } from "@/contexts/ToastContext";
import { cn } from "@/lib/utils";

type DestinationMode = "collection" | "itinerary";

interface DestinationItem {
  id: string;
  name: string;
  thumbnailUrl?: string | null;
  previewImages?: string[];
  subtitle?: string;
  collectionId?: string;
}

interface AddToDestinationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DestinationMode;
  locationIds: string[];
  onAdd: (destinationId: string, locationIds: string[], collectionId?: string) => Promise<void>;
}

export function AddToDestinationModal({
  open,
  onOpenChange,
  mode,
  locationIds,
  onAdd,
}: AddToDestinationModalProps) {
  const { showToast } = useToast();

  const [items, setItems] = useState<DestinationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  // Creation modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelectedIds(new Set());
    }
  }, [open]);

  // Fetch destinations on open or after creation
  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    const fetcher =
      mode === "collection" ? fetchCollections : fetchItineraries;
    fetcher()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setIsLoading(false));
  }, [open, mode, fetchKey]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, search]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsAdding(true);
    const results = await Promise.allSettled(
      Array.from(selectedIds).map((id) => {
        const item = items.find((i) => i.id === id);
        return onAdd(id, locationIds, item?.collectionId);
      }),
    );
    const hasError = results.some((r) => r.status === "rejected");

    if (hasError) {
      showToast({
        title: "Something went wrong. Try again.",
        variant: "error",
      });
    } else {
      const label =
        mode === "collection"
          ? selectedIds.size === 1 ? "collection" : "collections"
          : selectedIds.size === 1 ? "itinerary" : "itineraries";
      showToast({
        title: `Successfully added to ${selectedIds.size} ${label}`,
        variant: "success",
      });
      onOpenChange(false);
    }
    setIsAdding(false);
  }, [selectedIds, onAdd, locationIds, mode, showToast, onOpenChange]);

  const CardComponent = mode === "collection" ? CollectionCard : ItineraryCard;
  const title = mode === "collection" ? "Add to Collection" : "Add to Itinerary";
  const createLabel = mode === "collection" ? "Create new collection" : "Create new itinerary";
  const confirmLabel = mode === "collection" ? "Add to Collection" : "Add to Itinerary";

  const handleCreateSubmit = useCallback(async (data: { name?: string; tripName?: string; country?: string; region?: string; latitude?: number; longitude?: number; tags?: string[]; startDate?: string; totalDays?: number; endDate?: string }) => {
    setIsCreating(true);
    try {
      if (mode === "collection") {
        await createCollection(data.name!, data.country, data.region, data.latitude, data.longitude, data.tags, "action_toolbar");
      } else {
        if (!data.tripName || !data.country) return;
        await createItinerary(data.tripName, data.country, data.region, data.latitude, data.longitude, data.startDate, data.totalDays, data.endDate);
      }
      setFetchKey((k) => k + 1);
      if (mode === "collection") {
        queryClient.invalidateQueries({ queryKey: queryKeys.collections() });
      } else {
        queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() });
      }
      setIsCreateModalOpen(false);
      setNewItemName("");
    } catch (err) {
      console.error(`Failed to create ${mode}:`, err);
    } finally {
      setIsCreating(false);
    }
  }, [mode]);

  return (
    <>
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="add-to-destination-backdrop fixed inset-0 bg-black/50 z-40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "add-to-destination-popup fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "flex flex-col items-stretch p-2 rounded-xl w-[min(48rem,92vw)] max-h-[70vh]",
            "bg-surface-alt border border-edge-strong shadow-default",
            "transition-[opacity,transform] duration-[var(--motion-duration-normal)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          )}
        >
          {/* Header */}
          <div className="add-to-destination-header flex items-center justify-between w-full px-2 py-3 gap-2">
            <div className="flex items-center gap-2 min-w-0 px-2">
              <CategoryBadge category={mode === "collection" ? "collection" : "itinerary"} />
              <span className="type-h4 type-secondary text-glyph truncate">
                {title}
              </span>
            </div>
            <Dialog.Close
              className="add-to-destination-close flex items-center justify-center size-8 rounded-lg text-content-secondary hover:bg-surface-muted-hover active:bg-surface-muted-active transition-colors shrink-0"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {/* Search */}
          <div className="add-to-destination-search px-3 pb-2">
            <SearchBar
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Destination List */}
          <div className="add-to-destination-list flex-1 overflow-y-auto px-3 pb-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-content-secondary">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {filteredItems.map((item, index) => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <React.Fragment key={item.id}>
                      {index === 3 && (
                        <ActionCard
                          label={createLabel}
                          onClick={() => setIsCreateModalOpen(true)}
                          className="add-to-destination-create-card h-[220px]"
                        />
                      )}
                      <div className="add-to-destination-card-wrapper relative">
                        {mode === "collection" ? (
                          <CollectionCard
                            label={item.name}
                            images={item.previewImages ?? (item.thumbnailUrl ? [item.thumbnailUrl] : undefined)}
                            fallbackQuery={item.name}
                            className={cn(
                              "h-[220px] transition-[outline] duration-[var(--motion-duration-fast)]",
                              isSelected && "outline-2 outline-action-dark outline-offset-2 rounded-[12px]",
                            )}
                            onClick={() => toggleSelect(item.id)}
                          />
                        ) : (
                          <CardComponent
                            label={item.name}
                            imageUrl={item.thumbnailUrl ?? undefined}
                            imageAlt={item.name}
                            className={cn(
                              "h-[220px] transition-[outline] duration-[var(--motion-duration-fast)]",
                              isSelected && "outline-2 outline-action-dark outline-offset-2 rounded-[12px]",
                            )}
                            onClick={() => toggleSelect(item.id)}
                          />
                        )}
                        {isSelected && (
                          <div className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-full bg-action-dark text-content-on-dark">
                            <Check className="size-3.5" />
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}
                {filteredItems.length < 4 && (
                  <ActionCard
                    label={createLabel}
                    onClick={() => setIsCreateModalOpen(true)}
                    className="add-to-destination-create-card h-[220px]"
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="add-to-destination-footer flex items-center justify-end gap-2 px-3 pb-2 pt-1">
            <Button
              variant="ghost"
              size="md"
              onClick={() => onOpenChange(false)}
              className="add-to-destination-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || isAdding}
              className="add-to-destination-confirm"
            >
              {isAdding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : selectedIds.size > 0 ? (
                `${confirmLabel} (${selectedIds.size})`
              ) : (
                confirmLabel
              )}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>

      {/* Creation modal — stacks on top via its own Dialog.Portal */}
      {mode === "collection" ? (
        <NewCollectionModal
          open={isCreateModalOpen}
          onOpenChange={setIsCreateModalOpen}
          collectionValue={newItemName}
          onCollectionChange={setNewItemName}
          onSubmit={handleCreateSubmit}
          isLoading={isCreating}
          onCancel={() => setIsCreateModalOpen(false)}
        />
      ) : (
        <NewItineraryModal
        source="dashboard"
          open={isCreateModalOpen}
          onOpenChange={setIsCreateModalOpen}
          tripNameValue={newItemName}
          onTripNameChange={setNewItemName}
          onSubmit={handleCreateSubmit}
          onCancel={() => setIsCreateModalOpen(false)}
        />
      )}
    </>
  );
}

// ───── Data fetchers ──────────────────────────────────────────────────────────

async function fetchCollections(): Promise<DestinationItem[]> {
  const collections = await getCollections();
  return collections
    .filter((c) => !c.is_archived)
    .map((c: CollectionWithRole) => ({
      id: c.id,
      previewImages: c.preview_images?.length ? c.preview_images : undefined,
      name: c.name,
      thumbnailUrl: c.thumbnail_url,
      subtitle: c.country ?? undefined,
    }));
}

async function fetchItineraries(): Promise<DestinationItem[]> {
  const itineraries = await getItineraries();
  return itineraries
    .filter((i) => !i.is_archived)
    .map((i: ItineraryWithRole) => ({
      id: i.id,
      name: i.name,
      thumbnailUrl: i.thumbnail_url,
      subtitle: i.country ?? undefined,
      collectionId: i.collection_id ?? undefined,
    }));
}
