"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  type ReactNode,
  type ComponentProps,
} from "react";
import { cn } from "@/lib/utils";

// ============================================================================
// MenuItem Variants
// ============================================================================

const menuItemVariants = cva(
  [
    // Base styles
    "relative flex items-center min-w-[160px] rounded-xl outline-none select-none",
    "transition-[background-color,border-color,color,opacity] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-standard)]",
    // Transparent border by default to prevent layout shift on hover/active
    "border border-transparent",
    // Typography (weight only — size sets the type ramp)
    "font-medium text-glyph",
    // Disabled state
    "disabled:pointer-events-none disabled:opacity-50",
    // Icon sizing
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Figma State axis modelled as pseudo-classes (hover/active/highlighted)
        // Figma: Hover = bg-secondary/border-subtle, Active = bg-tertiary/border-default
        default: [
          "data-[highlighted]:bg-surface-alt data-[highlighted]:border-edge-subtle",
          "hover:bg-surface-alt hover:border-edge-subtle",
          "active:bg-surface-muted active:border-edge",
        ].join(" "),
        // Figma: Destructive Hover & Active both use a flat red-50 fill, no border
        destructive: [
          "text-content-error",
          "data-[highlighted]:bg-surface-error-subtle",
          "hover:bg-surface-error-subtle focus-visible:bg-surface-error-subtle",
          "active:bg-surface-error-subtle",
        ].join(" "),
      },
      // Figma: all sizes use Body 2 (14px); only the height changes
      size: {
        sm: "h-8 type-body-2",
        md: "h-9 type-body-2",
        lg: "h-10 type-body-2",
      },
      // Unified Figma Icon axis (None / Leading / Trailing / Both) — padding via table below
      icon: {
        none: "px-3",
        leading: "pl-2 pr-3 gap-1.5",
        trailing: "pl-3 pr-2 gap-1.5 justify-between w-[160px]",
        both: "pl-2 pr-2 gap-1.5 justify-between w-[160px]",
      },
      // Persistent selection (Figma "Active" fill applied to the current item)
      selected: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "default",
        selected: true,
        className: "bg-surface-muted border-edge",
      },
      {
        variant: "destructive",
        selected: true,
        className: "bg-surface-error-subtle",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "sm",
      icon: "none",
      selected: false,
    },
  }
);

// ============================================================================
// DescriptiveMenuItem Variants
// ============================================================================

const descriptiveMenuItemVariants = cva(
  [
    // Fixed Figma geometry: 280 × 70, radius 12, pad L16 / R12 / T-B12, gap 12
    "relative flex items-center w-[280px] h-[70px] rounded-xl pl-4 pr-3 py-3 gap-3",
    "text-left outline-none select-none transition-[background-color,border-color,color,opacity] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-standard)]",
    "border border-transparent",
    // Interaction states — Figma: Hover = bg-secondary/border-default @85%, Active = bg-tertiary/border-default @70%
    "data-[highlighted]:bg-surface-alt data-[highlighted]:border-edge data-[highlighted]:opacity-[0.85]",
    "hover:bg-surface-alt hover:border-edge hover:opacity-[0.85]",
    "active:bg-surface-muted active:border-edge active:opacity-70",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" ")
);

// ============================================================================
// Menu Container Variants
// ============================================================================

const menuVariants = cva(
  [
    // Base styles — items sit directly inside the padded popup
    "z-10 flex flex-col items-stretch gap-1 overflow-hidden",
    // Background and border (Figma: bg-primary, border-default)
    "bg-surface border border-edge",
    // Shape (Figma: radius 16, padding 8)
    "rounded-2xl p-2",
    // Shadow
    "shadow-default",
    // Animation origin
    "origin-[var(--transform-origin)]",
  ].join(" ")
);

// ============================================================================
// Types
// ============================================================================

interface MenuItemProps
  extends VariantProps<typeof menuItemVariants>,
    ComponentProps<typeof MenuPrimitive.Item> {
  className?: string;
  children?: ReactNode;
  /** Icon to display at the start of the menu item (when icon is "leading" or "both") */
  leadingIcon?: ReactNode;
  /** Icon to display at the end of the menu item (when icon is "trailing" or "both") */
  trailingIcon?: ReactNode;
}

interface DescriptiveMenuItemProps
  extends Omit<ComponentProps<typeof MenuPrimitive.Item>, "title"> {
  className?: string;
  /** Primary line (Body 2, medium) */
  title: ReactNode;
  /** Secondary line (Body 3, secondary content color) */
  description?: ReactNode;
  /** Optional icon rendered to the left of the text block */
  leadingIcon?: ReactNode;
}

interface MenuSeparatorProps
  extends ComponentProps<typeof MenuPrimitive.Separator> {
  className?: string;
}

interface MenuProps extends ComponentProps<typeof MenuPrimitive.Root> {
  children?: ReactNode;
}

interface MenuTriggerProps extends ComponentProps<typeof MenuPrimitive.Trigger> {
  className?: string;
  children?: ReactNode;
}

