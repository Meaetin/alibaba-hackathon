"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ArrowRight } from "lucide-react";
import { forwardRef, type MouseEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const actionCardVariants = cva(
  [
    "action-card group relative flex flex-col items-start rounded-2xl border border-edge bg-surface p-1 cursor-pointer",
    "transition-colors duration-[var(--motion-duration-fast)]",
    "hover:bg-surface-alt hover:border-edge-strong",
    "focus-visible:border-edge-strong focus-visible:ring-edge-strong/50 focus-visible:ring-3 outline-none",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {},
    defaultVariants: {},
  }
);

interface ActionCardProps extends VariantProps<typeof actionCardVariants> {
  className?: string;
  children?: ReactNode;
  /** Label text displayed in the card */
  label: string;
  /** Optional sticker image URL displayed centered in the card body */
  stickerUrl?: string;
  /** Click handler. Receives the mouse event so callers can anchor UI at cursor. */
  onClick?: (event?: MouseEvent<HTMLDivElement>) => void;
  /** Whether the card is disabled */
  disabled?: boolean;
}

const ActionCard = forwardRef<HTMLDivElement, ActionCardProps>(
  (
    {
      className,
      label,
      stickerUrl,
      onClick,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={disabled ? -1 : 0}
        className={cn(
          "action-card",
          actionCardVariants({ className })
        )}
        onClick={disabled ? undefined : onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!disabled && onClick) onClick();
          }
        }}
        aria-disabled={disabled}
        {...props}
      >
        {/* Header Section - positioned at top-right */}
        <div className="action-card-header flex w-full items-center gap-1">
          <div className="action-card-label flex-1 flex items-center justify-end py-2">
            <span className="action-card-text type-body-2 text-content-secondary group-hover:text-glyph transition-colors">
              {label}
            </span>
          </div>
          <div className="action-card-icon size-5 flex items-center justify-center shrink-0 opacity-0 transition-opacity duration-[var(--motion-duration-fast)]">
            <ArrowRight className="size-4 text-glyph" />
          </div>
        </div>

        {/* Sticker — optional centered image with hover scale+lift */}
        {stickerUrl && (
          <div className="flex-1 min-h-0 w-full flex items-center justify-center pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stickerUrl}
              alt=""
              className="action-card-sticker size-20 object-contain drop-shadow-[0px_4px_4px_rgba(0,0,0,0.25)]"
              draggable="false"
              aria-hidden="true"
            />
          </div>
        )}
      </div>
    );
  }
);

ActionCard.displayName = "ActionCard";

export { ActionCard };
export type { ActionCardProps };
