"use client";

import { Field } from "@base-ui/react/field";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "./Menu";

const inputVariants = cva(
  [
    "input relative flex items-center gap-1.5",
    "transition-[background-color,border-color,box-shadow,color] duration-[var(--motion-control-duration)] ease-[var(--motion-ease-standard)] outline-none cursor-text",
    "disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed",
    "aria-invalid:border-edge-error aria-invalid:hover:border-edge-error aria-invalid:focus-within:border-edge-error",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "rounded-xl border",
          "bg-surface border-edge",
          "hover:bg-surface-alt",
          "focus-within:bg-surface-alt focus-within:border-edge-input-active",
          "focus-within:shadow-[0px_0px_0px_2px_var(--edge-input-focus-ring),inset_0px_1px_4px_0px_var(--input-inner-shadow)]",
        ].join(" "),
        underline: [
          "rounded-none border-b px-0",
          "bg-transparent",
          "border-edge-muted hover:border-edge focus-within:border-edge-strong",
        ].join(" "),
      },
      size: {
        sm: "h-9",
        md: "h-11",
      },
      // Mirrors Figma's `Icon` property — drives asymmetric padding so the
      // right edge tightens when there is no trailing control.
      icon: {
        none: "",
        leading: "",
        trailing: "",
        both: "",
      },
      hasValue: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      // Asymmetric padding (default variant only — underline keeps px-0).
      { variant: "default", icon: "none", className: "pl-3 pr-1" },
      { variant: "default", icon: "leading", className: "pl-2 pr-1" },
      { variant: "default", icon: "trailing", className: "pl-3 pr-2" },
      { variant: "default", icon: "both", className: "pl-2 pr-2" },
      {
        hasValue: true,
        variant: "default",
        className: "bg-surface-alt shadow-[inset_0px_1px_4px_0px_var(--input-inner-shadow)]",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "md",
      icon: "none",
      hasValue: false,
    },
  }
);

const inputControlVariants = cva(
  [
    "input-control w-full bg-transparent outline-none cursor-inherit",
    "text-glyph type-body-2",
    "placeholder:text-content-secondary",
  ].join(" ")
);

/** Resolve Figma's `Icon` property from which slots are populated. */
function resolveIconState(hasLeading: boolean, hasTrailing: boolean) {
  if (hasLeading && hasTrailing) return "both" as const;
  if (hasLeading) return "leading" as const;
  if (hasTrailing) return "trailing" as const;
  return "none" as const;
}

const leadingIconClass =
  "input-icon flex shrink-0 items-center justify-center size-5 text-content-secondary [&_svg]:size-4 [&_svg]:shrink-0";
const trailingIconClass =
  "input-trailing-icon flex shrink-0 items-center justify-center size-5 text-content-secondary [&_svg]:size-4 [&_svg]:shrink-0";

interface InputProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Field.Control>, "size">,
    Omit<VariantProps<typeof inputVariants>, "icon" | "hasValue"> {
  className?: string;
  /** Leading icon (16px recommended) */
  icon?: ReactNode;
  /** Icon wrapper className */
  iconClassName?: string;
  /** Input className */
  inputClassName?: string;
  /** Current value for controlled inputs to determine styling */
  value?: string;
  /** Default value for uncontrolled inputs */
  defaultValue?: string;
  /**
   * Trailing icon (16px recommended). Use for status indicators, etc. When the
   * input is `clearable` and filled, the clear button takes the trailing slot.
   */
  trailingIcon?: ReactNode;
  /** Trailing icon wrapper className */
  trailingIconClassName?: string;
  /**
   * @deprecated Use the `DropdownSelector` component instead. Kept as a
   * back-compat alias that renders a `DropdownSelector`.
   */
  showDropdown?: boolean;
  /** Show a clear button when the input has a value */
  clearable?: boolean;
  /** Called when the clear button is clicked */
  onClear?: () => void;
}

