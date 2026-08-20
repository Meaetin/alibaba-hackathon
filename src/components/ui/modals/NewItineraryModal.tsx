"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, MapPin, PenLine } from "lucide-react";
import { type DateRange } from "react-day-picker";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FormModal } from "@/components/ui/modals/FormModal";
import { Input } from "@/components/ui/primitives/Input";
import { Calendar } from "@/components/ui/primitives/Calendar";
import { PlaceAutocomplete } from "@/components/ui/primitives/PlaceAutocomplete";
import type { PlaceResult } from "@/components/ui/primitives/PlaceAutocomplete";
import type { Surface } from "@/lib/domain-types";

interface NewItineraryModalProps {
  /** Surface this modal was opened from — drives the create-funnel analytics. */
  source: Surface;
  className?: string;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tripNameValue?: string;
  defaultTripNameValue?: string;
  onTripNameChange?: (value: string) => void;
  onSubmit?: (data: {
    tripName: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    startDate?: string;
    endDate?: string;
    totalDays?: number;
    aiRecommendations: boolean;
    selectedLocationIds: string[];
  }) => void | Promise<void>;
  onCancel?: () => void;
  /** Pre-fill the location field. */
  defaultPlace?: PlaceResult | null;
  /** Locations selected on the calling page. Empty drives the no-selection (AI-only / blank) cases. */
  selectedLocationIds?: string[];
}