interface MenuContentProps
  extends VariantProps<typeof menuVariants>,
    ComponentProps<typeof MenuPrimitive.Popup> {
  className?: string;
  children?: ReactNode;
  /** Alignment of the menu relative to the trigger: 'start' (left) or 'end' (right) */
  align?: 'start' | 'center' | 'end';
  /** Side of the trigger to position the menu on */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Distance between trigger and menu (px) */
  sideOffset?: number;
  /**
   * Classname applied to the floating Positioner element. Use this to set a
   * z-index that stacks above other overlays (e.g. when the menu is rendered
   * inside a Dialog, pass `z-[120]` to sit above the dialog popup).
   */
  positionerClassName?: string;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Menu Root component - wraps trigger and content
 */
function Menu({ children, ...props }: MenuProps) {
  return <MenuPrimitive.Root {...props}>{children}</MenuPrimitive.Root>;
}

/**
 * Menu Trigger - the element that opens the menu
 */
function MenuTrigger({
  className,
  children,
  ...props
}: MenuTriggerProps) {
  return (
    <MenuPrimitive.Trigger className={className} {...props}>
      {children}
    </MenuPrimitive.Trigger>
  );
}

/**
 * Menu Content - the dropdown container
 */
const MenuContent = forwardRef<HTMLDivElement, MenuContentProps>(
  ({ className, children, align = 'end', side, sideOffset = 8, positionerClassName, ...props }, ref) => {
    return (
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          className={cn("z-10", positionerClassName)}
          sideOffset={sideOffset}
          align={align}
          side={side}
          collisionPadding={8}
        >
          <MenuPrimitive.Popup
            ref={ref}
            className={cn(
              "menu outline-none",
              menuVariants(),
              className
            )}
            {...props}
          >
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    );
  }
);
MenuContent.displayName = "MenuContent";

/**
 * Menu Item - individual selectable item
 */
const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(
  (
    {
      className,
      size = "sm",
      icon = "none",
      variant = "default",
      selected = false,
      leadingIcon,
      trailingIcon,
      children,
      ...props
    },
    ref
  ) => {
    const showLeading = icon === "leading" || icon === "both";
    const showTrailing = icon === "trailing" || icon === "both";

    return (
      <MenuPrimitive.Item
        ref={ref}
        className={cn(
          "menu-item",
          menuItemVariants({ size, icon, variant, selected }),
          className
        )}
        {...props}
      >
        {/* Leading icon */}
        {showLeading && leadingIcon && (
          <span className="menu-item-leading-icon flex size-5 items-center justify-center">
            {leadingIcon}
          </span>
        )}

        {/* Content */}
        <span
          className={cn(
            "menu-item-content flex items-center gap-1.5",
            showTrailing && "flex-1"
          )}
        >
          {children}
        </span>

        {/* Trailing icon */}
        {showTrailing && trailingIcon && (
          <span className="menu-item-trailing-icon flex size-5 items-center justify-center">
            {trailingIcon}
          </span>
        )}
      </MenuPrimitive.Item>
    );
  }
);
MenuItem.displayName = "MenuItem";

/**
 * Descriptive Menu Item - two-line item with a title + description
 */
const DescriptiveMenuItem = forwardRef<HTMLDivElement, DescriptiveMenuItemProps>(
  ({ className, title, description, leadingIcon, ...props }, ref) => {
    return (
      <MenuPrimitive.Item
        ref={ref}
        className={cn(
          "descriptive-menu-item",
          descriptiveMenuItemVariants(),
          className
        )}
        {...props}
      >
        {/* Leading icon */}
        {leadingIcon && (
          <span className="descriptive-menu-item-leading-icon flex items-center justify-center shrink-0">
            {leadingIcon}
          </span>
        )}

        {/* Text block — Figma NewMenuDropdown: title Body 2 medium, description Body 3 regular, gap 2 */}
        <span className="descriptive-menu-item-text flex flex-1 flex-col gap-0.5 min-w-0 overflow-hidden">
          <span className="type-body-2 font-medium text-content w-full truncate">
            {title}
          </span>
          {description && (
            <span className="type-body-3 text-content-secondary w-full truncate">
              {description}
            </span>
          )}
        </span>
      </MenuPrimitive.Item>
    );
  }
);
DescriptiveMenuItem.displayName = "DescriptiveMenuItem";

/**
 * Menu Separator - horizontal rule between groups of items
 */
const MenuSeparator = forwardRef<HTMLDivElement, MenuSeparatorProps>(
  ({ className, ...props }, ref) => {
    return (
      <MenuPrimitive.Separator
        ref={ref}
        className={cn("menu-separator min-w-[160px] px-2 py-1", className)}
        {...props}
      >
        <div className="h-px w-full bg-edge-subtle" />
      </MenuPrimitive.Separator>
    );
  }
);
MenuSeparator.displayName = "MenuSeparator";

// ============================================================================
// Exports
// ============================================================================

export {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  DescriptiveMenuItem,
  MenuSeparator,
  menuVariants,
  menuItemVariants,
  descriptiveMenuItemVariants,
};

export type {
  MenuProps,
  MenuTriggerProps,
  MenuContentProps,
  MenuItemProps,
  DescriptiveMenuItemProps,
  MenuSeparatorProps,
};
