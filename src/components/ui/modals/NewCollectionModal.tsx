"use client";

import { useRef, useState, type ReactNode } from "react";
import { MapPin, PenLine, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { FormModal } from "@/components/ui/modals/FormModal";
import { Input } from "@/components/ui/primitives/Input";
import { Pill } from "@/components/ui/primitives/Pill";
import { PlaceAutocomplete } from "@/components/ui/primitives/PlaceAutocomplete";
import type { PlaceResult } from "@/components/ui/primitives/PlaceAutocomplete";

const COLLECTION_TAGS = [
  "Lodging",
  "Cafes",
  "Food",
  "Must Try",
  "Nature",
  "Sightseeing",
] as const;

interface NewCollectionModalProps {
  className?: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  collectionValue?: string;
  defaultCollectionValue?: string;
  onCollectionChange?: (value: string) => void;
  onSubmit?: (data: {
    name: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    tags?: string[];
  }) => void | Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
}

function NewCollectionModal({
  className,
  trigger,
  open,
  onOpenChange,
  collectionValue,
  defaultCollectionValue,
  onCollectionChange,
  onSubmit,
  onCancel,
  isLoading,
}: NewCollectionModalProps) {
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagValue, setNewTagValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const newTagInputRef = useRef<HTMLInputElement>(null);

  const currentName = collectionValue ?? defaultCollectionValue ?? "";
  const hasName = Boolean(currentName.trim());
  const isBusy = isLoading || isSubmitting;

  const resetState = () => {
    setSelectedPlace(null);
    setSelectedTags(new Set());
    setCustomTags([]);
    setIsAddingTag(false);
    setNewTagValue("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetState();
    onOpenChange?.(nextOpen);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const commitNewTag = () => {
    const tag = newTagValue.trim();
    if (tag && !COLLECTION_TAGS.includes(tag as never) && !customTags.includes(tag)) {
      setCustomTags((prev) => [...prev, tag]);
      setSelectedTags((prev) => new Set(prev).add(tag));
    }
    setNewTagValue("");
    setIsAddingTag(false);
  };

  const removeCustomTag = (tag: string) => {
    setCustomTags((prev) => prev.filter((t) => t !== tag));
    setSelectedTags((prev) => {
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });
  };

  const handleAddTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitNewTag();
    }
    if (e.key === "Escape") {
      setNewTagValue("");
      setIsAddingTag(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasName || isBusy || !onSubmit) return;
    const allTags = [...Array.from(selectedTags), ...customTags];
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: currentName,
        country: selectedPlace?.country,
        region: selectedPlace?.region ?? undefined,
        latitude: selectedPlace?.latitude,
        longitude: selectedPlace?.longitude,
        tags: allTags.length > 0 ? allTags : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormModal
      className={cn("w-[33.25rem]", className)}
      trigger={trigger}
      open={open}
      onOpenChange={handleOpenChange}
      variant="collection"
      stickerUrl="/images/stickers/Folder.svg"
      title="New Collection"
      description="Create boards to save your favorite spots"
      submitLabel="Create Collection"
      submittingLabel="Creating…"
      onSubmit={handleSubmit}
      onCancel={onCancel}
      submitDisabled={!hasName}
      isSubmitting={isBusy}
    >
      {/* Form Fields */}
      <div className="new-collection-modal-fields flex flex-col gap-4 items-center w-full">
        <Input
          icon={<PenLine />}
          placeholder="Name your collection"
          value={collectionValue}
          defaultValue={defaultCollectionValue}
          onChange={(e) => onCollectionChange?.(e.target.value)}
          className="w-full max-w-80"
        />
        <PlaceAutocomplete
          icon={<MapPin />}
          placeholder="Location (optional)"
          onPlaceSelect={setSelectedPlace}
          className="new-collection-modal-place-autocomplete w-full max-w-80"
          inputClassName="h-11 rounded-xl"
        />

        {/* Tags Row */}
        <div className="new-collection-modal-tags flex flex-wrap gap-2 w-full max-w-[26.25rem]">
          {COLLECTION_TAGS.map((tag) => (
            <Pill
              key={tag}
              type={selectedTags.has(tag) ? "selected" : "default"}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </Pill>
          ))}
          {customTags.map((tag) => (
            <Pill
              key={tag}
              type={selectedTags.has(tag) ? "selected" : "default"}
              onClick={() => toggleTag(tag)}
              onRemove={() => removeCustomTag(tag)}
            >
              {tag}
            </Pill>
          ))}
          {isAddingTag ? (
            <div className="new-collection-modal-tag-input-wrapper inline-flex h-9 items-center rounded-full border border-edge px-3 bg-surface focus-within:border-edge-strong focus-within:ring-2 focus-within:ring-edge-strong/50 transition-colors">
              <input
                ref={newTagInputRef}
                autoFocus
                type="text"
                value={newTagValue}
                onChange={(e) => setNewTagValue(e.target.value)}
                onKeyDown={handleAddTagKeyDown}
                onBlur={commitNewTag}
                placeholder="Tag name…"
                className="new-collection-modal-tag-input type-body-2 bg-transparent outline-none w-24 placeholder:text-content-secondary text-content"
              />
            </div>
          ) : (
            <Pill
              type="input"
              leadingIcon={<Plus className="size-4" />}
              onClick={() => setIsAddingTag(true)}
            >
              Add
            </Pill>
          )}
        </div>
      </div>
    </FormModal>
  );
}

NewCollectionModal.displayName = "NewCollectionModal";

export { NewCollectionModal };
export type { NewCollectionModalProps };
