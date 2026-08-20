"use client";

import { Link } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FormModal } from "@/components/ui/modals/FormModal";
import { Input } from "@/components/ui/primitives/Input";
import { validateUrl } from "@/lib/utils/url-validation";
import { getFriendlyApiError } from "@/lib/errors/userMessages";

interface NewLinkModalProps {
  className?: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  linkValue?: string;
  defaultLinkValue?: string;
  onLinkChange?: (value: string) => void;
  onSubmit?: (linkUrl: string) => Promise<void>;
  onCancel?: () => void;
}

function NewLinkModal({
  className,
  trigger,
  open,
  onOpenChange,
  linkValue,
  defaultLinkValue,
  onLinkChange,
  onSubmit,
  onCancel,
}: NewLinkModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [internalValue, setInternalValue] = useState(defaultLinkValue ?? "");

  const isControlled = linkValue !== undefined;
  const currentValue = isControlled ? linkValue : internalValue;

  // Reset uncontrolled value + error state when the modal closes so reopening
  // presents a fresh form.
  useEffect(() => {
    if (open === false) {
      if (!isControlled) setInternalValue("");
      setUrlError(undefined);
    }
  }, [open, isControlled]);

  const updateValue = (next: string) => {
    if (!isControlled) setInternalValue(next);
    onLinkChange?.(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSubmit) return;

    const trimmed = currentValue.trim();
    const validation = validateUrl(trimmed);

    if (!validation.valid) {
      setUrlError(validation.error);
      return;
    }

    setUrlError(undefined);
    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
      if (!isControlled) setInternalValue("");
    } catch (err) {
      // Never render a raw backend string here — it used to surface machine
      // codes like "quota_exceeded" directly under the input.
      console.error("Link submission failed:", err);
      setUrlError(getFriendlyApiError(err, "We couldn't add that link. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (urlError) setUrlError(undefined);
    updateValue(e.target.value);
  };

  return (
    <FormModal
      className={className}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      variant="link"
      stickerUrl="/images/stickers/Link Sticker.svg"
      title="Add New Link"
      description="Analyse TikTok, YouTube, Instagram and Websites"
      submitLabel="Submit"
      submittingLabel="Adding to queue…"
      onSubmit={handleSubmit}
      onCancel={onCancel}
      submitDisabled={!currentValue.trim()}
      isSubmitting={isSubmitting}
    >
      {/* Link Input Row */}
      <div className="new-link-modal-input-row flex flex-col items-center px-10 w-full">
        <Input
          icon={<Link />}
          placeholder="Paste any link"
          value={currentValue}
          onChange={handleChange}
          disabled={isSubmitting}
          className={cn("w-full", urlError && "border-edge-error")}
          aria-invalid={Boolean(urlError)}
          aria-describedby={urlError ? "new-link-modal-error" : undefined}
        />

        {/* Validation Error */}
        {urlError && (
          <p
            id="new-link-modal-error"
            className="new-link-modal-error type-body-3 text-content-error self-start mt-2 pl-1"
          >
            {urlError}
          </p>
        )}
      </div>
    </FormModal>
  );
}

NewLinkModal.displayName = "NewLinkModal";

export { NewLinkModal };
export type { NewLinkModalProps };
