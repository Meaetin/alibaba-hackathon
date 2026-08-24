"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Link2, Loader2, Lock, MapPin, MoreVertical, PanelLeftClose, Paperclip, Plus, RefreshCw, Search, Trash2, Unlock, Upload, X } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { looksLikeGoogleMapsUrl } from "@/lib/maps/google-maps-url";
import { staggerContainer, staggerSlideDown, staggerSlideUp } from "@/lib/utils/animations";
import { Switch } from "@/components/ui/primitives/Switch";
import { inputControlVariants, inputVariants } from "@/components/ui/primitives/Input";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/primitives/Menu";
import { AlsoInCard } from "@/components/ui/detail-views/AlsoInCard";
import { LocationDetailPanel } from "./LocationDetailPanel";
import { CollectionPanel } from "./CollectionPanel";
import { FlightTab } from "./tabs/FlightTab";
import { LodgingTab } from "./tabs/LodgingTab";
import type { FilePillHeaderFile } from "@/components/ui/detail-views/FilePillHeader";
import { FilePill } from "@/components/ui/primitives/FilePill";
import { fromHHMM } from "@/lib/utils/calendar";
import { TypeableTimePicker } from "@/components/ui/detail-views/TypeableTimePicker";
import { BookingsTab } from "./tabs/BookingsTab";
import { ExpensesTab } from "./tabs/ExpensesTab";
import { NotesTab } from "./tabs/NotesTab";
import { Button } from "@/components/ui/primitives/Button";
import { PanelFooterCTA } from "@/components/ui/detail-views/PanelFooterCTA";
import { ConfirmActionDialog } from "@/components/ui/modals/ConfirmActionDialog";
import { FlightForm, type FlightFormData } from "@/components/ui/detail-views/FlightForm";
import { LodgingForm, type LodgingFormData } from "@/components/ui/detail-views/LodgingForm";
import type { ItineraryActivityDetail } from "@/lib/supabase/queries/home";
import type { ActivityNote, ActivityAttachment, DayActivityMarker } from "./LocationDetailPanel";
import type { ActivityNoteCard } from "@/components/ui/notes/InlineNoteEditor";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import type { LodgingCardProps } from "@/components/ui/detail-views/LodgingCard";
import type { Expense } from "@/components/ui/detail-views/ExpensesSidebar";
import type { CollectionWithRole, CollectionWithLocations, Location } from "@/lib/api/collections";
import type { PlaceSearchResult } from "@/lib/maps/place-search";
import { getFriendlyApiError } from "@/lib/errors/userMessages";
import { useToast } from "@/contexts/ToastContext";
import { PlaceDetailsBlock, placeSearchResultToPlaceView } from "./PlaceDetailsBlock";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";

// ───── Types ─────────────────────────────────────────────────────────────────

export type ItineraryPanelVariant =
  | "location"
  | "search-place"
  | "collection"
  | "add-location"
  | "flight"
  | "flight-form"
  | "flight-edit"
  | "lodging"
  | "lodging-form"
  | "lodging-edit"
  | "bookings"
  | "expenses"
  | "notes";

export type ItineraryPanelState =
  | { variant: "location"; activity: ItineraryActivityDetail; from?: "collection" | "activity" | "flight" | "lodging" | "expenses" }
  | { variant: "search-place"; place: PlaceSearchResult }
  | { variant: "collection" }
  | { variant: "add-location"; dayId: string; insertAtIndex?: number }
  | { variant: "flight" }
  | { variant: "flight-form" }
  | { variant: "flight-edit"; flightId: string }
  | { variant: "lodging" }
  | { variant: "lodging-form" }
  | { variant: "lodging-edit"; lodgingId: string }
  | { variant: "bookings" }
  | { variant: "expenses" }
  | { variant: "notes" }
  | null;

interface ItinerarySidePanelProps {
  state: ItineraryPanelState;
  onClose?: () => void;
  /** Navigates back (e.g., location → collection) */
  onBack?: () => void;
  // Location
  /** Accepted, not implemented — the component ignores this today. */
  onViewOnMap?: () => void;
  /** Called when user selects a day from "Add to" dropdown (location not yet in itinerary) */
  onAddToDay?: (dayId: string) => void;
  onActivityTimeChange?: (startTime: string, endTime: string | null) => void;
  /** Sibling activities on the focused activity's day — markers + conflict detection in the time picker. */
  activityDaySiblings?: DayActivityMarker[];
  /** This activity's single note (FE-124), or null when none exists yet. */
  activityNote?: ActivityNote | null;
  /** Persist the activity's note (autosaved from the editor). */
  onActivityNoteSave?: (note: ActivityNote) => void;
  /** Drop the activity's note when the user empties it. */
  onActivityNoteClear?: () => void;
  /** All activity-authored notes, shown alongside standalone notes in the Notes tab. */
  notesActivityNotes?: ActivityNoteCard[];
  /** Open the owning activity when its note card in the Notes tab is clicked. */
  onNotesActivityClick?: (activityId: string) => void;
  onActivityAddAttachment?: () => void;
  /** Accepted, not implemented — the component ignores this today. */
  onActivityRemoveAttachment?: (attachmentId: string) => void;
  onActivityToggleLock?: () => void;
  onActivityDelete?: () => void;
  /** Accepted, not implemented — the component ignores this today. */
  onActivityMoveTo?: (dayId: string) => void;
  availableDays?: { id: string; label: string }[];
  activityAttachments?: ActivityAttachment[];
  activityIsLocked?: boolean;
  phone?: string | null;
  website?: string | null;
  // Collection
  collections?: CollectionWithRole[];
  collectionsLoading?: boolean;
  itineraryCollection?: CollectionWithLocations | null;
  /** The itinerary's own (home) collection — always the top row of the selector
   *  menu so the user can return to it regardless of which collection is viewed. */
  itineraryHomeCollection?: CollectionWithLocations | null;
  itineraryLocationIds?: Set<string>;
  onLocationSelect?: (location: Location) => void;
  onCollectionChange?: (collectionId: string) => void;
  /** Accepted, not implemented — the component ignores this today. */
  isSecondaryCollection?: boolean;
  /** Accepted, not implemented — the component ignores this today. */
  onCollectionBack?: () => void;
  // Flight
  flights?: FlightCardProps[];
  flightLoading?: boolean;
  flightFiles?: FilePillHeaderFile[];
  onFlightFilesSelected?: (files: File[]) => void;
  onFlightFileRemove?: (attachmentId: string) => void;
  onFlightAddManual?: () => void;
  /** Re-runs extraction on the edited flight's source attachment (sync icon). */
  onFlightReanalyze?: (attachmentId: string) => void;
  /** True while a flight re-analysis is running — spins the sync icon. */
  flightReanalyzing?: boolean;
  // Lodging
  lodgings?: LodgingCardProps[];
  lodgingLoading?: boolean;
  lodgingFiles?: FilePillHeaderFile[];
  onLodgingFilesSelected?: (files: File[]) => void;
  onLodgingFileRemove?: (attachmentId: string) => void;
  onLodgingAddManual?: () => void;
  onLodgingEdit?: (lodgingId: string) => void;
  onLodgingDelete?: (lodgingId: string) => void;
  onLodgingOpen?: (lodgingId: string) => void;
  onLodgingFormSubmit?: (data: LodgingFormData) => void;
  onLodgingEditSubmit?: (lodgingId: string, data: LodgingFormData) => void;
  /** Re-runs extraction on the edited lodging's source attachment (sync icon). */
  onLodgingReanalyze?: (attachmentId: string) => void;
  /** True while a lodging re-analysis is running — spins the sync icon. */
  lodgingReanalyzing?: boolean;
  // Expenses
  expenses?: Expense[];
  onExpenseCreate?: () => void;
  // Add Location
  onAddLocation?: (location: { name: string; address?: string; mapsLink?: string; latitude?: number; longitude?: number; category?: string; stayDuration?: number; startTime?: string; endTime?: string; place?: PlaceSearchResult }) => void;
  /** Re-scopes the open add-location form to a different day (header day-selector dropdown). */
  onAddLocationDayChange?: (dayId: string) => void;
  /** Runs a Google Places search for the add-location form (provided by the map). */
  onPlaceSearch?: (query: string) => Promise<PlaceSearchResult[]>;
  /** Resolves a pasted Google Maps link into a full place for the add-location form. */
  onResolveMapsLink?: (url: string) => Promise<PlaceSearchResult | null>;
  // Search Place (map search result preview)
  onAddSearchPlace?: (dayId: string, place: PlaceSearchResult) => void;
  /** True while a clicked search place is being enriched via Place Details. */
  searchPlaceDetailsLoading?: boolean;
  /** True while a place_id-only add's location is still being enriched server-side
   *  — the detail panel shows a skeleton body until the full row lands. */
  activityLocationLoading?: boolean;
  // Notes
  itineraryId?: string;
  timezone?: string;
  // Flight form
  onFlightFormSubmit?: (data: FlightFormData, expandDates?: boolean) => void;
  onFlightEditSubmit?: (flightId: string, data: FlightFormData, expandDates?: boolean) => void;
  onFlightEdit?: (flightId: string) => void;
  onFlightDelete?: (flightId: string) => void;
  onFlightOpen?: (flightId: string) => void;
  itineraryStartDate?: string;
  itineraryEndDate?: string;
  className?: string;
}

