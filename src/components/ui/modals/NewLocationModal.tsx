"use client";

import { Link as LinkIcon, MapPin } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { FormModal } from "@/components/ui/modals/FormModal";
import { Input } from "@/components/ui/primitives/Input";
import { looksLikeGoogleMapsUrl } from "@/lib/maps/google-maps-url";

interface NewLocationModalProps {
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (url: string) => void;
}

function NewLocationModal({
  className,
  open,
  onOpenChange,
  onSubmit,
}: NewLocationModalProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) {
      setValue("");
      setError(undefined);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();

    if (!trimmed) {
      setError("Paste a Google Maps share link");
      return;
    }
    if (!looksLikeGoogleMapsUrl(trimmed)) {
      setError("That doesn't look like a Google Maps share link");
      return;
    }

    setError(undefined);
    onSubmit(trimmed);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (error) setError(undefined);
    setValue(e.target.value);
  };

  return (
    <FormModal
      className={className}
      open={open}
      onOpenChange={onOpenChange}
      variant="location"
      icon={<MapPin />}
      title="Add Location"
      description="Pin a new spot to your collection"
      submitLabel="Submit"
      onSubmit={handleSubmit}
      submitDisabled={!value.trim()}
    >
      {/* Link Input Row */}
      <div className="new-location-modal-input-row flex flex-col items-center px-10 w-full">
        <Input
          icon={<LinkIcon />}
          placeholder="Paste google link"
          value={value}
          onChange={handleChange}
          className={cn("w-full", error && "border-edge-error")}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "new-location-modal-error" : undefined}
        />

        {/* Validation Error */}
        {error && (
          <p
            id="new-location-modal-error"
            className="new-location-modal-error type-body-3 text-content-error self-start mt-2 pl-1"
          >
            {error}
          </p>
        )}
      </div>
    </FormModal>
  );
}

NewLocationModal.displayName = "NewLocationModal";

export { NewLocationModal };
export type { NewLocationModalProps };
