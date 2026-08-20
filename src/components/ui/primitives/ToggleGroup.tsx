"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";

export interface ToggleGroupOption<T extends string = string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface ToggleGroupProps<T extends string = string> {
  options: ToggleGroupOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function ToggleGroup<T extends string = string>({
  options,
  value,
  onChange,
  className,
}: ToggleGroupProps<T>) {
  return (
    <div
      role="group"
      data-slot="toggle-group"
      className={cn(
        "flex h-11 items-center gap-1 shrink-0 rounded-2xl border border-edge bg-surface-alt p-1",
        className
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            variant={isActive ? "primary" : "ghost"}
            size="sm"
            onClick={() => onChange(option.value)}
          >
            {option.icon ?? option.label}
          </Button>
        );
      })}
    </div>
  );
}
