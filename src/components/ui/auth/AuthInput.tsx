"use client";

import { Field } from "@base-ui/react/field";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";

interface AuthInputProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Field.Control>, "size"> {
  className?: string;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Stable identity for contextual trailing-icon swaps. */
  trailingIconKey?: string;
  onTrailingClick?: () => void;
  value?: string;
  defaultValue?: string;
  /** Show a clear button when the input has a value */
  clearable?: boolean;
  /** Called when the clear button is clicked */
  onClear?: () => void;
  /** Error state — red border (State=Error in Figma 977:46) */
  error?: boolean;
}

// Two-edge inset bevel for filled/focused inputs (Figma: inset 0 -2px mist-200, inset 0 2px mist-50)
const INPUT_BEVEL =
  "shadow-[inset_0_-2px_0_0_var(--action-secondary-border),inset_0_2px_0_0_var(--action-secondary-highlight)]";
// Focused: bevel + 2px focus ring (Figma: + 0 0 0 2px brand-300)
const INPUT_FOCUS_SHADOW =
  "focus-within:shadow-[inset_0_-2px_0_0_var(--action-secondary-border),inset_0_2px_0_0_var(--action-secondary-highlight),0_0_0_2px_var(--edge-input-focus-ring)]";

const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(
  (
    {
      className,
      icon,
      trailingIcon,
      trailingIconKey,
      onTrailingClick,
      value,
      defaultValue,
      clearable = true,
      onClear,
      error = false,
      disabled,
      placeholder,
      onChange,
      ...props
    },
    ref
  ) => {
    const isControlled = value !== undefined;
    const prefersReducedMotion = useReducedMotion();
    const [internalHasValue, setInternalHasValue] = useState(
      Boolean(value ?? defaultValue)
    );
    const internalRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (isControlled) setInternalHasValue(Boolean(value));
    }, [isControlled, value]);

    const hasValue = isControlled ? Boolean(value) : internalHasValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) setInternalHasValue(Boolean(e.target.value));
      (onChange as React.ChangeEventHandler<HTMLInputElement>)?.(e);
    };

    const handleClear = () => {
      if (onClear) {
        onClear();
        return;
      }
      const el = internalRef.current;
      if (el) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        setter?.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      setInternalHasValue(false);
    };

    const showClear = clearable && hasValue;
    const hasLeading = Boolean(icon);
    const hasTrailing = showClear || Boolean(trailingIcon);

    return (
      <div
        className={cn(
          "relative flex h-[44px] w-full items-center gap-1.5 rounded-full border",
          "transition-[background-color,border-color,box-shadow,color] duration-[var(--motion-control-duration)] ease-[var(--motion-ease-standard)] outline-none",
          // Icon-axis asymmetric padding (Figma: None px-16, Leading pl-12, Trailing pr-12)
          hasLeading ? "pl-3" : "pl-4",
          hasTrailing ? "pr-3" : "pr-4",
          // State chrome
          error
            ? cn(
                "border-edge-error",
                hasValue ? cn("bg-surface-alt", INPUT_BEVEL) : "bg-surface"
              )
            : cn(
                hasValue
                  ? cn("border-edge bg-surface-alt", INPUT_BEVEL)
                  : "border-edge bg-surface",
                "focus-within:border-edge-input-active focus-within:bg-surface-alt",
                INPUT_FOCUS_SHADOW
              ),
          disabled && "pointer-events-none opacity-50",
          className
        )}
      >
        {icon && (
          <span
            className={cn(
              "flex shrink-0 items-center justify-center size-4 text-content-secondary",
              "[&_svg]:size-4 [&_svg]:shrink-0"
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}

        <Field.Control
          ref={(node) => {
            const el = node as HTMLInputElement | null;
            (internalRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
            if (typeof ref === "function") (ref as (n: HTMLInputElement | null) => void)(el);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
          }}
          value={value}
          defaultValue={defaultValue}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full bg-transparent outline-none",
            // Body 2 (14px); filled value is Medium, placeholder Regular (Figma 977:46)
            "type-body-2 text-content",
            hasValue ? "font-medium" : "font-normal",
            "placeholder:font-normal placeholder:text-content-placeholder"
          )}
          onChange={handleChange}
          {...props}
        />

        {showClear && (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleClear}
            className="flex shrink-0 items-center justify-center size-5 rounded-full bg-surface-muted text-content-secondary hover:bg-surface-muted-active transition-colors cursor-pointer [&_svg]:size-3"
            aria-label="Clear"
          >
            <X />
          </button>
        )}

        {!showClear && trailingIcon && (
          <button
            type="button"
            tabIndex={-1}
            onClick={onTrailingClick}
            className={cn(
              "flex shrink-0 items-center justify-center size-5 text-content-secondary",
              "[&_svg]:size-4 [&_svg]:shrink-0",
              "cursor-pointer transition-colors hover:text-content"
            )}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={trailingIconKey ?? "trailing-icon"}
                className="flex items-center justify-center"
                initial={prefersReducedMotion ? false : motionPresets.iconSwap.initial}
                animate={motionPresets.iconSwap.animate}
                exit={prefersReducedMotion ? { opacity: 0 } : motionPresets.iconSwap.exit}
                transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.iconSwap}
              >
                {trailingIcon}
              </motion.span>
            </AnimatePresence>
          </button>
        )}
      </div>
    );
  }
);

AuthInput.displayName = "AuthInput";

export { AuthInput };
export type { AuthInputProps };
