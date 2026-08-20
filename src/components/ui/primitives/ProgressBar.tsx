"use client";

import { forwardRef, type ReactNode } from "react";
import { Progress } from "@base-ui/react/progress";
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  className?: string;
  /** Overrides for the label row, e.g. a smaller type class */
  labelClassName?: string;
  value: number;
  max?: number;
  label?: string;
  /** Renders the right-hand slot. Returns a node so callers can pass a link. */
  formatLabel?: (value: number) => ReactNode;
  showLabel?: boolean;
  autoFill?: boolean;
}

const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ className, labelClassName, value, max = 100, label, formatLabel, showLabel = true, autoFill = false, ...props }, ref) => {
    const clampedValue = Math.min(Math.max(0, value), max);
    const percentage = Math.round((clampedValue / max) * 100);
    const displayValue = formatLabel ? formatLabel(clampedValue) : `${percentage}%`;

    return (
      <Progress.Root
        ref={ref}
        value={clampedValue}
        max={max}
        className={cn("flex flex-col gap-1", className)}
        {...props}
      >
        {showLabel && (
          <div className={cn("progress-bar-label-row flex items-center justify-between type-body-3 text-content-secondary whitespace-nowrap", labelClassName)}>
            {label ? <span>{label}</span> : <span />}
            <span className="tabular-nums">{displayValue}</span>
          </div>
        )}
        {/* Track: rounded pill with 4px inset (px-1) framing the fill */}
        <Progress.Track className="relative h-[22px] w-full overflow-hidden rounded-full border border-edge-subtle bg-surface px-1 shadow-[inset_0px_1px_4px_0px_var(--color-input-inner-shadow)]">
          <Progress.Indicator
            className={cn(
              "flex h-full items-center motion-reduce:transition-none",
              !autoFill &&
                "transition-[width] duration-[var(--motion-duration-progress)]",
              autoFill &&
                "origin-left animate-[progress-fill_var(--motion-duration-progress-auto)_var(--motion-ease-standard)_forwards] motion-reduce:animate-none",
            )}
          >
            {/* Fill: 14px pill, vertically centered for the 4px top/bottom inset */}
            {clampedValue > 0 && (
              <div className="h-3.5 w-full min-w-3.5 rounded-full border border-action-info-border bg-action-info shadow-[inset_1px_-2px_0px_0px_var(--color-action-info-border),inset_-1px_-2px_0px_0px_var(--color-action-info-border),inset_1px_2px_0px_0px_var(--color-action-info-highlight),inset_-1px_2px_0px_0px_var(--color-action-info-highlight)]" />
            )}
          </Progress.Indicator>
        </Progress.Track>
      </Progress.Root>
    );
  }
);

ProgressBar.displayName = "ProgressBar";

export { ProgressBar };
export type { ProgressBarProps };
