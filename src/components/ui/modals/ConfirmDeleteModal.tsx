"use client";

import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, X } from "lucide-react";

import { Button } from "@/components/ui/primitives/Button";
import { cn } from "@/lib/utils";

interface ConfirmDeleteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "collection" | "itinerary";
  entityName: string;
  collaboratorCount: number;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({
  open,
  onOpenChange,
  entityType,
  entityName,
  collaboratorCount,
  onConfirm,
}: ConfirmDeleteModalProps) {
  const hasCollaborators = collaboratorCount > 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="confirm-delete-backdrop fixed inset-0 bg-black/50 z-40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "confirm-delete-popup fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "flex flex-col items-stretch p-6 rounded-xl w-[min(28rem,92vw)]",
            "bg-surface-alt border border-edge-strong shadow-default",
            "transition-[opacity,transform] duration-[var(--motion-duration-normal)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          )}
        >
          {/* Header */}
          <div className="confirm-delete-header flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {hasCollaborators && (
                <AlertTriangle className="size-5 text-content-warning" />
              )}
              <span className="type-h4 type-secondary text-glyph">
                Delete {entityType}
              </span>
            </div>
            <Dialog.Close className="confirm-delete-close flex items-center justify-center size-8 rounded-lg text-content-secondary hover:bg-surface-muted-hover active:bg-surface-muted-active transition-colors">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="confirm-delete-body mb-6">
            {hasCollaborators ? (
              <div className="flex flex-col gap-3">
                <p className="type-body-1 text-glyph">
                  <span className="font-medium">{entityName}</span> has{" "}
                  <span className="font-medium">{collaboratorCount}{" "}
                    {collaboratorCount === 1 ? "collaborator" : "collaborators"}
                  </span>.
                </p>
                <p className="type-body-2 text-content-secondary">
                  This {entityType} will be permanently deleted for you and all
                  collaborators. This action cannot be undone.
                </p>
              </div>
            ) : (
              <p className="type-body-1 text-glyph">
                Are you sure you want to delete{" "}
                <span className="font-medium">{entityName}</span>?
                This action is permanent and cannot be undone.
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="confirm-delete-footer flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className="bg-action-error text-content-on-dark hover:bg-action-error-hover active:bg-action-error-active"
            >
              Delete
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
