"use client";

import { forwardRef } from "react";

import { BaseCard, type BaseCardProps } from "./BaseCard";
import { CardMedia } from "./CardMedia";

interface LocationCardProps
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

const LocationCard = forwardRef<HTMLDivElement, LocationCardProps>(
  ({ imageUrl, imageAlt, imageAspect, gradient, label, ...props }, ref) => (
    <BaseCard
      ref={ref}
      cardClass="location-card"
      iconVariant="location"
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

LocationCard.displayName = "LocationCard";

export { LocationCard };
export type { LocationCardProps };