const Input = forwardRef<HTMLInputElement | HTMLButtonElement, InputProps>(
  (
    {
      className,
      icon,
      iconClassName,
      inputClassName,
      variant = "default",
      size = "md",
      value,
      defaultValue,
      showDropdown = false,
      trailingIcon,
      trailingIconClassName,
      placeholder,
      clearable = true,
      onClear,
      "aria-invalid": ariaInvalid,
      onChange,
      ...props
    },
    ref
  ) => {
    const isControlled = value !== undefined;
    const [internalHasValue, setInternalHasValue] = useState(
      Boolean(value ?? defaultValue)
    );
    const internalRef = useRef<HTMLInputElement>(null);

    // Sync controlled value changes
    useEffect(() => {
      if (isControlled) {
        setInternalHasValue(Boolean(value));
      }
    }, [isControlled, value]);

    const hasValue = isControlled ? Boolean(value) : internalHasValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) {
        setInternalHasValue(Boolean(e.target.value));
      }
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

    // Back-compat: delegate the legacy dropdown branch to DropdownSelector.
    if (showDropdown) {
      return (
        <DropdownSelector
          ref={ref as React.Ref<HTMLButtonElement>}
          className={className}
          icon={icon}
          iconClassName={iconClassName}
          inputClassName={inputClassName}
          variant={variant}
          size={size}
          value={value as string | undefined}
          defaultValue={defaultValue as string | undefined}
          trailingIcon={trailingIcon}
          trailingIconClassName={trailingIconClassName}
          placeholder={placeholder}
          aria-invalid={ariaInvalid}
          {...(props as Omit<
            React.ButtonHTMLAttributes<HTMLButtonElement>,
            "value" | "defaultValue"
          >)}
        />
      );
    }

    const clearButton =
      clearable && hasValue ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={handleClear}
          className="flex shrink-0 items-center justify-center size-5 rounded-full bg-surface-muted text-content-secondary hover:bg-surface-muted-active transition-colors cursor-pointer [&_svg]:size-3"
          aria-label="Clear"
        >
          <X />
        </button>
      ) : null;

    const trailingIconNode =
      !clearButton && trailingIcon ? (
        <span
          className={cn(trailingIconClass, trailingIconClassName)}
          aria-hidden="true"
        >
          {trailingIcon}
        </span>
      ) : null;

    const iconState = resolveIconState(
      Boolean(icon),
      Boolean(clearButton) || Boolean(trailingIconNode)
    );

    return (
      <div
        className={cn(
          "input",
          inputVariants({ variant, size, icon: iconState, hasValue, className })
        )}
        data-slot="input-wrapper"
        data-name="input"
        aria-invalid={ariaInvalid}
      >
        {icon && (
          <span className={cn(leadingIconClass, iconClassName)}>{icon}</span>
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
          className={cn(
            "input-control",
            inputControlVariants({ className: inputClassName })
          )}
          onChange={handleChange}
          {...props}
        />
        {clearButton}
        {trailingIconNode}
      </div>
    );
  }
);

Input.displayName = "Input";

/* -------------------------------------------------------------------------- */
/* DropdownSelector — Figma "Dropdown Selector" component set                  */
/* -------------------------------------------------------------------------- */

interface DropdownSelectorProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">,
    Omit<VariantProps<typeof inputVariants>, "icon" | "hasValue"> {
  className?: string;
  /** Leading icon (16px recommended) */
  icon?: ReactNode;
  /** Icon wrapper className */
  iconClassName?: string;
  /** Text/value className */
  inputClassName?: string;
  /** Current selected value (renders as text) */
  value?: string;
  /** Fallback value when no `value` is provided */
  defaultValue?: string;
  /** Placeholder shown when there is no value */
  placeholder?: string;
  /** Trailing icon — defaults to a chevron-down */
  trailingIcon?: ReactNode;
  /** Trailing icon wrapper className */
  trailingIconClassName?: string;
  /**
   * When provided, the selector opens a real Base UI `Menu` listing these
   * options instead of behaving as a bare presentational trigger. The current
   * `value` is marked as `selected`; choosing an option fires `onValueChange`.
   */
  options?: { value: string; label: ReactNode }[];
  /** Called with the chosen option's value when an option is selected. */
  onValueChange?: (value: string) => void;
  /** Classname applied to the Menu surface when `options` are provided. */
  menuClassName?: string;
}

