"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

interface PanelFooterCTAProps extends ComponentPropsWithoutRef<"div"> {
  children: React.ReactNode;
}

const PanelFooterCTA = forwardRef<HTMLDivElement, PanelFooterCTAProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="panel-footer-cta"
        className={cn(
          "panel-footer-cta flex gap-2 p-3 border-t border-edge shrink-0",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

PanelFooterCTA.displayName = "PanelFooterCTA";

export { PanelFooterCTA };
export type { PanelFooterCTAProps };
