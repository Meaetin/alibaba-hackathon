"use client";

import { Accordion } from "@base-ui/react/accordion";
import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

// Fixed item value used for the single-section accordion pattern.
const ITEM_VALUE = "section";

interface CollapsibleSectionProps {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** Applied to the Accordion.Root wrapper. */
  className?: string;
  /** Applied to the inner content wrapper inside Accordion.Panel. */
  contentClassName?: string;
}

const CollapsibleSection = forwardRef<HTMLDivElement, CollapsibleSectionProps>(
  (
    {
      label,
      children,
      defaultOpen,
      open,
      onOpenChange,
      disabled,
      className,
      contentClassName,
    },
    ref,
  ) => {
    // Translate boolean open/defaultOpen to Base UI Accordion's value-array API.
    const controlledValue =
      open !== undefined ? (open ? [ITEM_VALUE] : []) : undefined;

    const defaultValue =
      defaultOpen !== undefined
        ? defaultOpen
          ? [ITEM_VALUE]
          : []
        : undefined;

    return (
      <Accordion.Root
        ref={ref}
        value={controlledValue}
        defaultValue={defaultValue}
        onValueChange={(v) => onOpenChange?.(v.includes(ITEM_VALUE))}
        className={cn("w-full", className)}
      >
        {/* Card — single rounded border wraps both header and content */}
        <Accordion.Item
          value={ITEM_VALUE}
          disabled={disabled}
          className={cn(
            "overflow-hidden rounded-xl border border-edge-subtle bg-surface",
            "data-[disabled]:opacity-50",
          )}
        >
          {/* Header */}
          <Accordion.Header>
            <Accordion.Trigger
              className={cn(
                "group flex h-11 w-full items-center justify-between px-4",
                "type-body-1 font-medium text-content",
                "transition-colors duration-[var(--motion-duration-normal)]",
                "hover:bg-surface-muted active:bg-surface-muted-active",
                "data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed",
                "outline-none focus-visible:ring-2 focus-visible:ring-edge-strong/50 focus-visible:ring-inset",
              )}
            >
              <span className="truncate">{label}</span>

              {/* Chevron — rotates 180° when expanded */}
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-glyph-secondary",
                  "transition-transform duration-[var(--motion-duration-normal)]",
                  "group-data-[panel-open]:rotate-180",
                )}
              />
            </Accordion.Trigger>
          </Accordion.Header>

          {/* Panel — height animates open/closed */}
          <Accordion.Panel
            className={cn(
              "h-[var(--accordion-panel-height)] overflow-hidden",
              "transition-[height] duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)]",
              "data-[starting-style]:h-0 data-[ending-style]:h-0",
            )}
          >
            <div
              className={cn(
                "px-4 pt-2 pb-4 type-body-2 text-content-secondary",
                contentClassName,
              )}
            >
              {children}
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>
    );
  },
);

CollapsibleSection.displayName = "CollapsibleSection";

export { CollapsibleSection };
export type { CollapsibleSectionProps };
