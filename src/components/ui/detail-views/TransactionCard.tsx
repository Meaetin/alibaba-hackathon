"use client";

import { Dot, FerrisWheel, MoreVertical, Plus, type LucideIcon } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { Button } from "@/components/ui/primitives/Button";
import { cn } from "@/lib/utils";

interface SubTransaction {
  avatar: string;
  description?: string;
  date: string;
  time: string;
  amount: string;
}

interface TransactionCardProps extends ComponentPropsWithoutRef<"button"> {
  name: string;
  date: string;
  amount: string;
  image?: string;
  icon?: LucideIcon;
  expanded?: boolean;
  onToggle?: () => void;
  subTransactions?: SubTransaction[];
  expandsUp?: boolean;
}

const TransactionCard = forwardRef<HTMLButtonElement, TransactionCardProps>(
  (
    {
      className,
      name,
      date,
      amount,
      image,
      icon: Icon = FerrisWheel,
      expanded = false,
      onToggle,
      subTransactions = [],
      expandsUp = false,
      onClick,
      ...props
    },
    ref
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onToggle?.();
      onClick?.(e);
    };

    const expandedContent = expanded ? (
      <div className="overflow-hidden">
        <div className="flex flex-col">
          {/* Separator */}
          {!expandsUp && <div className="px-10"><div className="border-t border-edge" /></div>}

          {/* Subdetails */}
          <div
            className={cn("bg-surface p-2 flex flex-col gap-2 relative", expandsUp ? "rounded-t-[12px]" : "rounded-b-[12px]")}
          >
            <span className="type-secondary font-semibold text-content type-body-2">
              Transactions
            </span>

            {subTransactions.map((sub, i) => (
              <div
                key={i}
                className="flex items-center justify-between w-full"
              >
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-action-secondary border-2 border-surface flex items-center justify-center shrink-0">
                    <span className="type-body-3 font-medium text-glyph">
                      {sub.avatar}
                    </span>
                  </div>
                  <div className="flex items-center type-body-2 font-medium text-content-secondary">
                    {sub.description ? (
                      <span className="truncate">{sub.description}</span>
                    ) : (
                      <>
                        <span>{sub.date}</span>
                        <Dot className="size-5 text-content shrink-0" aria-hidden="true" />
                        <span>{sub.time}</span>
                      </>
                    )}
                  </div>
                </div>

                <span className="type-secondary font-semibold text-content type-body-2">
                  {sub.amount}
                </span>
              </div>
            ))}

            <div>
              <Button
                variant="secondary"
                className="w-full h-9 rounded-lg border border-action-secondary-hover"
                onClick={(e) => e.stopPropagation()}
              >
                <Plus className="size-4" />
                Sub Transaction
              </Button>
            </div>

            <button
              type="button"
              className="absolute top-0 right-0 flex items-center justify-center size-8 transition-opacity duration-[var(--motion-duration-fast)]"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="size-4 text-content" />
            </button>
          </div>

          {/* Separator above main row when expanding upward */}
          {expandsUp && <div className="px-10"><div className="border-t border-edge" /></div>}
        </div>
      </div>
    ) : null;

    return (
      <button
        ref={ref}
        type="button"
        data-slot="transaction-card"
        onClick={handleClick}
        className={cn(
          "w-full text-left rounded-[12px] overflow-clip flex flex-col",
          "transition-[background-color,box-shadow] duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)]",
          expanded
            ? "bg-surface gap-1 border border-edge shadow-default"
            : "bg-surface-alt shadow-none",
          className
        )}
        {...props}
      >
        {expandsUp && expandedContent}

        {/* Main row */}
        <div
          className={cn(
            "flex items-center gap-2 bg-surface rounded-[12px] p-2 pr-3 transition-[border-color] duration-[var(--motion-duration-normal)]",
            !expanded && "border border-edge",
            expanded && "border border-transparent"
          )}
        >
          {image ? (
            <div className="size-10 rounded-lg border border-edge-subtle overflow-hidden shrink-0">
              <img src={image} alt={name} className="size-full object-cover" />
            </div>
          ) : (
            <div className="bg-surface-alt border border-edge-strong rounded-lg p-2 shrink-0 flex flex-col items-center justify-center overflow-clip">
              <div className="flex items-center justify-center size-8 rounded-lg">
                <Icon className="size-4 text-content" aria-hidden="true" />
              </div>
            </div>
          )}

          <div className="flex flex-col flex-1 min-w-0">
            <span className="type-secondary font-semibold text-content type-body-2 truncate">
              {name}
            </span>
            <span className="type-body-2 font-medium text-content-secondary">
              {date}
            </span>
          </div>

          <span className="type-secondary font-bold text-content text-[16px] shrink-0">
            {amount}
          </span>
        </div>

        {!expandsUp && expandedContent}
      </button>
    );
  }
);

TransactionCard.displayName = "TransactionCard";

export { TransactionCard };
export type { TransactionCardProps, SubTransaction };