const DropdownSelector = forwardRef<HTMLButtonElement, DropdownSelectorProps>(
  (
    {
      className,
      icon,
      iconClassName,
      inputClassName,
      variant = "default",
      size = "md",
      value,
      defaultValue,
      placeholder,
      trailingIcon,
      trailingIconClassName,
      options,
      onValueChange,
      menuClassName,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref
  ) => {
    const hasValue = Boolean(value ?? defaultValue);
    const displayText = hasValue ? (value ?? defaultValue) : placeholder;
    const resolvedTrailingIcon = trailingIcon ?? <ChevronDown />;
    // The chevron always occupies the trailing slot → padR8 regardless.
    const iconState = resolveIconState(Boolean(icon), true);

    const trigger = (
      <button
        type="button"
        ref={ref}
        className={cn(
          "input",
          inputVariants({ variant, size, icon: iconState, hasValue, className }),
          "cursor-pointer text-left focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        )}
        data-slot="input-wrapper"
        data-name="dropdown-selector"
        aria-invalid={ariaInvalid}
        {...props}
      >
        {icon && (
          <span className={cn(leadingIconClass, iconClassName)}>{icon}</span>
        )}
        <span
          className={cn(
            "input-control flex-1 min-w-0 truncate type-body-2",
            hasValue ? "text-glyph" : "text-content-secondary font-secondary font-medium",
            inputClassName
          )}
        >
          {displayText}
        </span>
        <span
          className={cn(trailingIconClass, trailingIconClassName)}
          aria-hidden="true"
        >
          {resolvedTrailingIcon}
        </span>
      </button>
    );

    // No options → presentational trigger only (back-compat).
    if (!options) {
      return trigger;
    }

    // Options provided → open a real Base UI Menu as the dropdown surface.
    return (
      <Menu>
        <MenuTrigger render={trigger} />
        <MenuContent align="start" side="bottom" sideOffset={4} className={menuClassName}>
          {options.map((o) => (
            <MenuItem
              key={o.value}
              size="sm"
              selected={o.value === (value ?? defaultValue)}
              onClick={() => onValueChange?.(o.value)}
            >
              {o.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    );
  }
);

DropdownSelector.displayName = "DropdownSelector";

/* -------------------------------------------------------------------------- */
/* AddToInput — Figma "Add To Input" component set                             */
/* -------------------------------------------------------------------------- */

interface AddToInputProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Field.Control>, "size">,
    Omit<VariantProps<typeof inputVariants>, "icon" | "variant" | "hasValue"> {
  className?: string;
  /** Leading icon (always rendered) */
  icon?: ReactNode;
  /** Leading icon wrapper className */
  iconClassName?: string;
  /** Trailing icon / action (always rendered) */
  trailingIcon?: ReactNode;
  /** Trailing icon wrapper className */
  trailingIconClassName?: string;
  /** Input className */
  inputClassName?: string;
  /** Current value for controlled inputs to determine styling */
  value?: string;
  /** Default value for uncontrolled inputs */
  defaultValue?: string;
}

const AddToInput = forwardRef<HTMLInputElement, AddToInputProps>(
  (
    {
      className,
      icon,
      iconClassName,
      trailingIcon,
      trailingIconClassName,
      inputClassName,
      size = "md",
      value,
      defaultValue,
      placeholder,
      "aria-invalid": ariaInvalid,
      onChange,
      ...props
    },
    ref
  ) => {
    const isControlled = value !== undefined;
    const [internalHasValue, setInternalHasValue] = useState(
      Boolean(value ?? defaultValue)
    );

    useEffect(() => {
      if (isControlled) setInternalHasValue(Boolean(value));
    }, [isControlled, value]);

    const hasValue = isControlled ? Boolean(value) : internalHasValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) setInternalHasValue(Boolean(e.target.value));
      (onChange as React.ChangeEventHandler<HTMLInputElement>)?.(e);
    };

    return (
      <div
        className={cn(
          "input",
          // Always both icon slots → symmetric pl-2 pr-2 (L8/R8).
          inputVariants({ variant: "default", size, icon: "both", hasValue, className })
        )}
        data-slot="input-wrapper"
        data-name="add-to-input"
        aria-invalid={ariaInvalid}
      >
        <span className={cn(leadingIconClass, iconClassName)} aria-hidden="true">
          {icon}
        </span>
        <Field.Control
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={cn(
            "input-control",
            inputControlVariants({ className: inputClassName })
          )}
          onChange={handleChange}
          {...props}
        />
        <span
          className={cn(trailingIconClass, trailingIconClassName)}
          aria-hidden="true"
        >
          {trailingIcon}
        </span>
      </div>
    );
  }
);

AddToInput.displayName = "AddToInput";

export {
  Input,
  DropdownSelector,
  AddToInput,
  inputVariants,
  inputControlVariants,
};
export type { InputProps, DropdownSelectorProps, AddToInputProps };
