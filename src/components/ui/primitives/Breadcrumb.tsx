"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronRight } from "lucide-react";
import { Children, Fragment, isValidElement, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/* ───────────── BreadcrumbItem ───────────── */
// Figma node 363:2 — Step (Previous | Current) is the only structural axis.
// The Figma "State" axis (Default/Hover/Active/Disabled) maps to CSS
// pseudo-classes, not CVA variants (FE-077), mirroring Button.tsx's
// hover:opacity-85 / active:opacity-70 / disabled:opacity-50.
const breadcrumbItemVariants = cva(
  "inline-flex h-8 items-center overflow-hidden rounded-xl outline-none transition-[background-color,border-color,color,opacity]",
  {
    variants: {
      step: {
        // Icon-only crumb for previous steps. Interactive (Base UI Button).
        previous:
          "cursor-pointer gap-1.5 px-1.5 text-glyph-secondary hover:bg-surface-muted hover:opacity-85 active:bg-action-brand active:text-glyph-on-brand active:opacity-70 focus-visible:ring-2 focus-visible:ring-edge-strong/50 disabled:pointer-events-none disabled:opacity-50",
        // Terminal crumb with icon + label. Non-interactive.
        current:
          "gap-1.5 pl-2 pr-3 text-content-secondary type-body-2 font-medium select-none",
      },
    },
    defaultVariants: { step: "previous" },
  },
);

export interface BreadcrumbItemProps
  extends VariantProps<typeof breadcrumbItemVariants>,
    ButtonPrimitive.Props {
  /** Leading icon — rendered in a 20px slot. Pass a `size-4` Lucide icon. */
  icon?: ReactNode;
}

function BreadcrumbItem({
  className,
  step = "previous",
  icon,
  children,
  ...props
}: BreadcrumbItemProps) {
  const content = (
    <>
      {icon && (
        <span className="inline-flex size-5 shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      {children != null && children !== "" && (
        <span className="truncate">{children}</span>
      )}
    </>
  );

  if (step === "current") {
    return (
      <span
        aria-current="page"
        className={cn(breadcrumbItemVariants({ step, className }))}
      >
        {content}
      </span>
    );
  }

  return (
    <ButtonPrimitive
      type="button"
      className={cn(breadcrumbItemVariants({ step, className }))}
      {...props}
    >
      {content}
    </ButtonPrimitive>
  );
}

/* ───────────── BreadcrumbSeparator ───────────── */
// Figma node 373:19 — 20px container, ChevronRight (16px) in mist/400.
function BreadcrumbSeparator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center text-glyph-disabled",
        className,
      )}
    >
      <ChevronRight className="size-4" />
    </span>
  );
}

/* ───────────── Breadcrumb ───────────── */
// Figma node 405:37 — items + separators sit flush (gap-0); the separator's
// 20px width provides the spacing. A separator is auto-inserted between crumbs.
interface BreadcrumbProps {
  className?: string;
  children: ReactNode;
}

function Breadcrumb({ className, children }: BreadcrumbProps) {
  const items = Children.toArray(children).filter(isValidElement);

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center">
        {items.map((item, index) => (
          <Fragment key={index}>
            <li className="flex items-center">{item}</li>
            {index < items.length - 1 && (
              <li aria-hidden="true" className="flex items-center">
                <BreadcrumbSeparator />
              </li>
            )}
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

export { Breadcrumb, BreadcrumbItem, BreadcrumbSeparator, breadcrumbItemVariants };
