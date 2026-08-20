"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/primitives/ProgressBar";

export interface UsageData {
  used: number;
  max: number;
  planName: string;
  resetDate?: string;
}

type UsageCardType = "link" | "itinerary";

const USAGE_CARD_LABELS: Record<UsageCardType, string> = {
  link: "Links Analysed",
  itinerary: "Itineraries Created",
};

const usageCardVariants = cva(
  "flex w-full flex-col rounded-2xl border border-edge bg-surface p-1 shadow-default",
  {
    variants: {
      variant: {
        compact: "",
        detailed: "",
      },
    },
    defaultVariants: {
      variant: "compact",
    },
  }
);

interface UsageCardProps extends VariantProps<typeof usageCardVariants> {
  className?: string;
  /** Which quota this card reports — drives the "X/X …" label */
  type: UsageCardType;
  usage: UsageData | null | undefined;
  /**
   * When set, the right-hand slot renders an "Upgrade" link to this href
   * instead of the plan name. Passed in rather than hardcoded so this stays a
   * presentational primitive with no routing knowledge of its own.
   */
  upgradeHref?: string;
}

const UsageCard = forwardRef<HTMLDivElement, UsageCardProps>(
  ({ className, type, usage, variant, upgradeHref, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(usageCardVariants({ variant, className }))}
        {...props}
      >
        <div className="rounded-xl border border-edge-subtle bg-surface-alt p-2 w-full">
          <ProgressBar
            label={usage ? `${usage.used}/${usage.max} ${USAGE_CARD_LABELS[type]}` : "—"}
            labelClassName="type-body-4 tabular-nums"
            // ProgressBar clamps value into [0, max] itself, so a user sitting
            // over their cap after a downgrade (e.g. 40 itineraries on a plan
            // allowing 5) renders a full bar rather than overflowing. The
            // "40/5" label above stays unclamped — that number is honest.
            value={usage?.used ?? 0}
            max={usage?.max ?? 1}
            formatLabel={() =>
              upgradeHref ? (
                <Link
                  href={upgradeHref}
                  className="type-body-4 font-medium text-content-brand hover:underline"
                >
                  Upgrade
                </Link>
              ) : (
                (usage?.planName ?? "Free plan")
              )
            }
          />
        </div>
        {variant === "detailed" && usage?.resetDate && (
          <div className="flex items-center justify-end p-1 w-full">
            <span className="type-body-4 text-content-secondary whitespace-nowrap">
              {`resets on ${usage.resetDate}`}
            </span>
          </div>
        )}
      </div>
    );
  }
);

UsageCard.displayName = "UsageCard";

export { UsageCard };
export type { UsageCardProps, UsageCardType };
