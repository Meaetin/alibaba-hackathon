"use client";

import { useState } from "react";
import { ArrowUpDown, MoreVertical } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { Button } from "@/components/ui/primitives/Button";
import { cn } from "@/lib/utils";

interface CurrencyOption {
  code: string;
  amount: string;
}

interface ExpenseSummaryCardProps extends ComponentPropsWithoutRef<"div"> {
  amount?: string;
  label?: string;
  currency?: string;
  currencies?: CurrencyOption[];
  onMenuClick?: () => void;
}

const ExpenseSummaryCard = forwardRef<HTMLDivElement, ExpenseSummaryCardProps>(
  ({ className, amount, label = "Total Spent", currency = "SGD", currencies, onMenuClick, ...props }, ref) => {
    const [activeCurrencyIndex, setActiveCurrencyIndex] = useState(0);

    const activeCurrency = currencies?.[activeCurrencyIndex];
    const displayAmount = activeCurrency?.amount ?? amount ?? "$0.00";
    const displayCode = activeCurrency?.code ?? currency;

    const handleToggle = () => {
      if (currencies && currencies.length > 1) {
        setActiveCurrencyIndex((prev) => (prev + 1) % currencies.length);
      }
    };

    return (
      <div
        ref={ref}
        data-slot="expense-summary-card"
        className={cn("bg-surface border border-edge rounded-[12px] p-1", className)}
        {...props}
      >
        <div className="group relative bg-surface-alt rounded-lg py-2 flex flex-col gap-2 items-center justify-center">
          <span className="type-body-2 font-medium text-content">{label}</span>

          <span className="type-secondary type-h4 font-medium text-content">{displayAmount}</span>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleToggle}
            className="h-8 pl-2 pr-3 gap-1 rounded-lg border border-action-secondary-hover"
            aria-label="Toggle currency"
          >
            <ArrowUpDown className="size-4" aria-hidden="true" />
            <span className="type-body-2 font-medium text-glyph">{displayCode}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm" icon="only"
            onClick={onMenuClick}
            className="absolute top-0 right-0 opacity-0 transition-opacity duration-[var(--motion-duration-fast)] group-hover:opacity-100"
            aria-label="More options"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }
);

ExpenseSummaryCard.displayName = "ExpenseSummaryCard";

export { ExpenseSummaryCard };
export type { ExpenseSummaryCardProps, CurrencyOption };
