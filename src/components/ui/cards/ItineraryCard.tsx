"use client";

import { forwardRef } from "react";

import { BaseCard, type BaseCardProps } from "./BaseCard";
import { CardMedia } from "./CardMedia";

interface ItineraryCardProps
  extends Pick<
    BaseCardProps,
    | "className"
    | "style"
    | "label"
    | "href"
    | "prefetchHref"
    | "onClick"
    | "onDelete"
    | "onAddToCollection"
    | "onAddToItinerary"
    | "disabled"
    | "isSelected"
    | "isSelectingMode"
  > {
  imageUrl?: string;
  imageAlt?: string;
  imageAspect?: string;
  gradient?: string;
}

const ItineraryCard = forwardRef<HTMLDivElement, ItineraryCardProps>(
  ({ imageUrl, imageAlt, imageAspect, gradient, label, ...props }, ref) => (
    <BaseCard
      ref={ref}
      cardClass="itinerary-card"
      iconVariant="itinerary"
      label={label}
      media={
        <CardMedia
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          imageAspect={imageAspect}
          gradient={gradient}
          label={label}
        />
      }
      {...props}
    />
  )
);

ItineraryCard.displayName = "ItineraryCard";

export { ItineraryCard };
export type { ItineraryCardProps };
