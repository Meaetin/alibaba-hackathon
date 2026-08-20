"use client";

import { Dialog } from "@base-ui/react/dialog";
import { AlertTriangle, X, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { Separator } from "@/components/ui/primitives/Separator";
import { formatTimeRange } from "@/components/ui/itinerary/activity-utils";
import type { ItineraryActivityDetail } from "@/lib/supabase/queries/home";

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  children,
}: ConfirmActionDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel(); onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/50 z-40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "flex flex-col items-stretch gap-4 px-6 pt-6 pb-5 rounded-2xl w-[min(26.25rem,92vw)]",
            "bg-surface border border-edge shadow-default",
            "transition-[opacity,transform] duration-[var(--motion-duration-normal)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Floating Icon */}
              <div className="flex items-center justify-center shrink-0 size-10 rounded-full bg-blue-400">
                <div className="flex items-center justify-center size-8 rounded-full bg-blue-500">
                  <AlertTriangle className="size-5 text-white" />
                </div>
              </div>
              <span className="type-body-1 type-secondary font-semibold text-content">{title}</span>
            </div>
            <Dialog.Close className="flex items-center justify-center shrink-0 size-6 rounded-xl text-content-secondary hover:bg-surface-muted-hover active:bg-surface-muted-active transition-colors">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="flex flex-col gap-4 w-full">
            {children}
          </div>

          {/* Separator */}
          <Separator />

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ActivityChangeRowProps {
  activity: ItineraryActivityDetail;
  newStart: string;
  newEnd: string;
  badge?: React.ReactNode;
  /** Render as an immovable anchor: keeps its time and shows a lock indicator
   *  instead of an old→new time change. */
  locked?: boolean;
  timezone?: string;
}

export function ActivityChangeRow({ activity, newStart, newEnd, badge, locked, timezone }: ActivityChangeRowProps) {
  const photoUrl = activity.photo_url || activity.location?.photo_urls?.[0];
  const currentTime = formatTimeRange(activity.start_time, activity.end_time, timezone);
  const newTime = formatTimeRange(newStart, newEnd, timezone);

  return (
    <div className="activity-change-row flex items-center gap-3 h-14 py-2 pl-2 pr-3 rounded-xl border border-edge bg-surface">
      {badge}
      {photoUrl ? (
        <div className="size-10 rounded-lg overflow-hidden shrink-0 border border-edge">
          <img src={photoUrl} alt={activity.name} className="size-full object-cover" draggable={false} />
        </div>
      ) : (
        <div className="size-10 rounded-lg shrink-0 bg-surface-muted border border-edge" />
      )}
      <div className="flex-1 min-w-0">
        <span className="type-body-2 font-medium text-content truncate block">{activity.name}</span>
        {activity.location?.formatted_address && (
          <span className="type-body-3 text-content-secondary truncate block">{activity.location.formatted_address}</span>
        )}
      </div>
      <div className="flex flex-col items-end shrink-0">
        {locked ? (
          <>
            <span className="type-body-4 text-content-tertiary inline-flex items-center gap-1">
              <Lock className="size-3" aria-hidden="true" /> Locked
            </span>
            <span className="type-body-3 text-content font-medium">{currentTime}</span>
          </>
        ) : (
          <>
            <span className="type-body-3 text-content-secondary line-through">{currentTime}</span>
            <span className="type-body-3 text-content font-medium">{newTime}</span>
          </>
        )}
      </div>
    </div>
  );
}
