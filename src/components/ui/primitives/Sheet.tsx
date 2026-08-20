"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useBreakpoint } from "@/hooks/useMediaQuery";

const sheetVariants = cva(
  "sheet-popup fixed z-50 flex flex-col overflow-hidden bg-surface border border-edge shadow-default",
  {
    variants: {
      side: {
        bottom:
          "inset-x-0 bottom-0 w-full max-h-[90dvh] rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] has-[input]:min-h-[70dvh] has-[select]:min-h-[70dvh] has-[textarea]:min-h-[70dvh]",
        right:
          "inset-y-0 right-0 h-dvh w-[min(24rem,100vw)] rounded-l-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        left: "inset-y-0 left-0 h-dvh w-[min(24rem,100vw)] rounded-r-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
      },
    },
    defaultVariants: {
      side: "bottom",
    },
  },
);

type SheetSide = NonNullable<VariantProps<typeof sheetVariants>["side"]>;

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Force a presentation. Omit for the responsive default:
   * phone → "bottom", tablet+ → "right".
   */
  side?: SheetSide;
  /** a11y label — rendered sr-only unless the caller supplies its own header. */
  title: string;
  /** Optional a11y description (sr-only). */
  description?: string;
  /** Overlay content. */
  children?: ReactNode;
  /** Optional trigger element (consumers usually control `open` directly). */
  trigger?: ReactNode;
  /** Extra classes on the Popup. */
  className?: string;
}

/**
 * Responsive overlay container built on the same Base UI `Dialog` as the
 * modals — focus trap, `Esc`, scroll-lock, backdrop-dismiss, and ARIA wiring
 * come for free. Presents as a bottom-sheet on phone and a side-drawer on
 * tablet+ (override with `side`). Reused by the shell sidebar, phone modals,
 * mobile search, itinerary action sheet, and edit-mode panel nav.
 */
function Sheet({
  open,
  onOpenChange,
  side,
  title,
  description,
  children,
  trigger,
  className,
}: SheetProps) {
  const { isPhone } = useBreakpoint();
  const resolvedSide: SheetSide = side ?? (isPhone ? "bottom" : "right");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        {/* Sheet Backdrop */}
        <Dialog.Backdrop className="sheet-backdrop modal-backdrop-animated fixed inset-0 bg-black/50 z-40" />
        <Dialog.Popup
          data-side={resolvedSide}
          className={cn(sheetVariants({ side: resolvedSide }), className)}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="sr-only">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

Sheet.displayName = "Sheet";

export { Sheet, sheetVariants };
export type { SheetProps, SheetSide };