// ───── Search Place Preview ────────────────────────────────────────────────

/** Thin wrapper that adapts a live Google Places search result into the shared
 *  PlaceDetailsBlock used by the activity panel. The `pt-3` keeps the spacing
 *  the side panel had before this component shrank. */
function SearchPlacePreview({ place, loading = false }: { place: PlaceSearchResult; loading?: boolean }) {
  const view = placeSearchResultToPlaceView(place);
  view.loadingEnterprise = loading;
  return <PlaceDetailsBlock view={view} className="search-place-preview pt-3" />;
}

// ───── Helpers ───────────────────────────────────────────────────────────────

function getHeaderTitle(state: NonNullable<ItineraryPanelState>): string {
  switch (state.variant) {
    case "location": return state.activity.name ?? "Location";
    case "search-place": return state.place.name;
    case "collection": return "Collections";
    case "add-location": return "Add Location";
    case "flight": return "Flights";
    case "flight-form": return "Add Flight";
    case "flight-edit": return "Edit Flight";
    case "lodging": return "Lodging";
    case "lodging-form": return "Add Lodging";
    case "lodging-edit": return "Edit Lodging";
    case "bookings": return "Bookings";
    case "expenses": return "Expenses";
    case "notes": return "Notes";
  }
}

// ───── Source File Row (edit forms) ───────────────────────────────────────────

/** Flight/Lodging edit-form header row: the source booking file pill + a sync
 *  button that re-runs extraction on the stored attachment. */
function SourceFileRow({
  region,
  fileName,
  reanalyzing,
  onRemove,
  onReanalyze,
}: {
  region: string;
  fileName: string;
  reanalyzing?: boolean;
  onRemove?: () => void;
  onReanalyze?: () => void;
}) {
  return (
    <div data-region={region} className="edit-panel-source-file flex items-center gap-2 pt-3">
      <FilePill filename={fileName} onRemove={onRemove} className="edit-panel-source-file-pill min-w-0 flex-1" />
      <Button
        variant="ghost"
        size="sm"
        icon="only"
        aria-label="Re-analyze file"
        title="Re-analyze the uploaded file"
        onClick={onReanalyze}
        disabled={reanalyzing}
        className="edit-panel-reanalyze-button shrink-0"
      >
        <RefreshCw className={cn("edit-panel-reanalyze-icon size-4", reanalyzing && "animate-spin")} />
      </Button>
    </div>
  );
}

// ───── Add Location Panel ──────────────────────────────────────────────────

interface AddLocationData {
  name: string;
  address?: string;
  /** Pasted (or place-derived) Google Maps share link. */
  mapsLink?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
  stayDuration?: number;
  /** Activity start time on the selected day, "HH:MM". */
  startTime?: string;
  /** Activity end time on the selected day, "HH:MM". */
  endTime?: string;
  /** Full Places result when the user picked a search result (vs. manual free-text). */
  place?: PlaceSearchResult;
}

// ───── Add Location — V3 Helpers ──────────────────────────────────────────────

/**
 * Pure heuristic: returns true when the query looks more like a street address
 * than a place name. Used to drive the detection chip label in the smart field.
 */
function looksLikeAddress(q: string): boolean {
  const s = q.trim();
  if (!s) return false;
  if (/^\d+\s+\S/.test(s)) return true;
  if (/,\s*\S/.test(s) && /\d/.test(s)) return true;
  if (/\b(st|street|ave|avenue|rd|road|blvd|lane|ln|drive|dr|jalan|jln|highway|hwy)\b/i.test(s)) return true;
  return false;
}

