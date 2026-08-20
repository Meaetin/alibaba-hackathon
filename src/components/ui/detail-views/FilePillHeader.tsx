"use client";

import { Plus } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { FilePill } from "@/components/ui/primitives/FilePill";

export interface FilePillHeaderFile {
  id: string;
  name: string;
}

interface FilePillHeaderProps extends ComponentPropsWithoutRef<"div"> {
  files: FilePillHeaderFile[];
  onAddFile?: () => void;
  /** Called with the file's id when the user clicks the remove button on a pill. */
  onRemoveFile?: (id: string) => void;
}

const FilePillHeader = forwardRef<HTMLDivElement, FilePillHeaderProps>(
  ({ className, files, onAddFile, onRemoveFile, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="file-pill-header"
        className={cn("file-pill-header flex items-center gap-2 flex-wrap", className)}
        {...props}
      >
        {files.map((file) => (
          <FilePill
            key={file.id}
            filename={file.name}
            onRemove={onRemoveFile ? () => onRemoveFile(file.id) : undefined}
          />
        ))}
        <Button
          variant="ghost"
          size="sm" icon="only"
          className="file-pill-header-add-button shrink-0"
          onClick={onAddFile}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    );
  }
);

FilePillHeader.displayName = "FilePillHeader";

export { FilePillHeader };
export type { FilePillHeaderProps };
