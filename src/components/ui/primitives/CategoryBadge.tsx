"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  Link,
  Layers,
  Map,
  MapPin,
  SquareDashed,
  PlaneTakeoff,
  House,
  WalletMinimal,
  type LucideIcon,
} from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

// Outer ring uses the lighter `-icon` token (400 shade) as a halo around the
// inner circle.
const categoryBadgeVariants = cva(
  "inline-flex items-center justify-center overflow-hidden size-6 rounded-full p-0.5 shrink-0",
  {
    variants: {
      category: {
        link: "bg-category-link-icon",
        collection: "bg-category-collection-icon",
        itinerary: "bg-category-itinerary-icon",
        location: "bg-category-location-icon",
        brand: "bg-category-brand-icon",
        neutral: "bg-category-neutral-icon",
        flight: "bg-category-flight-icon",
        accommodation: "bg-category-accommodation-icon",
        expense: "bg-category-expense-icon",
      },
    },
    defaultVariants: {
      category: "neutral",
    },
  }
);

// Inner circle uses the base 500/600 fill; the glyph uses the `-on` token
// (50 shade of the family) for high contrast on the fill.
const categoryBadgeInnerVariants = cva(
  "flex-1 self-stretch inline-flex items-center justify-center overflow-hidden rounded-full",
  {
    variants: {
      category: {
        link: "bg-category-link text-category-link-on",
        collection: "bg-category-collection text-category-collection-on",
        itinerary: "bg-category-itinerary text-category-itinerary-on",
        location: "bg-category-location text-category-location-on",
        brand: "bg-category-brand text-category-brand-on",
        neutral: "bg-category-neutral text-category-neutral-on",
        flight: "bg-category-flight text-category-flight-on",
        accommodation: "bg-category-accommodation text-category-accommodation-on",
        expense: "bg-category-expense text-category-expense-on",
      },
    },
    defaultVariants: {
      category: "neutral",
    },
  }
);

const defaultIcons: Record<string, LucideIcon> = {
  link: Link,
  collection: Layers,
  itinerary: Map,
  location: MapPin,
  brand: SquareDashed,
  neutral: SquareDashed,
  flight: PlaneTakeoff,
  accommodation: House,
  expense: WalletMinimal,
};

interface CategoryBadgeProps
  extends VariantProps<typeof categoryBadgeVariants>,
    ComponentPropsWithoutRef<"div"> {
  /** Custom icon to display. Defaults to category-specific icon. */
  icon?: LucideIcon;
  /** Size of the icon in pixels (default: 12, fits the 20px inner circle). */
  iconSize?: number;
}

const CategoryBadge = forwardRef<HTMLDivElement, CategoryBadgeProps>(
  (
    { className, category = "neutral", icon: Icon, iconSize = 12, ...props },
    ref
  ) => {
    const DefaultIcon = category ? defaultIcons[category] : SquareDashed;
    const IconToRender = Icon ?? DefaultIcon;

    return (
      <div
        ref={ref}
        data-slot="category-badge"
        className={cn(
          "category-badge",
          categoryBadgeVariants({ category, className })
        )}
        {...props}
      >
        {/* Inner Circle */}
        <div className={cn(categoryBadgeInnerVariants({ category }))}>
          <IconToRender size={iconSize} aria-hidden="true" className="text-current" />
        </div>
      </div>
    );
  }
);

CategoryBadge.displayName = "CategoryBadge";

export { CategoryBadge };
export type { CategoryBadgeProps };
