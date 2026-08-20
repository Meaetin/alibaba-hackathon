"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils";
import { useLocationPhoto } from "@/hooks/useLocationPhoto";
import { BaseCard, type BaseCardProps } from "./BaseCard";
import { CardMedia } from "./CardMedia";

export function CollectionImageGrid({ images }: { images: string[] }) {
  const count = Math.min(images.length, 4);

  if (count === 1) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={images[0]}
        alt=""
        className="collection-image-grid-single w-full h-full object-cover"
        draggable="false"
      />
    );
  }

  return (
    <div className="collection-image-grid grid grid-cols-2 grid-rows-2 gap-[2px] w-full h-full">
      {images.slice(0, count).map((url, i) => {
        let colClass = "";
        let rowClass = "";

        if (count === 2) {
          colClass = "col-[1/span_2]";
          rowClass = i === 0 ? "row-1" : "row-2";
        } else if (count === 3) {
          if (i === 0) { colClass = "col-[1/span_2]"; rowClass = "row-1"; }
          else { colClass = i === 1 ? "col-1" : "col-2"; rowClass = "row-2"; }
        } else {
          colClass = i % 2 === 0 ? "col-1" : "col-2";
          rowClass = i < 2 ? "row-1" : "row-2";
        }

        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={url}
            alt=""
            className={cn("collection-image-grid-tile w-full h-full object-cover", colClass, rowClass)}
            draggable="false"
          />
        );
      })}
    </div>
  );
}

interface CollectionCardProps
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
  images?: string[];
  imageAspect?: string;
  gradient?: string;
  fallbackQuery?: string;
}

const CollectionCard = forwardRef<HTMLDivElement, CollectionCardProps>(
  ({ images, imageAspect, gradient, fallbackQuery, label, ...props }, ref) => {
    const hasImages = images && images.length > 0;
    const { url: unsplashUrl } = useLocationPhoto({ region: fallbackQuery }, hasImages);

    // Multi-image collections render their 2×2 grid through CardMedia's slot;
    // the single-image/Unsplash/gradient/placeholder fallbacks reuse CardMedia's
    // built-in paths (precedence: images > Unsplash > gradient > placeholder).
    const media = (
      <CardMedia
        imageUrl={hasImages ? undefined : unsplashUrl ?? undefined}
        imageAspect={imageAspect}
        gradient={gradient}
        label={label ?? ""}
      >
        {hasImages ? <CollectionImageGrid images={images!} /> : undefined}
      </CardMedia>
    );

    return (
      <BaseCard
        ref={ref}
        cardClass="collection-card"
        iconVariant="collection"
        label={label}
        media={media}
        {...props}
      />
    );
  }
);

CollectionCard.displayName = "CollectionCard";

export { CollectionCard };
export type { CollectionCardProps };
