"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/primitives/Button";
import type { Surface } from "@/lib/domain-types";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  DescriptiveMenuItem,
} from "@/components/ui/primitives/Menu";

interface NewMenuDropdownProps {
  /** Surface this menu lives on, for the create-funnel analytics. */
  source: Surface;
  /** Fired when "Link" is chosen. */
  onNewLink?: () => void;
  /** Fired when "Collection" is chosen. */
  onNewCollection?: () => void;
  /** Fired when "Itinerary" is chosen. */
  onNewItinerary?: () => void;
}

/**
 * The "+ New" create menu in the navbar. A `MenuContent` surface holding three
 * `DescriptiveMenuItem`s (Link / Collection / Itinerary), each with a
 * `CategoryBadge` icon. Mirrors the Figma `NewMenuDropdown` component (794:151).
 */
function NewMenuDropdown({
  onNewLink,
  onNewCollection,
  onNewItinerary,
  source,
}: NewMenuDropdownProps) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="primary" size="sm" icon="leading" />}
        aria-label="Create new"
      >
        <Plus className="size-4" />
        New
      </MenuTrigger>

      <MenuContent align="end" sideOffset={8} className="w-[296px]" positionerClassName="z-50">
        <DescriptiveMenuItem
          leadingIcon={<CategoryBadge category="link" />}
          title="Link"
          description="Save a URL or Video"
          onClick={onNewLink}
        />
        <DescriptiveMenuItem
          leadingIcon={<CategoryBadge category="collection" />}
          title="Collection"
          description="Group your links"
          onClick={onNewCollection}
        />
        <DescriptiveMenuItem
          leadingIcon={<CategoryBadge category="itinerary" />}
          title="Itinerary"
          description="Plan your next trip"
          onClick={onNewItinerary}
        />
      </MenuContent>
    </Menu>
  );
}

export { NewMenuDropdown };
export type { NewMenuDropdownProps };
