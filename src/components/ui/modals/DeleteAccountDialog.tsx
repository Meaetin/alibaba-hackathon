"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, Loader2, Users, X } from "lucide-react";

import { Button } from "@/components/ui/primitives/Button";
import { Input } from "@/components/ui/primitives/Input";
import { Separator } from "@/components/ui/primitives/Separator";
import { getDeletionImpact, type DeletionImpact, type SharedItemImpact } from "@/lib/api/profile";
import { getFriendlyApiError } from "@/lib/errors/userMessages";
import { cn } from "@/lib/utils";

/** Typed exactly to arm the delete button — guards against a reflex click. */
const CONFIRM_PHRASE = "DELETE";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

function SharedItemRow({ item, kind }: { item: SharedItemImpact; kind: string }) {
  return (
    <div
      data-region="settings-shared-item-row"
      className="shared-item-row flex items-center gap-3 px-3 py-2 rounded-lg border border-edge bg-surface"
    >
      <div className="flex-1 min-w-0">
        <span className="type-body-3 font-medium text-content truncate block">{item.name}</span>
        <span className="type-body-4 text-content-tertiary">{kind}</span>
      </div>
      <span className="type-body-4 text-content-warning inline-flex items-center gap-1 shrink-0">
        <Users className="size-3" aria-hidden="true" />
        {item.collaborator_count}
      </span>
    </div>
  );
}

export function DeleteAccountDialog({ open, onOpenChange, onConfirm }: DeleteAccountDialogProps) {
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Reload the impact each time the dialog opens so the numbers reflect the
  // account as it stands right now, not as it was when the page first mounted.
  useEffect(() => {
    if (!open) {
      setImpact(null);
      setLoadError(null);
      setConfirmText("");
      setDeleteError(null);
      return;
    }

    let cancelled = false;
    getDeletionImpact()
      .then((data) => {
        if (!cancelled) setImpact(data);
      })
      .catch((err) => {
        console.error("Failed to load deletion impact:", err);
        if (!cancelled) {
          setLoadError(getFriendlyApiError(err, "We couldn't load your account details."));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const sharedItineraries = impact?.shared_itineraries ?? [];
  const sharedCollections = impact?.shared_collections ?? [];
  const hasSharedItems = sharedItineraries.length > 0 || sharedCollections.length > 0;
  const peopleAffected = [...sharedItineraries, ...sharedCollections].reduce(
    (sum, item) => sum + item.collaborator_count,
    0,
  );

  // Block confirmation until the impact is known — deleting against an unknown
  // blast radius is exactly what this dialog exists to prevent.
  const canDelete = impact !== null && confirmText.trim() === CONFIRM_PHRASE && !deleting;

  const handleConfirm = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onConfirm();
    } catch (err) {
      console.error("Account deletion failed:", err);
      setDeleteError(getFriendlyApiError(err, "We couldn't delete your account. Please try again."));
      setDeleting(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // A delete in flight must not be dismissable — the request continues
        // regardless and a closed dialog would leave the user guessing.
        if (deleting) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="delete-account-backdrop fixed inset-0 bg-black/50 z-40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "delete-account-popup fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "flex flex-col items-stretch p-6 rounded-xl w-[min(30rem,92vw)] max-h-[85dvh]",
            "bg-surface-alt border border-edge-strong shadow-default",
            "transition-[opacity,transform] duration-[var(--motion-duration-normal)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          )}
        >
          {/* Header */}
          <div
            data-region="settings-delete-header"
            className="delete-account-header flex items-center justify-between mb-4"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-content-error" />
              <span className="type-h4 type-secondary text-glyph">Delete account</span>
            </div>
            {!deleting && (
              <Dialog.Close className="delete-account-close flex items-center justify-center size-8 rounded-lg text-content-secondary hover:bg-surface-muted-hover active:bg-surface-muted-active transition-colors">
                <X className="size-4" />
              </Dialog.Close>
            )}
          </div>

          {/* Body */}
          <div
            data-region="settings-delete-body"
            className="delete-account-body flex flex-col gap-4 overflow-y-auto"
          >
            {/* Loading State */}
            {!impact && !loadError && (
              <div className="flex items-center gap-2 py-6 text-content-secondary">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span className="type-body-2">Checking what will be deleted…</span>
              </div>
            )}

            {/* Error Message */}
            {loadError && (
              <p className="type-body-2 text-content-error" role="alert">
                {loadError}
              </p>
            )}

            {impact && (
              <>
                <p className="type-body-1 text-glyph">
                  This permanently deletes your account and everything in it. It cannot be undone.
                </p>

                {/* Impact Summary */}
                <div
                  data-region="settings-delete-summary"
                  className="delete-account-summary flex flex-col gap-1.5 px-4 py-3 rounded-lg bg-surface-muted"
                >
                  <span className="type-body-3 text-content-secondary">
                    <span className="font-semibold text-content">{impact.itineraries_owned}</span>{" "}
                    {impact.itineraries_owned === 1 ? "itinerary" : "itineraries"}
                  </span>
                  <span className="type-body-3 text-content-secondary">
                    <span className="font-semibold text-content">{impact.collections_owned}</span>{" "}
                    {impact.collections_owned === 1 ? "collection" : "collections"}
                  </span>
                  <span className="type-body-3 text-content-secondary">
                    <span className="font-semibold text-content">{impact.links_analyzed}</span>{" "}
                    analysed {impact.links_analyzed === 1 ? "link" : "links"}
                  </span>
                </div>

                {/* Shared Items Warning */}
                {hasSharedItems && (
                  <div
                    data-region="settings-delete-shared-warning"
                    className="delete-account-shared flex flex-col gap-2.5 p-3 rounded-lg border border-edge-error bg-surface-error-subtle"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        className="size-4 text-content-error shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <p className="type-body-3 text-content">
                        <span className="font-semibold">
                          {peopleAffected} {peopleAffected === 1 ? "person" : "people"}
                        </span>{" "}
                        will lose access to work you share with them. These are deleted for
                        everyone, not just you:
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {sharedItineraries.map((item) => (
                        <SharedItemRow key={item.id} item={item} kind="Itinerary" />
                      ))}
                      {sharedCollections.map((item) => (
                        <SharedItemRow key={item.id} item={item} kind="Collection" />
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                {/* Confirm Input */}
                <div
                  data-region="settings-delete-confirm"
                  className="delete-account-confirm flex flex-col gap-2"
                >
                  <label htmlFor="delete-confirm-input" className="type-body-3 text-content">
                    Type <span className="font-semibold">{CONFIRM_PHRASE}</span> to confirm
                  </label>
                  <Input
                    id="delete-confirm-input"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={CONFIRM_PHRASE}
                    autoComplete="off"
                    disabled={deleting}
                  />
                </div>

                {/* Error Message */}
                {deleteError && (
                  <p className="type-body-3 text-content-error" role="alert">
                    {deleteError}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div
            data-region="settings-delete-footer"
            className="delete-account-footer flex items-center justify-end gap-2 mt-6"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirm}
              disabled={!canDelete}
              className="bg-action-error text-content-on-dark hover:bg-action-error-hover active:bg-action-error-active disabled:opacity-50"
            >
              {deleting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Deleting…
                </span>
              ) : (
                "Delete my account"
              )}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
