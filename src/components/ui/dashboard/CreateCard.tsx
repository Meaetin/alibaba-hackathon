"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";

type CreateCardType = "link" | "collection" | "itinerary" | "flight";

interface CreateCardContent {
  stickerUrl: string;
  title: string;
  description: string;
  buttonLabel: string;
}

const CREATE_CARD_CONTENT: Record<CreateCardType, CreateCardContent> = {
  link: {
    stickerUrl: "/images/stickers/Link Sticker.svg",
    title: "Add New Link",
    description: "Analyse TikTok, YouTube, Instagram and Websites",
    buttonLabel: "Add Link",
  },
  collection: {
    stickerUrl: "/images/stickers/Folder.svg",
    title: "New Collection",
    description: "Create boards to save your favorite spots",
    buttonLabel: "Create Collection",
  },
  itinerary: {
    stickerUrl: "/images/stickers/Map.svg",
    title: "Plan New Itinerary",
    description: "Compile your favorite spots into a trip plan",
    buttonLabel: "Start Planning",
  },
  flight: {
    stickerUrl: "/images/stickers/Plane.svg",
    title: "Discover Flights",
    description: "Find and track flights for your next trip",
    buttonLabel: "Explore Flights",
  },
};

interface CreateCardProps {
  /** Which create action this card promotes (maps to Figma `Type` property) */
  type: CreateCardType;
  /** Click handler for the action button (modal hookup) */
  onAction?: () => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Promo card for the four create flows (link / collection / itinerary / flight),
 * shown on the home page and each entity page. The button will open the
 * matching create modal via `onAction`.
 */
function CreateCard({ type, onAction, className, disabled }: CreateCardProps) {
  const content = CREATE_CARD_CONTENT[type];

  return (
    <div
      className={cn(
        "create-card flex flex-col items-center justify-between rounded-2xl border border-edge bg-surface p-3 shadow-default",
        className,
      )}
      data-name={`create-${type}-card`}
    >
      {/* Content Section */}
      <div className="create-card-content flex w-full flex-1 flex-col items-center gap-6 py-3">
        <div className="create-card-sticker flex size-[80px] items-center justify-center drop-shadow-[0px_3.2px_3.2px_rgba(0,0,0,0.25)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={content.stickerUrl}
            alt=""
            className="create-card-sticker-image size-full object-contain"
            draggable="false"
            aria-hidden="true"
          />
        </div>
        <div className="create-card-header flex flex-col items-center gap-2 text-center">
          <h3 className="create-card-title type-body-2 type-secondary font-semibold text-content">
            {content.title}
          </h3>
          <p className="create-card-description type-body-3 text-content-placeholder">
            {content.description}
          </p>
        </div>
      </div>

      {/* Action Button */}
      <Button
        variant="primary"
        size="sm"
        className="create-card-button w-full"
        onClick={onAction}
        disabled={disabled}
      >
        {content.buttonLabel}
      </Button>
    </div>
  );
}

export { CreateCard };
export type { CreateCardProps, CreateCardType };
