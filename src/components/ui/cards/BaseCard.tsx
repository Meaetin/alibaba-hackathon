"use client";

import { MoreVertical } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { CategoryBadge, type CategoryBadgeProps } from "@/components/ui/primitives/CategoryBadge";
import { CardActionMenu } from "@/components/ui/dashboard/CardActionMenu";

const baseCardClasses = [
  "relative flex flex-col items-start gap-2 p-2 rounded-2xl border border-edge-subtle bg-surface overflow-hidden cursor-pointer",
  "transition-colors duration-[var(--motion-duration-fast)]",
  "focus-visible:border-edge-strong focus-visible:ring-edge-strong/50 focus-visible:ring-3 outline-none",
  "disabled:pointer-events-none disabled:opacity-50",
].join(" ");

interface BaseCardProps {
  /** Root slug class that also names the card semantically, e.g. "itinerary-card" */
  cardClass: string;
  className?: string;
  style?: React.CSSProperties;
  /** Media area (image, gradient, grid…) rendered above the header */
  media: ReactNode;
  /** Header label text */
  label: string;
  /** CategoryBadge category shown in the header */
  iconVariant?: CategoryBadgeProps["category"];
  href?: string;
  prefetchHref?: string;
  onClick?: () => void;
  /**
   * Card action callbacks. When any is provided, BaseCard renders the trailing
   * `⋮` kebab and a right-click handler that open the shared `CardActionMenu`
   * (anchored to the kebab, or the cursor on right-click). Pages supply the
   * behaviour; the menu itself lives here so every card gets it for free.
   */
  onDelete?: () => void;
  onAddToCollection?: () => void;
  onAddToItinerary?: () => void;
  disabled?: boolean;
  /**
   * Rubber-band multi-select state. When true the card renders the Figma
   * "Selected" variant: a 2px brand border on a `surface-alt` background.
   */
  isSelected?: boolean;
  isSelectingMode?: boolean;
}

/**
 * Shared shell for all entity cards: selection badge, header, and the
 * Link-vs-button wrapper with its keyboard/click handling. Each card supplies
 * its own `media` slot and `cardClass`/`iconVariant`.
 */
const BaseCard = forwardRef<HTMLDivElement, BaseCardProps>(
  (
    {
      cardClass,
      className,
      style,
      media,
      label,
      iconVariant,
      href,
      prefetchHref,
      onClick,
      onDelete,
      onAddToCollection,
      onAddToItinerary,
      disabled,
      isSelected,
      isSelectingMode,
      ...htmlProps
    },
    ref
  ) => {
    const router = useRouter();

    const [menuOpen, setMenuOpen] = useState(false);
    const [menuCoords, setMenuCoords] = useState<{ x: number; y: number } | null>(null);
    const hasMenuActions = Boolean(onDelete || onAddToCollection || onAddToItinerary);

    const openMenuAt = (coords: { x: number; y: number }) => {
      setMenuCoords(coords);
      setMenuOpen(true);
    };

    // Kebab — anchor the menu under the ⋮ button. The menu is right-aligned
    // (align="end"), so anchor at the kebab's right edge to align the edges.
    const handleKebabClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      openMenuAt({ x: rect.right, y: rect.bottom });
    };

    // Right-click convenience — anchor at the cursor.
    const handleContextMenu = hasMenuActions
      ? (e: React.MouseEvent) => {
          e.preventDefault();
          openMenuAt({ x: e.clientX, y: e.clientY });
        }
      : undefined;

    // Close the menu before running the action so it never lingers open.
    const runAction = (fn?: () => void) =>
      fn ? () => { setMenuOpen(false); fn(); } : undefined;

    const cardClassName = cn(
      cardClass,
      baseCardClasses,
      !isSelectingMode && "group hover:bg-surface-alt hover:border-edge",
      isSelected && "border-2 border-edge-brand bg-surface-alt",
      disabled && "opacity-50 pointer-events-none",
      className,
    );

    const cardContent = (
      <>
        {/* Media Area */}
        {media}

        {/* Footer */}
        <div className="card-header flex items-center gap-1.5 px-2 py-1 w-full shrink-0">
          <CategoryBadge category={iconVariant} />
          <span className="card-header-label type-body-2 font-medium text-glyph truncate flex-1 min-w-0">
            {label}
          </span>
          {hasMenuActions && (
            <Button
              variant="ghost"
              size="xs"
              icon="only"
              className={cn(
                "card-header-menu shrink-0 transition-opacity",
                isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
              aria-label="More options"
              onClick={handleKebabClick}
            >
              <MoreVertical className="size-4" />
            </Button>
          )}
        </div>
      </>
    );

    const actionMenu = hasMenuActions ? (
      <CardActionMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        coords={menuCoords}
        onDelete={runAction(onDelete)}
        onAddToCollection={runAction(onAddToCollection)}
        onAddToItinerary={runAction(onAddToItinerary)}
      />
    ) : null;

    if (href) {
      return (
        <>
          <Link
            href={href}
            className={cardClassName}
            style={style}
            onClick={disabled ? (e) => e.preventDefault() : onClick}
            onContextMenu={handleContextMenu}
            aria-disabled={disabled}
          >
            {cardContent}
          </Link>
          {actionMenu}
        </>
      );
    }

    return (
      <>
        <div
          ref={ref}
          role="button"
          tabIndex={disabled ? -1 : 0}
          className={cardClassName}
          style={style}
          onClick={disabled ? undefined : onClick}
          onContextMenu={handleContextMenu}
          onMouseEnter={prefetchHref ? () => router.prefetch(prefetchHref) : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!disabled && onClick) onClick();
            }
          }}
          aria-disabled={disabled}
          {...htmlProps}
        >
          {cardContent}
        </div>
        {actionMenu}
      </>
    );
  }
);

BaseCard.displayName = "BaseCard";

export { BaseCard };
export type { BaseCardProps };
