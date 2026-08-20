"use client";

import { cn } from "@/lib/utils";
import { LodgingSidebar } from "@/components/ui/detail-views/LodgingSidebar";
import type { LodgingCardProps } from "@/components/ui/detail-views/LodgingCard";
import { FilePillHeader, type FilePillHeaderFile } from "@/components/ui/detail-views/FilePillHeader";

interface LodgingTabProps {
  lodgings: LodgingCardProps[];
  loading?: boolean;
  files?: FilePillHeaderFile[];
  onAddFile?: () => void;
  onRemoveFile?: (id: string) => void;
  onAddManual?: () => void;
  onLodgingEdit?: (lodgingId: string) => void;
  onLodgingDelete?: (lodgingId: string) => void;
  onLodgingOpen?: (lodgingId: string) => void;
  className?: string;
}

export function LodgingTab({ lodgings, loading, files, onAddFile, onRemoveFile, onAddManual, onLodgingEdit, onLodgingDelete, onLodgingOpen, className }: LodgingTabProps) {
  return (
    <div data-slot="lodging-tab" className={cn("lodging-tab-root flex flex-col gap-3 h-full", className)}>
      {/* File Pills */}
      {files && files.length > 0 && (
        <FilePillHeader files={files} onAddFile={onAddFile} onRemoveFile={onRemoveFile} />
      )}

      {/* Lodging List */}
      <LodgingSidebar lodgings={lodgings} loading={loading} onAddManual={onAddManual} onUpload={onAddFile} onLodgingEdit={onLodgingEdit} onLodgingDelete={onLodgingDelete} onLodgingOpen={onLodgingOpen} />
    </div>
  );
}
