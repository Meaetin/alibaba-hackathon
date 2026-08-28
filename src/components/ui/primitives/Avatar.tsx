"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Hashvatar } from "hashvatar/react";
import { UserRound, type LucideIcon } from "lucide-react";
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "avatar relative flex items-center justify-center rounded-full overflow-hidden bg-surface-alt font-medium",
  {
    variants: {
      size: {
        sm: "size-8 type-body-4", // 32px — Body 4 (12/14)
        md: "size-9 type-body-3", // 36px — Body 3 (13/16)
        lg: "size-10 type-body-2", // 40px — Body 2 (14/20)
        xl: "size-[148px] type-h2 font-semibold", // 148px — profile page hero avatar
      },
      type: {
        initial: "border-2 border-surface",
        image: "border border-edge",
        generated: "border-2 border-surface",
        icon: "border-2 border-surface",
      },
    },
    defaultVariants: {
      size: "md",
      type: "initial",
    },
  }
);

/** Lucide icon px per avatar size (Figma: lg→20, md→16, sm→16) */
const ICON_SIZE_CLASS: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "size-4",
  md: "size-4",
  lg: "size-5",
  xl: "size-12",
};

interface AvatarProps
  extends VariantProps<typeof avatarVariants>,
    Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The name to display, used for generating initials */
  name?: string;
  /** Image source URL */
  src?: string;
  /** Stable user identifier used to generate a deterministic Hashvatar */
  hash?: string;
  /** Alt text for image */
  alt?: string;
  /** Custom initials (overrides name-based initials) */
  initials?: string;
  /** Lucide icon rendered when `type="icon"` (defaults to UserRound) */
  icon?: LucideIcon;
}

/**
 * Get initials from a name string
 */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Avatar component for displaying user identity via initials, image, a
 * deterministic Hashvatar, or an icon.
 *
 * Three sizes (sm 32px, md 36px, lg 40px) plus an xl 148px hero size for the
 * profile page, and four types (initial, image, generated, icon), matching the
 * Figma Avatar component set. The component is intentionally static; callers
 * can wrap it in an interactive control when avatar actions are introduced.
 *
 * @example
 * // Initial avatar
 * <Avatar name="John Doe" />
 *
 * // Image avatar
 * <Avatar src="/avatar.jpg" alt="John Doe" type="image" />
 *
 * // Generated avatar — the same hash always produces the same image
 * <Avatar hash="user-id" type="generated" />
 *
 * // Icon avatar (defaults to UserRound)
 * <Avatar type="icon" size="lg" />
 */
const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  (
    { name, src, hash, alt, initials, icon: IconComponent = UserRound, size, type, className, ...props },
    ref
  ) => {
    const displayInitials = initials
      ? initials.slice(0, 2).toUpperCase()
      : name
        ? getInitials(name)
        : "";

    const resolvedSize = size ?? "md";
    const isImage = type === "image" && src;
    const isGenerated = type === "generated" && hash;
    const isIcon = type === "icon";
    const hashvatarSize = { sm: 32, md: 36, lg: 40, xl: 148 }[resolvedSize];

    return (
      <div
        ref={ref}
        className={cn("avatar", avatarVariants({ size, type }), className)}
        {...props}
      >
        {isImage ? (
          <img
            className="avatar-image absolute inset-0 size-full object-cover"
            src={src}
            alt={alt || name || "Avatar"}
            draggable="false"
          />
        ) : isGenerated ? (
          <Hashvatar
            hash={hash}
            size={hashvatarSize}
            mode="dither"
            className="avatar-generated absolute inset-0 size-full"
            style={{ width: "100%", height: "100%" }}
          />
        ) : isIcon ? (
          <IconComponent
            className={cn("avatar-icon text-glyph", ICON_SIZE_CLASS[resolvedSize])}
          />
        ) : (
          <span className="avatar-initials text-glyph">{displayInitials}</span>
        )}
      </div>
    );
  }
);

Avatar.displayName = "Avatar";

export { Avatar };
export type { AvatarProps };
