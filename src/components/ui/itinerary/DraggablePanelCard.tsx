"use client";

import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { LocationCard } from "@/components/ui/cards/LocationCard";
import type { Location } from "@/lib/api/collections";

interface DraggablePanelCardProps {
  location: Location;
  onClick?: () => void;
  className?: string;
}

export function DraggablePanelCard({ location, onClick, className }: DraggablePanelCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `panel-${location.id}`,
    data: { type: "location" as const, location },
  });

  return (
    <LocationCard
      ref={setNodeRef}
      label={location.name}
      imageUrl={location.photo_urls?.[0]}
      onClick={onClick}
      className={cn(isDragging && "opacity-40", className)}
      data-slot="draggable-panel-card"
      {...listeners}
      {...attributes}
    />
  );
}
