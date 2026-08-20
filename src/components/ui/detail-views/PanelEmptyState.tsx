"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface PanelEmptyStateProps extends ComponentPropsWithoutRef<"div"> {
  /** Lucide icon — rendered in a rounded box (legacy style). Ignored when `imageSrc` is set. */
  icon?: LucideIcon;
  /** Sticker/illustration src — renders the generic centered empty state (Figma). */
  imageSrc?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}

const PanelEmptyState = forwardRef<HTMLDivElement, PanelEmptyStateProps>(
  ({ className, icon: Icon, imageSrc, title, description, children, ...props }, ref) => {
    // Generic centered empty state (sticker + Body 1 title + Body 2 description),
    // shared by the Collection / Flight / Lodging panels.
    if (imageSrc) {
      return (
        <div
          ref={ref}
          data-slot="panel-empty-state"
          className={cn(
            "panel-empty-state flex flex-1 flex-col items-center justify-center gap-3 pb-6 text-center",
            className
          )}
          {...props}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageSrc} alt="" className="panel-empty-state-sticker h-16 w-auto" />
          <div className="panel-empty-state-text flex flex-col items-center gap-1">
            <p className="panel-empty-state-title type-body-1 font-medium text-content">{title}</p>
            {description && (
              <p className="panel-empty-state-description type-body-2 text-content-secondary">{description}</p>
            )}
          </div>
          {children}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        data-slot="panel-empty-state"
        className={cn(
          "panel-empty-state flex flex-col items-center text-center",
          className
        )}
        {...props}
      >
        <div className="panel-empty-state-content w-full max-w-[440px]">
          {/* Hero */}
          <div className="panel-empty-state-hero flex flex-col items-center pb-8 text-center">
            {Icon && (
              <div className="panel-empty-state-icon flex items-center justify-center size-14 rounded-2xl bg-surface-muted mb-4">
                <Icon className="size-7 text-content-secondary" />
              </div>
            )}
            <p className="panel-empty-state-title type-body-3 uppercase tracking-widest text-content-secondary mb-1">{title}</p>
            {description && (
              <p className="panel-empty-state-description type-body-2 text-content-tertiary">{description}</p>
            )}
          </div>

          {/* Actions */}
          {children && (
            <div className="panel-empty-state-actions flex flex-col border-t border-edge">
              {children}
            </div>
          )}
        </div>
      </div>
    );
  }
);

PanelEmptyState.displayName = "PanelEmptyState";

export { PanelEmptyState };
export type { PanelEmptyStateProps };
