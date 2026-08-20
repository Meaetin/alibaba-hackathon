"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Layers } from "lucide-react";
import { CollectionCard } from "@/components/ui";
import { UsageCard } from "@/components/ui/primitives/UsageCard";
import { CreateCard } from "@/components/ui/dashboard/CreateCard";
import { NewCollectionModal } from "@/components/ui/modals/NewCollectionModal";
import { ConfirmDeleteModal } from "@/components/ui/modals/ConfirmDeleteModal";
import { useToast } from "@/contexts/ToastContext";
import { createCollection, deleteCollection } from "@/lib/api/collections";
import type { CollectionWithRole } from "@/lib/api/collections";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { useCollectionsQuery } from "@/hooks/queries/useCollectionsQuery";
import { useLinkUsageQuery } from "@/hooks/queries/useLinkUsageQuery";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";

const collectionGradient = "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)";

export default function CollectionsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const userId = useSessionUserId();
  const { data: collections = [], isLoading } = useCollectionsQuery();
  const { data: linkUsage } = useLinkUsageQuery(userId);
  const shouldReduceMotion = useReducedMotion();
  const newCollectionIdsRef = useRef(new Set<string>());

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    ids: string[];
    name: string;
    collaboratorCount: number;
  }>({ open: false, ids: [], name: "", collaboratorCount: 0 });

  // Filtered + sorted collections: non-archived, ordered by recency
  const filteredCollections = useMemo(() => {
    return [...collections]
      .filter((c) => !c.is_archived)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [collections]);

  // ── Create handlers ──────────────────────────────────────────────────────────

  const handleCreateCollection = useCallback(
    async (data: {
      name: string;
      country?: string;
      region?: string;
      latitude?: number;
      longitude?: number;
      tags?: string[];
    }) => {
      setIsCreating(true);
      try {
        const collection = await createCollection(
          data.name,
          data.country,
          data.region,
          data.latitude,
          data.longitude,
          data.tags,
        );
        newCollectionIdsRef.current.add(collection.id);
        queryClient.invalidateQueries({ queryKey: queryKeys.collections() });
        setIsCreateModalOpen(false);
        setNewCollectionName("");
      } catch (err) {
        console.error("Failed to create collection:", err);
        showToast({
          title: "Failed to create collection",
          description: err instanceof Error ? err.message : "Something went wrong.",
          variant: "error",
        });
      } finally {
        setIsCreating(false);
      }
    },
    [showToast],
  );

  const handleCancelCreate = () => {
    setIsCreateModalOpen(false);
    setNewCollectionName("");
  };

  // ── Delete handlers ──────────────────────────────────────────────────────────
  // The card's kebab / right-click menu (owned by BaseCard) requests deletion;
  // collections route through ConfirmDeleteModal (collaborator-aware).

  const handleDeleteRequest = useCallback((item: { id: string; name: string }) => {
    setDeleteModal({ open: true, ids: [item.id], name: item.name, collaboratorCount: 0 });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    try {
      await Promise.all(deleteModal.ids.map((id) => deleteCollection(id)));
      queryClient.invalidateQueries({ queryKey: queryKeys.collections() });
      showToast({ title: "Deleted", variant: "success" });
    } catch {
      showToast({ title: "Something went wrong. Try again.", variant: "error" });
    }
  }, [deleteModal.ids, showToast]);

  return (
    <div
      className="collections-page flex flex-col min-h-full pt-[var(--navbar-height)]"
      data-region="collections-page"
    >
      <div
        data-region="collections-shell"
        className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 pt-3 pb-10 md:px-8 lg:px-12 xl:px-20"
      >
        {/* Header Section */}
        <div
          data-region="collections-header"
          className="flex w-full flex-col items-stretch gap-3 md:flex-row md:items-start md:justify-between"
        >
          <h1 className="type-h4 font-secondary font-semibold text-glyph">Your Collections</h1>
          <div data-region="collections-usage" className="shrink-0">
            <UsageCard
              type="link"
              usage={linkUsage}
              variant="detailed"
              upgradeHref={linkUsage && linkUsage.used >= linkUsage.max ? "/billing" : undefined}
              className="w-full md:w-[280px]"
            />
          </div>
        </div>

        {/* Cards Grid */}
        <div data-region="collections-bento-wrap" className="@container w-full">
          {/* Bento Grid */}
          <div
            data-region="collections-bento-grid"
            className="bento-grid [--ratio:0.72] [--cols:1] sm:[--ratio:calc(292/243)] sm:[--cols:2] md:[--cols:3] lg:[--cols:4] xl:[--cols:5]"
          >
            {/* Create Card */}
            <div data-region="collections-create" className="h-full">
              <CreateCard
                type="collection"
                className="h-full"
                onAction={() => setIsCreateModalOpen(true)}
              />
            </div>

            {/* Collection Cards */}
            {filteredCollections.map((item: CollectionWithRole) => (
              <motion.div
                key={item.id}
                data-region="collections-card"
                data-card-id={item.id}
                className="h-full"
                initial={
                  newCollectionIdsRef.current.has(item.id) && !shouldReduceMotion
                    ? motionPresets.completionHandoff.initial
                    : false
                }
                animate={motionPresets.completionHandoff.animate}
                transition={
                  shouldReduceMotion ? motionTransitions.instant : motionTransitions.spatial
                }
                onAnimationComplete={() => {
                  newCollectionIdsRef.current.delete(item.id);
                }}
              >
                <CollectionCard
                  label={item.name}
                  images={
                    item.preview_images?.length
                      ? item.preview_images
                      : item.thumbnail_url
                        ? [item.thumbnail_url]
                        : undefined
                  }
                  gradient={
                    item.preview_images?.length || item.thumbnail_url
                      ? undefined
                      : collectionGradient
                  }
                  fallbackQuery={item.region || item.name}
                  className="h-full"
                  onClick={() => router.push(`/collections/${item.id}`)}
                  onDelete={() => handleDeleteRequest({ id: item.id, name: item.name })}
                />
              </motion.div>
            ))}
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="flex w-full items-center justify-center py-16">
              <span className="type-body-2 text-content-secondary">Loading...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && filteredCollections.length === 0 && (
            <div
              data-region="collections-empty-state"
              className="flex w-full flex-col items-center justify-center gap-3 py-16"
            >
              <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-muted">
                <Layers className="size-7 text-content-secondary" />
              </div>
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="type-body-1 text-glyph">No collections found</p>
                <p className="type-body-2 text-content-secondary">
                  Create a new collection to get started
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm Delete Modal */}
      <ConfirmDeleteModal
        open={deleteModal.open}
        onOpenChange={(open) => setDeleteModal((prev) => ({ ...prev, open }))}
        entityType="collection"
        entityName={deleteModal.name}
        collaboratorCount={deleteModal.collaboratorCount}
        onConfirm={handleConfirmDelete}
      />

      {/* Create Collection Modal */}
      <NewCollectionModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        collectionValue={newCollectionName}
        onCollectionChange={setNewCollectionName}
        onSubmit={handleCreateCollection}
        isLoading={isCreating}
        onCancel={handleCancelCreate}
      />
    </div>
  );
}
