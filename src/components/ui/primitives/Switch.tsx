"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

const switchVariants = cva("", {
  variants: {
    size: {
      // Figma Size=sm → track 44×24, 4px thumb inset
      sm: "h-6 w-11 px-1",
      // Figma Size=md → track 48×28, 4px thumb inset
      md: "h-7 w-12 px-1",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const thumbVariants = cva("", {
  variants: {
    size: {
      // Figma Size=sm → 16px thumb, travel = 44−4−4−16 = 20px
      sm: "size-4 data-[checked]:translate-x-[20px]",
      // Figma Size=md → 20px thumb, travel = 48−4−4−20 = 20px
      md: "size-5 data-[checked]:translate-x-[20px]",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

interface SwitchProps extends VariantProps<typeof switchVariants> {
  className?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  label?: string;
}

const Switch = forwardRef<HTMLSpanElement, SwitchProps>(
  (
    {
      className,
      size = "md",
      checked,
      defaultChecked,
      onCheckedChange,
      disabled,
      name,
      label,
    },
    ref,
  ) => {
    return (
      <BaseSwitch.Root
        ref={ref}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        name={name}
        className={cn(
          "group relative inline-flex shrink-0 items-center rounded-full border border-edge bg-surface-alt",
          // Track inset bevel (secondary) — constant across checked/unchecked, matches Figma
          "shadow-[inset_0_-2px_0_0_var(--action-secondary-border),inset_0_2px_0_0_var(--action-secondary-highlight)]",
          "transition-colors duration-[var(--motion-control-duration)] ease-[var(--motion-ease-standard)]",
          "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong/50",
          switchVariants({ size }),
          className,
        )}
        aria-label={label}
        data-slot="switch"
      >
        <BaseSwitch.Thumb
          className={cn(
            "relative block rounded-full border transition-[background-color,border-color,box-shadow,translate] duration-[var(--motion-control-duration)] ease-[var(--motion-ease-standard)]",
            "data-[unchecked]:translate-x-0",
            // Unchecked thumb: light circle, muted border, secondary bevel
            "data-[unchecked]:bg-surface-alt data-[unchecked]:border-edge-muted",
            "data-[unchecked]:shadow-[inset_0_-2px_0_0_var(--action-secondary-border),inset_0_2px_0_0_var(--action-secondary-highlight)]",
            // Checked thumb: brand fill, brand border, brand bevel
            "data-[checked]:bg-action-brand data-[checked]:border-action-brand-border",
            "data-[checked]:shadow-[inset_0_-2px_0_0_var(--action-brand-border),inset_0_2px_0_0_var(--action-brand-highlight)]",
            thumbVariants({ size }),
          )}
        />
      </BaseSwitch.Root>
    );
  },
);

Switch.displayName = "Switch";

export { Switch };
export type { SwitchProps };
