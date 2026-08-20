"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";

import { cn } from "@/lib/utils";

interface ImageGalleryProps {
  images: string[];
  alt: string;
  className?: string;
  onLightboxChange?: (open: boolean) => void;
}

function ImageCell({
  src,
  alt,
  className,
  onClick,
  children,
}: {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative bg-surface-muted overflow-hidden cursor-pointer",
        "focus-visible:ring-2 focus-visible:ring-edge-strong focus-visible:ring-offset-2 outline-none",
        className,
      )}
      onClick={onClick}
    >
      <img src={src} alt={alt} className="size-full object-cover" />
      {children}
    </button>
  );
}

function ImageLightbox({
  images,
  alt,
  initialIndex,
  open,
  onClose,
}: {
  images: string[];
  alt: string;
  initialIndex: number;
  open: boolean;
  onClose: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    if (open) setCurrentIndex(initialIndex);
  }, [open, initialIndex]);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  useEffect(() => {
    if (!open || images.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [open, images.length, goNext, goPrev, onClose]);

  if (!open || images.length === 0) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
      onKeyDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/90"
        onClick={onClose}
      />

      {/* Close */}
      <button
        type="button"
        className="absolute top-4 right-4 z-10 flex items-center justify-center size-10 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        aria-label="Close lightbox"
        onClick={onClose}
      >
        <X className="size-5" />
      </button>

      {/* Counter */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10 type-body-2 text-white/70 tabular-nums">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Previous */}
      {images.length > 1 && (
        <button
          type="button"
          onClick={goPrev}
          className="absolute left-4 z-10 flex items-center justify-center size-10 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          aria-label="Previous image"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}

      {/* Image */}
      <img
        src={images[currentIndex]}
        alt={`${alt} - ${currentIndex + 1}`}
        className="relative z-[1] max-h-[85vh] max-w-[90vw] object-contain rounded-lg select-none"
        draggable={false}
      />

      {/* Next */}
      {images.length > 1 && (
        <button
          type="button"
          onClick={goNext}
          className="absolute right-4 z-10 flex items-center justify-center size-10 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          aria-label="Next image"
        >
          <ChevronRight className="size-5" />
        </button>
      )}
    </div>,
    document.body,
  );
}

/**
 * ImageGallery — location photo gallery (Figma: Argo-v4 → ImageGallery, node 882:46).
 *
 * Layout per Figma: a full-width hero MainImage (h-180) on top, with up to four
 * thumbnail tiles (h-80, two-per-row) stacked below, all separated by an 8px gap.
 * The Figma variants "Images=2" / "Images=4" count the SUB-images, i.e. 3 and 5
 * total images respectively. Counts outside those are mapped gracefully:
 *   0 → empty placeholder · 1 → hero only · 2 → hero + 1 thumb ·
 *   3 → hero + 2 thumbs (Figma "2") · 4 → hero + 3 thumbs ·
 *   5 → hero + 4 thumbs (Figma "4") · 6+ → hero + 4 thumbs with a "+N more" overlay.
 * Tapping any tile opens the full-screen ImageLightbox.
 */
function ImageGallery({ images, alt, className, onLightboxChange }: ImageGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const setLightbox = useCallback((open: boolean) => {
    setLightboxOpen(open);
    onLightboxChange?.(open);
  }, [onLightboxChange]);

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightbox(true);
  };

  const count = images.length;

  // First image is the hero; the rest become thumbnails (max 4 visible, two per row).
  const thumbnails = images.slice(1, 5);
  const hasMore = count > 5;
  const extraCount = count - 5;

  // Chunk thumbnails into rows of two to mirror the Figma SubImages layout.
  const thumbnailRows: string[][] = [];
  for (let i = 0; i < thumbnails.length; i += 2) {
    thumbnailRows.push(thumbnails.slice(i, i + 2));
  }

  return (
    <>
      <div className={cn("flex flex-col gap-2", className)}>
        {/* Empty State */}
        {count === 0 && <div className="h-[180px] w-full rounded-xl bg-surface-muted" />}

        {/* Hero Image */}
        {count >= 1 && (
          <ImageCell
            src={images[0]}
            alt={alt}
            className="h-[180px] w-full rounded-xl"
            onClick={() => openLightbox(0)}
          />
        )}

        {/* Thumbnail Rows */}
        {thumbnailRows.map((row, rowIdx) => (
          <div key={rowIdx} className="flex gap-2">
            {row.map((src, colIdx) => {
              const thumbIdx = rowIdx * 2 + colIdx; // 0-based within thumbnails
              const imageIndex = thumbIdx + 1; // index within the full images array
              const isLastVisible = thumbIdx === thumbnails.length - 1;
              const showOverlay = hasMore && isLastVisible;
              return (
                <ImageCell
                  key={imageIndex}
                  src={src}
                  alt={`${alt} - ${imageIndex + 1}`}
                  className="h-[80px] flex-1 rounded-xl"
                  onClick={() => openLightbox(imageIndex)}
                >
                  {showOverlay && (
                    <div className="absolute inset-0 flex items-end justify-end p-3 bg-gradient-to-t from-black/50 to-transparent">
                      <span className="flex items-center gap-1.5 type-body-2 font-medium text-white tabular-nums">
                        <Images className="size-4" />
                        +{extraCount} more
                      </span>
                    </div>
                  )}
                </ImageCell>
              );
            })}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      <ImageLightbox
        images={images}
        alt={alt}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightbox(false)}
      />
    </>
  );
}

ImageGallery.displayName = "ImageGallery";

export { ImageGallery, ImageLightbox };
export type { ImageGalleryProps };
