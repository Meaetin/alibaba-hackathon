"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl font-medium whitespace-nowrap transition-[opacity,translate] duration-[var(--motion-button-duration)] ease-[var(--motion-ease-standard)] outline-none select-none focus-visible:border-edge-strong focus-visible:ring-3 focus-visible:ring-edge-strong/50 hover:opacity-85 active:opacity-70 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "text-content-on-brand",
        secondary: "text-glyph",
        ghost: "border border-transparent bg-transparent text-glyph",
        outline: "border border-action-secondary-border bg-transparent text-glyph",
        dark: "text-content-on-dark",
      },
      size: {
        xs: "size-6 rounded-lg p-0",
        sm: "h-9 gap-1.5 px-3 type-body-2 font-medium",
        md: "h-10 gap-1.5 px-3 type-body-2 font-medium",
      },
      icon: {
        none: "",
        leading: "pl-2 pr-3",
        trailing: "pl-3 pr-2",
        only: "",
      },
    },
    compoundVariants: [
      { icon: "only", size: "sm", className: "size-9 px-0" },
      { icon: "only", size: "md", className: "size-10 px-0" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      icon: "none",
    },
  },
);

// Each filled variant is drawn as three stacked layers (clipped to the button's
// rounded rect by its overflow-hidden): bg fill → inset bevel → a dedicated 1px
// border ring ON TOP. The ring sits above the bevel so the border stays crisp on
// all sides instead of being covered by the bevel highlight/shadow.
const decorationStyles: Record<string, { bg: string; inset: string; ring: string }> = {
  primary: {
    bg: "bg-action-brand",
    inset:
      "shadow-[inset_0_-2px_0_var(--action-brand-border),inset_0_2px_0_var(--action-brand-highlight)]",
    ring: "border-action-brand-border",
  },
  secondary: {
    bg: "bg-action-secondary",
    inset:
      "shadow-[inset_0_-2px_0_var(--action-secondary-border),inset_0_2px_0_var(--action-secondary-highlight)]",
    ring: "border-action-secondary-border",
  },
  dark: {
    bg: "bg-action-dark",
    inset:
      "shadow-[inset_0_-2px_0_var(--action-dark-border),inset_0_2px_0_var(--action-dark-highlight)]",
    ring: "border-action-dark-border",
  },
};

export interface ButtonProps
  extends VariantProps<typeof buttonVariants>,
    ButtonPrimitive.Props {
  className?: string;
  children?: ReactNode;
}

function Button({
  className,
  variant = "primary",
  size = "md",
  icon = "none",
  children,
  ...props
}: ButtonProps) {
  const decoration = decorationStyles[variant as string];

  return (
    <ButtonPrimitive
      data-slot="button"
      data-name="button"
      className={cn(
        "button",
        buttonVariants({ variant, size, icon, className }),
      )}
      {...props}
    >
      {decoration && (
        <>
          {/* Fill */}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[inherit]",
              decoration.bg,
            )}
          />
          {/* Bevel (inset top highlight + bottom shadow) */}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[inherit]",
              decoration.inset,
            )}
          />
          {/* Border ring — on top so it stays crisp over the bevel */}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[inherit] border",
              decoration.ring,
            )}
          />
        </>
      )}
      <span className="relative inline-flex items-center gap-1.5">
        {children}
      </span>
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
