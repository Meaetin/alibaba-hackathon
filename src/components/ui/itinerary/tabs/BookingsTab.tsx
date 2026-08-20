"use client";

import { cn } from "@/lib/utils";
import { Receipt } from "lucide-react";

interface BookingsTabProps {
  className?: string;
}

export function BookingsTab({ className }: BookingsTabProps) {
  return (
    <div data-slot="bookings-tab" className={cn("bookings-tab-root flex flex-col items-center justify-center py-16 gap-3", className)}>
      {/* Empty State */}
      <div className="bookings-tab-empty-icon-circle size-12 rounded-full bg-surface-alt border border-edge flex items-center justify-center">
        <Receipt className="bookings-tab-empty-icon size-6 text-content-secondary" />
      </div>
      <p className="bookings-tab-empty-title type-body-2 text-content-secondary">Bookings coming soon</p>
      <p className="bookings-tab-empty-subtitle type-body-3 text-content-tertiary">Track tickets, reservations, and e-bookings</p>
    </div>
  );
}
