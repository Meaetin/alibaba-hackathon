"use client";

import { ImagePlus, Paperclip, X } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { FormModal } from "@/components/ui/modals/FormModal";
import { Button } from "@/components/ui/primitives/Button";
import { useToast } from "@/contexts/ToastContext";
import {
  FEEDBACK_IMAGE_TYPES,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGES,
  submitFeedback,
} from "@/lib/api/feedback";
import { cn } from "@/lib/utils";

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SelectedImage {
  id: string;
  file: File;
  previewUrl: string;
}

const ACCEPTED_IMAGE_TYPES = new Set<string>(FEEDBACK_IMAGE_TYPES);

function formatFileSize(bytes: number): string {
  return `${Math.max(0.1, bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
  const pathname = usePathname();
  const { showToast } = useToast();
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<SelectedImage[]>([]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  const clearImages = useCallback(() => {
    setImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
  }, []);

  const reset = useCallback(() => {
    setMessage("");
    setError(null);
    clearImages();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [clearImages]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const addImages = useCallback((incoming: File[], method: "paste" | "picker") => {
    setError(null);

    const validImages = incoming.filter((file) => {
      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        setError("Attach JPEG, PNG, or WebP images only.");
        return false;
      }
      if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
        setError("Each image must be 5 MB or smaller.");
        return false;
      }
      if (file.size === 0) {
        setError("One of those images is empty and could not be attached.");
        return false;
      }
      return true;
    });

    if (validImages.length === 0) return;

    setImages((current) => {
      const available = MAX_FEEDBACK_IMAGES - current.length;
      if (available <= 0) {
        setError(`You can attach up to ${MAX_FEEDBACK_IMAGES} images.`);
        return current;
      }

      const accepted = validImages.slice(0, available).map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));

      if (validImages.length > available) {
        setError(`Only the first ${MAX_FEEDBACK_IMAGES} images were attached.`);
      }
      return [...current, ...accepted];
    });
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addImages(Array.from(event.target.files ?? []), "picker");
    event.target.value = "";
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item, index) => {
        const file = item.getAsFile();
        if (!file) return null;
        const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        return new File([file], `pasted-screenshot-${Date.now()}-${index + 1}.${extension}`, {
          type: file.type,
        });
      })
      .filter((file): file is File => file !== null);

    if (pastedImages.length > 0) {
      event.preventDefault();
      addImages(pastedImages, "paste");
    }
  };

  const removeImage = (id: string) => {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.id !== id);
    });
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setError("Add a message before sending your feedback.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await submitFeedback({
        message: trimmedMessage,
        pagePath: pathname,
        images: images.map((image) => image.file),
      });
      showToast({
        variant: "success",
        title: "Feedback sent",
        description: "Thanks for helping make Argo better.",
      });
      reset();
      onOpenChange(false);
    } catch (submitError) {
      const reason = submitError instanceof Error ? submitError.message : "unknown";
      setError("We couldn’t send that feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <FormModal
      open={open}
      onOpenChange={handleOpenChange}
      stickerUrl="/images/stickers/Feedback.svg"
      title="Share feedback"
      description="Tell us what would make planning with Argo better."
      submitLabel="Send feedback"
      submittingLabel="Sending…"
      cancelLabel="Not now"
      submitDisabled={!message.trim()}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
      className="feedback-modal sm:w-[34rem]"
    >
      <div className="feedback-modal-content flex w-full flex-col gap-4">
        <div className="flex w-full max-w-[25rem] self-center flex-col gap-2">
          <label htmlFor="feedback-message" className="type-body-2 font-medium text-content">
            Message
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (error) setError(null);
            }}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            maxLength={4000}
            rows={3}
            autoFocus
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "feedback-error" : undefined}
            placeholder="Tell us about your experience, a bug you found, or an idea you’d love to see…"
            className={cn(
              "feedback-message h-20 min-h-20 w-full resize-y rounded-xl border bg-surface px-3 py-3",
              "type-body-2 text-content placeholder:text-content-placeholder outline-none",
              "transition-[background-color,border-color,box-shadow] duration-[var(--motion-control-duration)]",
              "hover:bg-surface-alt focus:bg-surface-alt focus:border-edge-input-active",
              "focus:shadow-[0px_0px_0px_2px_var(--edge-input-focus-ring),inset_0px_1px_4px_0px_var(--input-inner-shadow)]",
              error ? "border-edge-error" : "border-edge",
            )}
          />
          {images.length > 0 && (
            <div className="feedback-image-grid grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Attached images">
              {images.map((image) => (
                <div
                  key={image.id}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-edge bg-surface-alt"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.previewUrl}
                    alt={image.file.name}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(image.id)}
                    aria-label={`Remove ${image.file.name}`}
                    className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-lg bg-surface/90 text-content shadow-default backdrop-blur-sm transition-opacity hover:bg-surface"
                  >
                    <X className="size-4" />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1.5 text-white backdrop-blur-sm">
                    <p className="truncate text-[11px] font-medium">{image.file.name}</p>
                    <p className="text-[10px] text-white/70">{formatFileSize(image.file.size)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={FEEDBACK_IMAGE_TYPES.join(",")}
            multiple
            onChange={handleFileChange}
            className="sr-only"
            aria-label="Attach feedback images"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="leading"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSubmitting || images.length >= MAX_FEEDBACK_IMAGES}
            className="self-start"
          >
            {images.length > 0 ? <ImagePlus className="size-4" /> : <Paperclip className="size-4" />}
            Attach images{images.length > 0 ? ` (${images.length}/${MAX_FEEDBACK_IMAGES})` : ""}
          </Button>
        </div>

        {error && (
          <p id="feedback-error" role="alert" className="type-body-3 text-center text-content-error">
            {error}
          </p>
        )}
      </div>
    </FormModal>
  );
}

export type { FeedbackModalProps };