/** Field wrapper with label above the control. */
function AddLocationField({
  label,
  required,
  htmlFor,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("add-location-field flex flex-1 flex-col gap-1.5 min-w-0", className)}>
      <label
        htmlFor={htmlFor}
        className="add-location-field-label type-body-3 font-medium text-content-secondary"
      >
        {label}
        {required && (
          <span className="add-location-field-required text-content-error ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

/** Boxed input built with the default variant. Accepts optional leading icon and trailing slot. */
function AddLocationBoxedInput({
  type = "text",
  placeholder,
  value,
  onChange,
  disabled,
  leadingIcon,
  trailingSlot,
  id,
  autoFocus,
  onFocus,
}: {
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  id?: string;
  autoFocus?: boolean;
  onFocus?: () => void;
}) {
  const hasLeading = Boolean(leadingIcon);
  const hasTrailing = Boolean(trailingSlot);
  const icon = hasLeading && hasTrailing ? "both" : hasLeading ? "leading" : hasTrailing ? "trailing" : "none";

  return (
    <div
      className={cn(
        "add-location-boxed-input",
        inputVariants({ variant: "default", size: "md", icon, hasValue: value.length > 0 }),
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      {/* Leading Icon */}
      {leadingIcon && (
        <span
          className="add-location-boxed-input-leading flex shrink-0 items-center justify-center size-5 text-content-secondary [&_svg]:size-4 [&_svg]:shrink-0"
          aria-hidden="true"
        >
          {leadingIcon}
        </span>
      )}

      {/* Input Control */}
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={onFocus}
        className={cn(inputControlVariants(), "add-location-boxed-input-control text-content font-medium")}
      />

      {/* Trailing Slot */}
      {trailingSlot && (
        <span className="add-location-boxed-input-trailing flex shrink-0 items-center gap-1.5">
          {trailingSlot}
        </span>
      )}
    </div>
  );
}


/** Minutes between two "HH:MM" times (positive only); null when either is unset. */
function durationBetween(start: string, end: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : null;
}

function AddLocationPanel({ onAdd, onPlaceSearch, onResolveMapsLink, onFormStateChange }: { onAdd?: (data: AddLocationData) => void; onPlaceSearch?: (query: string) => Promise<PlaceSearchResult[]>; onResolveMapsLink?: (url: string) => Promise<PlaceSearchResult | null>; onFormStateChange?: (state: { canSubmit: boolean; resolving: boolean }) => void }) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [mapsLink, setMapsLink] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // Places search state. `selectedPlace` is set once the user picks a result; while it's
  // set the field is "locked" to that place and no further searches fire until cleared.
  const [selectedPlace, setSelectedPlace] = useState<PlaceSearchResult | null>(null);
  // Which detail the user anchored on when picking a result. Drives the symmetric
  // display: search by address → show the address in the field + the name below;
  // search by name → show the name in the field + the address below.
  const [resolvedMode, setResolvedMode] = useState<"name" | "address">("name");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const searchRunIdRef = useRef(0);

  // Google Maps link resolution state. `lastResolvedLinkRef` tracks the URL we
  // already resolved (or the canonical link a resolved place wrote back) so the
  // debounced effect doesn't re-fire on its own write-back.
  const [resolvingLink, setResolvingLink] = useState(false);
  const lastResolvedLinkRef = useRef<string | null>(null);
  const resolveRunIdRef = useRef(0);

  // Submit is gated on Name + Start time; report validity + resolve-in-flight up
  // so the parent footer can disable/spin the "Add Location" button.
  const canSubmit = name.trim().length > 0 && startTime.length > 0;
  useEffect(() => {
    onFormStateChange?.({ canSubmit, resolving: resolvingLink });
  }, [canSubmit, resolvingLink, onFormStateChange]);
  useEffect(() => () => onFormStateChange?.({ canSubmit: false, resolving: false }), [onFormStateChange]);

  // Debounced search: ~400ms after typing stops, run a Places search for the typed name.
  // Skips while a place is selected, when no runner is available, or for tiny queries.
  useEffect(() => {
    const query = name.trim();
    if (!onPlaceSearch || selectedPlace || query.length < 2) {
      setResults([]);
      setSearching(false);
      setHasSearched(false);
      return;
    }
    const runId = ++searchRunIdRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      onPlaceSearch(query)
        .then((places) => {
          if (runId !== searchRunIdRef.current) return;
          setResults(places);
          setHasSearched(true);
        })
        .catch((e) => {
          if (runId !== searchRunIdRef.current) return;
          console.error("[add-location search]", e);
          setResults([]);
          setHasSearched(true);
        })
        .finally(() => {
          if (runId === searchRunIdRef.current) setSearching(false);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [name, selectedPlace, onPlaceSearch]);

  // Picking a search result (or a resolved Maps link) fills Name + Address + the
  // Google Maps Link from the place. Marking the written link as "already resolved"
  // keeps the link-resolve effect from re-firing on this write-back.
  const handleSelectPlace = useCallback((place: PlaceSearchResult, mode: "name" | "address" = "name") => {
    searchRunIdRef.current += 1; // cancel any in-flight search
    setSelectedPlace(place);
    setResolvedMode(place.address ? mode : "name"); // can't anchor on a missing address
    setName(place.name);
    setAddress(place.address ?? "");
    if (place.googleMapsUri) {
      setMapsLink(place.googleMapsUri);
      lastResolvedLinkRef.current = place.googleMapsUri;
    }
    setResults([]);
    setShowResults(false);
    setSearching(false);
    setHasSearched(false);
  }, []);

  // Debounced Google Maps link resolution: ~600ms after the link field settles on
  // a plausible Maps URL we haven't resolved yet, resolve it to a full place and
  // fill the form via handleSelectPlace. Skips the canonical link a resolved place
  // wrote back (lastResolvedLinkRef) so it doesn't loop.
  useEffect(() => {
    const url = mapsLink.trim();
    if (!onResolveMapsLink || !url) {
      setResolvingLink(false);
      return;
    }
    if (url === lastResolvedLinkRef.current || !looksLikeGoogleMapsUrl(url)) {
      setResolvingLink(false);
      return;
    }

    const runId = ++resolveRunIdRef.current;
    setResolvingLink(true);
    const timer = setTimeout(() => {
      onResolveMapsLink(url)
        .then((place) => {
          if (runId !== resolveRunIdRef.current) return;
          // Remember this URL either way so a bad link doesn't re-fire the toast
          // every render — the user edits the field to retry.
          lastResolvedLinkRef.current = url;
          if (place) {
            handleSelectPlace(place);
          } else {
            showToast({ variant: "error", title: "We couldn't find a place for that Google Maps link." });
          }
        })
        .catch((e) => {
          if (runId !== resolveRunIdRef.current) return;
          lastResolvedLinkRef.current = url;
          console.error("[add-location resolve link]", e);
          showToast({ variant: "error", title: getFriendlyApiError(e, "We couldn't read that Google Maps link.") });
        })
        .finally(() => {
          if (runId === resolveRunIdRef.current) setResolvingLink(false);
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      // Invalidate this run so an already-dispatched resolve that settles after the
      // effect re-runs or the panel unmounts can't fire a stray toast / select.
      resolveRunIdRef.current += 1;
    };
  }, [mapsLink, onResolveMapsLink, handleSelectPlace, showToast]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !startTime) return;
      // When no place was selected from search and the query looks like an address,
      // promote the typed value to the address field as well as name.
      const submittedAddress = address.trim() || (selectedPlace ? undefined : looksLikeAddress(name) ? name.trim() : undefined);
      onAdd?.({
        name: name.trim(),
        address: submittedAddress,
        mapsLink: mapsLink.trim() || undefined,
        stayDuration: durationBetween(startTime, endTime) ?? undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        place: selectedPlace ?? undefined,
      });
      setName("");
      setAddress("");
      setMapsLink("");
      setStartTime("");
      setEndTime("");
      setSelectedPlace(null);
      setResults([]);
      setShowResults(false);
      setHasSearched(false);
      setResolvingLink(false);
      lastResolvedLinkRef.current = null;
    },
    [name, address, mapsLink, startTime, endTime, selectedPlace, onAdd],
  );

  // Detection chip label — only shown while there is text and no selected place
  const detectionLabel = name.trim() && !selectedPlace
    ? looksLikeAddress(name) ? "Address" : "Name"
    : null;

  // What the field shows: while typing it's the query (`name`); once a place is
  // picked it mirrors what the user anchored on — the address when they searched
  // by address, otherwise the name.
  const fieldValue = selectedPlace && resolvedMode === "address" ? address : name;

  // The complement of what's in the field — the name when the field shows the
  // address, otherwise the address.
  const resolvedDetail = selectedPlace
    ? resolvedMode === "address" ? selectedPlace.name : selectedPlace.address
    : null;

  return (
    <form id="add-location-form" onSubmit={handleSubmit} className="add-location-form flex flex-col gap-3.5 px-4 py-3">

      {/* Smart Place Field — merged Name + Address with live type detection */}
      <AddLocationField label="Place" required htmlFor="add-location-place-input">
        <div className="add-location-smart-field relative">

          {/* Boxed Input Row */}
          <AddLocationBoxedInput
            id="add-location-place-input"
            type="text"
            placeholder="Search a place, name, or address…"
            value={fieldValue}
            autoFocus
            onChange={(v) => {
              setName(v);
              if (selectedPlace) { setSelectedPlace(null); setResolvedMode("name"); }
              setShowResults(true);
            }}
            onFocus={() => { if (!selectedPlace) setShowResults(true); }}
            leadingIcon={<Search />}
            trailingSlot={
              <>
                {/* Detection Chip — visible while typing before a place is selected */}
                {detectionLabel && (
                  <span
                    aria-live="polite"
                    className="add-location-detection-chip type-body-4 font-medium text-content-secondary bg-surface-muted rounded-full px-2 py-0.5 select-none whitespace-nowrap"
                  >
                    {detectionLabel}
                  </span>
                )}
                {/* Spinner while searching */}
                {searching ? (
                  <Loader2 className="add-location-search-spinner size-4 shrink-0 animate-spin text-content-secondary" />
                ) : null}
              </>
            }
          />

          {/* Resolved Detail Helper — the complement of what's in the field
              (field = address → the place name; field = name → the address). */}
          {resolvedDetail && (
            <div
              data-region="add-location-resolved-detail"
              className="add-location-resolved-detail mt-1.5 flex items-center gap-1"
            >
              <MapPin className="size-3.5 shrink-0 text-content-tertiary" aria-hidden="true" />
              <span className="type-body-3 font-normal text-content-tertiary truncate">{resolvedDetail}</span>
            </div>
          )}

          {/* Search Results Dropdown */}
          {onPlaceSearch && showResults && !selectedPlace && (searching || results.length > 0 || hasSearched) && (
            <div className="add-location-search-results absolute inset-x-0 top-full z-20 mt-1 max-h-[280px] overflow-y-auto scrollbar-none rounded-xl border border-edge bg-surface shadow-lg">
              {results.length > 0 ? (
                results.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => handleSelectPlace(place, looksLikeAddress(name) ? "address" : "name")}
                    className="add-location-search-result flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:bg-surface-muted"
                  >
                    {place.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={place.photoUrl} alt="" className="add-location-search-result-thumb size-10 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="add-location-search-result-thumb-placeholder flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-alt">
                        <MapPin className="add-location-search-result-thumb-icon size-4 text-content-tertiary" />
                      </div>
                    )}
                    <div className="add-location-search-result-info flex min-w-0 flex-col">
                      <span className="add-location-search-result-name type-body-2 font-medium text-content truncate">{place.name}</span>
                      {place.address && (
                        <span className="add-location-search-result-meta type-body-3 text-content-tertiary truncate">
                          {place.address}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                !searching && hasSearched && (
                  <p className="add-location-search-empty type-body-3 text-content-tertiary py-3 text-center">No places found</p>
                )
              )}
            </div>
          )}
        </div>
      </AddLocationField>

      {/* Start / End Times — boxed pickers directly under the smart field */}
      <div className="add-location-times-row flex gap-3">
        <AddLocationField label="Start" required htmlFor="add-location-start-time">
          <TypeableTimePicker
            value={startTime}
            onChange={(v) => {
              setStartTime(v);
              // Clear an End that's now at/before the new Start so the trigger
              // never shows an invalid time the End menu no longer offers.
              const endH = fromHHMM(endTime);
              const startH = fromHHMM(v);
              if (endH != null && startH != null && endH <= startH) setEndTime("");
            }}
            placeholder="HH:MM"
          />
        </AddLocationField>
        <AddLocationField label="End" htmlFor="add-location-end-time">
          <TypeableTimePicker
            value={endTime}
            onChange={setEndTime}
            placeholder="HH:MM"
            minTime={startTime}
          />
        </AddLocationField>
      </div>

      {/* Or Divider */}
      <div className="add-location-or-divider flex items-center gap-3 py-0.5">
        <span className="h-px flex-1 bg-edge-subtle" />
        <span className="type-body-4 font-medium uppercase tracking-wide text-content-tertiary">or</span>
        <span className="h-px flex-1 bg-edge-subtle" />
      </div>

      {/* Paste Google Maps Link — standout alternative card */}
      <div
        data-region="add-location-maps-link"
        className="add-location-maps-card rounded-xl border border-edge bg-surface-alt p-2 flex flex-col gap-2"
      >
        {/* Card Header */}
        <div className="add-location-maps-card-header flex items-center gap-2">
          {/* Icon Tile */}
          <div className="add-location-maps-card-icon-tile flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
            <Link2 className="size-4 text-content-secondary" aria-hidden="true" />
          </div>
          {/* Title + Helper */}
          <div className="add-location-maps-card-copy flex flex-col">
            <span className="type-body-2 font-medium text-content">Paste a Google Maps link</span>
            <span className="type-body-4 text-content-tertiary">We&apos;ll detect the place automatically</span>
          </div>
        </div>

        {/* Maps Link Input */}
        <div className="add-location-maps-card-input flex flex-col gap-1">
          <AddLocationBoxedInput
            id="add-location-maps-link"
            type="url"
            placeholder="https://maps.app.goo.gl/…"
            value={mapsLink}
            onChange={setMapsLink}
            disabled={resolvingLink}
          />
          {resolvingLink && (
            <span className="add-location-link-status flex items-center gap-1.5 type-body-3 text-content-secondary">
              <Loader2 className="size-3 animate-spin" />
              Looking up place…
            </span>
          )}
        </div>
      </div>
    </form>
  );
}

// ───── Component ─────────────────────────────────────────────────────────────

export function ItinerarySidePanel({
  state,
  onClose,
  onBack,
  onAddToDay,
  onActivityTimeChange,
  activityDaySiblings,
  onAddSearchPlace,
  searchPlaceDetailsLoading,
  activityLocationLoading,
  activityNote,
  onActivityNoteSave,
  onActivityNoteClear,
  notesActivityNotes,
  onNotesActivityClick,
  onActivityAddAttachment,
  onActivityToggleLock,
  onActivityDelete,
  availableDays = [],
  activityAttachments = [],
  activityIsLocked = false,
  phone,
  website,
  collections = [],
  collectionsLoading,
  itineraryCollection,
  itineraryHomeCollection,
  itineraryLocationIds,
  onLocationSelect,
  onCollectionChange,
  flights = [],
  flightLoading,
  flightFiles,
  onFlightFilesSelected,
  onFlightFileRemove,
  onFlightAddManual,
  onFlightReanalyze,
  flightReanalyzing,
  lodgings = [],
  lodgingLoading,
  lodgingFiles,
  onLodgingFilesSelected,
  onLodgingFileRemove,
  onLodgingAddManual,
  onLodgingEdit,
  onLodgingDelete,
  onLodgingOpen,
  onLodgingFormSubmit,
  onLodgingEditSubmit,
  onLodgingReanalyze,
  lodgingReanalyzing,
  expenses = [],
  onExpenseCreate,
  onAddLocation,
  onAddLocationDayChange,
  onPlaceSearch,
  onResolveMapsLink,
  itineraryId,
  timezone,
  onFlightFormSubmit,
  onFlightEditSubmit,
  onFlightEdit,
  onFlightDelete,
  onFlightOpen,
  itineraryStartDate,
  itineraryEndDate,
  className,
}: ItinerarySidePanelProps) {
  const prefersReducedMotion = useReducedMotion();
  const noteBackRef = useRef<(() => void) | null>(null);
  const notesTabBackRef = useRef<(() => void) | null>(null);
  const notesTabDeleteRef = useRef<(() => void) | null>(null);
  const [isEditingTabNote, setIsEditingTabNote] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [showItineraryActivities, setShowItineraryActivities] = useState(true);
  const [collectionSearch, setCollectionSearch] = useState("");
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const flightFileInputRef = useRef<HTMLInputElement>(null);
  const lodgingFileInputRef = useRef<HTMLInputElement>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  // Add-location form validity + resolve-in-flight, reported up by AddLocationPanel
  // so the footer "Add Location" button can gate/spin (it lives outside that form).
  const [addLocationForm, setAddLocationForm] = useState({ canSubmit: false, resolving: false });
  const handleAddLocationFormState = useCallback(
    (s: { canSubmit: boolean; resolving: boolean }) => setAddLocationForm(s),
    [],
  );
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const prevVariantRef = useRef(state?.variant ?? null);
  const staggerActivityRef = useRef<ItineraryActivityDetail | undefined>(undefined);
  const [staggerDirection, setStaggerDirection] = useState<"in" | "out" | null>(null);
  const didStaggerInRef = useRef(false);
  const justFinishedStaggerRef = useRef(false);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const accepted = files.filter(
        (f) => f.type === "application/pdf" || f.name.endsWith(".pdf") || f.type.startsWith("image/"),
      );
      if (accepted.length === 0) return;
      if (state?.variant === "lodging") {
        onLodgingFilesSelected?.(accepted);
      } else {
        onFlightFilesSelected?.(accepted);
      }
    },
    [onFlightFilesSelected, onLodgingFilesSelected, state?.variant],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    // Ignore drags that don't carry files (e.g., text selections, image drags from the page)
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      // Primary path: dataTransfer.files (works for File Explorer on most platforms)
      const files: File[] = Array.from(e.dataTransfer.files ?? []);

      // Windows fallback: Outlook attachments and OneDrive synced files often only
      // appear in dataTransfer.items with kind === "file".
      if (files.length === 0 && e.dataTransfer.items) {
        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }

      handleFiles(files);
    },
    [handleFiles],
  );

  const variant = state?.variant;

  // Reset drag tracking when the user switches between flight/lodging mid-drag
  // (counter would otherwise leak across variants and leave the overlay stuck).
  useEffect(() => {
    dragCounter.current = 0;
    setIsDragging(false);
  }, [variant]);

  useEffect(() => {
    const prev = prevVariantRef.current;
    const curr = state?.variant ?? null;
    const isFromCollection = state?.variant === "location" && state.from === "collection";

    if (prev === "collection" && curr === "location" && isFromCollection) {
      staggerActivityRef.current = state.activity;
      setStaggerDirection("in");
      didStaggerInRef.current = true;
    } else if (prev === "location" && curr === "collection" && didStaggerInRef.current) {
      setStaggerDirection("out");
      didStaggerInRef.current = false;
    } else {
      didStaggerInRef.current = false;
    }

    prevVariantRef.current = curr;
  }, [state]);

  const staggerActivity =
    staggerDirection === "in" && state?.variant === "location"
      ? state.activity
      : staggerActivityRef.current;

  useEffect(() => {
    if (justFinishedStaggerRef.current) {
      justFinishedStaggerRef.current = false;
    }
  });

  // Leaving an activity (or the location variant) closes the note editor so the
  // next activity opens on its detail view, not mid-edit. Must run before the
  // early return below to keep hook order stable.
  const focusedActivityId = state?.variant === "location" ? state.activity.id : undefined;
  useEffect(() => {
    setIsEditingNote(false);
  }, [focusedActivityId, variant]);

  if (!state) return null;

  const isStaggering = staggerDirection !== null;
  const title = getHeaderTitle(state);
  const activity = state.variant === "location" ? state.activity : undefined;

  // A location opened from the collection panel is a synthetic preview — it isn't a
  // real activity in this itinerary yet (no day, empty `day_id`). Its primary action
  // is "Add to day" (which schedules it and pools it into this itinerary's
  // collection), and the activity-only chrome — notes, attachments, lock, delete —
  // stays hidden until it's actually scheduled here.
  const isCollectionPreview = state.variant === "location" && state.from === "collection";

  // Add-location header shows the target day with a selector dropdown ("4 June ▾").
  const addLocationDayLabel =
    state.variant === "add-location"
      ? availableDays.find((d) => d.id === state.dayId)?.label ?? "Add Location"
      : "Add Location";

  // Edit forms show the source booking file (pill + sync) when the entry came
  // from an extracted attachment. Resolve the filename from the panel's file list.
  const editFlight = state.variant === "flight-edit" ? flights.find((f) => f.id === state.flightId) : undefined;
  const editFlightAttachmentId = editFlight?.sourceAttachmentId ?? null;
  const editFlightFileName = editFlightAttachmentId
    ? flightFiles?.find((f) => f.id === editFlightAttachmentId)?.name
    : undefined;
  const editLodging = state.variant === "lodging-edit" ? lodgings.find((a) => a.id === state.lodgingId) : undefined;
  const editLodgingAttachmentId = editLodging?.sourceAttachmentId ?? null;
  const editLodgingFileName = editLodgingAttachmentId
    ? lodgingFiles?.find((f) => f.id === editLodgingAttachmentId)?.name
    : undefined;

  const isFlightEmpty = variant === "flight" && flights.length === 0;
  const isLodgingEmpty = variant === "lodging" && lodgings.length === 0;
  const isEmptyDropTarget = isFlightEmpty || isLodgingEmpty;

  const handleEmptyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEmptyDropTarget) return;
    // Don't fire when the click landed on an existing interactive descendant
    // (the empty-state Upload button, Switch, close button, etc.).
    const target = e.target as HTMLElement;
    if (target.closest('button, input, a, label, select, textarea, [role="button"]')) return;
    if (isFlightEmpty) flightFileInputRef.current?.click();
    else if (isLodgingEmpty) lodgingFileInputRef.current?.click();
  };

  return (
    <div
      data-slot="edit-panel"
      data-variant={variant}
      className={cn(
        "edit-panel @container/panel relative flex flex-col h-full rounded-2xl border border-edge bg-surface overflow-hidden shadow-default",
        isEmptyDropTarget && "cursor-pointer",
        className,
      )}
      onDragEnter={variant === "flight" || variant === "lodging" ? handleDragEnter : undefined}
      onDragLeave={variant === "flight" || variant === "lodging" ? handleDragLeave : undefined}
      onDragOver={variant === "flight" || variant === "lodging" ? handleDragOver : undefined}
      onDrop={variant === "flight" || variant === "lodging" ? handleDrop : undefined}
      onClick={isEmptyDropTarget ? handleEmptyClick : undefined}
    >
      {/* Header */}
      <div
        data-region="itinerary-edit-panel-header"
        className={cn(
        "edit-panel-header flex items-center justify-between p-4 h-[68px] shrink-0 sticky top-0 z-10 transition-colors overflow-visible",
        (variant === "location" && !isStaggering) || (variant === "notes" && isEditingTabNote) ? "bg-surface-alt" : "bg-surface",
      )}>
        {variant === "location" ? (
          <div className="edit-panel-title-row flex items-center gap-2 min-w-0">
            <Button variant="outline" size="sm" icon="only" onClick={isEditingNote ? () => noteBackRef.current?.() : onBack} aria-label="Back">
              <ChevronLeft className="edit-panel-location-back-icon size-4" />
            </Button>
            <span className="edit-panel-title type-body-2 font-semibold text-content truncate shrink">{title}</span>
          </div>
        ) : variant === "collection" ? (
          <div className="edit-panel-collection-header flex items-center gap-1 min-w-0">
          <Menu open={collectionMenuOpen} onOpenChange={setCollectionMenuOpen}>
            {/* Collection Selector Trigger — thumbnail + name + chevron, no hover */}
            <MenuTrigger className="edit-panel-collection-selector flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 outline-none">
              {itineraryCollection?.thumbnail_url ? (
                <img src={itineraryCollection.thumbnail_url} alt="" className="edit-panel-collection-selector-thumb size-7 rounded-md object-cover" />
              ) : (
                <div className="edit-panel-collection-selector-thumb-placeholder size-7 rounded-md bg-surface-alt" />
              )}
              <span className="edit-panel-collection-selector-name type-body-2 font-semibold text-content truncate max-w-[160px]">{itineraryCollection?.name ?? "Collections"}</span>
              <ChevronDown className="edit-panel-collection-selector-chevron size-4 text-content-secondary shrink-0" />
            </MenuTrigger>
            <MenuContent side="bottom" align="start" sideOffset={4} className="edit-panel-collection-menu w-[296px]">
              {/* Itinerary's Home Collection — always returns the user to the itinerary's own collection */}
              {itineraryHomeCollection && (
                <AlsoInCard
                  className="edit-panel-collection-home w-full"
                  role="button"
                  title={itineraryHomeCollection.name}
                  count={itineraryHomeCollection.locations.length}
                  countLabel="Locations"
                  thumbnailUrl={itineraryHomeCollection.thumbnail_url ?? undefined}
                  onClick={() => {
                    onCollectionChange?.(itineraryHomeCollection.id);
                    setCollectionSearch("");
                    setCollectionMenuOpen(false);
                  }}
                />
              )}

              {/* Separator */}
              <MenuSeparator />

              {/* Search */}
              <div className="edit-panel-collection-search-wrap p-3">
                <div className="edit-panel-collection-search flex h-10 items-center gap-1.5 rounded-full border border-edge px-2">
                  <Search className="edit-panel-collection-search-icon size-4 text-content-tertiary shrink-0" />
                  <input
                    type="text"
                    placeholder="Search"
                    value={collectionSearch}
                    onChange={(e) => {
                      e.stopPropagation();
                      setCollectionSearch(e.target.value);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="edit-panel-collection-search-input flex-1 bg-transparent type-body-2 text-content placeholder:text-content-placeholder outline-none"
                  />
                </div>
              </div>

              {/* Others Label */}
              <div className="edit-panel-collection-others flex items-center px-3">
                <p className="edit-panel-collection-others-label type-body-2 text-content-secondary">Others</p>
              </div>

              {/* Others List */}
              <div className="edit-panel-collection-list max-h-[280px] overflow-y-auto scrollbar-none flex flex-col gap-1">
                {collections
                  .filter((c) => c.id !== itineraryHomeCollection?.id && c.name.toLowerCase().includes(collectionSearch.toLowerCase()))
                  .map((collection) => (
                    <AlsoInCard
                      key={collection.id}
                      className="edit-panel-collection-item w-full"
                      role="button"
                      title={collection.name}
                      type="Collection"
                      count={collection.location_count}
                      countLabel="Locations"
                      thumbnailUrl={collection.thumbnail_url ?? undefined}
                      onClick={() => {
                        onCollectionChange?.(collection.id);
                        setCollectionSearch("");
                        setCollectionMenuOpen(false);
                      }}
                    />
                  ))}
                {collections.filter((c) => c.id !== itineraryHomeCollection?.id && c.name.toLowerCase().includes(collectionSearch.toLowerCase())).length === 0 && (
                  <p className="edit-panel-collection-empty type-body-3 text-content-tertiary text-center py-4">No collections found</p>
                )}
              </div>
            </MenuContent>
          </Menu>
          </div>
        ) : variant === "add-location" ? (
          <div className="edit-panel-title-row flex items-center gap-2 min-w-0">
            <Button variant="outline" size="sm" icon="only" onClick={onBack} aria-label="Back">
              <ChevronLeft className="edit-panel-back-button-icon size-4" />
            </Button>
            {/* Day Selector — re-scopes the form to another day */}
            <Menu>
              <MenuTrigger className="edit-panel-add-location-day-selector flex items-center gap-1 rounded-lg py-1 pl-2 pr-1.5 outline-none cursor-pointer">
                <span className="edit-panel-add-location-day-label type-body-2 font-semibold text-content truncate max-w-[160px]">{addLocationDayLabel}</span>
                <ChevronDown className="edit-panel-add-location-day-chevron size-4 text-content-secondary shrink-0" />
              </MenuTrigger>
              <MenuContent side="bottom" align="start" sideOffset={4} className="edit-panel-add-location-day-menu w-[200px]">
                {availableDays.map((day) => (
                  <MenuItem
                    key={day.id}
                    size="lg"
                    selected={state.variant === "add-location" && state.dayId === day.id}
                    onClick={() => onAddLocationDayChange?.(day.id)}
                  >
                    <span className="type-body-2 text-content">{day.label}</span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          </div>
        ) : variant === "flight-form" || variant === "flight-edit" || variant === "lodging-form" || variant === "lodging-edit" ? (
          <div className="edit-panel-title-row flex items-center gap-2 min-w-0">
            <Button variant="outline" size="sm" icon="only" onClick={onBack} aria-label="Back">
              <ChevronLeft className="edit-panel-back-button-icon size-4" />
            </Button>
            <span className="edit-panel-back-title type-body-2 font-semibold text-content truncate max-w-[200px]">{title}</span>
          </div>
        ) : variant === "notes" && isEditingTabNote ? (
          <div className="edit-panel-title-row flex items-center gap-2 min-w-0">
            <Button variant="outline" size="sm" icon="only" onClick={() => notesTabBackRef.current?.()} aria-label="Back">
              <ChevronLeft className="edit-panel-notes-back-icon size-4" />
            </Button>
            <span className="edit-panel-notes-title type-body-2 font-semibold text-content truncate">{title}</span>
          </div>
        ) : (
          <span className="edit-panel-default-title type-body-2 font-semibold text-content truncate max-w-[200px] py-2 pl-2">{title}</span>
        )}
        <div className="edit-panel-header-actions flex items-center gap-2 shrink-0">
          {variant === "collection" && (
            <>
              <span className="edit-panel-collection-toggle-label type-body-2 text-content-secondary whitespace-nowrap">Show in Itinerary</span>
              <Switch
                size="sm"
                checked={showItineraryActivities}
                onCheckedChange={setShowItineraryActivities}
                label="Show in Itinerary"
              />
            </>
          )}
          {state.variant === "location" && !isCollectionPreview && (
            <>
              {/* Panel Controls — inline (collapses to a kebab when the panel is narrow) */}
              <div className="edit-panel-location-controls hidden items-center @[400px]/panel:flex">
                {onActivityToggleLock && (
                  <Button variant="ghost" size="sm" icon="only" onClick={onActivityToggleLock} aria-label={activityIsLocked ? "Unlock" : "Lock"}>
                    <span className="relative size-4">
                      <AnimatePresence initial={false}>
                        <motion.span
                          key={activityIsLocked ? "locked" : "unlocked"}
                          className="absolute inset-0"
                          {...(prefersReducedMotion ? {} : motionPresets.iconSwap)}
                          transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.iconSwap}
                        >
                          {activityIsLocked ? <Lock className="edit-panel-lock-icon size-4" /> : <Unlock className="edit-panel-unlock-icon size-4" />}
                        </motion.span>
                      </AnimatePresence>
                    </span>
                  </Button>
                )}
                {onActivityDelete && (
                  <Button variant="ghost" size="sm" icon="only"
                    onClick={() => setDeleteConfirm({
                      title: "Remove activity",
                      message: "Are you sure you want to remove this activity from your itinerary?",
                      onConfirm: onActivityDelete,
                    })}
                    aria-label="Delete activity"
                  >
                    <Trash2 className="edit-panel-delete-activity-icon size-4" />
                  </Button>
                )}
              </div>
              {/* Panel Controls — kebab (narrow) */}
              <Menu>
                <MenuTrigger render={<Button variant="ghost" size="sm" icon="only" className="edit-panel-controls-kebab flex @[400px]/panel:hidden" aria-label="More options" />}>
                  <MoreVertical className="edit-panel-controls-kebab-icon size-4" />
                </MenuTrigger>
                <MenuContent side="bottom" align="end" sideOffset={4} className="edit-panel-controls-menu w-[160px]">
                  {onActivityToggleLock && (
                    <MenuItem icon="leading" leadingIcon={activityIsLocked ? <Lock className="size-4" /> : <Unlock className="size-4" />} onClick={onActivityToggleLock}>
                      <span className="type-body-2 text-content">{activityIsLocked ? "Unlock" : "Lock"}</span>
                    </MenuItem>
                  )}
                  {onActivityDelete && (
                    <MenuItem variant="destructive" icon="leading" leadingIcon={<Trash2 className="size-4" />}
                      onClick={() => setDeleteConfirm({
                        title: "Remove activity",
                        message: "Are you sure you want to remove this activity from your itinerary?",
                        onConfirm: onActivityDelete,
                      })}
                    >
                      Delete
                    </MenuItem>
                  )}
                </MenuContent>
              </Menu>
            </>
          )}
          {variant === "notes" && isEditingTabNote && (
            <Button variant="ghost" size="sm" icon="only"
              onClick={() => setDeleteConfirm({
                title: "Delete note",
                message: "Are you sure you want to delete this note? This action cannot be undone.",
                onConfirm: () => notesTabDeleteRef.current?.(),
              })}
              aria-label="Delete note"
            >
              <Trash2 className="edit-panel-delete-tab-note-icon size-4" />
            </Button>
          )}
          {variant === "location" ? (
            <Button variant="ghost" size="sm" icon="only"
              onClick={onClose}
              className="edit-panel-close-button"
              aria-label="Close panel"
            >
              <PanelLeftClose className="edit-panel-close-panel-icon size-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon="only"
              onClick={onClose}
              className="edit-panel-close-button"
              aria-label="Close panel"
            >
              <PanelLeftClose className="edit-panel-close-icon size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={state.variant}
          initial={justFinishedStaggerRef.current || prefersReducedMotion ? false : motionPresets.panelContent.initial}
          animate={motionPresets.panelContent.animate}
          exit={prefersReducedMotion ? { opacity: 0 } : motionPresets.panelContent.exit}
          transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.spatial}
          className={cn(
            "edit-panel-content flex-1 min-h-0 overflow-y-auto scrollbar-none px-3 pb-3",
            (variant === "location" || (variant === "notes" && isEditingTabNote)) && "bg-surface-alt",
          )}
        >
            {variant === "location" && activity ? (
              <LocationDetailPanel
                activity={activity}
                timezone={timezone}
                loading={activityLocationLoading}
                currentItineraryId={itineraryId}
                attachments={activityAttachments}
                phone={phone}
                website={website}
                onTimeChange={onActivityTimeChange}
                dayActivities={activityDaySiblings}
                noteEditing={isEditingNote}
                note={activityNote}
                onNoteSave={onActivityNoteSave}
                onNoteClear={onActivityNoteClear}
                onEditingNoteChange={setIsEditingNote}
                noteBackRef={noteBackRef}
              />
            ) : variant === "search-place" && state.variant === "search-place" ? (
              <SearchPlacePreview place={state.place} loading={searchPlaceDetailsLoading} />
            ) : variant === "collection" ? (
              <CollectionPanel
                collections={collections}
                loading={collectionsLoading}
                itineraryCollection={itineraryCollection}
                itineraryLocationIds={itineraryLocationIds}
                showItineraryActivities={showItineraryActivities}
                onLocationSelect={onLocationSelect}
                onClose={onClose}
              />
            ) : variant === "flight" ? (
              <FlightTab
                flights={flights}
                loading={flightLoading}
                files={flightFiles}
                onAddFile={() => flightFileInputRef.current?.click()}
                onRemoveFile={onFlightFileRemove}
                onAddManual={onFlightAddManual}
                onFlightEdit={onFlightEdit}
                onFlightDelete={onFlightDelete}
                onFlightOpen={onFlightOpen}
              />
            ) : variant === "flight-form" ? (
              <FlightForm
                itineraryStartDate={itineraryStartDate}
                itineraryEndDate={itineraryEndDate}
                onSubmit={(data, expand) => onFlightFormSubmit?.(data, expand)}
              />
            ) : variant === "flight-edit" && state.variant === "flight-edit" ? (
              <>
              {editFlightAttachmentId && editFlightFileName && (
                <SourceFileRow
                  region="itinerary-edit-panel-flight-source"
                  fileName={editFlightFileName}
                  reanalyzing={flightReanalyzing}
                  onRemove={onFlightFileRemove ? () => onFlightFileRemove(editFlightAttachmentId) : undefined}
                  onReanalyze={() => onFlightReanalyze?.(editFlightAttachmentId)}
                />
              )}
              <FlightForm
                key={state.flightId}
                initialData={(() => {
                  const f = flights.find(fl => fl.id === state.flightId);
                  if (!f) return undefined;
                  return {
                    fromCode: f.fromCode,
                    fromCity: f.fromCity,
                    toCode: f.toCode,
                    toCity: f.toCity,
                    flightNumber: f.flightNumber,
                    departDate: f.departDate ?? "",
                    departTime: f.departTime ?? "",
                    arriveDate: f.arriveDate ?? "",
                    arriveTime: f.arriveTime ?? "",
                    airline: f.airline,
                    fareClass: f.fareClass,
                    cost: f.cost,
                    currency: f.currency,
                    confirmation: f.confirmation,
                    terminal: f.terminal,
                    baggageAllowance: f.baggageAllowance,
                    ticketNumber: f.ticketNumber,
                  };
                })()}
                itineraryStartDate={itineraryStartDate}
                itineraryEndDate={itineraryEndDate}
                onSubmit={(data, expand) => onFlightEditSubmit?.(state.flightId, data, expand)}
              />
              </>
            ) : variant === "lodging" ? (
              <LodgingTab
                lodgings={lodgings}
                loading={lodgingLoading}
                files={lodgingFiles}
                onAddFile={() => lodgingFileInputRef.current?.click()}
                onRemoveFile={onLodgingFileRemove}
                onAddManual={onLodgingAddManual}
                onLodgingEdit={onLodgingEdit}
                onLodgingDelete={onLodgingDelete}
                onLodgingOpen={onLodgingOpen}
              />
            ) : variant === "lodging-form" ? (
              <LodgingForm
                onSubmit={(data) => onLodgingFormSubmit?.(data)}
              />
            ) : variant === "lodging-edit" && state.variant === "lodging-edit" ? (
              <>
              {editLodgingAttachmentId && editLodgingFileName && (
                <SourceFileRow
                  region="itinerary-edit-panel-lodging-source"
                  fileName={editLodgingFileName}
                  reanalyzing={lodgingReanalyzing}
                  onRemove={onLodgingFileRemove ? () => onLodgingFileRemove(editLodgingAttachmentId) : undefined}
                  onReanalyze={() => onLodgingReanalyze?.(editLodgingAttachmentId)}
                />
              )}
              <LodgingForm
                key={state.lodgingId}
                imageUrl={editLodging?.image}
                initialData={(() => {
                  const a = lodgings.find(ac => ac.id === state.lodgingId);
                  if (!a) return undefined;
                  return {
                    name: a.name,
                    address: a.address,
                    checkInDate: a.checkInDate ?? "",
                    checkInTime: a.checkInTimeRaw ?? "",
                    checkOutDate: a.checkOutDate ?? "",
                    checkOutTime: a.checkOutTimeRaw ?? "",
                    confirmation: a.confirmation,
                    cost: a.cost,
                    currency: a.currency,
                  };
                })()}
                onSubmit={(data) => onLodgingEditSubmit?.(state.lodgingId, data)}
              />
              </>
            ) : variant === "add-location" ? (
              <AddLocationPanel
                onAdd={(loc) => onAddLocation?.(loc)}
                onPlaceSearch={onPlaceSearch}
                onResolveMapsLink={onResolveMapsLink}
                onFormStateChange={handleAddLocationFormState}
              />
            ) : variant === "bookings" ? (
              <BookingsTab />
            ) : variant === "expenses" ? (
              <ExpensesTab expenses={expenses} onAddExpense={onExpenseCreate} />
            ) : variant === "notes" && itineraryId ? (
              <NotesTab
                itineraryId={itineraryId}
                onEditingChange={setIsEditingTabNote}
                noteBackRef={notesTabBackRef}
                noteDeleteRef={notesTabDeleteRef}
                activityNotes={notesActivityNotes}
                onActivityNoteClick={onNotesActivityClick}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>

      {/* Stagger Layer — location detail staggers in/out */}
      {isStaggering && staggerActivity && (
        <motion.div
          key={staggerDirection}
          className="edit-panel-stagger-layer absolute inset-0 flex flex-col bg-surface-alt z-20 rounded-2xl"
          initial={prefersReducedMotion ? false : staggerDirection === "in" ? "hidden" : "visible"}
          animate={prefersReducedMotion ? { opacity: staggerDirection === "in" ? 1 : 0 } : staggerDirection === "in" ? "visible" : "hidden"}
          variants={prefersReducedMotion ? undefined : staggerContainer}
          transition={prefersReducedMotion ? motionTransitions.instant : undefined}
          onAnimationComplete={() => {
            justFinishedStaggerRef.current = true;
            setStaggerDirection(null);
          }}
        >
          {/* Stagger: Header */}
          <motion.div
            data-region="itinerary-edit-panel-header"
            className="edit-panel-header flex items-center justify-between p-4 h-[68px] shrink-0 bg-surface-alt overflow-visible"
            variants={prefersReducedMotion ? undefined : staggerSlideDown}
          >
            <div className="edit-panel-title-row flex items-center gap-2 min-w-0">
              <Button variant="outline" size="sm" icon="only" onClick={onBack} aria-label="Back">
                <ChevronLeft className="edit-panel-stagger-back-icon size-4" />
              </Button>
              <span className="edit-panel-stagger-title type-body-2 font-semibold text-content truncate shrink">
                {staggerActivity.name ?? "Location"}
              </span>
            </div>
            <div className="edit-panel-header-actions flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" icon="only" onClick={onBack} aria-label="Back to collection">
                <X className="edit-panel-stagger-close-icon size-4" />
              </Button>
            </div>
          </motion.div>

          {/* Stagger: Content */}
          <motion.div
            className="edit-panel-stagger-content flex-1 min-h-0 overflow-y-auto scrollbar-none px-3 pb-3"
            variants={prefersReducedMotion ? undefined : staggerSlideUp}
          >
            <LocationDetailPanel
              activity={staggerActivity}
              timezone={timezone}
              currentItineraryId={itineraryId}
              attachments={activityAttachments}
              phone={phone}
              website={website}
            />
          </motion.div>

        </motion.div>
      )}

      {/* Footer — Itinerary activity actions */}
      {/* Footer — Collection preview: schedule the location onto a day. Notes and
          attachments only become available once it's a real activity here. */}
      {variant === "location" && activity && isCollectionPreview && !isStaggering && (
        <PanelFooterCTA>
          {availableDays.length <= 1 ? (
            <Button
              variant="primary"
              size="md"
              className="edit-panel-location-add-to-day flex-1"
              disabled={availableDays.length === 0}
              onClick={() => {
                const dayId = availableDays[0]?.id;
                if (dayId) onAddToDay?.(dayId);
              }}
            >
              <Plus className="edit-panel-location-add-to-day-icon size-4" />
              Add to day
            </Button>
          ) : (
            <Menu>
              <MenuTrigger render={<Button variant="primary" size="md" className="edit-panel-location-add-to-day-trigger flex-1 gap-1.5" />}>
                <Plus className="edit-panel-location-add-to-day-trigger-icon size-4" />
                Add to day
                <ChevronDown className="edit-panel-location-add-to-day-trigger-chevron size-4" />
              </MenuTrigger>
              <MenuContent side="top" align="center" sideOffset={4} className="edit-panel-location-add-to-day-menu w-[220px]">
                {availableDays.map((day) => (
                  <MenuItem key={day.id} onClick={() => onAddToDay?.(day.id)}>
                    <span className="edit-panel-location-add-to-day-label type-body-2 text-content">{day.label}</span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </PanelFooterCTA>
      )}

      {/* Footer — Real activity: add attachment */}
      {variant === "location" && activity && !isCollectionPreview && !isStaggering && !isEditingNote && (
        <PanelFooterCTA>
          {/* Add CTA — opens attachment menu */}
          <Menu>
            <MenuTrigger render={<Button variant="primary" size="md" className="edit-panel-footer-add flex-1 gap-1.5" />}>
              <Plus className="edit-panel-footer-add-icon size-4" />
              Add
            </MenuTrigger>
            <MenuContent side="top" align="center" sideOffset={4} className="edit-panel-add-menu w-[var(--anchor-width)]">
              <MenuItem size="lg" icon="leading" leadingIcon={<Paperclip className="size-4" />} onClick={() => onActivityAddAttachment?.()}>
                <span className="type-body-2 text-content">Attachment</span>
              </MenuItem>
            </MenuContent>
          </Menu>
        </PanelFooterCTA>
      )}

      {/* Footer — Flight Form Save */}
      {variant === "flight-form" && (
        <PanelFooterCTA>
          <Button variant="secondary" size="md" className="edit-panel-flight-form-cancel flex-1" onClick={onBack}>
            Cancel
          </Button>
          <Button variant="primary" size="md" className="edit-panel-flight-form-save flex-1" type="submit" form="flight-manual-form">
            Save Flight
          </Button>
        </PanelFooterCTA>
      )}
      {variant === "flight-edit" && (
        <PanelFooterCTA>
          <Button variant="secondary" size="md" className="edit-panel-flight-edit-cancel flex-1" onClick={onBack}>
            Cancel
          </Button>
          <Button variant="primary" size="md" className="edit-panel-flight-edit-save flex-1" type="submit" form="flight-manual-form">
            Save
          </Button>
        </PanelFooterCTA>
      )}

      {/* Footer — Flight variant CTAs */}
      {variant === "flight" && (
        <PanelFooterCTA>
          <Button variant="primary" size="md" className="edit-panel-flight-upload flex-1" onClick={() => flightFileInputRef.current?.click()}>
            <Upload className="edit-panel-flight-upload-icon size-4" />
            Upload
          </Button>
        </PanelFooterCTA>
      )}

      {/* Footer — Lodging variant CTAs */}
      {variant === "lodging" && (
        <PanelFooterCTA>
          <Button variant="primary" size="md" className="edit-panel-lodging-upload flex-1" onClick={() => lodgingFileInputRef.current?.click()}>
            <Upload className="edit-panel-lodging-upload-icon size-4" />
            Upload
          </Button>
        </PanelFooterCTA>
      )}

      {/* Footer — Lodging Form Save */}
      {variant === "lodging-form" && (
        <PanelFooterCTA>
          <Button variant="secondary" size="md" className="edit-panel-lodging-form-cancel flex-1" onClick={onBack}>
            Cancel
          </Button>
          <Button variant="primary" size="md" className="edit-panel-lodging-form-save flex-1" type="submit" form="lodging-manual-form">
            Save Lodging
          </Button>
        </PanelFooterCTA>
      )}
      {variant === "lodging-edit" && (
        <PanelFooterCTA>
          <Button variant="secondary" size="md" className="edit-panel-lodging-edit-cancel flex-1" onClick={onBack}>
            Cancel
          </Button>
          <Button variant="primary" size="md" className="edit-panel-lodging-edit-save flex-1" type="submit" form="lodging-manual-form">
            Save
          </Button>
        </PanelFooterCTA>
      )}

      {/* Footer — Search Place Add to Day */}
      {state.variant === "search-place" && (
        <PanelFooterCTA>
          {availableDays.length <= 1 ? (
            <Button
              variant="primary"
              size="md"
              className="edit-panel-search-place-add flex-1"
              disabled={availableDays.length === 0}
              onClick={() => {
                const dayId = availableDays[0]?.id;
                if (dayId) onAddSearchPlace?.(dayId, state.place);
              }}
            >
              <Plus className="edit-panel-search-place-add-icon size-4" />
              Add to itinerary
            </Button>
          ) : (
            <Menu>
              <MenuTrigger render={<Button variant="primary" size="md" className="edit-panel-search-place-add-trigger flex-1 gap-1.5" />}>
                <Plus className="edit-panel-search-place-add-trigger-icon size-4" />
                Add to day
                <ChevronDown className="edit-panel-search-place-add-trigger-chevron size-4" />
              </MenuTrigger>
              <MenuContent side="top" align="center" sideOffset={4} className="edit-panel-search-place-add-menu w-[220px]">
                {availableDays.map((day) => (
                  <MenuItem key={day.id} onClick={() => onAddSearchPlace?.(day.id, state.place)}>
                    <span className="edit-panel-search-place-day-label type-body-2 text-content">{day.label}</span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </PanelFooterCTA>
      )}

      {/* Footer — Add Location Save */}
      {variant === "add-location" && (
        <PanelFooterCTA>
          <Button variant="secondary" size="md" className="edit-panel-add-location-cancel flex-1" onClick={onBack}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            icon={addLocationForm.resolving ? "leading" : "none"}
            className="edit-panel-add-location-save flex-1"
            type="submit"
            form="add-location-form"
            disabled={!addLocationForm.canSubmit || addLocationForm.resolving}
          >
            {addLocationForm.resolving && <Loader2 className="edit-panel-add-location-save-spinner size-4 animate-spin" />}
            Add Location
          </Button>
        </PanelFooterCTA>
      )}

      {/* Footer — Expenses variant CTAs */}
      {variant === "expenses" && (
        <PanelFooterCTA>
          <Button variant="secondary" size="md" className="edit-panel-expense-add flex-1" onClick={onExpenseCreate}>
            <Plus className="edit-panel-expense-add-icon size-4" />
            Expense
          </Button>
        </PanelFooterCTA>
      )}

      {/* Hidden File Input — Flight */}
      {variant === "flight" && (
        <input
          ref={flightFileInputRef}
          type="file"
          accept=".pdf,image/png,image/jpeg,image/webp"
          multiple
          className="edit-panel-flight-file-input hidden"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      )}

      {/* Hidden File Input — Lodging */}
      {variant === "lodging" && (
        <input
          ref={lodgingFileInputRef}
          type="file"
          accept=".pdf,image/png,image/jpeg,image/webp"
          multiple
          className="edit-panel-lodging-file-input hidden"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      )}

      {/* Drop Overlay */}
      {isDragging && (
        <div className="edit-panel-drop-overlay pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-edge-brand bg-action-brand/5 backdrop-blur-[2px]">
          <div className="edit-panel-drop-overlay-icon flex items-center justify-center size-14 rounded-2xl bg-action-brand/10">
            <Upload className="edit-panel-drop-overlay-upload-icon size-7 text-content-brand" />
          </div>
          <p className="edit-panel-drop-overlay-title type-body-1 font-semibold text-content-brand">
            Drop files here
          </p>
          <p className="edit-panel-drop-overlay-hint type-body-2 text-content-brand/60">
            PDF or image files accepted
          </p>
        </div>
      )}
      {/* Delete Confirmation Dialog */}
      <ConfirmActionDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}
        title={deleteConfirm?.title ?? ""}
        confirmLabel="Delete"
        onConfirm={() => { deleteConfirm?.onConfirm(); setDeleteConfirm(null); }}
        onCancel={() => setDeleteConfirm(null)}
      >
        <p className="edit-panel-delete-dialog-message type-body-2 text-content-secondary">
          {deleteConfirm?.message}
        </p>
      </ConfirmActionDialog>
    </div>
  );
}
