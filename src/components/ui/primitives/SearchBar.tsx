"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

const searchBarVariants = cva(
  [
    // Base styles — matches Figma SearchBar (node 480:103)
    "search-bar relative flex items-center rounded-full border outline-none transition-colors",
    // Default (empty): white surface, edge border
    "bg-surface border-edge",
    // Hover: surface-alt fill (Figma Expanded/Hover)
    "hover:bg-surface-alt",
    // Focus: surface-alt fill, edge-input border (Figma Expanded/Focus = edge/input #9ca8ab)
    "focus-within:bg-surface-alt focus-within:border-edge-input",
    // Cursor
    "cursor-text",
    // Disabled state
    "disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed",
  ].join(" "),
  {
    variants: {
      size: {
        sm: "h-9",
        md: "h-10",
      },
      icon: {
        leading: "px-2 gap-1.5 w-60",
        only: "justify-center",
      },
    },
    compoundVariants: [
      // Icon-only sizes
      { icon: "only", size: "sm", className: "size-9" },
      { icon: "only", size: "md", className: "size-10" },
    ],
    defaultVariants: {
      size: "md",
      icon: "leading",
    },
  }
);

const searchBarIconVariants = cva(
  [
    "search-bar-icon flex shrink-0 items-center justify-center size-5",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    // Icon color: glyph in all states (Figma icon/primary)
    "text-glyph",
  ].join(" ")
);

const searchBarInputVariants = cva(
  [
    "search-bar-input w-full bg-transparent outline-none cursor-inherit",
    // Filled value: Switzer Medium, content (Figma Expanded/Filled)
    "text-content font-medium type-body-2",
    // Placeholder: Switzer Regular, placeholder color (Figma Expanded/Default)
    "placeholder:text-content-placeholder placeholder:font-normal",
  ].join(" ")
);

interface SearchBarProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "size">,
    VariantProps<typeof searchBarVariants> {
  className?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Icon className */
  iconClassName?: string;
  /** Input className */
  inputClassName?: string;
  /** Callback when search is submitted (Enter key) */
  onSearch?: (value: string) => void;
  /** Whether to auto-focus the input on mount */
  autoFocus?: boolean;
  /** Swap the leading search glyph for a spinner while a search is in flight */
  loading?: boolean;
  /** Called when the built-in clear button is pressed, after the value is cleared */
  onClear?: () => void;
  /** Extra content rendered inside the rounded container, after the clear button */
  endSlot?: React.ReactNode;
}

const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  (
    {
      className,
      iconClassName,
      inputClassName,
      size = "md",
      icon = "leading",
      placeholder = "Search",
      onSearch,
      onKeyDown,
      autoFocus,
      value,
      defaultValue,
      onChange,
      loading = false,
      onClear,
      endSlot,
      ...props
    },
    ref
  ) => {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = useState(
      (defaultValue as string) ?? ""
    );

    const currentValue = isControlled ? (value as string) : internalValue;
    const hasValue = Boolean(currentValue);

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
      onKeyDown?.(e);
    };

    const handleClear = () => {
      if (!isControlled) setInternalValue("");
      if (onSearch) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        onSearch("");
      }
      // For controlled inputs, fire a synthetic onChange so parent can clear
      if (isControlled && onChange) {
        const nativeInput = typeof ref === "object" && ref?.current;
        if (nativeInput) {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value"
          )?.set;
          setter?.call(nativeInput, "");
          nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      onClear?.();
    };

    return (
      <div
        className={cn(
          "search-bar",
          searchBarVariants({ size, icon, className }),
          "group/search",
          // Filled (has value): surface-alt fill + edge-muted border (Figma Expanded/Filled)
          hasValue && "bg-surface-alt border-edge-muted"
        )}
        data-slot="search-bar"
        data-name="search-bar"
      >
        <span
          className={cn(
            "search-bar-icon",
            searchBarIconVariants({ className: iconClassName })
          )}
        >
          {loading ? <Loader2 className="animate-spin" /> : <Search />}
        </span>
        {icon === "leading" && (
          <input
            ref={ref}
            type="text"
            placeholder={placeholder}
            className={cn(
              "search-bar-input",
              searchBarInputVariants({ className: inputClassName })
            )}
            value={isControlled ? value : internalValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            autoFocus={autoFocus}
            {...props}
          />
        )}
        {hasValue && (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleClear}
            className="flex shrink-0 items-center justify-center size-6 rounded-xl text-glyph hover:bg-surface-muted transition-colors cursor-pointer [&_svg]:size-4"
            aria-label="Clear"
          >
            <X />
          </button>
        )}
        {endSlot}
      </div>
    );
  }
);

SearchBar.displayName = "SearchBar";

export { SearchBar };
export type { SearchBarProps };
