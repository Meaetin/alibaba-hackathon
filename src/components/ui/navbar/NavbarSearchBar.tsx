"use client";

import { forwardRef, useRef, useState, useCallback, type KeyboardEvent, type ReactNode } from "react";
import { ScanText, Search, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { motionTransitions } from "@/lib/motion/presets";
import { Button } from "@/components/ui/primitives/Button";

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface NavbarSearchBarProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "size"> {
  className?: string;
  inputClassName?: string;
  onSearch?: (value: string) => void;
  onScanClick?: () => void;
  filterPill?: ReactNode;
  isActive?: boolean;
  onActiveChange?: (active: boolean) => void;
}

const NavbarSearchBar = forwardRef<HTMLInputElement, NavbarSearchBarProps>(
  (
    {
      className,
      inputClassName,
      placeholder = "Search",
      onSearch,
      onScanClick,
      filterPill,
      isActive: controlledActive,
      onActiveChange,
      onKeyDown,
      onChange,
      value,
      defaultValue,
      disabled,
      ...props
    },
    ref,
  ) => {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [internalActive, setInternalActive] = useState(false);
    const isActive = controlledActive ?? internalActive;
    const prefersReducedMotion = useReducedMotion();
    const feedbackTransition = motionTransitions.fast;

    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(
      (defaultValue as string) ?? ""
    );
    const currentValue = isControlled ? (value as string) : internalValue;
    const hasValue = Boolean(currentValue);

    const setActive = useCallback(
      (active: boolean) => {
        setInternalActive(active);
        onActiveChange?.(active);
      },
      [onActiveChange],
    );

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (!isControlled) setInternalValue(val);
      if (onSearch) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onSearch(val), 300);
      }
      onChange?.(e);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && onSearch) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        onSearch(e.currentTarget.value);
      }
      if (e.key === "Escape") {
        setActive(false);
        e.currentTarget.blur();
      }
      onKeyDown?.(e);
    };

    const handleClear = () => {
      if (!isControlled) setInternalValue("");
      if (onSearch) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        onSearch("");
      }
      const el = inputRef.current;
      if (el) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        setter?.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.focus();
      }
    };

    return (
      <div
        data-slot="navbar-searchbar"
        className={cn(
          "navbar-searchbar group/search flex h-12 w-full min-w-0 max-w-[520px] items-center gap-1.5 rounded-full border border-edge bg-surface pr-2 lg:w-[520px]",
          "transition-[background-color,border-color,box-shadow]",
          // Tighter left padding when a leading filter pill is active (8px vs 16px).
          filterPill ? "pl-2" : "pl-4",
          "hover:border-edge-strong hover:bg-action-secondary focus-within:border-edge-strong focus-within:bg-action-secondary",
          "has-[input:disabled]:opacity-50 has-[input:disabled]:pointer-events-none",
          className,
        )}
      >
        {/* Leading Search Icon — hidden when a filter pill is active */}
        {!filterPill && (
          <div className="navbar-searchbar-icon flex size-5 shrink-0 items-center justify-center">
            <Search className="size-4 text-content-secondary" />
          </div>
        )}
        <AnimatePresence>
          {filterPill && (
            <motion.div
              key="filter-pill"
              className="shrink-0"
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, transform: "translateX(-8px) scale(0.95)" }
              }
              animate={{ opacity: 1, transform: "translateX(0) scale(1)" }}
              exit={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, transform: "translateX(-8px) scale(0.95)" }
              }
              transition={feedbackTransition}
            >
              {filterPill}
            </motion.div>
          )}
        </AnimatePresence>
        <input
          ref={(node) => {
            (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
          }}
          type="text"
          placeholder={isActive ? placeholder : truncate(placeholder, 30)}
          disabled={disabled}
          value={isControlled ? value : internalValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setActive(true)}
          className={cn(
            "type-body-2 h-9 min-w-0 flex-1 bg-transparent text-glyph outline-none",
            "placeholder:text-content-secondary placeholder:transition-colors",
            "group-focus-within/search:placeholder:text-glyph",
            inputClassName,
          )}
          {...props}
        />
        {hasValue && (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleClear}
            className="mr-1 flex shrink-0 items-center justify-center size-5 rounded-full bg-surface-muted text-content-secondary hover:bg-surface-muted-active transition-colors cursor-pointer [&_svg]:size-3"
            aria-label="Clear"
          >
            <X />
          </button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon="only"
          aria-label="Scan"
          disabled={disabled}
          onClick={() => onScanClick?.()}
          className="shrink-0 rounded-xl"
        >
          <ScanText className="size-4" />
        </Button>
      </div>
    );
  },
);

NavbarSearchBar.displayName = "NavbarSearchBar";

export { NavbarSearchBar };
export type { NavbarSearchBarProps };
