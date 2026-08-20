"use client";

import { FileText, X } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

interface FilePillProps extends ComponentPropsWithoutRef<"div"> {
  /** Filename to display */
  filename: string;
  /** Optional callback to remove the pill. When provided, renders an X button. */
  onRemove?: () => void;
  /** Accessible label for the remove button. Defaults to "Remove {filename}". */
  removeLabel?: string;
}

const FilePill = forwardRef<HTMLDivElement, FilePillProps>(
  ({ className, filename, onRemove, removeLabel, ...props }, ref) => {
    const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onRemove?.();
    };

    return (
      <div
        ref={ref}
        data-slot="file-pill"
        className={cn(
          "file-pill inline-flex h-9 items-center gap-1.5 rounded-full border border-edge bg-action-secondary pl-2 pr-2 text-glyph aria-disabled:pointer-events-none aria-disabled:opacity-50",
          !onRemove && "pr-3",
          className
        )}
        {...props}
      >
        <FileText className="file-pill-icon size-4 text-content-secondary" aria-hidden="true" />
        <span className="file-pill-filename type-body-2 truncate">{filename}</span>
        {onRemove && (
          <button
            type="button"
            onClick={handleRemoveClick}
            aria-label={removeLabel ?? `Remove ${filename}`}
            className="file-pill-remove-button flex size-5 items-center justify-center rounded-full text-content-secondary hover:bg-surface-muted hover:text-content transition-colors"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }
);

FilePill.displayName = "FilePill";

export { FilePill };
export type { FilePillProps };
