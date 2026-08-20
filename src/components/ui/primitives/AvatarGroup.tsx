"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Children, forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";

// Width is purely content-driven in Figma (no container padding). The `size`
// variant exists to drive each child Avatar's size; overlap is a fixed -12px
// for every size (-ml-3).
const avatarGroupVariants = cva("flex items-center", {
  variants: {
    size: {
      sm: "",
      md: "",
      lg: "",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

interface AvatarGroupProps
  extends VariantProps<typeof avatarGroupVariants>,
    HTMLAttributes<HTMLDivElement> {
  /** Child Avatar components */
  children?: ReactNode;
  /** Maximum number of avatars to show before truncating */
  max?: number;
}

/**
 * AvatarGroup displays a stack of overlapping avatars with a count indicator
 * for additional avatars beyond the max.
 *
 * Avatars overlap by -12px (`-ml-3`) for all sizes. The overflow indicator is a
 * plain initial Avatar showing `+N`, matching the Figma AvatarGroup component set.
 *
 * @example
 * <AvatarGroup max={3} size="md">
 *   <Avatar name="John Doe" size="md" />
 *   <Avatar name="Jane Smith" size="md" />
 *   <Avatar name="Bob Wilson" size="md" />
 *   <Avatar name="Alice Brown" size="md" />
 * </AvatarGroup>
 */
const AvatarGroup = forwardRef<HTMLDivElement, AvatarGroupProps>(
  ({ children, max = 4, size = "md", className, ...props }, ref) => {
    // Children.toArray flattens nested arrays (e.g. `{single}{list.map()}`) and
    // drops null/false/empty entries — so an empty collaborators `[]` can't leak
    // a stray `-ml-3` item that collapses the group's width via negative margin.
    const childArray = Children.toArray(children);
    const visibleChildren = max ? childArray.slice(0, max) : childArray;
    const remainingCount = max ? childArray.length - max : 0;

    return (
      <div
        ref={ref}
        className={cn("avatar-group", avatarGroupVariants({ size, className }))}
        {...props}
      >
        {visibleChildren.map((child, index) => {
          // -12px overlap (-ml-3) on every avatar after the first
          const overlapClass = index > 0 ? "-ml-3" : "";
          return (
            <div
              key={index}
              className={cn("avatar-group-item relative", overlapClass)}
            >
              {child}
            </div>
          );
        })}
        {remainingCount > 0 && (
          <div className="avatar-group-remaining -ml-3">
            <Avatar
              size={size}
              type="initial"
              initials={`+${remainingCount}`}
              className="avatar-group-remaining-avatar"
            />
          </div>
        )}
      </div>
    );
  }
);

AvatarGroup.displayName = "AvatarGroup";

export { AvatarGroup };
export type { AvatarGroupProps };