function NewItineraryModal({
  className,
  trigger,
  open,
  onOpenChange,
  tripNameValue,
  defaultTripNameValue,
  onTripNameChange,
  onSubmit,
  onCancel,
  defaultPlace,
  selectedLocationIds = [],
  source,
}: NewItineraryModalProps) {
  const [page, setPage] = useState<1 | 2>(1);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(defaultPlace ?? null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [aiRecommendations, setAiRecommendations] = useState(false);
  const [shakingFields, setShakingFields] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Distinguishes a close-after-submit from a genuine abandonment.
  const submittedRef = useRef(false);
  const pageRef = useRef<1 | 2>(1);
  pageRef.current = page;

  useEffect(() => {
    if (!open) return;
    submittedRef.current = false;
  }, [open, source, selectedLocationIds.length]);

  const stopShake = (field: string) =>
    setShakingFields((prev) => { const next = new Set(prev); next.delete(field); return next; });

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const toLocalDateStr = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const dateDisplayValue = useMemo(() => {
    if (!dateRange?.from) return "";
    if (!dateRange.to) return formatDate(dateRange.from);
    return `${formatDate(dateRange.from)} – ${formatDate(dateRange.to)}`;
  }, [dateRange]);

  const totalDays = useMemo(() => {
    if (!dateRange?.from || !dateRange?.to) return 0;
    const diff = dateRange.to.getTime() - dateRange.from.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
  }, [dateRange]);

  const hasTripName = Boolean(tripNameValue ?? defaultTripNameValue);
  const isStep1Valid = hasTripName && selectedPlace !== null;
  const isStep2Valid = totalDays > 0;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (!submittedRef.current) {
      }
      setPage(1);
      setSelectedPlace(null);
      setDateRange(undefined);
      setAiRecommendations(false);
      setShakingFields(new Set());
      setIsSubmitting(false);
    }
    onOpenChange?.(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Page 1 → validate name + place, then advance
    if (page === 1) {
      if (!isStep1Valid) {
        const invalid = new Set<string>();
        if (!hasTripName) invalid.add("tripName");
        if (!selectedPlace) invalid.add("place");
        setShakingFields(invalid);
        return;
      }
      setPage(2);
      return;
    }

    // Page 2 → validate dates, then submit
    if (!isStep2Valid) {
      setShakingFields(new Set(["date"]));
      return;
    }
    if (!onSubmit) return;

    setIsSubmitting(true);
    submittedRef.current = true;
    try {
      await onSubmit({
        tripName: tripNameValue ?? defaultTripNameValue ?? "",
        country: selectedPlace?.country,
        region: selectedPlace?.region ?? undefined,
        latitude: selectedPlace?.latitude,
        longitude: selectedPlace?.longitude,
        startDate: dateRange?.from ? toLocalDateStr(dateRange.from) : undefined,
        endDate: dateRange?.to ? toLocalDateStr(dateRange.to) : undefined,
        totalDays,
        aiRecommendations,
        selectedLocationIds,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormModal
      className={cn(page === 2 ? "w-[min(42rem,92vw)]" : "", className)}
      trigger={trigger}
      open={open}
      onOpenChange={handleOpenChange}
      variant="itinerary"
      stickerUrl="/images/stickers/Map.svg"
      title="Plan New Itinerary"
      description="Compile your favorite spots into a trip plan"
      cancelLabel={page === 1 ? "Cancel" : "Back"}
      cancelCloses={page === 1}
      submitLabel={page === 1 ? "Next" : "Start Planning"}
      submittingLabel="Starting…"
      onSubmit={handleSubmit}
      onCancel={page === 1 ? onCancel : () => setPage(1)}
      isSubmitting={isSubmitting}
    >
      {/* Page 1: Trip Name + Region */}
      {page === 1 && (
        <div className="new-itinerary-modal-step-1 flex flex-col gap-4 items-center w-full">
          <div
            className="new-itinerary-modal-trip-field rounded-xl w-full max-w-80"
            style={shakingFields.has("tripName") ? { animation: "field-validate var(--motion-duration-validation) var(--motion-ease-standard) forwards" } : undefined}
            onAnimationEnd={(e) => { if (e.animationName === "field-validate") stopShake("tripName"); }}
          >
            <Input
              icon={<PenLine />}
              placeholder="Trip name"
              value={tripNameValue}
              defaultValue={defaultTripNameValue}
              onChange={(e) => onTripNameChange?.(e.target.value)}
              className="w-full"
            />
          </div>
          <div
            className="new-itinerary-modal-place-field relative z-10 rounded-xl w-full max-w-80"
            style={shakingFields.has("place") ? { animation: "field-validate var(--motion-duration-validation) var(--motion-ease-standard) forwards" } : undefined}
            onAnimationEnd={(e) => { if (e.animationName === "field-validate") stopShake("place"); }}
          >
            <PlaceAutocomplete
              icon={<MapPin />}
              placeholder="Search region or country"
              defaultPlace={selectedPlace ?? defaultPlace}
              onPlaceSelect={setSelectedPlace}
              className="new-itinerary-modal-place-autocomplete w-full"
            />
          </div>
        </div>
      )}

      {/* Page 2: Dates + Calendar + AI Toggle */}
      {page === 2 && (
        <div className="new-itinerary-modal-step-2 flex flex-col gap-4 items-center w-full">
          <div
            className="new-itinerary-modal-date-field rounded-xl w-full max-w-80"
            style={shakingFields.has("date") ? { animation: "field-validate var(--motion-duration-validation) var(--motion-ease-standard) forwards" } : undefined}
            onAnimationEnd={(e) => { if (e.animationName === "field-validate") stopShake("date"); }}
          >
            <Input
              icon={<CalendarDays />}
              placeholder="Select Dates"
              value={dateDisplayValue}
              readOnly
              className="new-itinerary-modal-date-input w-full cursor-default"
              trailingIcon={
                totalDays > 0 ? (
                  <span className="new-itinerary-modal-day-pill inline-flex items-center justify-center h-6 px-2 rounded-full border border-action-secondary-hover bg-action-secondary type-body-3 font-medium text-glyph whitespace-nowrap">
                    {totalDays} day{totalDays > 1 ? "s" : ""}
                  </span>
                ) : undefined
              }
              trailingIconClassName="w-auto size-auto"
            />
          </div>

          {/* Range Calendar */}
          <div className="new-itinerary-modal-calendar flex flex-col items-center">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              disabled={{ before: new Date() }}
            />
          </div>

          {/* AI Recommendations Toggle */}
          <button
            type="button"
            role="checkbox"
            aria-checked={aiRecommendations}
            onClick={() => setAiRecommendations((prev) => !prev)}
            className="new-itinerary-modal-ai-toggle flex items-center gap-2 py-2 pl-2 pr-3 rounded-xl border border-edge bg-surface cursor-pointer transition-colors hover:bg-surface-alt"
          >
            <span className="new-itinerary-modal-ai-check flex items-center justify-center size-9">
              {/* Selection indicator — nested Ring > Fill, brand when active */}
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border-2 transition-colors",
                  aiRecommendations
                    ? "border-edge-brand"
                    : "border-action-dark-border",
                )}
              >
                {aiRecommendations && (
                  <span className="size-3 rounded-full bg-action-brand" />
                )}
              </span>
            </span>
            <span className="new-itinerary-modal-ai-label type-body-2 font-medium text-content whitespace-nowrap">
              Start with AI recommendations
            </span>
          </button>
        </div>
      )}
    </FormModal>
  );
}

NewItineraryModal.displayName = "NewItineraryModal";

export { NewItineraryModal };
export type { NewItineraryModalProps };
