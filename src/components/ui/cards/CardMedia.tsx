"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface CardMediaProps {
  imageUrl?: string;
  imageAlt?: string;
  /** Tailwind aspect ratio, e.g. "9/16". Defaults to filling available space. */
  imageAspect?: string;
  gradient?: string;
  /** Fallback alt text when `imageAlt` is absent */
  label: string;
  /**
   * Custom slot content (e.g. CollectionCard's multi-image grid). When provided,
   * it is rendered inside the standard frame and takes precedence over the
   * image/gradient/placeholder fallback paths.
   */
  children?: ReactNode;
}

/**
 * Standard framed card media: renders custom `children` when provided, otherwise
 * shows the image when available, falls back to a gradient, then to a plain
 * placeholder. Static `rounded-xl` slot per Figma Card (node 1698:11889) — no
 * hover expansion. Single source of truth for the card media slot across all
 * card types.
 */
export function CardMedia({ imageUrl, imageAlt, imageAspect, gradient, label, children }: CardMediaProps) {
  const [imgError, setImgError] = useState(false);

  const frameClass = cn(
    "card-media relative w-full rounded-xl overflow-hidden bg-surface-alt",
    imageAspect ? `aspect-[${imageAspect}]` : "flex-1",
  );

  if (children) {
    return <div className={frameClass}>{children}</div>;
  }

  if (imageUrl && !imgError) {
    return (
      <div className={frameClass}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={imageAlt || label}
          className="absolute inset-0 w-full h-full object-cover"
          draggable="false"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  if (gradient) {
    return <div className={frameClass} style={{ background: gradient }} />;
  }

  return <div className={frameClass} />;
}
