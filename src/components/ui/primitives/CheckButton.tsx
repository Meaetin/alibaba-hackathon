"use client";

import { Checkbox } from "@base-ui/react/checkbox";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";

interface CheckButtonProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const CheckButton = forwardRef<HTMLElement, CheckButtonProps>(
  (
    {
      checked,
      defaultChecked,
      onCheckedChange,
      disabled,
      className,
      "aria-label": ariaLabel,
    },
    ref,
  ) => {
    const prefersReducedMotion = useReducedMotion();
    const isControlled = checked !== undefined;
    const [internalChecked, setInternalChecked] = useState(defaultChecked ?? false);
    const resolvedChecked = isControlled ? checked : internalChecked;

    useEffect(() => {
      if (isControlled) setInternalChecked(checked);
    }, [checked, isControlled]);

    const handleCheckedChange = (nextChecked: boolean) => {
      if (!isControlled) setInternalChecked(nextChecked);
      onCheckedChange?.(nextChecked);
    };

    return (
      <Checkbox.Root
        ref={ref}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={handleCheckedChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          // 36px touch target, radius 12, transparent — the layout slot
          "group flex size-9 shrink-0 items-center justify-center rounded-xl bg-transparent",
          "cursor-pointer",
          "data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
          className,
        )}
      >
        {/* Ring — 20px circle, dark outline unchecked / brand outline checked */}
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded-full border-2 transition-colors",
            "border-action-dark-border group-data-[checked]:border-edge-brand",
          )}
        >
          {/* Fill — 12px brand dot, rendered only when checked */}
          <AnimatePresence initial={false}>
            {resolvedChecked && (
              <motion.span
                key="checked"
                className="block size-3 rounded-full bg-action-brand"
                initial={prefersReducedMotion ? false : motionPresets.iconSwap.initial}
                animate={motionPresets.iconSwap.animate}
                exit={prefersReducedMotion ? { opacity: 0 } : motionPresets.iconSwap.exit}
                transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.iconSwap}
              />
            )}
          </AnimatePresence>
        </span>
      </Checkbox.Root>
    );
  },
);

CheckButton.displayName = "CheckButton";

export { CheckButton };
export type { CheckButtonProps };
