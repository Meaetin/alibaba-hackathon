"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { useBreakpoint } from "@/hooks/useMediaQuery";

const formModalIconRingVariants = cva(
  "form-modal-icon-ring flex items-center justify-center p-2 rounded-full",
  {
    variants: {
      variant: {
        link: "bg-category-link-icon",
        collection: "bg-category-collection-icon",
        itinerary: "bg-category-itinerary-icon",
        location: "bg-category-location-icon",
        brand: "bg-category-brand-icon",
        neutral: "bg-category-neutral-icon",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

const formModalIconCircleVariants = cva(
  "form-modal-icon-circle flex items-center justify-center rounded-full size-14 text-white [&_svg]:size-6",
  {
    variants: {
      variant: {
        link: "bg-category-link",
        collection: "bg-category-collection",
        itinerary: "bg-category-itinerary",
        location: "bg-category-location",
        brand: "bg-category-brand",
        neutral: "bg-category-neutral",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

interface FormModalProps extends VariantProps<typeof formModalIconRingVariants> {
  className?: string;
  /** Optional class for a bounded, independently scrollable content slot. */
  contentClassName?: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Icon rendered inside the floating colored circle (24px). */
  icon?: ReactNode;
  /** Sticker asset rendered in place of the generic colored icon treatment. */
  stickerUrl?: string;
  title: string;
  description?: string;
  /** Form content slot rendered between the separator and the button pair */
  children?: ReactNode;
  cancelLabel?: string;
  submitLabel?: string;
  /** Label shown on the submit button while `isSubmitting` is true */
  submittingLabel?: string;
  onSubmit?: (e: React.FormEvent) => void;
  onCancel?: () => void;
  /**
   * Whether the cancel button closes the dialog (default). Set to false for
   * wizard steps where it should act as a Back button instead.
   */
  cancelCloses?: boolean;
  submitDisabled?: boolean;
  isSubmitting?: boolean;
}

function FormModal({
  className,
  contentClassName,
  trigger,
  open,
  onOpenChange,
  variant,
  icon,
  stickerUrl,
  title,
  description,
  children,
  cancelLabel = "Cancel",
  submitLabel = "Submit",
  submittingLabel = "Submitting…",
  onSubmit,
  onCancel,
  cancelCloses = true,
  submitDisabled,
  isSubmitting,
}: FormModalProps) {
  const { isPhone } = useBreakpoint();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        {/* Form Modal Backdrop */}
        <Dialog.Backdrop className="form-modal-backdrop modal-backdrop-animated fixed inset-0 bg-black/50 z-40" />
        <Dialog.Popup
          data-mobile-sheet={isPhone ? "true" : undefined}
          className={cn(
            "form-modal-popup modal-popup-animated fixed z-50",
            isPhone
              ? "inset-x-0 bottom-0 flex max-h-[90dvh] w-full flex-col items-center gap-3 overflow-y-auto rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 has-[input]:min-h-[70dvh] has-[select]:min-h-[70dvh] has-[textarea]:min-h-[70dvh]"
              : "left-1/2 top-1/2 flex w-[32.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-2xl px-4 pb-4 pt-8",
            "bg-surface border border-edge",
            "shadow-default",
            !isPhone && className,
          )}
        >
          {isPhone && (
            <div
              aria-hidden="true"
              className="form-modal-sheet-handle mb-2 h-1 w-11 rounded-full bg-surface-muted-active"
            />
          )}
          <form
            onSubmit={onSubmit}
            className="form-modal-form flex min-h-0 w-full flex-1 flex-col items-center gap-3"
          >
            {/* Icon Section */}
            <div className="form-modal-icon-section flex items-center justify-center w-full">
              {stickerUrl ? (
                <div className="form-modal-sticker flex size-[80px] items-center justify-center drop-shadow-[0px_3.2px_3.2px_rgba(0,0,0,0.25)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={stickerUrl}
                    alt=""
                    className="form-modal-sticker-image size-full object-contain"
                    draggable="false"
                    aria-hidden="true"
                  />
                </div>
              ) : icon ? (
                <div className={formModalIconRingVariants({ variant })}>
                  <div className={formModalIconCircleVariants({ variant })}>
                    {icon}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Header */}
            <div className="form-modal-header flex flex-col items-center gap-1.5 pt-5 text-center w-full">
              <Dialog.Title className="form-modal-title type-secondary type-body-1 font-semibold text-content w-full">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="form-modal-description type-body-2 text-content-placeholder w-full">
                  {description}
                </Dialog.Description>
              )}
            </div>

            {/* Separator */}
            <div className="form-modal-separator flex items-start py-5 w-full">
              <div className="form-modal-separator-line h-px flex-1 bg-edge-subtle" />
            </div>

            {/* Content Slot */}
            {contentClassName ? (
              <div className={cn("form-modal-content min-h-0 w-full", contentClassName)}>
                {children}
              </div>
            ) : children}

            {/* Button Group */}
            <div className="form-modal-buttons flex w-full shrink-0 items-center justify-center gap-3 pt-6">
              {cancelCloses ? (
                <Dialog.Close
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      onClick={onCancel}
                      disabled={isSubmitting}
                    />
                  }
                >
                  {cancelLabel}
                </Dialog.Close>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={onCancel}
                  disabled={isSubmitting}
                >
                  {cancelLabel}
                </Button>
              )}
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={submitDisabled || isSubmitting}
              >
                {isSubmitting ? (
                  <span className="form-modal-submitting flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {submittingLabel}
                  </span>
                ) : (
                  submitLabel
                )}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

FormModal.displayName = "FormModal";

export { FormModal, formModalIconRingVariants, formModalIconCircleVariants };
export type { FormModalProps };
