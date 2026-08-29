"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { Dialog } from "@base-ui/react/dialog";
import dynamic from "next/dynamic";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { type DateRange } from "react-day-picker";
import {
  Link2,
  AlertTriangle,
  PlaneTakeoff,
  BedDouble,
  Receipt,
  Wallet,
  MapPinOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { timeToHour, hourToISO, toCalendarActivity, parseLocalDate, toLocalDateString, formatDateRangeLabel, formatStayDuration } from "@/lib/utils/itinerary";
import { weekdayDescriptionsFrom } from "@/lib/utils/location-detail";
import { formatLodgingDate, formatTimeOfDay } from "@/lib/utils/formatters";
import { mapExtractedFlightToCardProps } from "@/lib/utils/flightCard";
import { Button } from "@/components/ui/primitives/Button";
import { Sheet } from "@/components/ui/primitives/Sheet";
import type { CalendarDay } from "@/components/ui/calendar/ItineraryCalendar";

import type { CalendarActivity } from "@/components/ui/calendar/ActivityTimeslot";
import { DaysTab } from "@/components/ui/calendar/DaysTab";
import { NotesGrid } from "@/components/ui/detail-views/NotesGrid";
import { useItineraryNotes } from "@/hooks/useItineraryNotes";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";

import { useNavbarVisibility } from "@/contexts/NavbarVisibilityContext";
import { useNavbarFilter } from "@/contexts/NavbarFilterContext";
import { useRecordView } from "@/hooks/useRecordView";
import { useItineraryDetailQuery } from "@/hooks/queries/useItineraryDetailQuery";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import { fetchItineraryDetail } from "@/lib/api/itineraries";
import type {
  ItineraryDetail,
  ItineraryDayDetail,
  ItineraryActivityDetail,
  ActivityLocationDetail as ActivityLocation,
} from "@/lib/db/itinerary-detail";
import type { MapLocation, MapPolylineSegment } from "@/components/ui/map/MapContainer";
import { MapSearchBar } from "@/components/ui/itinerary/MapSearchBar";
import { MAP_SEARCH_CHIPS, placeNeedsDetails, toPlaceDetailsPayload, type PlaceDetailsPayload, type PlaceSearchRequest, type PlaceSearchResult } from "@/lib/maps/place-search";
import { trackPlaceDetailsEnterprise } from "@/lib/api/maps";
import { resolveGoogleMapsUrl } from "@/lib/api/locations";
import { locationRowToPlaceSearchResult } from "@/lib/maps/location-row";
import type { PlaceDetailsFetcher, PlaceSearchRunner } from "@/components/ui/map/GoogleMapDetail";
import { createCollection, getCollections, getCollection, type CollectionWithRole, type CollectionWithLocations, type Location } from "@/lib/api/collections";
import { updateItinerary, moveActivity, createActivity, deleteActivity, deleteItinerary, optimizeDayRoute, previewDayLegs, setActivityTravelMode, type CascadedActivity } from "@/lib/api/itineraries";
import {
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent, Over } from "@dnd-kit/core";
import { Kanban, type KanbanDropTarget } from "@/components/ui/primitives/Kanban";
import type { LodgingFormData } from "@/components/ui/detail-views/LodgingForm";
import { LocationDetailView } from "@/components/ui/detail-views/LocationDetailView";
import { extractFlightsFromPDF, getFlights, createFlight, updateFlight, deleteFlight, type ExtractedFlight } from "@/lib/api/flights";
import { getLodgings } from "@/lib/api/lodgings";
import { uploadAttachment, deleteAttachment, getAttachmentSignedUrl, type ItineraryAttachmentSummary } from "@/lib/api/attachments";
import { FilePillHeader } from "@/components/ui/detail-views/FilePillHeader";
import { getFriendlyApiError } from "@/lib/errors/userMessages";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import type { LodgingCardProps } from "@/components/ui/detail-views/LodgingCard";
import { ItineraryQuickView } from "@/components/ui/itinerary/ItineraryQuickView";
import { useNavigationLoading } from "@/contexts/NavigationLoadingContext";
import { minsToHHMM, parseTimeMins, isRealActivity, sameWallTime } from "@/components/ui/itinerary/activity-utils";
import { ItineraryPageHeader } from "@/components/ui/itinerary/ItineraryPageHeader";
import { ItineraryMapSection } from "@/components/ui/itinerary/ItineraryMapSection";
import { type ItineraryTab } from "@/components/ui/itinerary/ItineraryTabBar";
import { ItineraryEditLayout } from "@/components/ui/itinerary/ItineraryEditLayout";
import { EditDayList, type EditDayListHandle } from "@/components/ui/itinerary/EditDayList";
import { CompactActivityCard, getActivityCardLayout } from "@/components/ui/itinerary/CompactActivityCard";
import type { TransportMode } from "@/components/ui/itinerary/ItineraryDayColumn/constants";
import { ItinerarySidePanel, type ItineraryPanelState } from "@/components/ui/itinerary/ItinerarySidePanel";
import { FlightSeatSelectionWorkspace } from "@/components/ui/flights/FlightSeatSelectionWorkspace";
import type { FlightBookingConfirmation } from "@/components/ui/detail-views/FlightBookingFlow";
import type { DayActivityMarker } from "@/components/ui/itinerary/LocationDetailPanel";
import { computeProposedOrder, cascadeTimes, type OptimizeRouteResult } from "@/components/ui/itinerary/overlap-utils";
import { cascadeDayTimes, clearLegs } from "@/components/ui/itinerary/drag-utils";
import { ConfirmActionDialog, ActivityChangeRow } from "@/components/ui/modals/ConfirmActionDialog";
import type { ActivityNote } from "@/components/ui/itinerary/LocationDetailPanel";
import { CHANGI_AIRPORT, type FlightAirport } from "@/lib/flights/airports";
import type { FlightOffer, FlightPriceWatch } from "@/lib/flights/atlas";
import { searchFlightOffers } from "@/lib/api/atlas-flights";
import type { FlightSearchData } from "@/components/ui/detail-views/FlightForm";

/** Drop-time cascade aligns starts/ends to this many minutes (matches the backend). */
const DRAG_TIME_STEP_MIN = 10;

/** Hard cap on itinerary length, enforced server-side in PATCH /api/itineraries/:id. */
const MAX_ITINERARY_DAYS = 30;
const ceilToDragStep = (mins: number) => Math.ceil(mins / DRAG_TIME_STEP_MIN) * DRAG_TIME_STEP_MIN;
/** Distinguishes persisted rows from optimistic `temp-` ids. */
const ACTIVITY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLIGHT_PRICE_POLL_MS = 15 * 60 * 1000;

/** Activity ids from `pivotId` onward in a sorted list — the cascade's downstream set. */
function downstreamIds(sorted: ItineraryActivityDetail[], pivotId: string): string[] {
  const idx = sorted.findIndex((a) => a.id === pivotId);
  return idx < 0 ? [] : sorted.slice(idx).map((a) => a.id);
}

/**
 * Folds fresh server days into the edit-mode working copy without dropping an
 * optimistic card that hasn't been reconciled yet. The old behaviour blindly
 * replaced `editLocalDays` with `itinerary.days`, so a just-added temp card
 * (skeleton showing, `createActivity` still in flight) was clobbered the moment
 * the user's own realtime INSERT echo refreshed `itinerary.days` — leaving the
 * detail panel stuck in its aria-busy skeleton until a hard refetch.
 *
 * Server rows always win. For each day we re-attach any still-unreconciled
 * `temp-` activity from the working copy, but only when the echoed real row
 * hasn't landed yet — matched by correlation_id (the client token both rows
 * carry), falling back to location_id / place_id / name+start_time for rows that
 * predate the token — so the server row supersedes the temp once it arrives
 * instead of rendering both (which would later collapse to a duplicate id when
 * `createActivity` swaps temp→server).
 */
function mergeServerDaysPreservingPending(
  working: ItineraryDayDetail[],
  server: ItineraryDayDetail[],
): ItineraryDayDetail[] {
  const workingByDay = new Map(working.map((d) => [d.id, d]));
  const pendingByDay = new Map<string, ItineraryActivityDetail[]>();
  for (const day of working) {
    const temps = day.activities.filter((a) => a.id.startsWith("temp-"));
    if (temps.length) pendingByDay.set(day.id, temps);
  }

  const hasServerCounterpart = (
    temp: ItineraryActivityDetail,
    serverActs: ItineraryActivityDetail[],
  ) =>
    serverActs.some((s) => {
      // `correlation_id` used to carry a client token from an optimistic add
      // through the POST to the realtime echo. There is no POST now, so the
      // match falls to the ids the row actually has.
      if (temp.location_id && s.location_id) return s.location_id === temp.location_id;
      if (temp.place_id && s.place_id) return s.place_id === temp.place_id;
      return s.name === temp.name && s.start_time === temp.start_time;
    });

  return server.map((day) => {
    const local = workingByDay.get(day.id);
    const temps = pendingByDay.get(day.id);
    const stillPending = temps?.filter((t) => !hasServerCounterpart(t, day.activities)) ?? [];

    if (!local) {
      return stillPending.length ? { ...day, activities: [...day.activities, ...stillPending] } : day;
    }

    // Keep the working copy's ORDER for rows we already hold, taking the server's
    // field values for each. Realtime patches `itinerary.days` row-by-row and
    // never re-sorts (useItineraryRealtime), so after a reorder that array still
    // carries the pre-drag order alongside post-cascade times. Taking it wholesale
    // reverted every drag while leaving the new times visible — the order the user
    // just expressed is the one thing the edit surface owns.
    const serverById = new Map(day.activities.map((a) => [a.id, a]));
    const ordered: ItineraryActivityDetail[] = [];
    const taken = new Set<string>();
    for (const a of local.activities) {
      const fromServer = serverById.get(a.id);
      if (fromServer) {
        ordered.push(fromServer);
        taken.add(a.id);
      }
    }
    // Rows the working copy has never seen (another member's add, a realtime
    // INSERT) keep the server's placement.
    for (const a of day.activities) if (!taken.has(a.id)) ordered.push(a);

    return { ...day, activities: [...ordered, ...stillPending] };
  });
}

/**
 * Maps a place-search result into the rich `ActivityLocation` fields the side
 * panel renders (rating, price, hours, phone, website…), so an optimistically
 * added card shows them instantly instead of waiting for the server round-trip.
 * Fields the search didn't return (Pro-tier) come through null and collapse.
 */
function searchPlaceToActivityLocationFields(place: PlaceSearchResult): Partial<ActivityLocation> {
  const hasHours = Boolean(place.openingHoursPeriods?.length || place.openingHours?.length);
  return {
    rating: place.rating ?? null,
    user_rating_count: place.userRatingCount ?? null,
    primary_type: place.primaryType ?? null,
    categories: place.types ?? null,
    business_status: place.businessStatus ?? null,
    // Website, phone and the Maps links are not columns in `locations`, so a
    // searched place cannot carry them into a saved activity either.
    regular_opening_hours:
      hasHours && place.openingHours?.length
        ? { weekdayDescriptions: place.openingHours }
        : null,
    ...(place.photoStorageUrls?.length ? { photo_urls: place.photoStorageUrls } : {}),
  };
}

// Dynamically import map
const MapContainer = dynamic(
  () =>
    import("@/components/ui/map/MapContainer").then((mod) => mod.MapContainer),
  { ssr: false }
);

function encodePolylinePair(lat1: number, lng1: number, lat2: number, lng2: number): string {
  function encodeValue(val: number): string {
    let v = Math.round(val * 1e5);
    v = v < 0 ? ~(v << 1) : v << 1;
    let encoded = "";
    while (v >= 0x20) {
      encoded += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>>= 5;
    }
    encoded += String.fromCharCode(v + 63);
    return encoded;
  }
  return encodeValue(lat1) + encodeValue(lng1) + encodeValue(lat2 - lat1) + encodeValue(lng2 - lng1);
}

// ============================================================================
// Page Component
// ============================================================================

// ── Activity → LocationDetailView mapping (view-mode location detail) ──
function activityToDetailLocation(activity: ItineraryActivityDetail) {
  const loc = activity.location;
  return {
    name: activity.name,
    images: loc?.photo_urls ?? (activity.photo_url ? [activity.photo_url] : []),
    description: loc?.editorial_summary ?? "",
    address: loc?.formatted_address ?? "",
    openingHoursLines: weekdayDescriptionsFrom(loc?.regular_opening_hours),
    // Phone and website are not columns in `locations`.
    phone: "",
    website: "",
    stayDurationMinutes: loc?.stay_duration ?? null,
    priceRange: loc?.price_range ?? null,
    primaryType: loc?.primary_type ?? "",
    latitude: loc?.latitude ?? 0,
    longitude: loc?.longitude ?? 0,
    googleMapsUri: loc?.google_maps_uri ?? null,
    placeId: activity.place_id,
    stopContent: activity.content ?? null,
  };
}

/**
 * The planner has no timezone. `hours.ts` takes an injected weekday and nothing
 * in the pipeline derives one, so every stored minute is UTC and every reader
 * on this page already defaulted to it. Named once here rather than repeated as
 * `?? "UTC"` at twenty call sites.
 */
const ITINERARY_TIMEZONE = "UTC";

export default function ItineraryDetailPage() {
  const prefersReducedMotion = useReducedMotion();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const itineraryId = params.id as string;
  const highlightLocationId = searchParams.get("highlight");

  const { showToast } = useToast();
  const { isPhone, isDesktop } = useBreakpoint();

  const navbarVisibility = useNavbarVisibility();
  const { setFilter } = useNavbarFilter();
  const [quickViewEditMode, setQuickViewEditMode] = useState<"view" | "edit">("view");
  // Edit sessions are timed and counted so we can tell a real editing session
  // apart from someone who toggled edit mode and bounced.
  const editEnteredAtRef = useRef<number | null>(null);
  const editChangeCountRef = useRef(0);
  const [itinerary, setItinerary] = useState<ItineraryDetail | null>(null);
  const itineraryRef = useRef<ItineraryDetail | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);

  const { data: queryData, isLoading } = useItineraryDetailQuery(itineraryId);
  const { startLoading, stopLoading } = useNavigationLoading();
  const transitionStartRef = useRef(Date.now());

  useEffect(() => {
    startLoading();
  }, [startLoading]);

  useEffect(() => {
    if (!isLoading) {
      const elapsed = Date.now() - transitionStartRef.current;
      const remaining = Math.max(0, 1000 - elapsed);
      const timer = setTimeout(() => stopLoading(), remaining);
      return () => clearTimeout(timer);
    }
  }, [isLoading, stopLoading]);

  // Collaborators are gone with auth: there is no `user_itinerary` table and no
  // owner to seed the list from.
  // Prevents the dateRange effect from firing during the initial data load
  const dateRangeInitialized = useRef(false);
  // Last range that passed the 30-day cap, used to roll back a rejected change
  // without an optimistic flicker.
  const lastValidDateRange = useRef<{ from: Date; to: Date } | null>(null);
  const [, setSelectedActivity] = useState<CalendarActivity | null>(null);
  const [, setHighlightedActivityId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  // Controls row in the header — the auto-scroll target when entering edit mode
  // (the header-content row scrolls above; tabs + workspace fill the screen).
  const controlsRef = useRef<HTMLDivElement>(null);
  // Measured height of the controls row. In edit mode the workspace body is sized
  // to (100vh − controlsHeight) so that, once the controls scroll to the top, the
  // 3-column layout fills exactly the rest of the viewport with no further scroll.
  const [controlsHeight, setControlsHeight] = useState(0);
  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    const update = () => setControlsHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [quickViewEditMode]);
  // View-mode location detail (replaces the map; clicking a day activity opens it).
  const [detailActivity, setDetailActivity] = useState<ItineraryActivityDetail | null>(null);
  const detailSectionRef = useRef<HTMLDivElement>(null);
  // Close the detail view and scroll the activity card it was opened from back
  // into view (mirrors closeDetailView on the link/collection detail pages).
  const closeDetail = useCallback(() => {
    const activityId = detailActivity?.id;
    setDetailActivity(null);
    if (!activityId) return;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-activity-id="${activityId}"]`)
        ?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
    });
  }, [detailActivity, prefersReducedMotion]);
  // Open an activity's view-mode location detail (replaces the map and pushes
  // the header up). Shared by day-activity clicks and the Notes tab.
  const openActivityDetail = useCallback((activity: ItineraryActivityDetail) => {
    setDetailActivity(activity);
    if (!isPhone) {
      navbarVisibility?.setNavbarHidden(true);
      requestAnimationFrame(() => {
        detailSectionRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
      });
    }
  }, [isPhone, navbarVisibility, prefersReducedMotion]);
  // Esc closes the location detail view (back to the map + originating card).
  useEffect(() => {
    if (!detailActivity) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailActivity, closeDetail]);
  const [, setIsPanelOpen] = useState(false);
  const [showCollections] = useState(false);
  const [collections, setCollections] = useState<CollectionWithRole[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCollection] = useState<CollectionWithLocations | null>(null);
  const [itineraryCollection] = useState<CollectionWithLocations | null>(null);

  // Collections offered in the location detail-view "Add to" picker.
  const detailSaveMenuCollections = useMemo(
    () =>
      collections
        .filter((c) => !c.is_archived)
        .map((c) => ({
          id: c.id,
          name: c.name,
          locationCount: c.location_count,
          thumbnailUrl: c.thumbnail_url ?? c.preview_images?.[0],
        })),
    [collections],
  );

  // Add the open activity's location into a chosen collection (detail-view picker).
  const handleDetailSaveToCollection = useCallback(
    async (targetCollectionId: string) => {
      const locId = detailActivity?.location?.id;
      if (!locId) return;
      try {
        // Collections have no store in this build; the table this wrote to left
        // with Supabase. Failing loudly beats a success toast over no write.
        const error = new Error("Collections are not available in this build.");
        if (error) throw error;
        const target = collections.find((c) => c.id === targetCollectionId);
        showToast({ title: `Added to ${target?.name ?? "collection"}` });
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't add this location."),
          variant: "error",
        });
      }
    },
    [detailActivity, collections, showToast],
  );

  // Create a collection inline from the detail-view picker (UXR-013), refresh the
  // list, and hand the new id back so the location is saved straight into it.
  const handleDetailCreateCollection = useCallback(
    async (data: {
      name: string;
      country?: string;
      region?: string;
      latitude?: number;
      longitude?: number;
      tags?: string[];
    }) => {
      try {
        const created = await createCollection(
          data.name,
          data.country,
          data.region,
          data.latitude,
          data.longitude,
          data.tags,
        );
        const list = await getCollections();
        setCollections(list);
        return { id: created.id, name: created.name };
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't create the collection."),
          variant: "error",
        });
        return null;
      }
    },
    [showToast],
  );
  const [selectedLink] = useState<{ name: string; locations: Location[] } | null>(null);
  const [selectedLocationDetail] = useState<Location | null>(null);
  const [flights, setFlights] = useState<FlightCardProps[]>([]);
  const [flightSearchOrigin, setFlightSearchOrigin] = useState<FlightAirport | null>(CHANGI_AIRPORT);
  const [flightSearchDestination, setFlightSearchDestination] = useState<FlightAirport | null>(null);
  const [flightPriceWatches, setFlightPriceWatches] = useState<FlightPriceWatch[]>([]);
  const [flightBookingSeatMode, setFlightBookingSeatMode] = useState(false);
  const [flightBookingSeatId, setFlightBookingSeatId] = useState<string | null>(null);
  const [flightBookingPassengerName, setFlightBookingPassengerName] = useState("");
  const [flightUploading, setFlightUploading] = useState(false);
  // Keyed by IATA code. Populated from the `locations` table (which the backend
  // upserts during flight processing) and used to render airport markers + route
  // polylines on the edit-mode map.
  // Read-only, and permanently empty: the lookup that filled it is gone (see
  // the note in the flights effect below). Kept as state rather than a bare
  // constant so restoring the fetch is one line, not a re-plumbing.
  const [airportLocations] = useState<Map<string, { name: string; latitude: number; longitude: number; address?: string }>>(new Map());
  const [showLodgingSidebar] = useState(false);
  const [lodgings, setLodgings] = useState<LodgingCardProps[]>([]);
  const [lodgingUploading] = useState(false);
  const [lodgingsLoaded, setLodgingsLoaded] = useState(false);
  const handleFlightUploadRef = useRef<(file: File) => void>(() => {});
  const handleLodgingUploadRef = useRef<(file: File) => void>(() => {});
  const [showImportPanel] = useState(false);
  const [openTab, setOpenTab] = useState<ItineraryTab | null>(null);
  const [viewTabDragging, setViewTabDragging] = useState(false);
  const viewTabDragCounter = useRef(0);
  const viewTabFileInputRef = useRef<HTMLInputElement>(null);
  const [flightAttachments, setFlightAttachments] = useState<ItineraryAttachmentSummary[]>([]);
  const [lodgingAttachments, setLodgingAttachments] = useState<ItineraryAttachmentSummary[]>([]);
  const [pendingDeleteAttachment, setPendingDeleteAttachment] = useState<ItineraryAttachmentSummary | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);
  const [deleteItineraryConfirmOpen, setDeleteItineraryConfirmOpen] = useState(false);
  const [deletingItinerary, setDeletingItinerary] = useState(false);

  const [hiddenTransports, setHiddenTransports] = useState<Set<string>>(new Set());
  const [transportModes, setTransportModes] = useState<Record<string, TransportMode>>({});
  // Legs Google had no route for in the mode the user picked. Session-scoped:
  // it exists so the transport row can say "No route" instead of disappearing.
  const [unavailableLegIds, setUnavailableLegIds] = useState<Set<string>>(new Set());
  const [editActiveTab, setEditActiveTab] = useState<ItineraryTab>("Itinerary");
  const [panelState, setPanelState] = useState<ItineraryPanelState>(null);

  useEffect(() => {
    if (panelState?.variant === "flight-booking") return;
    setFlightBookingSeatMode(false);
  }, [panelState?.variant]);

  const beginFlightBooking = useCallback((offer: FlightOffer, search: { origin: string; destination: string; departureDate: string }) => {
    setFlightBookingSeatId(null);
    setFlightBookingSeatMode(false);
    setFlightBookingPassengerName("");
    setPanelState({ variant: "flight-booking", offer, search });
  }, []);

  /**
   * A finished booking becomes a row, then a card.
   *
   * The card is rendered optimistically from the confirmation and reconciled
   * with the stored row when the write lands, so the panel closes onto a filled
   * list rather than a spinner. Its id is the one the database issued — the old
   * `atlas-${bookingReference}` was minted in the browser and belonged to
   * nothing, so edit and delete had no row to name.
   *
   * A failed write still shows the card. The traveller has a ticket number
   * either way and the airline was not asked whether we managed to file it; the
   * toast says the trip did not keep it, which is the honest version of what
   * happened.
   */
  const completeFlightBooking = useCallback(async (confirmation: FlightBookingConfirmation) => {
    const { offer } = confirmation;
    const departDate = offer.departureTime.slice(0, 10);
    const arriveDate = offer.arrivalTime.slice(0, 10);
    const fromCity = flightSearchOrigin?.code === offer.departureAirport ? flightSearchOrigin.city : offer.departureAirport;
    const toCity = flightSearchDestination?.code === offer.arrivalAirport ? flightSearchDestination.city : offer.arrivalAirport;

    const bookedFlight: FlightCardProps = {
      id: `atlas-${confirmation.bookingReference}`,
      fromCode: offer.departureAirport,
      fromCity,
      toCode: offer.arrivalAirport,
      toCity,
      time: `${offer.departureTime} → ${offer.arrivalTime}`,
      cost: String(confirmation.total),
      confirmation: confirmation.bookingReference,
      flightNumber: offer.flightNumbers.join(" · "),
      departDate,
      departTime: offer.departureTime.slice(11, 16),
      arriveDate,
      arriveTime: offer.arrivalTime.slice(11, 16),
      airline: offer.carrier,
      flightDuration: `${Math.floor(offer.durationMinutes / 60)}h ${offer.durationMinutes % 60}m`,
      stops: offer.stops,
      terminal: offer.departureTerminal,
      baggageAllowance: confirmation.baggageLabel,
      currency: offer.currency,
      ticketNumber: confirmation.ticketNumber,
      seat: confirmation.seatId || undefined,
    };
    const withoutThisBooking = (list: FlightCardProps[]) =>
      list.filter((flight) => flight.confirmation !== confirmation.bookingReference);
    setFlights((current) => [bookedFlight, ...withoutThisBooking(current)]);
    setFlightBookingSeatMode(false);
    setFlightBookingSeatId(null);
    setFlightBookingPassengerName("");
    setPanelState({ variant: "flight" });

    let saved = false;
    if (itineraryId) {
      try {
        const row = await createFlight(itineraryId, {
          source: "booked",
          flight_number: offer.flightNumbers.join(" · "),
          airline: offer.carrier,
          depart_date: departDate,
          depart_time: offer.departureTime.slice(11, 16),
          depart_airport_code: offer.departureAirport,
          depart_city: fromCity,
          arrive_date: arriveDate,
          arrive_time: offer.arrivalTime.slice(11, 16),
          arrive_airport_code: offer.arrivalAirport,
          arrive_city: toCity,
          duration_minutes: offer.durationMinutes,
          confirmation: confirmation.bookingReference,
          cost: String(confirmation.total),
          currency: offer.currency,
          terminal: offer.departureTerminal,
          baggage_allowance: confirmation.baggageLabel,
          ticket_number: confirmation.ticketNumber,
          seat: confirmation.seatId || undefined,
          passenger_name: confirmation.passengerName || undefined,
        });
        // The stored row wins: it carries the real id, and `stops` is the only
        // thing it cannot say — the table holds one leg, not a segment list —
        // so that one field is carried over from the offer.
        setFlights((current) => [
          { ...mapExtractedFlightToCardProps(row), stops: offer.stops },
          ...withoutThisBooking(current),
        ]);
        saved = true;
      } catch (err) {
        console.error("[flights] the booked flight could not be saved", err);
      }
    }

    const seatNote = confirmation.seatId
      ? `Ticket ${confirmation.ticketNumber} · Seat ${confirmation.seatId}`
      : `Ticket ${confirmation.ticketNumber} · No seat selected`;
    showToast({
      title: saved
        ? `${offer.flightNumbers.join(" · ")} added to your itinerary`
        : `${offer.flightNumbers.join(" · ")} booked, but not saved to this trip`,
      description: saved ? seatNote : `${seatNote}. It will be gone when you reload — add it by hand to keep it.`,
    });
  }, [flightSearchDestination, flightSearchOrigin, itineraryId, showToast]);

  // The edit workspace is intentionally desktop/tablet-only for now. If the
  // viewport crosses into the phone breakpoint while editing, return to the
  // stable view surface and clear the desktop-only panel state.
  useEffect(() => {
    if (!isPhone || quickViewEditMode === "view") return;
    setQuickViewEditMode("view");
    setEditActiveTab("Itinerary");
    setPanelState(null);
    navbarVisibility?.setNavbarHidden(false);
  }, [isPhone, navbarVisibility, quickViewEditMode]);
  // Panel state to restore when the add-location "×" is clicked — i.e. whatever
  // the panel was showing right before "+" opened the manual add (e.g. a location
  // detail). Captured on open; "×" reverts to it instead of closing outright.
  const addLocationReturnRef = useRef<ItineraryPanelState>(null);
  const [collectionEnabled, setCollectionEnabled] = useState(true);
  const [editFocusedDayIndex, setEditFocusedDayIndex] = useState<number | null>(null);
  const [editDayFilterOpen, setEditDayFilterOpen] = useState(false);
  const [editFitBoundsKey, setEditFitBoundsKey] = useState(0);

  const openFlightWorkspace = useCallback(() => {
    if (isPhone) return;
    setDetailActivity(null);
    setQuickViewEditMode("edit");
    setEditActiveTab("Flight");
    setCollectionEnabled(false);
    setPanelState({ variant: "flight" });
    setEditFitBoundsKey((key) => key + 1);
    navbarVisibility?.setNavbarHidden(true);
    requestAnimationFrame(() => {
      controlsRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  }, [isPhone, navbarVisibility, prefersReducedMotion]);

  // ── Map Place Search ───────────────────────────────────────────────────────
  const [mapSearchOpen, setMapSearchOpen] = useState(false);
  const [mapSearchQuery, setMapSearchQuery] = useState("");
  const [mapSearchChipId, setMapSearchChipId] = useState<string | null>(null);
  const [mapSearchRequest, setMapSearchRequest] = useState<PlaceSearchRequest | null>(null);
  const [mapSearchLoading, setMapSearchLoading] = useState(false);
  const mapSearchNonce = useRef(0);
  // Enterprise Place Details fetcher (provided by the map once places lib loads),
  // a per-session enrichment cache, and the id currently being enriched on click.
  const placeDetailsFetcherRef = useRef<PlaceDetailsFetcher | null>(null);
  const placeDetailsCacheRef = useRef<Map<string, PlaceSearchResult>>(new Map());
  const [enrichingPlaceId, setEnrichingPlaceId] = useState<string | null>(null);
  // Viewport-biased place-search runner (provided by the map) for the add-location form.
  const placeSearchRunnerRef = useRef<PlaceSearchRunner | null>(null);

  // Fires a search against the current viewport. Resolves the active chip into
  // place types; with text we Text Search, chip-only we Nearby Search.
  const runMapSearch = useCallback((query: string, chipId: string | null) => {
    const trimmed = query.trim();
    if (!trimmed && !chipId) {
      setMapSearchRequest(null);
      return;
    }
    const includedTypes = chipId
      ? MAP_SEARCH_CHIPS.find((c) => c.id === chipId)?.includedTypes ?? []
      : [];
    mapSearchNonce.current += 1;
    setMapSearchRequest({ query: trimmed, includedTypes, nonce: mapSearchNonce.current });
    // Tier resolution + usage tracking happen in the map controller, where the
    // actual API call fires (see MapSearchController in GoogleMapDetail).
  }, []);

  const handleMapSearchSubmit = useCallback(() => {
    runMapSearch(mapSearchQuery, mapSearchChipId);
  }, [runMapSearch, mapSearchQuery, mapSearchChipId]);

  const handleMapSearchChipToggle = useCallback((chipId: string) => {
    setMapSearchChipId((prev) => {
      const next = prev === chipId ? null : chipId;
      runMapSearch(mapSearchQuery, next);
      return next;
    });
  }, [runMapSearch, mapSearchQuery]);

  const handleMapSearchClear = useCallback(() => {
    setMapSearchQuery("");
    setMapSearchChipId(null);
    setMapSearchRequest(null);
  }, []);

  const handleMapSearchOpenChange = useCallback((open: boolean) => {
    setMapSearchOpen(open);
    if (!open) {
      setMapSearchRequest(null);
    }
  }, []);

  // Open the side panel with whatever the search returned, then — only if the
  // result lacks Enterprise data (Pro-tier search) — enrich it via Place Details.
  const handleSearchResultClick = useCallback((place: PlaceSearchResult) => {
    const cached = placeDetailsCacheRef.current.get(place.id);
    setPanelState({ variant: "search-place", place: cached ?? place });

    if (cached || !placeNeedsDetails(place)) return;
    const fetcher = placeDetailsFetcherRef.current;
    if (!fetcher) return;

    setEnrichingPlaceId(place.id);
    fetcher(place.id)
      .then((details) => {
        const enriched: PlaceSearchResult = { ...place, ...details, id: place.id };
        placeDetailsCacheRef.current.set(place.id, enriched);
        void trackPlaceDetailsEnterprise();
        setPanelState((prev) =>
          prev?.variant === "search-place" && prev.place.id === place.id
            ? { variant: "search-place", place: enriched }
            : prev,
        );
      })
      .catch((e) => console.error("[place details]", e))
      .finally(() => setEnrichingPlaceId((cur) => (cur === place.id ? null : cur)));
  }, []);

  const handlePlaceDetailsFetcherReady = useCallback((fetcher: PlaceDetailsFetcher | null) => {
    placeDetailsFetcherRef.current = fetcher;
  }, []);

  const handlePlaceSearchReady = useCallback((runner: PlaceSearchRunner | null) => {
    placeSearchRunnerRef.current = runner;
  }, []);

  // Add-location form search: runs a free-text Places search against the map viewport.
  // Ties results to the itinerary's country by adding it as query context (Text Search
  // ranks/filters on it) — unless the user already typed the country. Returns [] if the
  // map (and its runner) hasn't loaded yet.
  const handlePlaceSearch = useCallback(async (query: string): Promise<PlaceSearchResult[]> => {
    const runner = placeSearchRunnerRef.current;
    if (!runner) return [];
    const country = itinerary?.country?.trim();
    const scopedQuery =
      country && !query.toLowerCase().includes(country.toLowerCase())
        ? `${query}, ${country}`
        : query;
    return runner(scopedQuery, []);
  }, [itinerary?.country]);

  // Add-location form Google Maps link: resolves a pasted share link to a fully
  // persisted `locations` row. The server expands/parses the URL to a place_id
  // (short links need server-side redirect expansion), reuses the cached row by
  // place_id or fetches + stores it, and returns the full row — so all fields flow
  // into the activity card with no client-side Place Details call, and the carried
  // locationId lets submit link the activity directly. Returns null when it can't
  // be resolved.
  const handleResolveMapsLink = useCallback(async (url: string): Promise<PlaceSearchResult | null> => {
    try {
      const { location } = await resolveGoogleMapsUrl(url);
      return locationRowToPlaceSearchResult(location);
    } catch (e) {
      console.error("[resolve maps link]", e);
      return null;
    }
  }, [itineraryId]);

  // ── Edit Mode DnD ───────────────────────────────────────────────────────────
  const [editLocalDays, setEditLocalDays] = useState<ItineraryDayDetail[]>(itinerary?.days ?? []);
  const [editDragLocation, setEditDragLocation] = useState<Location | null>(null);
  const [editDragActivity, setEditDragActivity] = useState<ItineraryActivityDetail | null>(null);
  const editDragSourceDayIdRef = useRef<string | null>(null);
  const [editPreviewDays, setEditPreviewDays] = useState<ItineraryDayDetail[] | null>(null);
  const [editDragActivityWidth, setEditDragActivityWidth] = useState<number | null>(null);
  const editPreviewDaysRef = useRef<ItineraryDayDetail[] | null>(null);
  // Kanban's own mouse sensor activates at 10px; keep the tighter 5px this view
  // has always used so cards still feel like they lift on contact.
  const editSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const editCollisionDetection = useCallback(
    (args: Parameters<typeof pointerWithin>[0]) => {
      const pointerCollisions = pointerWithin(args);
      if (args.active.data.current?.type !== "activity") return pointerCollisions;

      // An empty day has both a full-column droppable and a smaller, explicit
      // index-0 target. Prefer the target under the pointer so a nearby populated
      // day's card cannot win merely because its center is closer.
      const emptyDayCollisions = pointerCollisions.filter((collision) =>
        String(collision.id).startsWith("edit-empty-day-"),
      );
      if (emptyDayCollisions.length > 0) return emptyDayCollisions;

      // Inter-card gaps are intentional insertion slots. `closestCenter` can
      // otherwise choose either neighbouring card even while the pointer is
      // visibly between them, which makes releases in transport-less gaps look
      // like no-ops. Honour an explicit gap hit before comparing card centers.
      const gapCollisions = pointerCollisions.filter((collision) =>
        String(collision.id).startsWith("edit-gap-"),
      );
      if (gapCollisions.length > 0) return gapCollisions;

      // Prefer the concrete card under the pointer over a surrounding day
      // container. Day-sized droppables are useful for empty dates, but letting
      // them compete with populated cards makes direct swaps unpredictable.
      const activityCollisions = pointerCollisions.filter((collision) =>
        String(collision.id).startsWith("edit-activity-"),
      );
      return activityCollisions.length > 0 ? activityCollisions : pointerCollisions;
    },
    [],
  );

  // ── Drag drop: activities whose times are recalculating server-side (show loading) ──
  const [pendingTimeIds, setPendingTimeIds] = useState<Set<string>>(new Set());

  // ── Adds whose location is still being enriched server-side (place_id-only): the
  //    detail panel shows a skeleton body until createActivity returns the full row. ──
  const [pendingLocationIds, setPendingLocationIds] = useState<Set<string>>(new Set());

  // ── Locked Activities ─────────────────────────────────────────────────────────
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());

  // ── Activity Notes (shared, DB-backed) ─────────────────────────────────────────
  // Each activity has at most ONE note; standalone "overview" notes (activity_id
  // null) live in the same table. Notes are shared so every itinerary member sees
  // the same set (migration 112). A realtime subscription (below) keeps them live.
  const queryClient = useQueryClient();
  const {
    activityNotes,
    saveActivityNote,
    clearActivityNote,
  } = useItineraryNotes(itineraryId);

  // A realtime channel lived here, refetching shared notes when a collaborator
  // changed one. There are no collaborators, and the Supabase project it
  // subscribed to was never configured — the socket only ever retried against
  // `placeholder.supabase.co`.

  // ── Active Collection (secondary browsing) ─────────────────────────────────────
  const [activeCollection, setActiveCollection] = useState<CollectionWithLocations | null>(null);
  const currentItineraryCollection = activeCollection ?? itineraryCollection;
  const isSecondaryCollection = activeCollection !== null;

  // Adding a location to a day mirrors it into the itinerary's companion
  // collection server-side; refetch so the collection panel reflects it without
  // a hard refresh.
  // An itinerary no longer has a companion collection — there is no
  // `collection_id` — so there is nothing to refetch. The PIP panel still works
  // for a collection the user opens explicitly.
  const refetchItineraryCollection = useCallback(() => {}, []);

  // ── Optimize Route Confirmation ────────────────────────────────────────────────
  const [optimizeConfirmOpen, setOptimizeConfirmOpen] = useState(false);
  const [isOptimizingRoute, setIsOptimizingRoute] = useState(false);
  const [pendingOptimize, setPendingOptimize] = useState<{
    dayId: string;
    optimizedActivities: ItineraryActivityDetail[];
    changes: OptimizeRouteResult["changes"];
    dropped: { id: string; name: string }[];
  } | null>(null);

  // ── Deconflict Confirmation ────────────────────────────────────────────────────
  const [isResolvingOverlaps, setIsResolvingOverlaps] = useState(false);
  const [deconflictConfirmOpen, setDeconflictConfirmOpen] = useState(false);
  const [pendingDeconflict, setPendingDeconflict] = useState<{
    dayId: string;
    resolvedActivities: ItineraryActivityDetail[];
    /** Rows whose outgoing leg changed by a reorder — their stale legs are
     *  nulled on save so the backend recomputes fresh Google travel. */
    clearLegIds: string[];
    changes: { activity: ItineraryActivityDetail; newStart: string; newEnd: string }[];
    /** Locked activities in the re-timed region — shown (kept in place) so the
     *  user sees why the cascade reordered around them. */
    lockedAnchors: ItineraryActivityDetail[];
  } | null>(null);

  useEffect(() => {
    if (itinerary?.days) {
      setEditLocalDays((prev) => mergeServerDaysPreservingPending(prev, itinerary.days));
    }
  }, [itinerary?.days]);

  // A lazy-hydrate effect lived here, querying Supabase directly for a
  // location the eager join had missed. `readItineraryDetail` joins `locations`
  // for every stop that has one, and the Supabase project it queried was never
  // configured — the effect could only ever have failed.

  // Flights were the only activities that locked themselves.
  useEffect(() => {
    const autoLocked = new Set<string>();
    if (autoLocked.size > 0) {
      setLockedIds((prev) => {
        const next = new Set(prev);
        for (const id of autoLocked) next.add(id);
        return next;
      });
    }
  }, [editLocalDays]);

  const handleToggleTransportHidden = useCallback((transportId: string) => {
    setHiddenTransports((prev) => {
      const next = new Set(prev);
      if (next.has(transportId)) next.delete(transportId);
      else next.add(transportId);
      return next;
    });
  }, [itineraryId]);

  /**
   * `activityId` is the row the leg departs — that row owns `travel_mode` and the
   * three `travel_*` values. The lodging bookends pass a synthetic
   * `lodging-*-${dayId}` key instead: those legs span a day boundary and have no
   * activity row to persist onto, so they stay local-only until cross-day legs
   * are modelled.
   *
   * Deliberately does not retime the day. See setActivityTravelMode on the server.
   */
  const handleTransportModeChange = useCallback(
    async (activityId: string, mode: string) => {

      const previous = transportModes[activityId];
      setTransportModes((prev) => ({ ...prev, [activityId]: mode as TransportMode }));

      const isPersistable = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        activityId,
      );
      if (!isPersistable) return;

      setPendingTimeIds((prev) => new Set(prev).add(activityId));
      try {
        const result = await setActivityTravelMode(
          itineraryId,
          activityId,
          mode as "drive" | "walk",
        );

        setEditLocalDays((prev) =>
          prev.map((d) => ({
            ...d,
            activities: d.activities.map((a) =>
              a.id === activityId
                ? {
                    ...a,
                    travel_mode: result.travel_mode,
                    travel_duration_seconds: result.travel_duration_seconds,
                    travel_distance_meters: result.travel_distance_meters,
                    travel_polyline: result.travel_polyline,
                  }
                : a,
            ),
          })),
        );

        setUnavailableLegIds((prev) => {
          const next = new Set(prev);
          if (result.unavailable) next.add(activityId);
          else next.delete(activityId);
          return next;
        });

        if (result.unavailable) {
          showToast({
            title:
              mode === "walk"
                ? "No walking route between these stops."
                : "No driving route between these stops.",
            variant: "default",
          });
        }
      } catch (err) {
        console.error("Failed to change transport mode:", err);
        setTransportModes((prev) => {
          const next = { ...prev };
          if (previous) next[activityId] = previous;
          else delete next[activityId];
          return next;
        });
        showToast({
          title: getFriendlyApiError(err, "We couldn't change the transport mode."),
          variant: "error",
        });
      } finally {
        setPendingTimeIds((prev) => {
          const next = new Set(prev);
          next.delete(activityId);
          return next;
        });
      }
    },
    [itineraryId, transportModes, showToast],
  );

  const handleEditResolveOverlaps = useCallback(
    async (dayId: string) => {
      if (!itinerary) return;
      const day = editLocalDays.find((d) => d.id === dayId);
      if (!day) return;

      const proposed = computeProposedOrder({ day, lockedIds });
      if (proposed.firstConflictIndex < 0) return;

      // Price any reorder-created adjacencies exactly before previewing. Common
      // overlaps with no reorder produce none, so no backend call is made.
      const legDurations = new Map<string, number>();
      if (proposed.newAdjacencies.length > 0) {
        setIsResolvingOverlaps(true);
        try {
          const { legs } = await previewDayLegs(
            itineraryId,
            dayId,
            proposed.newAdjacencies.map((p) => ({ from_activity_id: p.from, to_activity_id: p.to })),
          );
          for (const leg of legs) {
            if (leg.durationSeconds != null) {
              legDurations.set(`${leg.from_activity_id}:${leg.to_activity_id}`, leg.durationSeconds);
            }
          }
        } catch (err) {
          console.error("[edit resolve] preview legs failed", err);
          showToast({
            title: getFriendlyApiError(err, "We couldn't calculate travel times. Please try again."),
            variant: "error",
          });
          return;
        } finally {
          setIsResolvingOverlaps(false);
        }
      }

      const resolvedActivities = cascadeTimes({ day, lockedIds }, proposed, legDurations);

      const changes: { activity: ItineraryActivityDetail; newStart: string; newEnd: string }[] = [];
      for (const resolved of resolvedActivities) {
        const original = day.activities.find((a) => a.id === resolved.id);
        if (!original) continue;
        if (!sameWallTime(resolved.start_time, original.start_time) || !sameWallTime(resolved.end_time, original.end_time)) {
          changes.push({ activity: original, newStart: resolved.start_time ?? "", newEnd: resolved.end_time ?? "" });
        }
      }

      if (changes.length === 0) return;

      // Locked anchors inside the re-timed region — shown alongside the changes
      // so the user sees the cascade kept them in place (and reordered around them).
      const lockedAnchors = proposed.ordered
        .slice(proposed.firstConflictIndex)
        .filter((a) => lockedIds.has(a.id));

      setPendingDeconflict({
        dayId,
        resolvedActivities,
        clearLegIds: Array.from(new Set(proposed.newAdjacencies.map((p) => p.from))),
        changes,
        lockedAnchors,
      });
      setDeconflictConfirmOpen(true);
    },
    [itinerary, editLocalDays, lockedIds, itineraryId, showToast],
  );

  const handleDeconflictConfirm = useCallback(async () => {
    if (!pendingDeconflict || !itinerary) return;
    const { dayId, resolvedActivities, clearLegIds } = pendingDeconflict;

    editChangeCountRef.current += resolvedActivities.length;
    setEditLocalDays((prev) =>
      prev.map((d) => (d.id === dayId ? { ...d, activities: resolvedActivities } : d)),
    );
    setDeconflictConfirmOpen(false);
    setPendingDeconflict(null);

    const timezone = ITINERARY_TIMEZONE;
    const day = editLocalDays.find((d) => d.id === dayId);
    if (!day) return;
    const dayDate = parseLocalDate(day.date);
    const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    type MoveArgs = { activityId: string; start_time: string; end_time: string | null };
    const moves: MoveArgs[] = [];
    for (const activity of resolvedActivities) {
      if (!isUuid(activity.id)) continue;
      const original = day.activities.find((a) => a.id === activity.id);
      if (!original) continue;
      if (sameWallTime(original.start_time, activity.start_time) && sameWallTime(original.end_time, activity.end_time)) continue;
      if (!activity.start_time) continue;
      // Lodging anchors (zero-duration) keep end_time = null — backend accepts
      // it. Other rows still require an end_time to be sensible.
      const isZeroAnchor = (activity.category ?? "").toLowerCase().startsWith("lodging_");
      if (!isZeroAnchor && !activity.end_time) continue;
      moves.push({
        activityId: activity.id,
        start_time: hourToISO(timeToHour(activity.start_time), dayDate, timezone),
        end_time: activity.end_time
          ? hourToISO(timeToHour(activity.end_time), dayDate, timezone)
          : null,
      });
    }

    if (moves.length === 0) return;

    try {
      // Persist all new times first (no cascade); legs are preserved by row.
      await Promise.all(
        moves.map((m) =>
          moveActivity(itineraryId, m.activityId, {
            start_time: m.start_time,
            end_time: m.end_time,
          }),
        ),
      );

      // Then trigger a legs-only async refill on the day. Passing one moved id
      // in affected_activity_ids routes through the backend's clear-then-refill
      // branch (recalculateRouteLegs only — no time re-cascade), so the user's
      // confirmed times stick and travel_* fields populate via Google Routes.
      // clear_leg_ids nulls the stale legs on reordered rows so they recompute
      // against their new neighbour.
      const seed = moves[0];
      await moveActivity(itineraryId, seed.activityId, {
        start_time: seed.start_time,
        end_time: seed.end_time,
        affected_activity_ids: [seed.activityId],
        clear_leg_ids: clearLegIds.length > 0 ? clearLegIds : undefined,
      });
    } catch (e) {
      console.error("[edit resolve]", e);
    }
  }, [pendingDeconflict, itinerary, editLocalDays, itineraryId]);

  const handleDeconflictCancel = useCallback(() => {
    setDeconflictConfirmOpen(false);
    setPendingDeconflict(null);
  }, [itineraryId, pendingDeconflict]);

  const handleOptimizeRoute = useCallback(async (dayId: string, lockedOverride?: Set<string>) => {
    const day = editLocalDays.find((d) => d.id === dayId);
    if (!day || !itinerary) return;

    const locked = lockedOverride ?? lockedIds;
    const timezone = ITINERARY_TIMEZONE;
    setIsOptimizingRoute(true);
    try {
      // Runs the real Google Route Optimization on the server (opening hours,
      // meal windows, drops what can't fit) — same engine as the day generator.
      const result = await optimizeDayRoute(itineraryId, dayId, Array.from(locked));

      // Optimizer returns ISO UTC times; convert to local HH:mm to match the
      // rest of the edit-mode representation.
      const toLocalTime = (iso: string) => minsToHHMM(Math.round(timeToHour(iso, timezone) * 60));
      const newTimes = new Map(
        result.activities.map((a) => [a.id, { start: toLocalTime(a.start_time), end: toLocalTime(a.end_time) }]),
      );
      const droppedIds = new Set(result.dropped.map((d) => d.id));

      // Build the optimized day: drop what doesn't fit, retime the rest.
      const optimizedActivities = day.activities
        .filter((a) => !droppedIds.has(a.id))
        .map((a) => {
          const t = newTimes.get(a.id);
          return t ? { ...a, start_time: t.start, end_time: t.end } : a;
        });

      // Compute the change rows for the confirmation dialog (sorted by new time).
      const orderedReal = optimizedActivities
        .filter((a) => isRealActivity(a) && a.start_time)
        .sort((a, b) => parseTimeMins(a.start_time!) - parseTimeMins(b.start_time!));
      const changes: OptimizeRouteResult["changes"] = [];
      orderedReal.forEach((act, index) => {
        const original = day.activities.find((a) => a.id === act.id);
        if (!original) return;
        if (original.start_time !== act.start_time || original.end_time !== act.end_time) {
          changes.push({ activity: original, newStart: act.start_time ?? "", newEnd: act.end_time ?? "", newIndex: index });
        }
      });

      // Nothing actually changed and nothing was dropped — no dialog needed.
      if (changes.length === 0 && result.dropped.length === 0) {
        showToast({ title: "This day's route is already optimized.", variant: "default" });
        return;
      }

      setPendingOptimize({ dayId, optimizedActivities, changes, dropped: result.dropped });
      setOptimizeConfirmOpen(true);
    } catch (e) {
      console.error("[edit optimize]", e);
      showToast({ title: "We couldn't optimize this day's route. Please try again.", variant: "error" });
    } finally {
      setIsOptimizingRoute(false);
    }
  }, [editLocalDays, itinerary, itineraryId, lockedIds, showToast]);

  // Optimize a single activity from its time picker (the wand): run the same
  // day-level Route Optimization, but lock every OTHER activity so only this
  // one (the red selection in the picker) is repositioned.
  const handleOptimizeActivity = useCallback(
    (activityId: string) => {
      const day = editLocalDays.find((d) => d.activities.some((a) => a.id === activityId));
      if (!day) return;
      const locked = new Set(
        day.activities.map((a) => a.id).filter((id) => id !== activityId),
      );
      void handleOptimizeRoute(day.id, locked);
    },
    [editLocalDays, handleOptimizeRoute],
  );

  const handleOptimizeConfirm = useCallback(async () => {
    if (!pendingOptimize || !itinerary) return;
    const { dayId, optimizedActivities, changes, dropped } = pendingOptimize;

    editChangeCountRef.current += changes.length;
    setOptimizeConfirmOpen(false);
    setPendingOptimize(null);

    const day = editLocalDays.find((d) => d.id === dayId);

    // Optimistic local update: drop + retime in one pass.
    setEditLocalDays((prev) =>
      prev.map((d) => (d.id === dayId ? { ...d, activities: optimizedActivities } : d)),
    );
    const timezone = ITINERARY_TIMEZONE;
    const dayDate = day ? parseLocalDate(day.date) : new Date();
    const isUuid = (id: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    // Delete dropped activities first so route-leg recalculation reflects the new
    // set. The location stays in the itinerary collection (shown as "unused").
    await Promise.allSettled(
      dropped.filter((d) => isUuid(d.id)).map((d) => deleteActivity(itineraryId, d.id)),
    );

    // Persist the reorder. affected_activity_ids triggers a full-day route-leg recalc.
    const changedIds = changes.map((c) => c.activity.id).filter(isUuid);
    await Promise.allSettled(
      changes
        .filter((c) => isUuid(c.activity.id) && c.newStart && c.newEnd)
        .map((c) =>
          moveActivity(itineraryId, c.activity.id, {
            start_time: hourToISO(timeToHour(c.newStart), dayDate, timezone),
            end_time: hourToISO(timeToHour(c.newEnd), dayDate, timezone),
            affected_activity_ids: changedIds,
          }),
        ),
    );
  }, [pendingOptimize, itinerary, editLocalDays, itineraryId]);

  const handleOptimizeCancel = useCallback(() => {
    setOptimizeConfirmOpen(false);
    setPendingOptimize(null);
  }, [itineraryId, pendingOptimize]);

  useRecordView("itinerary", itineraryId);

  const defaultCenter = useMemo((): [number, number] | undefined => {
    if (itinerary?.latitude != null && itinerary?.longitude != null) {
      return [itinerary.latitude, itinerary.longitude];
    }
    return undefined;
  }, [itinerary?.latitude, itinerary?.longitude]);

  const bannerUrl = useMemo(() => {
    if (!itinerary) return null;
    if (itinerary.thumbnail_url) return itinerary.thumbnail_url;
    for (const day of itinerary.days) {
      for (const activity of day.activities) {
        const url = activity.photo_url || activity.location?.photo_urls?.[0];
        if (url) return url;
      }
    }
    return null;
  }, [itinerary]);

  const dateLabel = useMemo(() => {
    if (!itinerary) return "";
    return formatDateRangeLabel(itinerary.start_date, itinerary.end_date);
  }, [itinerary?.start_date, itinerary?.end_date]);

  // Nothing edits an itinerary any more, so there is no "last edited".
  const lastEditedLabel = null;

  const totalAttachments = flightAttachments.length + lodgingAttachments.length;

  const handleDeleteItinerary = useCallback(async () => {
    if (deletingItinerary) return;
    setDeletingItinerary(true);
    try {
      await deleteItinerary(itineraryId);
      router.push("/itineraries");
    } catch (err) {
      console.error("Failed to delete itinerary:", err);
      setDeletingItinerary(false);
      setDeleteItineraryConfirmOpen(false);
    }
  }, [deletingItinerary, itineraryId, router]);

  const totalSpots = useMemo(() => {
    if (!itinerary) return 0;
    return itinerary.days.reduce(
      (sum, day) =>
        sum +
        day.activities.filter((a) => {
          const cat = a.category?.toLowerCase() ?? "";
          return cat !== "transportation" && cat !== "transport" && cat !== "travel";
        }).length,
      0
    );
  }, [itinerary?.days]);

  // Set of location IDs already used as activities in the itinerary. Sourced from
  // editLocalDays (the optimistic edit-mode state) so a just-added card registers
  // as "in the itinerary" immediately — that's what the collection panel's
  // "Show Itinerary Activities" toggle filters on. editLocalDays mirrors
  // itinerary.days when not editing, so this is also correct in view mode.
  const itineraryLocationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const day of editLocalDays) {
      for (const activity of day.activities) {
        if (activity.location?.id) {
          ids.add(activity.location.id);
        }
      }
    }
    return ids;
  }, [editLocalDays]);

  // dayId → day and activityId → { activity, dayId } indexes over editLocalDays, each
  // rebuilt once per editLocalDays change. Let the panel's per-tick lookups resolve in
  // O(1) instead of re-scanning editLocalDays on every drag / time-cascade / realtime
  // tick (the activity index replaces an O(days × activities) nested scan).
  const dayById = useMemo(() => {
    const index = new Map<string, ItineraryDayDetail>();
    for (const day of editLocalDays) index.set(day.id, day);
    return index;
  }, [editLocalDays]);

  const activityIndex = useMemo(() => {
    const index = new Map<string, { activity: ItineraryActivityDetail; dayId: string }>();
    for (const day of editLocalDays) {
      for (const activity of day.activities) {
        index.set(activity.id, { activity, dayId: day.id });
      }
    }
    return index;
  }, [editLocalDays]);

  const activityNotePreviews = useMemo(() => {
    const previews = new Map<string, string>();
    for (const [activityId, note] of activityNotes.entries()) {
      const preview = note.content.trim();
      if (preview) previews.set(activityId, preview);
    }
    return previews;
  }, [activityNotes]);

  // Every activity-authored note, flattened in day → activity order, for the
  // Notes tab's combined grid. Clicking one opens its owning activity.
  const activityNotesList = useMemo(() => {
    // Read from the canonical itinerary (view-mode source). editLocalDays is the
    // edit-mode working copy and may be empty until edit mode is opened.
    const days = itinerary?.days ?? [];
    const out: { activityId: string; activityName: string; note: ActivityNote }[] = [];
    for (const day of days) {
      for (const activity of day.activities) {
        const note = activityNotes.get(activity.id);
        if (note?.content?.trim()) {
          out.push({ activityId: activity.id, activityName: activity.name, note });
        }
      }
    }
    return out;
  }, [itinerary, activityNotes]);

  // Sibling activities on the focused activity's day → DayTimePicker markers + conflict detection.
  const activityDaySiblings = useMemo<DayActivityMarker[]>(() => {
    if (panelState?.variant !== "location") return [];
    const day = dayById.get(panelState.activity.day_id);
    if (!day) return [];
    return day.activities.map((a) => ({
      id: a.id,
      start_time: a.start_time,
      end_time: a.end_time,
      name: a.name,
      photo_url: a.photo_url ?? null,
    }));
  }, [panelState, dayById]);

  // The location panel renders the LIVE activity resolved from editLocalDays (the
  // edit-mode source of truth) rather than the frozen snapshot held in panelState,
  // so the open detail view reflects the server-enriched location / cascade times /
  // realtime updates in place — no need to close and re-open. Falls back to the
  // snapshot for activities not in the day list (e.g. a collection-preview location).
  const panelStateLive = useMemo<ItineraryPanelState>(() => {
    if (panelState?.variant !== "location") return panelState;
    const live = activityIndex.get(panelState.activity.id);
    if (live) return { ...panelState, activity: live.activity };
    return panelState;
  }, [panelState, activityIndex]);

  // Sidebar navigation depth for animation direction
  const sidebarDepth = useMemo(() => {
    if (showCollections && selectedLocationDetail) return 2;
    if (showCollections && (selectedCollection || selectedLink)) return 1;
    if (showCollections) return 0;
    return 0;
  }, [showCollections, selectedLocationDetail, selectedCollection, selectedLink]);
  const prevDepthRef = useRef(sidebarDepth);
  const directionRef = useRef<1 | -1>(1);
  useEffect(() => {
    if (sidebarDepth !== prevDepthRef.current) {
      directionRef.current = sidebarDepth > prevDepthRef.current ? 1 : -1;
      prevDepthRef.current = sidebarDepth;
    }
  }, [sidebarDepth]);

  // Refresh calendar days from the database (reused after PATCH)
  const refreshCalendarDays = useCallback(async () => {
    if (!itineraryId) return;
    const data = await fetchItineraryDetail(itineraryId);
    if (data) {
      const days: CalendarDay[] = data.days.map((day) => ({
        id: day.id,
        date: parseLocalDate(day.date),
        // The planner has no timezone — `hours.ts` takes an injected weekday and
        // nothing derives one — so every stamp is UTC and every reader here
        // already defaulted to it.
        activities: day.activities.map((a) => toCalendarActivity(a, undefined)),
      }));
      setCalendarDays(days);
      setItinerary(data);
    }
  }, [itineraryId]);

  // Opens an itinerary pin's own activity in the side panel. Matches the pin back
  // to an activity by location id (or activity id for locally-added pins),
  // preferring the focused day when one is active.
  const handleMapLocationClick = useCallback((location: MapLocation) => {
    const ordered =
      editFocusedDayIndex != null && editLocalDays[editFocusedDayIndex]
        ? [editLocalDays[editFocusedDayIndex], ...editLocalDays.filter((_, i) => i !== editFocusedDayIndex)]
        : editLocalDays;
    for (const day of ordered) {
      const match = day.activities.find(
        (a) => a.location?.id === location.id || a.id === location.id,
      );
      if (match) {
        setPanelState({ variant: "location", activity: match, from: "activity" });
        return;
      }
    }
  }, [editLocalDays, editFocusedDayIndex]);

  // ── Edit Mode DnD Handlers ──────────────────────────────────────────────────
  // A day's real (non-transport) activities, ordered by `position`.
  //
  // Order is read from the DATA, never from array placement. These arrays are
  // rebuilt constantly — React Query refetches, realtime row echoes,
  // `refreshCalendarDays`, the `itinerary.days` → `editLocalDays` sync — and an
  // order that exists only as array identity is lost by whichever of those fires
  // first. Sorting by a field makes every one of those rebuilds harmless.
  //
  // Rows with no position (an optimistic add before its create returns) sort last
  // and hold their relative array order, which is where an append belongs anyway.
  // This is also the list DropGap indexes against, so insertion indexes line up.
  const realActivities = useCallback(
    (activities: ItineraryActivityDetail[]) =>
      activities
        .filter(isRealActivity)
        .map((activity, index) => ({ activity, index }))
        .sort((a, b) => {
          const ap = a.activity.position ?? Number.MAX_SAFE_INTEGER;
          const bp = b.activity.position ?? Number.MAX_SAFE_INTEGER;
          return ap === bp ? a.index - b.index : ap - bp;
        })
        .map(({ activity }) => activity),
    [],
  );

  /** Restamps a day's real activities as a dense 0..n-1 run, so the optimistic
   *  order is expressed in the same field the render path reads. Without this a
   *  local reorder would only change array placement, which the next server echo
   *  discards. */
  const renumber = useCallback(
    (activities: ItineraryActivityDetail[]): ItineraryActivityDetail[] => {
      const transport = activities.filter((a) => !isRealActivity(a));
      const reals = activities
        .filter(isRealActivity)
        .map((activity, position) => (activity.position === position ? activity : { ...activity, position }));
      return [...reals, ...transport];
    },
    [],
  );

  // Places an activity at an explicit position instead of appending it and
  // trusting the time sort to land it there. A dropped card starts exactly when
  // its predecessor ends — which is also when its new successor starts, because
  // `cascadeDayTimes` makes neighbours back-to-back. Those equal start times tie,
  // and a stable sort breaks ties on array order alone, so an appended (or
  // left-in-place) card sinks one slot below where it was dropped.
  const spliceRealActivity = useCallback(
    (
      activities: ItineraryActivityDetail[],
      moved: ItineraryActivityDetail,
      index: number,
    ): ItineraryActivityDetail[] => {
      const reals = realActivities(activities).filter((a) => a.id !== moved.id);
      reals.splice(Math.max(0, Math.min(index, reals.length)), 0, moved);
      return renumber([...reals, ...activities.filter((a) => !isRealActivity(a))]);
    },
    [realActivities, renumber],
  );

  /**
   * Applies a time set through the timeline picker, and re-derives that day's
   * order from it.
   *
   * The picker draws neighbouring activities on a shared axis, so dragging a
   * block against them is a statement about sequence, not just duration. Position
   * stays authoritative for rendering — this is simply the other gesture that
   * *sets* it. Without this the card would keep its old slot and just display a
   * contradicting time (5th in the list, showing 6am).
   *
   * No cascade: a hand-set time is a pin, so neighbours keep their own times.
   */
  const applyActivityTimeChange = useCallback(
    (activityId: string, startTime: string, endTime: string | null) => {
      const tz = ITINERARY_TIMEZONE;

      const withNewOrder = (day: ItineraryDayDetail): ItineraryDayDetail => {
        const updated = day.activities.map((a) =>
          a.id === activityId ? { ...a, start_time: startTime, end_time: endTime } : a,
        );
        const reals = [...updated.filter(isRealActivity)].sort((a, b) => {
          if (!a.start_time && !b.start_time) return 0;
          if (!a.start_time) return 1;
          if (!b.start_time) return -1;
          return parseTimeMins(a.start_time, tz) - parseTimeMins(b.start_time, tz);
        });
        // Restamp: the chronological sort above only rearranged the array, and
        // the render path reads `position`.
        return {
          ...day,
          activities: renumber([...reals, ...updated.filter((a) => !isRealActivity(a))]),
        };
      };

      const day = editLocalDays.find((d) => d.activities.some((a) => a.id === activityId));
      setEditLocalDays((prev) => prev.map((d) => (d.id === day?.id ? withNewOrder(d) : d)));

      if (!day || !itinerary || !ACTIVITY_UUID_RE.test(activityId)) return;
      const orderedIds = realActivities(withNewOrder(day).activities)
        .map((a) => a.id)
        .filter((id) => ACTIVITY_UUID_RE.test(id));
      const dayDate = parseLocalDate(day.date);

      moveActivity(itineraryId, activityId, {
        start_time: hourToISO(timeToHour(startTime), dayDate, tz),
        end_time: endTime == null ? null : hourToISO(timeToHour(endTime), dayDate, tz),
        ordered_activity_ids: orderedIds,
      }).catch((e) => {
        console.error("[edit time change]", e);
        showToast({ title: "Couldn't save the new time. Try again.", variant: "error" });
      });
    },
    [editLocalDays, itinerary, itineraryId, realActivities, renumber, showToast],
  );

  const handleEditDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "location") {
      setEditDragLocation(data.location as Location);
    } else if (data?.type === "activity") {
      setEditDragActivity(data.activity as ItineraryActivityDetail);
      editDragSourceDayIdRef.current = data.dayId as string;
      // Seed the board on the SAME basis the drop handler measures against.
      // `provisionalStartMin` turns the released position into a time by indexing
      // into `realActivities`, so a preview carrying raw array order hands it
      // a position counted in a different list — and the card lands beside the
      // slot it was dropped on rather than in it.
      const seeded = editLocalDays.map((day) => ({
        ...day,
        activities: [
          ...realActivities(day.activities),
          ...day.activities.filter((activity) => !isRealActivity(activity)),
        ],
      }));
      editPreviewDaysRef.current = seeded;
      setEditPreviewDays(seeded);
      setEditDragActivityWidth(event.active.rect.current.initial?.width ?? null);
    }
  }, [editLocalDays, realActivities]);

  // ── Edit Mode Kanban Board ──────────────────────────────────────────────────
  // The board owns the live reorder while a drag is in flight. Its value is each
  // day's real activities in render order, read from the preview when one exists
  // so `editLocalDays` stays committed state and the drop handler keeps reading
  // the preview as the single source of truth for where the card was released.
  const editKanbanValue = useMemo(() => {
    const source = editPreviewDays ?? editLocalDays;
    const columns: Record<string, ItineraryActivityDetail[]> = {};
    for (const day of source) columns[day.id] = realActivities(day.activities);
    return columns;
  }, [editPreviewDays, editLocalDays, realActivities]);

  // Must match the sortable id the day column registers, or the board cannot
  // match the active draggable to a column.
  const getEditActivityId = useCallback(
    (activity: ItineraryActivityDetail) => `edit-activity-${activity.id}`,
    [],
  );

  // Insertion gaps and empty-day targets carry no card or column id of their own,
  // so the board would resolve them to no container and ignore the drop.
  const resolveEditDropTarget = useCallback((over: Over): KanbanDropTarget | null => {
    const data = over.data.current as
      | { type?: string; dayId?: string; index?: number }
      | undefined;
    if (data?.type !== "gap" || !data.dayId) return null;
    return { container: data.dayId, index: data.index ?? 0 };
  }, []);

  const handleEditKanbanChange = useCallback(
    (next: Record<string, ItineraryActivityDetail[]>) => {
      // The board settles its final position *after* the drag-end passthrough has
      // already read the preview and torn it down. Without this guard that last
      // write would resurrect the preview and pin it over the committed days.
      const base = editPreviewDaysRef.current;
      if (!base) return;

      // Lodging is anchored to its day. Reject the whole reshuffle rather than
      // preview a move the drop handler will refuse anyway.
      for (const day of base) {
        for (const activity of day.activities) {
          if (activity.category?.toLowerCase() !== "accommodation") continue;
          const stayed = next[day.id]?.some((candidate) => candidate.id === activity.id);
          const leftForAnotherDay = Object.entries(next).some(
            ([dayId, list]) =>
              dayId !== day.id && list.some((candidate) => candidate.id === activity.id),
          );
          if (!stayed && leftForAnotherDay) return;
        }
      }

      const merged = base.map((day) => {
        const reordered = next[day.id];
        if (!reordered) return day;
        // Transport rows are derived from neighbouring stops, never sortable, so
        // they are absent from the board's columns and must be re-appended here.
        const transport = day.activities.filter((activity) => !isRealActivity(activity));
        return {
          ...day,
          // Restamp positions so the live drag preview renders from the same
          // field the committed list does — otherwise the preview would sort by
          // the pre-drag ordinals and the card would appear not to move.
          activities: renumber([
            ...reordered.map((activity) =>
              activity.day_id === day.id ? activity : { ...activity, day_id: day.id },
            ),
            ...transport,
          ]),
        };
      });

      // dnd-kit can re-fire dragOver for a target that resolves to the order we
      // already hold. Re-rendering the whole day list with fresh array identities
      // for a no-op is pure thrash, so compare before committing.
      const unchanged = merged.every((day, i) => {
        const before = base[i].activities;
        return (
          before.length === day.activities.length &&
          before.every((activity, j) => activity.id === day.activities[j].id)
        );
      });
      if (unchanged) return;

      editPreviewDaysRef.current = merged;
      setEditPreviewDays(merged);
    },
    [renumber],
  );

  const clearEditDragPreview = useCallback(() => {
    editPreviewDaysRef.current = null;
    setEditPreviewDays(null);
    setEditDragActivityWidth(null);
  }, []);

  // Provisional drop start (local minutes) from neighbour times only — no Directions call.
  // Used purely to position the card instantly; the real time comes from the server cascade.
  const provisionalStartMin = useCallback(
    (targetDayId: string, index: number, durationMin: number, excludeActivityId?: string): number => {
      const day = editLocalDays.find((d) => d.id === targetDayId);
      const sorted = realActivities(day?.activities ?? []).filter((activity) => activity.id !== excludeActivityId);
      const prev = index > 0 ? sorted[index - 1] : null;
      const dragTimezone = ITINERARY_TIMEZONE;
      if (prev?.end_time) return parseTimeMins(prev.end_time, dragTimezone);
      if (index === 0 && sorted[0]?.start_time) {
        // Taking the front slot INHERITS the day's existing start; cascadeDayTimes
        // then pushes everything behind it later. Subtracting the card's duration
        // instead walked the whole day backwards on every top-drop (09:00 → 07:30
        // → 06:00 → …), parking the itinerary at 2–5am when nothing is open, and
        // eventually clamping at 00:00 where starts collide and ordering breaks.
        return parseTimeMins(sorted[0].start_time, dragTimezone);
      }
      return 9 * 60;
    },
    [editLocalDays, realActivities],
  );

  const activityTimestampLocalDate = useCallback((timestamp: string | null | undefined, timezone: string) => {
    if (!timestamp?.includes("T")) return null;
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? parseLocalDate(`${year}-${month}-${day}`) : null;
  }, []);

  // Apply the server's Directions cascade (times + legs) to the affected days in place,
  // and clear the loading state once the real times have landed.
  const applyServerCascadeToDays = useCallback(
    (
      relocate: { activityId: string; sourceDayId: string; targetDayId: string } | null,
      affected: { day_id: string; activities: CascadedActivity[] }[],
    ) => {
      const tz = ITINERARY_TIMEZONE;
      const toLocal = (iso: string) => minsToHHMM(Math.round(timeToHour(iso, tz) * 60));

      setEditLocalDays((prev) => {
        let days = prev;

        // 1. Reflect the structural cross-day move (DB already did it). Strip the
        // moving activity from every day first, then re-add it once to the target,
        // so a stale copy left in another day (optimistic move + resync race) can
        // never produce two rows with the same id.
        if (relocate && relocate.sourceDayId !== relocate.targetDayId) {
          const moving = prev.flatMap((d) => d.activities).find((a) => a.id === relocate.activityId);
          if (moving) {
            days = days.map((d) => ({
              ...d,
              activities: d.activities.filter((a) => a.id !== relocate.activityId),
            }));
            days = days.map((d) =>
              d.id === relocate.targetDayId
                ? { ...d, activities: [...d.activities, { ...moving, day_id: relocate.targetDayId }] }
                : d,
            );
          }
        }

        // 2. Apply the server times + legs for each affected day.
        const byDay = new Map(affected.map((a) => [a.day_id, a.activities]));
        return days.map((d) => {
          const rows = byDay.get(d.id);
          if (!rows) return d;
          const byId = new Map(rows.map((r) => [r.id, r]));
          return {
            ...d,
            activities: d.activities.map((a) => {
              const r = byId.get(a.id);
              if (!r) return a;
              return {
                ...a,
                start_time: r.start_time ? toLocal(r.start_time) : a.start_time,
                // Server is authoritative post-cascade: a null end_time means the
                // row is a single-time point (e.g. a "no duration" stop), so honor
                // it instead of keeping a stale local end_time.
                end_time: r.end_time ? toLocal(r.end_time) : null,
                travel_duration_seconds: r.travel_duration_seconds,
                travel_distance_meters: r.travel_distance_meters,
                travel_polyline: r.travel_polyline,
                travel_mode: r.travel_mode ?? a.travel_mode,
              };
            }),
          };
        });
      });
      setPendingTimeIds(new Set());
    },
    [],
  );

  // Shared "add a new activity to a day" path used by the map-search add, the collection
  // "add to day", and the add-location form. Drops the card in optimistically, then runs
  // the server Directions cascade (recompute_times) so it gets real travel legs + times.
  // - `insertAtIndex` (when given) seeds the provisional start from the slot's preceding
  //   activity so the card lands at that position; otherwise it's appended after the last.
  // - A stop without lat/lng gets NO optimistic travel data and the server skips the
  //   Directions call for legs into/out of it, so no phantom leg renders.
  const addActivityToDay = useCallback(
    (opts: {
      dayId: string;
      insertAtIndex?: number;
      name: string;
      category: "poi" | "meal";
      durationMin?: number;
      /** Explicit start/end ("HH:MM") from the Add Location form; overrides auto-placement. */
      startTime?: string;
      endTime?: string;
      latitude?: number | null;
      longitude?: number | null;
      placeId?: string;
      locationId?: string;
      photoUrl?: string | null;
      photoUrls?: string[] | null;
      formattedAddress?: string | null;
      googleMapsUri?: string | null;
      locationContext?: string | null;
      regularOpeningHours?: { weekdayDescriptions: string[] } | null;
      /** Enterprise place data from search, forwarded so the server skips a redundant Place Details fetch. */
      placeDetails?: PlaceDetailsPayload;
      /** Rich location fields (rating, hours, etc.) merged into the optimistic card so they show instantly. */
      optimisticLocation?: Partial<ActivityLocation>;
    }) => {
      const { dayId, insertAtIndex, name, category } = opts;
      const targetIdx = editLocalDays.findIndex((d) => d.id === dayId);
      const targetDay = editLocalDays[targetIdx];
      if (!targetDay) return;

      const tz = ITINERARY_TIMEZONE;
      const dayDate = parseLocalDate(targetDay.date);
      const durationMin = opts.durationMin ?? 60;
      const hasCoords = opts.latitude != null && opts.longitude != null;
      const ceilToStep = (mins: number) => Math.ceil(mins / 10) * 10;

      // Provisional start: by insertion index when given, else after the day's last activity.
      // Explicit times from the Add Location form take precedence over auto-placement.
      const hhmmToMin = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return (h ?? 0) * 60 + (m ?? 0);
      };
      const explicitStart = opts.startTime ? hhmmToMin(opts.startTime) : null;
      const explicitEnd = opts.endTime ? hhmmToMin(opts.endTime) : null;

      // A start-only add (explicit start, no end, no duration) is a point-in-time
      // activity: no synthesized stay block. The server cascade keeps end_time null
      // and anchors the next leg off the start. Auto-placed/collection adds (no
      // explicit start) keep the default block.
      const isPointInTime = explicitStart != null && explicitEnd == null && opts.durationMin == null;

      let startMin: number;
      if (explicitStart != null) {
        startMin = explicitStart;
      } else if (insertAtIndex != null) {
        startMin = ceilToStep(provisionalStartMin(dayId, insertAtIndex, durationMin));
      } else {
        const sortedActs = targetDay.activities
          .filter((a) => a.start_time)
          .sort((a, b) => timeToHour(a.start_time!, tz) - timeToHour(b.start_time!, tz));
        let startHour = 9;
        if (sortedActs.length > 0) {
          const lastEnd = sortedActs[sortedActs.length - 1].end_time;
          if (lastEnd) startHour = timeToHour(lastEnd, tz);
        }
        startMin = ceilToStep(Math.round(startHour * 60));
      }
      const endMin = isPointInTime
        ? startMin
        : explicitEnd != null && explicitEnd > startMin
          ? explicitEnd
          : ceilToStep(startMin + durationMin);
      const fmt = (mins: number) =>
        `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

      const tempId = `temp-${Date.now()}`;
      // Stable token tying this optimistic card to its persisted row. Sent in the
      // POST and echoed back on the realtime INSERT, so the temp→server swap is
      // deterministic even after the server rewrites name/start_time (a custom add
      // has no place_id/location_id to fall back on).
      const newActivity: ItineraryActivityDetail = {
        id: tempId,
        day_id: dayId,
        day_index: targetIdx,
        name,
        start_time: fmt(startMin),
        end_time: isPointInTime ? null : fmt(endMin),
        category,
        photo_url: opts.photoUrl ?? null,
        location: {
          id: opts.locationId ?? `loc-${Date.now()}`,
          name,
          latitude: opts.latitude ?? null,
          longitude: opts.longitude ?? null,
          photo_urls: opts.photoUrls ?? (opts.photoUrl ? [opts.photoUrl] : null),
          formatted_address: opts.formattedAddress ?? null,
          editorial_summary: opts.locationContext ?? null,
          regular_opening_hours: opts.regularOpeningHours ?? null,
          stay_duration: opts.durationMin ?? null,
          // Rich fields (rating/price/hours/phone/website) so the card renders them
          // immediately; overrides the bare defaults above where present.
          ...opts.optimisticLocation,
        },
      };

      setEditLocalDays((prev) =>
        prev.map((d) =>
          d.id === dayId
            ? {
                ...d,
                // An insert at an explicit slot starts exactly when its predecessor
                // ends, tying with its new successor — so it has to be placed by
                // position, not appended and left to the time sort. A plain add
                // (no slot) clamps to the end, which is where it belongs.
                activities: cascadeDayTimes(
                  spliceRealActivity(d.activities, newActivity, insertAtIndex ?? d.activities.length),
                  tz,
                ),
              }
            : d,
        ),
      );
      setPanelState({ variant: "location", activity: newActivity, from: "activity" });
      setEditFocusedDayIndex(targetIdx);
      setEditFitBoundsKey((k) => k + 1);

      // Any add that resolves to a server-side location (by place_id or an existing
      // location_id) gets enriched/backfilled server-side — stay duration, context,
      // price, and (Pro-tier) the contact fields all arrive with the createActivity
      // response. Flag it so the panel shows per-field skeletons for whatever the
      // optimistic card is still missing, filled in live on reveal. Per-field
      // skeletons never hide data we already have, so a fully-enriched add (resolved
      // link / collection) simply shows no visible skeleton.
      const locationPending = Boolean(opts.placeId || opts.locationId);
      if (locationPending) {
        setPendingLocationIds((prev) => new Set(prev).add(tempId));
      }

      createActivity(itineraryId, {
        day_id: dayId,
        name,
        start_time: hourToISO(startMin / 60, dayDate, tz),
        ...(isPointInTime ? {} : { end_time: hourToISO(endMin / 60, dayDate, tz) }),
        category,
        ...(opts.placeId ? { place_id: opts.placeId } : {}),
        ...(opts.locationId ? { location_id: opts.locationId } : {}),
        ...(opts.placeDetails ? { place_details: opts.placeDetails } : {}),
        ...(hasCoords ? { latitude: opts.latitude!, longitude: opts.longitude! } : {}),
        ...(opts.photoUrl ? { photo_url: opts.photoUrl } : {}),
        // An add aimed at a gap keeps that slot; a plain add omits it and appends.
        ...(insertAtIndex != null ? { position: insertAtIndex } : {}),
        recompute_times: true,
      })
        .then((created) => {
          // Swap the temp id for the server id (on both the day and the open panel)
          // and, when the server enriched a place_id-only add, fold in the joined
          // location so the card reveals full detail in one go. Then apply the
          // Directions cascade so the leg polyline + times land.
          const serverLocation = locationPending ? created.location ?? null : null;
          setEditLocalDays((prev) =>
            prev.map((d) =>
              d.id === dayId
                ? {
                    ...d,
                    activities: d.activities.map((a) =>
                      a.id === tempId
                        ? {
                            ...a,
                            id: created.id,
                            ...(created.photo_url ? { photo_url: created.photo_url } : {}),
                            ...(serverLocation ? { location: serverLocation } : {}),
                          }
                        : a,
                    ),
                  }
                : d,
            ),
          );
          // Track the temp→server id swap so the panel's live lookup (panelStateLive)
          // keeps resolving the right row from editLocalDays — which already holds the
          // server location + photo, so we don't re-stuff them into the snapshot here.
          setPanelState((prev) =>
            prev?.variant === "location" && prev.activity.id === tempId
              ? { variant: "location", activity: { ...prev.activity, id: created.id }, from: "activity" }
              : prev,
          );
          if (locationPending) {
            if (serverLocation) {
              // Enriched location arrived — drop the skeleton; the card now
              // renders full detail.
              setPendingLocationIds((prev) => {
                const next = new Set(prev);
                next.delete(tempId);
                return next;
              });
            } else {
              // Server returned no joined location (enrichment failed, or the
              // route's locations select errored and was swallowed). Clearing
              // the skeleton here would reveal the bare optimistic card with
              // blank address/hours/price rows. Instead keep the skeleton —
              // re-keyed to the swapped server id — and pull authoritative data;
              // clear it only once the refetch settles so a real location (or
              // the place_id lazy-hydrate fallback) can fill the card.
              setPendingLocationIds((prev) => {
                const next = new Set(prev);
                next.delete(tempId);
                next.add(created.id);
                return next;
              });
              refreshCalendarDays().finally(() => {
                setPendingLocationIds((prev) => {
                  const next = new Set(prev);
                  next.delete(created.id);
                  return next;
                });
              });
            }
          }
          if (created.cascade) {
            applyServerCascadeToDays(null, [
              { day_id: created.cascade.day_id, activities: created.cascade.activities },
            ]);
          }
          if (created.location_id) refetchItineraryCollection();
        })
        .catch((e) => {
          console.error("[addActivityToDay] create failed:", e);
          if (locationPending) {
            setPendingLocationIds((prev) => {
              const next = new Set(prev);
              next.delete(tempId);
              return next;
            });
          }
          refreshCalendarDays();
        });
    },
    [editLocalDays, itineraryId, provisionalStartMin, refreshCalendarDays, applyServerCascadeToDays, refetchItineraryCollection, spliceRealActivity],
  );

  // Map-search "Add to itinerary": appends a searched place to a day (no positional index).
  const handleAddSearchPlace = useCallback((dayId: string, place: PlaceSearchResult) => {
    editChangeCountRef.current += 1;
    const isMeal = place.types.some((t) =>
      ["restaurant", "cafe", "coffee_shop", "bar", "pub", "bakery", "meal_takeaway"].includes(t),
    );
    addActivityToDay({
      dayId,
      name: place.name,
      category: isMeal ? "meal" : "poi",
      latitude: place.latitude,
      longitude: place.longitude,
      placeId: place.id,
      photoUrl: place.photoUrl ?? null,
      formattedAddress: place.address ?? null,
      googleMapsUri: place.googleMapsUri ?? null,
      placeDetails: toPlaceDetailsPayload(place),
      optimisticLocation: searchPlaceToActivityLocationFields(place),
    });
  }, [addActivityToDay]);

  const handleEditDragEnd = useCallback((event: DragEndEvent) => {
    // The board applies each reorder synchronously during the drag, so the
    // preview already holds the exact order the card was released into.
    const previewDaysAtDrop = editPreviewDaysRef.current;
    clearEditDragPreview();
    const { active, over } = event;
    const activeData = active.data.current;
    const overData = over?.data.current as Record<string, unknown> | undefined;
    const overDayId = overData?.dayId as string | undefined;
    const overIndex = typeof overData?.index === "number" ? (overData.index as number) : undefined;

    const tz = ITINERARY_TIMEZONE;

    if (activeData?.type === "location") {
      const location = activeData.location as Location;
      const dayId = overDayId;
      const targetDay = dayId ? editLocalDays.find((d) => d.id === dayId) : undefined;
      const dayDate = targetDay?.date ? parseLocalDate(targetDay.date) : new Date();
      if (dayId) {
        const currentTargetActivities = realActivities(targetDay?.activities ?? []);
        const index = overIndex ?? currentTargetActivities.length;
        const durationMin = location.stay_duration ?? 60;
        const startMin = provisionalStartMin(dayId, index, durationMin);
        const endMin = ceilToDragStep(startMin + durationMin);
        const tempId = `temp-${Date.now()}`;

        const newActivity: ItineraryActivityDetail = {
          id: tempId,
          day_id: dayId,
          day_index: editLocalDays.findIndex((d) => d.id === dayId),
          name: location.name,
          start_time: minsToHHMM(startMin),
          end_time: minsToHHMM(endMin),
          category: "poi",
          photo_url: location.photo_urls?.[0] ?? null,
          location: {
            id: location.id,
            name: location.name,
            latitude: location.latitude ?? null,
            longitude: location.longitude ?? null,
            photo_urls: location.photo_urls ?? null,
            formatted_address: location.formatted_address ?? null,
            editorial_summary: location.location_context ?? null,
            regular_opening_hours: location.regular_opening_hours as
              | { weekdayDescriptions: string[] }
              | null,
            stay_duration: location.stay_duration ?? null,
            primary_type: location.primary_type ?? null,
          },
        };

        // Optimistic: drop the card into place instantly with provisional times.
        // The card now ahead of the new one had its outgoing leg pointed at a
        // different successor, so clear that stale leg until the cascade returns.
        setEditLocalDays((prev) =>
          prev.map((d) => {
            if (d.id !== dayId) return d;
            const timed = cascadeDayTimes(spliceRealActivity(d.activities, newActivity, index), tz);
            const insertedIdx = timed.findIndex((a) => a.id === tempId);
            const stale = new Set<string>([tempId]);
            if (insertedIdx > 0) stale.add(timed[insertedIdx - 1].id);
            return { ...d, activities: clearLegs(timed, stale) };
          }),
        );
        // The new card + everything after it will be (re)timed by the server cascade.
        const targetAfter = cascadeDayTimes(
          spliceRealActivity(targetDay?.activities ?? [], newActivity, index),
          tz,
        );
        setPendingTimeIds(new Set(downstreamIds(realActivities(targetAfter), tempId)));

        void (async () => {
          try {
            const created = await createActivity(itineraryId, {
              day_id: dayId,
              name: location.name,
              start_time: hourToISO(startMin / 60, dayDate, tz),
              end_time: hourToISO(endMin / 60, dayDate, tz),
              category: "poi",
              // The slot it was dropped into. Without it the server appends and
              // the card jumps to the end of the day on the next read.
              position: index,
              location_id: location.id,
              place_id: location.place_id ?? undefined,
              photo_url: location.photo_urls?.[0] ?? undefined,
              latitude: location.latitude,
              longitude: location.longitude,
              recompute_times: true,
            });
            // Swap the temp id for the server id before applying cascade times.
            setEditLocalDays((prev) =>
              prev.map((d) =>
                d.id === dayId
                  ? { ...d, activities: d.activities.map((a) => (a.id === tempId ? { ...a, id: created.id } : a)) }
                  : d,
              ),
            );
            if (created.cascade) {
              applyServerCascadeToDays(null, [
                { day_id: created.cascade.day_id, activities: created.cascade.activities },
              ]);
            } else {
              setPendingTimeIds(new Set());
            }
            if (created.location_id) refetchItineraryCollection();
          } catch (e) {
            console.error("[editDragEnd] create failed:", e);
            setPendingTimeIds(new Set());
            refreshCalendarDays();
          }
        })();
      }
      setEditDragLocation(null);
      return;
    }

    if (activeData?.type === "activity") {
      const activity = activeData.activity as ItineraryActivityDetail;
      // The preview re-renders the active sortable card in its prospective day,
      // which updates dnd-kit's mutable active data. Preserve the real source
      // captured at drag start so a cross-day drop still sends `day_id`.
      const sourceDayId = editDragSourceDayIdRef.current ?? (activeData.dayId as string);
      const previewTargetDay = previewDaysAtDrop?.find((day) =>
        day.activities.some((candidate) => candidate.id === activity.id),
      );
      const previewTargetActivities = previewTargetDay?.activities.filter(isRealActivity) ?? [];
      const previewTargetIndex = previewTargetActivities.findIndex((candidate) => candidate.id === activity.id);
      const dayId = previewTargetDay?.id ?? overDayId;
      if (dayId) {
        const targetDay = editLocalDays.find((d) => d.id === dayId);
        const dayDate = targetDay?.date ? parseLocalDate(targetDay.date) : new Date();
        const isCrossDay = sourceDayId !== dayId;
        const currentTargetActivities = realActivities(targetDay?.activities ?? []);
        const currentSourceActivities = realActivities(
          editLocalDays.find((day) => day.id === sourceDayId)?.activities ?? [],
        );
        const currentIndex = currentSourceActivities.findIndex((candidate) => candidate.id === activity.id);
        const droppedOnActivity = overData?.type === "activity";
        const droppedOnGap = overData?.type === "gap";

        // Lodging activities are anchored to their day.
        if (isCrossDay && activity.category?.toLowerCase() === "accommodation") {
          showToast({ title: "Lodging activities cannot be moved to a different day.", variant: "error" });
          setEditDragActivity(null);
          editDragSourceDayIdRef.current = null;
          return;
        }

        const rawIndex = overIndex ?? currentTargetActivities.length;
        const fallbackIndex = droppedOnGap && !isCrossDay && currentIndex >= 0 && currentIndex < rawIndex
          ? rawIndex - 1
          : rawIndex;
        const index = previewTargetIndex >= 0 ? previewTargetIndex : fallbackIndex;

        // The transient preview already contains the exact final order. Comparing
        // its trailing gap against the original list caused valid upward moves
        // (for example hotel index 3 → preview index 2) to be mistaken for no-ops.
        if (
          !isCrossDay &&
          currentIndex !== -1 &&
          (
            index === currentIndex ||
            (previewTargetIndex < 0 && !droppedOnActivity && !droppedOnGap)
          )
        ) {
          setEditDragActivity(null);
          editDragSourceDayIdRef.current = null;
          return;
        }

        // Single-time activities (start set, no end) carry no duration — e.g. a
        // lodging card the user left as "no duration". Moving must keep them as a
        // point: never synthesize a 60-minute block or an end_time.
        const isPointInTime = !!activity.start_time && !activity.end_time;
        let durationMin = 60;
        if (activity.start_time && activity.end_time) {
          let d = parseTimeMins(activity.end_time, tz) - parseTimeMins(activity.start_time, tz);
          if (d < 0) d += 24 * 60;
          if (d > 0) durationMin = d;
        }
        if (isPointInTime) durationMin = 0;
        const startMin = provisionalStartMin(dayId, index, durationMin, activity.id);
        const endMin = ceilToDragStep(startMin + durationMin);
        const targetWithoutMoving = currentTargetActivities.filter((candidate) => candidate.id !== activity.id);
        const previousAtDrop = index > 0 ? targetWithoutMoving[index - 1] : null;
        const nextAtDrop = targetWithoutMoving[index] ?? null;
        const referenceTimestamp = previousAtDrop?.end_time
          ?? previousAtDrop?.start_time
          ?? nextAtDrop?.start_time;
        // Existing itineraries can contain ISO timestamps whose calendar date
        // differs from `itinerary_days.date` while their displayed wall time is
        // still valid. Stay in the neighbouring activity's local date cohort so
        // timestamp sorting preserves the requested adjacency.
        const persistedDate = activityTimestampLocalDate(referenceTimestamp, tz) ?? dayDate;
        const movedActivity = {
          ...activity,
          start_time: minsToHHMM(startMin),
          end_time: isPointInTime ? null : minsToHHMM(endMin),
          day_id: dayId,
        };

        // Pending = moved card + everything after it (target), and the gap it leaves (source).
        const pending = new Set<string>();
        const sourceSorted = realActivities((editLocalDays.find((d) => d.id === sourceDayId)?.activities) ?? []);
        if (isCrossDay) {
          for (const id of downstreamIds(sourceSorted, activity.id)) if (id !== activity.id) pending.add(id);
        }

        // Optimistic: move the card into place instantly with provisional times.
        // Clear stale legs on rows whose successor changed: the card now ahead of
        // the moved card (target) and the card that used to be ahead of it (source),
        // plus the moved card itself — each gets a fresh leg from the cascade.
        setEditLocalDays((prev) => {
          let updated = prev;
          if (isCrossDay) {
            updated = updated.map((d) => {
              if (d.id !== sourceDayId) return d;
              const before = realActivities(d.activities);
              const oldIdx = before.findIndex((a) => a.id === activity.id);
              const oldPredId = oldIdx > 0 ? before[oldIdx - 1].id : null;
              const remaining = cascadeDayTimes(d.activities.filter((a) => a.id !== activity.id), tz);
              return { ...d, activities: clearLegs(remaining, new Set(oldPredId ? [oldPredId] : [])) };
            });
            updated = updated.map((d) => {
              if (d.id !== dayId) return d;
              const timed = cascadeDayTimes(spliceRealActivity(d.activities, movedActivity, index), tz);
              const movedIdx = timed.findIndex((a) => a.id === activity.id);
              const stale = new Set<string>([activity.id]);
              if (movedIdx > 0) stale.add(timed[movedIdx - 1].id);
              return { ...d, activities: clearLegs(timed, stale) };
            });
          } else {
            updated = updated.map((d) => {
              if (d.id !== dayId) return d;
              const before = realActivities(d.activities);
              const oldIdx = before.findIndex((a) => a.id === activity.id);
              const oldPredId = oldIdx > 0 ? before[oldIdx - 1].id : null;
              const timed = cascadeDayTimes(spliceRealActivity(d.activities, movedActivity, index), tz);
              const movedIdx = timed.findIndex((a) => a.id === activity.id);
              const stale = new Set<string>([activity.id]);
              if (movedIdx > 0) stale.add(timed[movedIdx - 1].id);
              if (oldPredId) stale.add(oldPredId);
              return { ...d, activities: clearLegs(timed, stale) };
            });
          }
          return updated;
        });
        const targetBase = spliceRealActivity(targetDay?.activities ?? [], movedActivity, index);

        // The authoritative post-drop sequence sent to the server. Optimistic
        // adds still holding a `temp-` id have no row to renumber yet, so they
        // are dropped rather than failing the endpoint's uuid validation — their
        // own create call appends them once it lands.
        const persistedIds = (activities: ItineraryActivityDetail[]) =>
          realActivities(activities)
            .map((a) => a.id)
            .filter((id) => ACTIVITY_UUID_RE.test(id));
        const targetOrderedIds = persistedIds(targetBase);
        const sourceOrderedIds = isCrossDay
          ? persistedIds(
              (editLocalDays.find((d) => d.id === sourceDayId)?.activities ?? []).filter(
                (a) => a.id !== activity.id,
              ),
            )
          : undefined;

        for (const id of downstreamIds(realActivities(cascadeDayTimes(targetBase, tz)), activity.id)) pending.add(id);
        setPendingTimeIds(pending);

        void (async () => {
          try {
            const result = await moveActivity(itineraryId, activity.id, {
              ...(isCrossDay ? { day_id: dayId, source_day_id: sourceDayId } : {}),
              start_time: hourToISO(startMin / 60, persistedDate, tz),
              end_time: isPointInTime ? null : hourToISO(endMin / 60, persistedDate, tz),
              recompute_times: true,
              // The order is the instruction; the times above are only a hint the
              // cascade uses as a floor when scheduling. Sending the day's whole
              // id list keeps the write idempotent and free of index-shift
              // ambiguity — the server assigns position = array index.
              ordered_activity_ids: targetOrderedIds,
              ...(isCrossDay && sourceOrderedIds ? { source_ordered_activity_ids: sourceOrderedIds } : {}),
            });
            if (result) {
              const affected = [{ day_id: result.day_id, activities: result.activities }];
              if (result.source_day) {
                affected.push({ day_id: result.source_day.day_id, activities: result.source_day.activities });
              }
              applyServerCascadeToDays({ activityId: activity.id, sourceDayId, targetDayId: dayId }, affected);
              // The cached detail still holds the pre-drag order, and it outlives
              // this component (staleTime 5m). Without this, navigating away and
              // back re-seeds `itinerary` from that stale cache and the reorder
              // appears to have been lost until a hard refresh.
              queryClient.invalidateQueries({ queryKey: queryKeys.itineraryDetail(itineraryId) });
            } else {
              setPendingTimeIds(new Set());
              refreshCalendarDays();
            }
          } catch (e) {
            // The endpoint persists start_time before it persists position, so a
            // failure here can leave the day retimed but not reordered. Log the
            // status: silently resyncing makes that half-write look like the
            // drag simply didn't take.
            const status = (e as { status?: number }).status;
            console.error(`[editDragEnd] move failed (status ${status ?? "network"}):`, e);
            setPendingTimeIds(new Set());
            refreshCalendarDays();
          }
        })();
      }
      setEditDragActivity(null);
      editDragSourceDayIdRef.current = null;
      return;
    }

    setEditDragLocation(null);
    setEditDragActivity(null);
    editDragSourceDayIdRef.current = null;
  }, [editLocalDays, itineraryId, realActivities, provisionalStartMin, activityTimestampLocalDate, applyServerCascadeToDays, refreshCalendarDays, showToast, refetchItineraryCollection, clearEditDragPreview, spliceRealActivity, queryClient]);

  const handleEditDragCancel = useCallback(() => {
    clearEditDragPreview();
    setEditDragLocation(null);
    setEditDragActivity(null);
    editDragSourceDayIdRef.current = null;
  }, [clearEditDragPreview]);

  useEffect(() => { itineraryRef.current = itinerary; }, [itinerary]);

  // Keyed on the mode rather than the toggle handler: an itinerary with no real
  // activities flips itself into edit mode on load, which would otherwise start
  // an untracked session (and swallow its matching exit).
  useEffect(() => {
    if (quickViewEditMode !== "edit") return;
    editEnteredAtRef.current = Date.now();
    editChangeCountRef.current = 0;
    return () => {
      if (editEnteredAtRef.current == null) return;
      editEnteredAtRef.current = null;
    };
  }, [quickViewEditMode, itineraryId]);

  const itineraryViewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!itinerary || itineraryViewedRef.current === itinerary.id) return;
    itineraryViewedRef.current = itinerary.id;
  }, [itinerary]);

  // Populate local state from React Query cache on first arrival
  useEffect(() => {
    if (!queryData || itinerary) return;
    setItinerary(queryData);
    setDateRange({ from: parseLocalDate(queryData.start_date), to: parseLocalDate(queryData.end_date) });
    const days: CalendarDay[] = queryData.days.map((day) => ({
      id: day.id,
      date: parseLocalDate(day.date),
      activities: day.activities.map((a) => toCalendarActivity(a, undefined)),
    }));
    setCalendarDays(days);
    // UXR-016: drop the user straight into edit mode when the itinerary has no
    // real activities yet — view mode of an empty itinerary has nothing to see
    // or do, and the add path is hidden behind the View/Edit toggle. This runs
    // once on first arrival (guarded by `itinerary` above), so it never yanks a
    // user back to edit if they later toggle to view on an empty itinerary.
    // Mirrors `totalSpots` semantics: transport-type activities don't count.
    const realSpots = queryData.days.reduce(
      (sum, day) =>
        sum +
        day.activities.filter((a) => {
          const cat = a.category?.toLowerCase() ?? "";
          return cat !== "transportation" && cat !== "transport" && cat !== "travel";
        }).length,
      0,
    );
    const canEnterEdit = window.matchMedia?.("(min-width: 768px)").matches ?? false;
    if (realSpots === 0 && canEnterEdit) {
      setQuickViewEditMode("edit");
    }
  }, [queryData, itinerary]);

  // Eagerly load user collections for the PIP panel
  useEffect(() => {
    if (collections.length > 0 || collectionsLoading) return;
    setCollectionsLoading(true);
    getCollections()
      .then((data) => setCollections(data))
      .catch(() => setCollections([]))
      .finally(() => setCollectionsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight activity from ?highlight=<locationId> URL param (search navigation)
  useEffect(() => {
    if (!highlightLocationId || calendarDays.length === 0) return;

    let matchedActivity: CalendarActivity | null = null;
    for (const day of calendarDays) {
      for (const activity of day.activities) {
        if (activity.locationId === highlightLocationId) {
          matchedActivity = activity;
          break;
        }
      }
      if (matchedActivity) break;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("highlight");
    window.history.replaceState({}, "", url.pathname + url.search);

    if (!matchedActivity) return;

    setSelectedActivity(matchedActivity);
    setIsPanelOpen(true);
    setHighlightedActivityId(matchedActivity.id);

    const timer = setTimeout(() => setHighlightedActivityId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightLocationId, calendarDays]);

  useEffect(() => {
    if (itinerary) {
      setFilter({
        type: "itinerary",
        label: itinerary.name,
        thumbnailUrl: bannerUrl ?? undefined,
        entityId: itinerary.id,
      });
    }
    return () => { setFilter(null); };
  }, [bannerUrl, itinerary?.id, itinerary?.name, setFilter]);

  // Hydrate the trip's flights. This is what makes a booking survive a reload:
  // `completeFlightBooking` writes the row, and this reads it back on the next
  // visit. Nothing loaded flights before, which is the other half of why a
  // booked fare used to vanish the moment the page re-rendered from scratch.
  //
  // On mount rather than when the Flight tab opens, unlike lodgings: the flight
  // list also draws the airport markers and route polylines on the map, and a
  // tab-gated fetch would leave the map wrong until somebody clicked.
  useEffect(() => {
    if (!itineraryId) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await getFlights(itineraryId);
        if (cancelled) return;
        setFlights(rows.map(mapExtractedFlightToCardProps));
      } catch (err) {
        // An empty flight list and a failed fetch look identical on the page,
        // so the difference goes to the terminal rather than nowhere.
        console.error("[flights] the trip's flights could not be loaded", err);
      }
    })();
    return () => { cancelled = true; };
  }, [itineraryId]);

  // Load airport coords directly from the `locations` table (the backend upserts
  // them during flight upload/create via the resolveAirport helper). Used to draw
  // airport markers + route polylines in editFlightMapData below.
  useEffect(() => {
    if (flights.length === 0 || !itineraryId) return;
    const codes = new Set<string>();
    for (const f of flights) {
      if (f.fromCode) codes.add(f.fromCode.toUpperCase());
      if (f.toCode) codes.add(f.toCode.toUpperCase());
    }
    const missing = [...codes].filter(c => !airportLocations.has(c));
    if (missing.length === 0) return;
    // Airports were looked up by IATA code in a Supabase `locations` table with
    // `iata_code` and `terminal` columns. The Neon table of the same name has
    // neither — it holds Google Places rows — so there is nothing to query and
    // no way to fake one. Flights are unbacked here anyway (see
    // `src/lib/api/flights.ts`), so no airport is ever asked for.
  }, [flights, itineraryId, airportLocations]);

  // Fetch existing lodgings when the accommodation sidebar opens
  useEffect(() => {
    if ((!showLodgingSidebar && editActiveTab !== "Lodging") || lodgingsLoaded || !itineraryId) return;

    getLodgings(itineraryId)
      .then((rows) => {
        if (rows.length === 0) return;

        const mapped: LodgingCardProps[] = rows.map((l) => ({
          id: l.id,
          image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800",
          address: l.address ?? "",
          name: l.name ?? "",
          confirmation: l.confirmation ?? "",
          cost: l.cost != null ? String(l.cost) : "",
          checkIn: formatLodgingDate(l.check_in_date),
          checkInTime: formatTimeOfDay(l.check_in_time),
          checkOut: formatLodgingDate(l.check_out_date),
          checkOutTime: formatTimeOfDay(l.check_out_time),
          checkInDate: l.check_in_date,
          checkInTimeRaw: l.check_in_time?.slice(0, 5) ?? undefined,
          checkOutDate: l.check_out_date,
          checkOutTimeRaw: l.check_out_time?.slice(0, 5) ?? undefined,
          currency: l.currency ?? undefined,
          latitude: l.latitude ?? undefined,
          longitude: l.longitude ?? undefined,
          sourceAttachmentId: l.source_attachment_id ?? null,
        }));
        setLodgings(mapped);
      })
      .catch((err) => {
        console.error("Failed to fetch existing lodgings:", err);
        showToast({ title: "Couldn't load lodgings.", variant: "error" });
      })
      .finally(() => setLodgingsLoaded(true));
  }, [showLodgingSidebar, editActiveTab, lodgingsLoaded, itineraryId]);

  // Rebuild calendar days when the user changes the date range
  useEffect(() => {
    if (!dateRangeInitialized.current) {
      if (dateRange !== undefined) {
        dateRangeInitialized.current = true;
        if (dateRange?.from && dateRange?.to) {
          lastValidDateRange.current = { from: dateRange.from, to: dateRange.to };
        }
      }
      return;
    }
    if (!dateRange?.from || !dateRange?.to) return;

    const from = dateRange.from;
    const to = dateRange.to;
    const numDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;

    // Reject ranges past the 30-day cap before touching the UI. The server
    // would 400 anyway, but without this guard the optimistic update below
    // already mutated the calendar and only rolls back on a successful refetch.
    if (numDays > MAX_ITINERARY_DAYS) {
      showToast({
        title: `Itineraries can't be longer than ${MAX_ITINERARY_DAYS} days.`,
        variant: "error",
      });
      const prev = lastValidDateRange.current;
      // Restore the last accepted range; the effect re-runs and no-ops because
      // it matches lastValidDateRange (skipped below).
      if (prev) setDateRange({ from: prev.from, to: prev.to });
      return;
    }

    // No-op when the range is unchanged from the last accepted one (e.g. the
    // rollback above), avoiding a redundant optimistic pass + server PATCH.
    const prevValid = lastValidDateRange.current;
    if (
      prevValid &&
      toLocalDateString(prevValid.from) === toLocalDateString(from) &&
      toLocalDateString(prevValid.to) === toLocalDateString(to)
    ) {
      return;
    }
    lastValidDateRange.current = { from, to };

    const existingByDate = new Map(calendarDays.map((d) => [toLocalDateString(d.date), d]));

    const newDays: CalendarDay[] = Array.from({ length: numDays }, (_, i) => {
      const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      const key = toLocalDateString(date);
      const existing = existingByDate.get(key);
      return existing ? { ...existing, date } : { id: `day-${key}`, date, activities: [] };
    });

    setCalendarDays(newDays);
    const fromStr = toLocalDateString(from);
    const toStr = toLocalDateString(to);
    setItinerary((prev) =>
      prev
        ? {
            ...prev,
            total_days: numDays,
            start_date: fromStr,
            end_date: toStr,
            days: prev.days.filter((d) => d.date >= fromStr && d.date <= toStr),
          }
        : prev
    );

    if (itineraryId) {
      updateItinerary(itineraryId, {
        start_date: toLocalDateString(from),
        end_date: toLocalDateString(to),
      })
        .then(() => refreshCalendarDays())
        .catch((err) => {
          console.error("Failed to save date range:", err);
          showToast({ title: "Couldn't update dates. Try again.", variant: "error" });
        });
    }
  }, [dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extract map locations from activities (DB data + locally added)
  const mapLocations = useMemo((): MapLocation[] => {
    const seen = new Set<string>();
    const locations: MapLocation[] = [];

    // From original itinerary data
    if (itinerary) {
      itinerary.days.forEach((day, dayIndex) => {
        // Sorted for the same reason as the edit-mode markers: pin numbers come
        // from array position, so they must follow visit order.
        for (const activity of realActivities(day.activities)) {
          const loc = activity.location;
          if (loc && loc.latitude != null && loc.longitude != null && !seen.has(loc.id)) {
            seen.add(loc.id);
            locations.push({
              id: loc.id,
              name: loc.name,
              latitude: loc.latitude,
              longitude: loc.longitude,
              photo_urls: loc.photo_urls ?? undefined,
              // 0-based day position — matches the route's dayIndex (activity.dayIndex)
              // so a stop's pin color equals its route leg's color.
              dayIndex,
            });
          }
        }
      });
    }

    // From locally added activities (e.g. dropped from sidebar)
    for (const day of calendarDays) {
      for (const activity of day.activities) {
        if (activity.latitude != null && activity.longitude != null && !seen.has(activity.id)) {
          seen.add(activity.id);
          locations.push({
            id: activity.id,
            name: activity.name,
            latitude: activity.latitude,
            longitude: activity.longitude,
            photo_urls: activity.photoUrl ? [activity.photoUrl] : undefined,
            dayIndex: activity.dayIndex,
          });
        }
      }
    }

    return locations;
  }, [itinerary, calendarDays, realActivities]);

  // Extract polyline segments from activities
  const mapPolylines = useMemo((): MapPolylineSegment[] => {
    const segments: MapPolylineSegment[] = [];
    for (const day of calendarDays) {
      for (const activity of day.activities) {
        if (activity.travelPolyline && activity.latitude != null && activity.longitude != null) {
          segments.push({
            id: activity.id,
            dayIndex: activity.dayIndex,
            encodedPath: activity.travelPolyline,
          });
        }
      }
    }
    return segments;
  }, [calendarDays]);

  // `handleManualLodgingSubmit` lived here. Lodging is gone: there is no table
  // behind it and no `lodging_checkin` category for the cards it produced.
  const handleManualLodgingSubmit = useCallback(async (_data: LodgingFormData) => {}, []);

  const trackedFlightOfferKeys = useMemo(
    () => new Set(flightPriceWatches.map((watch) => watch.offer.offerKey)),
    [flightPriceWatches],
  );

  const handleFlightTrackOffer = useCallback((offer: FlightOffer, search: FlightSearchData) => {
    const alreadyTracked = flightPriceWatches.some((watch) => watch.offer.offerKey === offer.offerKey);
    if (alreadyTracked) {
      setFlightPriceWatches((current) => current.filter((watch) => watch.offer.offerKey !== offer.offerKey));
      showToast({ title: `Stopped tracking ${offer.flightNumbers.join(" · ")}` });
      return;
    }
    setFlightPriceWatches((current) => {
      const now = new Date().toISOString();
      return [...current, {
        offer,
        search: {
          origin: search.origin.code,
          destination: search.destination.code,
          departureDate: search.departureDate,
        },
        initialPrice: offer.price,
        latestPrice: offer.price,
        previousPrice: offer.price,
        lastCheckedAt: now,
        status: "watching",
      }];
    });
    showToast({
      title: `Tracking ${offer.flightNumbers.join(" · ")}`,
      description: "We'll refresh this fare every 15 minutes while this itinerary is open.",
    });
  }, [flightPriceWatches, showToast]);

  const handleFlightPriceWatchRemove = useCallback((watch: FlightPriceWatch) => {
    setFlightPriceWatches((current) => current.filter(
      (candidate) => candidate.offer.offerKey !== watch.offer.offerKey,
    ));
    showToast({ title: `Stopped tracking ${watch.offer.flightNumbers.join(" · ")}` });
  }, [showToast]);

  // Session-scoped price listener. Atlas routing identifiers expire, so every
  // refresh performs a new route search and matches the same flight signature.
  // A durable watcher belongs in a server worker once notification delivery is wired.
  useEffect(() => {
    if (flightPriceWatches.length === 0) return;

    const refreshPrices = async () => {
      const snapshot = flightPriceWatches;
      const updates = await Promise.all(snapshot.map(async (watch) => {
        try {
          const result = await searchFlightOffers(watch.search);
          const currentOffer = result.offers.find((offer) => offer.offerKey === watch.offer.offerKey);
          if (!currentOffer) {
            return { key: watch.offer.offerKey, status: "unavailable" as const, checkedAt: result.searchedAt };
          }
          return {
            key: watch.offer.offerKey,
            status: currentOffer.price === watch.latestPrice ? "watching" as const : "changed" as const,
            checkedAt: result.searchedAt,
            offer: currentOffer,
          };
        } catch (error) {
          console.error("[flight price watch]", error);
          return { key: watch.offer.offerKey, status: "error" as const, checkedAt: new Date().toISOString() };
        }
      }));

      setFlightPriceWatches((current) => current.map((watch) => {
        const update = updates.find((candidate) => candidate.key === watch.offer.offerKey);
        if (!update) return watch;
        const nextOffer = "offer" in update ? update.offer : undefined;
        if (!nextOffer) return { ...watch, status: update.status, lastCheckedAt: update.checkedAt };
        return {
          ...watch,
          offer: nextOffer,
          previousPrice: watch.latestPrice,
          latestPrice: nextOffer.price,
          lastCheckedAt: update.checkedAt,
          status: update.status,
        };
      }));
    };

    const timer = window.setInterval(() => { void refreshPrices(); }, FLIGHT_PRICE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [flightPriceWatches]);

  const editFlightMapData = useMemo(() => {
    if (editActiveTab !== "Flight") return null;

    if (flightSearchOrigin || flightSearchDestination) {
      const locations = [
        flightSearchOrigin ? { id: `airport-${flightSearchOrigin.code}`, name: flightSearchOrigin.name, latitude: flightSearchOrigin.latitude, longitude: flightSearchOrigin.longitude, address: `${flightSearchOrigin.city}, ${flightSearchOrigin.country}` } : null,
        flightSearchDestination ? { id: `airport-${flightSearchDestination.code}`, name: flightSearchDestination.name, latitude: flightSearchDestination.latitude, longitude: flightSearchDestination.longitude, address: `${flightSearchDestination.city}, ${flightSearchDestination.country}` } : null,
      ].filter((location): location is NonNullable<typeof location> => location !== null);
      return {
        locations,
        polylines: flightSearchOrigin && flightSearchDestination ? [{
          id: `flight-search-route-${flightSearchOrigin.code}-${flightSearchDestination.code}`,
          dayIndex: 0,
          encodedPath: encodePolylinePair(flightSearchOrigin.latitude, flightSearchOrigin.longitude, flightSearchDestination.latitude, flightSearchDestination.longitude),
          color: "var(--edge-brand)",
        }] : [],
      };
    }

    if (flights.length === 0 || airportLocations.size === 0) {
      return {
        locations: [{ id: "airport-SIN", name: CHANGI_AIRPORT.name, latitude: CHANGI_AIRPORT.latitude, longitude: CHANGI_AIRPORT.longitude, address: `${CHANGI_AIRPORT.city}, ${CHANGI_AIRPORT.country}` }],
        polylines: [],
      };
    }
    const seen = new Map<string, { id: string; name: string; latitude: number; longitude: number; address?: string }>();
    const ordered: string[] = [];
    for (const f of flights) {
      const fromAirport = airportLocations.get(f.fromCode.toUpperCase());
      const toAirport = airportLocations.get(f.toCode.toUpperCase());
      if (fromAirport && !seen.has(f.fromCode)) {
        seen.set(f.fromCode, { id: `airport-${f.fromCode}`, name: fromAirport.name, latitude: fromAirport.latitude, longitude: fromAirport.longitude, address: fromAirport.address });
        ordered.push(f.fromCode);
      }
      if (toAirport && !seen.has(f.toCode)) {
        seen.set(f.toCode, { id: `airport-${f.toCode}`, name: toAirport.name, latitude: toAirport.latitude, longitude: toAirport.longitude, address: toAirport.address });
        ordered.push(f.toCode);
      }
    }
    const locations = ordered.map(code => seen.get(code)!);
    const polylines: typeof mapPolylines = [];
    for (const f of flights) {
      const from = seen.get(f.fromCode);
      const to = seen.get(f.toCode);
      if (from && to) {
        polylines.push({
          id: `flight-route-${f.id ?? f.fromCode}-${f.toCode}`,
          dayIndex: 0,
          encodedPath: encodePolylinePair(from.latitude, from.longitude, to.latitude, to.longitude),
          color: "var(--edge-brand)",
        });
      }
    }
    return { locations, polylines };
  }, [editActiveTab, flights, airportLocations, flightSearchDestination, flightSearchOrigin]);

  // Edit-mode map markers, built directly from editLocalDays (the optimistic edit
  // state) rather than the server-synced mapLocations — so a just-added card shows
  // its marker immediately, before the create round-trips. Focusing a day narrows
  // to that day; otherwise every day's activities are shown.
  const editFilteredMapLocations = useMemo((): MapLocation[] => {
    if (editActiveTab === "Flight" && editFlightMapData) {
      return editFlightMapData.locations;
    }

    if (editActiveTab === "Lodging") {
      return lodgings
        .filter(a => a.latitude != null && a.longitude != null)
        .map(a => ({
          id: a.id ?? `lodging-${a.name}`,
          name: a.name,
          latitude: a.latitude!,
          longitude: a.longitude!,
        }));
    }

    const seen = new Set<string>();
    const locations: MapLocation[] = [];
    // Mirror the polyline builder exactly (same 0-based editLocalDays index + focus
    // filter) so each pin's day color matches its route leg, and focusing a single
    // day doesn't shift the palette.
    editLocalDays.forEach((day, dayIndex) => {
      if (editFocusedDayIndex != null && dayIndex !== editFocusedDayIndex) return;
      // Sorted, not raw array order: GoogleMapDetail numbers stop pins by their
      // position in this array, so an unsorted day would label pins by whatever
      // order the rows happen to sit in rather than by when you visit them.
      for (const activity of realActivities(day.activities)) {
        const loc = activity.location;
        if (loc?.latitude == null || loc?.longitude == null) continue;
        const key = loc.id ?? activity.id;
        if (seen.has(key)) continue;
        seen.add(key);
        locations.push({
          id: key,
          name: loc.name ?? activity.name,
          latitude: loc.latitude,
          longitude: loc.longitude,
          photo_urls: loc.photo_urls ?? undefined,
          dayIndex,
        });
      }
    });
    return locations;
  }, [editFocusedDayIndex, editLocalDays, editActiveTab, editFlightMapData, lodgings, realActivities]);

  // Edit-mode travel-leg polylines, built from editLocalDays. Each activity row
  // carries its OUTGOING leg's encoded path (server cascade returns travel_polyline
  // on add/move), so a new card's leg renders as soon as the Directions cascade lands.
  const editFilteredMapPolylines = useMemo((): MapPolylineSegment[] => {
    if (editActiveTab === "Flight" && editFlightMapData) {
      return editFlightMapData.polylines;
    }
    if (editActiveTab === "Lodging") return [];

    const segments: MapPolylineSegment[] = [];
    editLocalDays.forEach((day, dayIndex) => {
      if (editFocusedDayIndex != null && dayIndex !== editFocusedDayIndex) return;
      // Legs used to carry a Google-encoded polyline. `travel_to_next` is a
      // crow-flight distance and duration with no path to draw, so the map
      // shows pins and the straight lines it derives itself.
    });
    return segments;
  }, [editFocusedDayIndex, editLocalDays, editActiveTab, editFlightMapData]);

  const editDayDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editDayListRef = useRef<EditDayListHandle>(null);
  const handleEditDayFilterClick = useCallback((dayIndex: number) => {
    if (editDayDebounceRef.current) clearTimeout(editDayDebounceRef.current);
    // Toggle the day filter (clicking the active day again clears it). Capture the
    // target up front so the programmatic scroll below can't race the debounce.
    const target = editFocusedDayIndex === dayIndex ? null : dayIndex;
    editDayDebounceRef.current = setTimeout(() => {
      setEditFocusedDayIndex(target);
      setEditFitBoundsKey(k => k + 1);
    }, 100);
    // Also scroll the day column list to the picked day (only when selecting one).
    if (target != null) editDayListRef.current?.scrollToDay(target);
  }, [editFocusedDayIndex]);

  const handleActivityDelete = useCallback(
    (activityId: string) => {
      setCalendarDays((prev) =>
        prev.map((day) => ({
          ...day,
          activities: day.activities.filter((a) => a.id !== activityId),
        }))
      );
      setEditLocalDays((prev) =>
        prev.map((day) => ({
          ...day,
          activities: day.activities.filter((a) => a.id !== activityId),
        }))
      );
      if (!itineraryId) return;
      // Temp/local ids were never persisted — nothing to delete or recompute.
      const isPersisted = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activityId);
      if (!isPersisted) return;
      // recompute_times: the server runs the full route cascade after the delete
      // (legs + downstream times, same as add/move) and returns the day's rows,
      // which we apply so the map line, transport durations, and schedule update.
      deleteActivity(itineraryId, activityId, { recompute_times: true })
        .then((cascade) => {
          if (cascade) {
            applyServerCascadeToDays(null, [
              { day_id: cascade.day_id, activities: cascade.activities },
            ]);
          }
        })
        .catch((e) => {
          console.error(e);
          showToast({ title: "Couldn't remove activity. Try again.", variant: "error" });
        });
    },
    [itineraryId, applyServerCascadeToDays, showToast]
  );

  const handleFlightUpload = useCallback(
    async (file: File) => {
      if (!itineraryId) return;
      setFlightUploading(true);
      try {
        const extracted = await extractFlightsFromPDF(itineraryId, file);
        if (extracted.length === 0) return;

        // Best-effort: archive the original file in storage and link every
        // extracted flight back to the attachment via source_attachment_id, so
        // removing the file later cascades to all sibling flights + activity
        // cards. Failure here must not roll back the extraction.
        const primaryFlightId = extracted[0]?.id;
        if (primaryFlightId) {
          const linkEntityIds = extracted.map((f) => f.id);
          void (async () => {
            try {
              const inserted = await uploadAttachment({
                itineraryId,
                entityType: "flight",
                entityId: primaryFlightId,
                file,
                linkEntityIds,
              });
              setFlightAttachments((prev) =>
                prev.some((a) => a.id === inserted.id) ? prev : [...prev, inserted]
              );
              const linkedIds = new Set(linkEntityIds);
              setFlights((prev) =>
                prev.map((c) => (c.id && linkedIds.has(c.id) ? { ...c, sourceAttachmentId: inserted.id } : c))
              );
            } catch (err) {
              console.error("Flight attachment upload failed:", err);
              showToast({
                title: "Flight imported, but we couldn't archive the original file.",
                variant: "error",
              });
            }
          })();
        }

        const mapped: FlightCardProps[] = extracted.map(mapExtractedFlightToCardProps);
        setFlights((prev) => {
          const existingIds = new Set(prev.map((c) => c.id).filter(Boolean));
          return [...prev, ...mapped.filter((m) => !existingIds.has(m.id))];
        });

        // Expand itinerary dates if needed
        let earliest = dateRange?.from;
        let latest = dateRange?.to;
        for (const f of extracted) {
          const dep = parseLocalDate(f.depart_date);
          const arr = parseLocalDate(f.arrive_date);
          if (!earliest || dep < earliest) earliest = dep;
          if (!latest || arr > latest) latest = arr;
        }
        if (earliest && latest) {
          const needsUpdate =
            !dateRange?.from || !dateRange?.to ||
            earliest < dateRange.from || latest > dateRange.to;
          if (needsUpdate) {
            const newFrom = !dateRange?.from || earliest < dateRange.from ? earliest : dateRange.from;
            const newTo = !dateRange?.to || latest > dateRange.to ? latest : dateRange.to;
            setDateRange({ from: newFrom, to: newTo });
          }
        }

        // Activity cards arrive via the realtime INSERT subscription
        // (useItineraryRealtime.ts) after createFlightActivityCards persists
        // them with airport-resolved names and buffered times.
      } catch (err) {
        console.error("Flight extraction failed:", err);
      } finally {
        setFlightUploading(false);
      }
    },
    [itineraryId, dateRange, showToast]
  );
  handleFlightUploadRef.current = handleFlightUpload;

  // Re-analyze: re-download the stored booking file and re-run extraction. Reuses
  // the upload→extract flow; the extract endpoint dedups so identical flights are
  // skipped and any missed segments are added.
  const handleFlightReanalyze = useCallback(
    async (attachmentId: string) => {
      if (!itineraryId) return;
      try {
        const { signed_url, file_name, mime_type } = await getAttachmentSignedUrl(itineraryId, attachmentId);
        const resp = await fetch(signed_url);
        if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
        const blob = await resp.blob();
        const file = new File([blob], file_name || "booking.pdf", { type: mime_type || "application/pdf" });
        await handleFlightUpload(file);
        showToast({ title: "Re-analyzed the booking file.", variant: "success" });
      } catch (err) {
        console.error("[flight reanalyze]", err);
        showToast({ title: "We couldn't re-analyze this file. Please try again.", variant: "error" });
      }
    },
    [itineraryId, handleFlightUpload, showToast],
  );

  // `handleLodgingUpload` extracted lodgings from an uploaded PDF and turned
  // them into check-in/check-out cards. Both the extraction endpoint and the
  // categories those cards used are gone.
  const handleLodgingUpload = useCallback(async (_file: File) => {}, []);
  handleLodgingUploadRef.current = handleLodgingUpload;

  // Re-analyze: re-download the stored booking file and re-run lodging extraction.
  const handleLodgingReanalyze = useCallback(
    async (attachmentId: string) => {
      if (!itineraryId) return;
      try {
        const { signed_url, file_name, mime_type } = await getAttachmentSignedUrl(itineraryId, attachmentId);
        const resp = await fetch(signed_url);
        if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
        const blob = await resp.blob();
        const file = new File([blob], file_name || "booking.pdf", { type: mime_type || "application/pdf" });
        await handleLodgingUpload(file);
        showToast({ title: "Re-analyzed the booking file.", variant: "success" });
      } catch (err) {
        console.error("[lodging reanalyze]", err);
        showToast({ title: "We couldn't re-analyze this file. Please try again.", variant: "error" });
      }
    },
    [itineraryId, handleLodgingUpload, showToast],
  );

  // ── View-mode Tab Dropzone (Flight / Lodging) ───────────────────────────────
  // The decorative "drop your X files here or browse" panel that appears under
  // each tab in view mode. Click opens the file picker; drag-and-drop accepts
  // PDF/image files. Routes to the same upload handlers as edit mode.

  // Reset drag tracking when the open tab changes so the highlight doesn't
  // get stuck if the user switches tabs mid-drag.
  useEffect(() => {
    viewTabDragCounter.current = 0;
    setViewTabDragging(false);
  }, [openTab]);

  // Attachments hydrated here from the old REST backend. They belong to flights
  // and lodging, both of which are gone, and the call threw "Not authenticated"
  // on every mount because auth is gone too.

  const viewTabAcceptsFiles = openTab === "Flight" || openTab === "Lodging";

  const dispatchViewTabFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const accepted = files.filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf") || f.type.startsWith("image/"),
      );
      if (accepted.length === 0) return;
      if (openTab === "Flight") {
        for (const file of accepted) handleFlightUploadRef.current(file);
      } else if (openTab === "Lodging") {
        for (const file of accepted) handleLodgingUploadRef.current(file);
      }
    },
    [openTab],
  );

  const handleViewTabClick = useCallback(() => {
    if (!viewTabAcceptsFiles) return;
    viewTabFileInputRef.current?.click();
  }, [viewTabAcceptsFiles]);

  const handleViewTabDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!viewTabAcceptsFiles) return;
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      viewTabDragCounter.current += 1;
      if (viewTabDragCounter.current === 1) setViewTabDragging(true);
    },
    [viewTabAcceptsFiles],
  );

  const handleViewTabDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!viewTabAcceptsFiles) return;
      e.preventDefault();
      e.stopPropagation();
      viewTabDragCounter.current = Math.max(0, viewTabDragCounter.current - 1);
      if (viewTabDragCounter.current === 0) setViewTabDragging(false);
    },
    [viewTabAcceptsFiles],
  );

  const handleViewTabDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!viewTabAcceptsFiles) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [viewTabAcceptsFiles],
  );

  const requestRemoveAttachment = useCallback(
    (entityType: "flight" | "lodging", attachmentId: string) => {
      const list = entityType === "flight" ? flightAttachments : lodgingAttachments;
      const target = list.find((a) => a.id === attachmentId);
      if (!target) return;
      setPendingDeleteAttachment(target);
    },
    [flightAttachments, lodgingAttachments],
  );

  // Opens the source PDF for a lodging/flight in a new tab. Pop-up-blocker
  // friendly: open the placeholder tab synchronously inside the user gesture,
  // then redirect it to the signed URL once the API resolves. `noopener` is
  // intentionally omitted on window.open because it would make the call
  // return null and there'd be no handle to redirect; we sever the opener
  // manually before navigation to preserve reverse-tabnabbing protection.
  const openAttachmentInNewTab = useCallback(
    async (entityType: "flight" | "lodging", entityId: string) => {
      if (!itineraryId) return;
      const card =
        entityType === "flight"
          ? flights.find((f) => f.id === entityId)
          : lodgings.find((a) => a.id === entityId);
      const attachmentId = card?.sourceAttachmentId ?? null;
      if (!attachmentId) return;

      const tab = window.open("about:blank", "_blank");
      if (!tab) {
        showToast({
          title: "Please allow pop-ups to view documents.",
          variant: "error",
        });
        return;
      }
      try {
        const { signed_url } = await getAttachmentSignedUrl(itineraryId, attachmentId);
        try { tab.opener = null; } catch { /* best-effort across browsers */ }
        tab.location.href = signed_url;
      } catch (err) {
        console.error("Failed to open attachment:", err);
        tab.close();
        showToast({
          title: getFriendlyApiError(err, "We couldn't open that document. Try again."),
          variant: "error",
        });
      }
    },
    [itineraryId, flights, lodgings, showToast],
  );

  const confirmDeleteAttachment = useCallback(async () => {
    if (!pendingDeleteAttachment || !itineraryId) return;
    const attachment = pendingDeleteAttachment;
    setDeletingAttachment(true);
    try {
      await deleteAttachment({
        itineraryId,
        attachmentId: attachment.id,
      });

      // The realtime sub on itinerary_activities (always on) prunes calendar
      // cards in both view and edit mode. The realtime sub on
      // itinerary_flights / itinerary_lodgings is gated on sidebar visibility,
      // so when the sidebar is closed we won't see cascade deletes. Refetch the
      // live list and intersect by id to drop every flight/lodging that the
      // cascade removed — this covers the multi-extraction case.
      if (attachment.entity_type === "flight") {
        setFlightAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
        try {
          const live = await getFlights(itineraryId);
          const liveIds = new Set((Array.isArray(live) ? live : []).map((f: ExtractedFlight) => f.id));
          // Keep entries that are still in the live list. Unsaved local entries
          // (no id yet) are kept defensively — they aren't part of the cascade.
          setFlights((prev) => prev.filter((f) => !f.id || liveIds.has(f.id)));
        } catch (refetchErr) {
          console.error("Flight refetch after delete failed:", refetchErr);
        }
      } else {
        setLodgingAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
        try {
          const live = await getLodgings(itineraryId);
          const liveIds = new Set(live.map((l) => l.id));
          setLodgings((prev) => prev.filter((a) => !a.id || liveIds.has(a.id)));
        } catch (refetchErr) {
          console.error("Lodging refetch after delete failed:", refetchErr);
        }
      }
      setPendingDeleteAttachment(null);
    } catch (err) {
      console.error("Failed to delete attachment:", err);
      showToast({
        title: getFriendlyApiError(err, "We couldn't remove that file. Try again."),
        variant: "error",
      });
    } finally {
      setDeletingAttachment(false);
    }
  }, [pendingDeleteAttachment, itineraryId, showToast]);

  const handleViewTabDrop = useCallback(
    (e: React.DragEvent) => {
      if (!viewTabAcceptsFiles) return;
      e.preventDefault();
      e.stopPropagation();
      viewTabDragCounter.current = 0;
      setViewTabDragging(false);

      const files: File[] = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0 && e.dataTransfer.items) {
        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      dispatchViewTabFiles(files);
    },
    [viewTabAcceptsFiles, dispatchViewTabFiles],
  );

  if (!isLoading && !queryData) {
    return (
      <div className="itinerary-detail-not-found flex flex-col items-center justify-center h-full gap-2">
        <p className="itinerary-detail-not-found-text type-body-1 text-content-secondary">Itinerary not found</p>
        <Button variant="ghost" onClick={() => router.push("/itineraries")}>
          Back to itineraries
        </Button>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} data-page-scroll="true" data-region="itinerary-detail-page" className="itinerary-detail-page relative flex size-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-[var(--navbar-height)]">
      {itinerary && (<>
      {/* Header Section */}
      <ItineraryPageHeader
        bannerUrl={bannerUrl}
        name={itinerary.name}
        region={itinerary.region ?? null}
        country={itinerary.country ?? ""}
        dateLabel={dateLabel}
        overview={itinerary.overview}
        totalSpots={totalSpots}
        totalDays={itinerary.days.length}
        totalAttachments={totalAttachments}
        lastEdited={lastEditedLabel}
        viewMode={quickViewEditMode}
        onViewModeChange={(mode) => {
          if (isPhone) return;
          setQuickViewEditMode(mode);
          if (mode === "edit") {
            setDetailActivity(null);
            setEditActiveTab("Itinerary");
            setCollectionEnabled(true);
            // Tablet now enters map-first; the collection drawer opens on demand.
            setPanelState(null);
            // Pull the workspace to the top: hide the navbar immediately, then
            // scroll the controls row to the top so the header content drops
            // above the fold and the 3-column workspace fills the screen.
            navbarVisibility?.setNavbarHidden(true);
            requestAnimationFrame(() => {
              controlsRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
            });
          }
        }}
        onDelete={() => setDeleteItineraryConfirmOpen(true)}
        activeTab={editActiveTab}
        onTabClick={(tab) => {
          setEditActiveTab(tab);
          setEditFitBoundsKey((k) => k + 1);
          if (tab === "Itinerary") {
            setPanelState({ variant: "collection" });
          } else {
            setPanelState({ variant: tab.toLowerCase() } as ItineraryPanelState);
          }
          // Re-pin the workspace to the top (same as entering edit) so every tab —
          // including the short Flight/Lodging lists — fills the full viewport
          // height with the controls row at the top, not floating below the header.
          navbarVisibility?.setNavbarHidden(true);
          requestAnimationFrame(() => {
            controlsRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
          });
        }}
        controlsRef={controlsRef}
      />

      {/* Import Panel */}
      <div
        data-region="itinerary-detail-import"
        className="itinerary-import-panel mx-auto grid w-full max-w-[1600px] px-3 transition-[grid-template-rows,opacity] duration-[var(--motion-duration-medium)] ease-[var(--motion-ease-spatial)] md:px-8 lg:px-10"
        style={{
          gridTemplateRows: showImportPanel ? "1fr" : "0fr",
          opacity: showImportPanel ? 1 : 0,
        }}
      >
        <div className="itinerary-import-panel-clip overflow-hidden">
          <div className="itinerary-import-dropzone flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-edge bg-surface-alt py-12 mt-5">
            <div className="itinerary-import-dropzone-cards flex -space-x-3">
              <div className="itinerary-import-dropzone-card itinerary-import-dropzone-card-left size-14 rounded-xl bg-surface-muted rotate-[-6deg] shadow-sm" />
              <div className="itinerary-import-dropzone-card itinerary-import-dropzone-card-right size-14 rounded-xl bg-surface-muted rotate-[6deg] shadow-sm" />
            </div>
            <p className="itinerary-import-dropzone-prompt type-body-1 text-content-secondary">
              Drag & drop here,{" "}
              <button type="button" className="itinerary-import-upload-button type-body-2 text-content underline underline-offset-2">
                upload file
              </button>
              {" "}or paste a URL
            </p>
            <div className="itinerary-import-url-field flex items-center gap-2 rounded-full bg-action-secondary px-4 py-2.5 w-full max-w-sm">
              <Link2 className="itinerary-import-url-icon size-4 text-content-tertiary shrink-0" />
              <input
                type="text"
                placeholder="Paste a URL"
                className="itinerary-import-url-input flex-1 bg-transparent type-body-2 text-content placeholder:text-content-tertiary outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* On tablet/desktop, a clicked activity replaces the map inline. Phones
          keep the itinerary visible and present the detail as a bottom sheet. */}
      {!isPhone && detailActivity ? (
        <div
          ref={detailSectionRef}
          data-region="itinerary-detail-location-detail"
          className="itinerary-location-detail mx-auto w-full max-w-[1600px] px-3 pt-3 md:px-8 md:pt-6 lg:px-10"
        >
          <LocationDetailView
            key={detailActivity.id}
            location={activityToDetailLocation(detailActivity)}
            locationId={detailActivity.location?.id}
            excludeItineraryId={itineraryId}
            onBack={closeDetail}
            collections={detailSaveMenuCollections}
            onSaveToCollection={handleDetailSaveToCollection}
            onCreateCollection={handleDetailCreateCollection}
          />
        </div>
      ) : mapLocations.length > 0 ? (
        <div
          className="itinerary-map-collapse grid transition-[grid-template-rows,opacity] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-spatial)]"
          style={{
            gridTemplateRows: quickViewEditMode === "view" ? "1fr" : "0fr",
            opacity: quickViewEditMode === "view" ? 1 : 0,
          }}
        >
          <div className="itinerary-map-clip overflow-hidden">
            <ItineraryMapSection
              locations={mapLocations}
              polylines={mapPolylines}
              defaultCenter={defaultCenter}
              hoverVariant="name"
            />
          </div>
        </div>
      ) : null}

      {isPhone && detailActivity && (
        <Sheet
          open
          side="bottom"
          title={detailActivity.name}
          description="Location details"
          onOpenChange={(open) => {
            if (!open) closeDetail();
          }}
        >
          <div className="flex shrink-0 justify-center pt-3 pb-2" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-surface-muted-active" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 scrollbar-none">
            <LocationDetailView
              key={detailActivity.id}
              location={activityToDetailLocation(detailActivity)}
              locationId={detailActivity.location?.id}
              excludeItineraryId={itineraryId}
              onBack={closeDetail}
              collections={detailSaveMenuCollections}
              onSaveToCollection={handleDetailSaveToCollection}
              onCreateCollection={handleDetailCreateCollection}
              className="animate-none rounded-none border-0"
            />
          </div>
        </Sheet>
      )}

      {/* Workspace Body — the edit-mode tab bar now lives in the header control
          row (swapped in for the DataPills); switching modes + tabs is handled
          there. View mode uses min-h-screen for scroll room; edit mode is sized to
          (100vh − controls height) so once the controls scroll to the top the
          3-column layout fills exactly the rest of the viewport — the controls-at-top
          position becomes the furthest the page can scroll. */}
      <div
        ref={tabBarRef}
        data-region="itinerary-detail-body"
        className={cn(
          "itinerary-tabs-body flex flex-col",
          quickViewEditMode === "view" && "min-h-dvh",
        )}
        style={
          quickViewEditMode === "edit"
            ? { height: `calc(100dvh - ${controlsHeight}px)` }
            : undefined
        }
      >
      {quickViewEditMode === "edit" ? (
        /* ── Edit Mode: Kanban Board + 3-Column Layout ── */
        <Kanban
          value={editKanbanValue}
          onValueChange={handleEditKanbanChange}
          getItemValue={getEditActivityId}
          resolveDropTarget={resolveEditDropTarget}
          sensors={editSensors}
          collisionDetection={editCollisionDetection}
          onDragStart={handleEditDragStart}
          onDragEnd={handleEditDragEnd}
          onDragCancel={handleEditDragCancel}
          // DndContext rendered no DOM of its own; Kanban renders a div, so keep
          // it layout-neutral or the edit workspace loses its flex sizing.
          className="contents"
        >
          <div
            data-region="itinerary-edit-workspace"
            className="itinerary-edit-wrapper mx-auto w-full max-w-[1600px] flex-1 px-8 py-3 lg:px-10"
            style={{ minHeight: `calc(100dvh - ${controlsHeight}px)` }}
          >
            <ItineraryEditLayout
              className="h-full"
              leftOpen={isDesktop || editActiveTab === "Itinerary"}
              centerOpen={panelState != null}
              onPanelOpen={() => {
                setPanelState((current) => {
                  if (current) return current;
                  if (editActiveTab === "Itinerary") return { variant: "collection" };
                  return { variant: editActiveTab.toLowerCase() } as ItineraryPanelState;
                });
              }}
              panelOpenLabel={`Open ${editActiveTab === "Itinerary" ? "itinerary details" : `${editActiveTab} panel`}`}
              leftContent={
                <EditDayList
                  ref={editDayListRef}
                  days={editPreviewDays ?? editLocalDays}
                  onDatesChange={(range) => {
                    setDateRange(range);
                  }}
                  panelVariant={
                    editActiveTab === "Flight" ? "flight"
                    : editActiveTab === "Lodging" ? "lodging"
                    : panelState?.variant ?? null
                  }
                  selectedActivityId={panelState?.variant === "location" ? panelState.activity.id : null}
                  selectedLocationId={panelState?.variant === "location" ? panelState.activity.location?.id ?? null : null}
                  isCollectionActive={panelState?.variant === "collection"}
                  isDragActive={editDragLocation != null || editDragActivity != null}
                  timezone={ITINERARY_TIMEZONE}
                  pendingTimeIds={pendingTimeIds}
                  preserveActivityOrder={editPreviewDays != null && editDragActivity != null}
                  activityNotePreviews={activityNotePreviews}
                  onActivityClick={(activity) => {
                    const dayIdx = editLocalDays.findIndex(d => d.id === activity.day_id);
                    if (dayIdx >= 0 && dayIdx !== editFocusedDayIndex) {
                      setEditFocusedDayIndex(dayIdx);
                      setEditFitBoundsKey(k => k + 1);
                    }
                    const tabVariant = editActiveTab === "Flight" ? "flight" as const
                      : editActiveTab === "Lodging" ? "lodging" as const
                      : null;
                    const fallback = tabVariant
                      ? { variant: tabVariant } as ItineraryPanelState
                      : collectionEnabled ? { variant: "collection" } as ItineraryPanelState
                      : null;
                    setPanelState((prev) =>
                      prev?.variant === "location" && prev.activity.id === activity.id
                        ? fallback
                        : { variant: "location", activity, from: tabVariant ?? "activity" }
                    );
                  }}
                  onActivityDelete={(activityId) => {
                    setEditLocalDays((prev) =>
                      prev.map((d) => ({
                        ...d,
                        activities: d.activities.filter((a) => a.id !== activityId),
                      })),
                    );
                    handleActivityDelete(activityId);
                    if (panelState?.variant === "location" && panelState.activity.id === activityId) {
                      setPanelState(collectionEnabled ? { variant: "collection" } : null);
                    }
                  }}
                  onAddActivity={(dayId, insertAtIndex) => {
                    setPanelState((prev) => {
                      // Remember what was showing before add opened, so "×" can
                      // return to it. Don't overwrite when re-targeting add to
                      // another day (prev is already add-location).
                      if (prev?.variant !== "add-location") addLocationReturnRef.current = prev;
                      return { variant: "add-location", dayId, insertAtIndex };
                    });
                  }}
                  addLocationDayId={panelState?.variant === "add-location" ? panelState.dayId : null}
                  onCloseAdd={() => setPanelState(addLocationReturnRef.current)}
                  onActivityAction={(activity, action) => {
                    if (action === 'notes') {
                      const dayIdx = editLocalDays.findIndex(d => d.id === activity.day_id);
                      if (dayIdx >= 0 && dayIdx !== editFocusedDayIndex) {
                        setEditFocusedDayIndex(dayIdx);
                        setEditFitBoundsKey(k => k + 1);
                      }
                      setPanelState({ variant: "location", activity, from: "activity" });
                    } else if (action === 'expense') {
                      setPanelState((prev) => prev?.variant === "expenses" ? null : { variant: "expenses" });
                    }
                  }}
                  onActivityQuickNoteSubmit={async (activity, content) => {
                    const actId = activity.id;
                    if (actId.startsWith("temp-") || actId.startsWith("act-")) {
                      showToast({ title: "This activity is still saving. Try adding the note again in a moment.", variant: "error" });
                      throw new Error("Cannot save an activity note before the activity finishes saving.");
                    }
                    const now = new Date().toISOString();
                    try {
                      await saveActivityNote(actId, {
                        id: activityNotes.get(actId)?.id ?? crypto.randomUUID(),
                        content,
                        createdAt: now,
                        updatedAt: now,
                      });
                    } catch (err) {
                      showToast({ title: getFriendlyApiError(err, "We couldn't save your note. Try again."), variant: "error" });
                      throw err;
                    }
                  }}
                  onActivityQuickNoteRemove={async (activity) => {
                    try {
                      await clearActivityNote(activity.id);
                    } catch (err) {
                      showToast({ title: getFriendlyApiError(err, "We couldn't remove this note. Try again."), variant: "error" });
                      throw err;
                    }
                  }}
                  onCollectionOpen={() => {
                    setPanelState((prev) => {
                      const isClosing = prev?.variant === "collection";
                      if (editActiveTab === "Itinerary") {
                        setCollectionEnabled(!isClosing);
                      }
                      if (isClosing) {
                        const tabVariant = editActiveTab === "Flight" ? "flight"
                          : editActiveTab === "Lodging" ? "lodging"
                          : null;
                        return tabVariant ? { variant: tabVariant } as ItineraryPanelState : null;
                      }
                      return { variant: "collection" };
                    });
                  }}
                  onResolveOverlaps={handleEditResolveOverlaps}
                  isResolvingOverlaps={isResolvingOverlaps}
                  onOptimizeRoute={handleOptimizeRoute}
                  isOptimizingRoute={isOptimizingRoute}
                  lockedActivityIds={lockedIds}
                  onToggleActivityLock={(activityId) => {
                    setLockedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(activityId)) next.delete(activityId);
                      else next.add(activityId);
                      editChangeCountRef.current += 1;
                      return next;
                    });
                  }}
                  hiddenTransports={hiddenTransports}
                  transportModes={transportModes}
                  unavailableLegIds={unavailableLegIds}
                  onToggleTransportHidden={handleToggleTransportHidden}
                  onTransportModeChange={handleTransportModeChange}
                  onAddFlight={() => setPanelState((prev) =>
                    prev?.variant === "flight-form" ? { variant: "flight" } : { variant: "flight-form" }
                  )}
                  isAddingFlight={panelState?.variant === "flight-form"}
                  flight={flights[0] ?? null}
                  onFlightOpen={openFlightWorkspace}
                  onAddLodging={() => setPanelState((prev) =>
                    prev?.variant === "lodging-form" ? { variant: "lodging" } : { variant: "lodging-form" }
                  )}
                  isAddingLodging={panelState?.variant === "lodging-form"}
                  onActivityTimeChange={applyActivityTimeChange}
                  onActivityOptimize={handleOptimizeActivity}
                  onDayScroll={(dayIndex) => {
                    if (dayIndex !== editFocusedDayIndex) {
                      setEditFocusedDayIndex(dayIndex);
                      setEditFitBoundsKey(k => k + 1);
                      // Do NOT open the day menu on scroll: with the V3 DaysTab,
                      // `editDayFilterOpen` controls the dropdown, so auto-opening
                      // it popped the menu open while scrolling.
                    }
                  }}
                />
              }
              centerContent={
                <ItinerarySidePanel
                  state={panelStateLive}
                  onClose={() => setPanelState(null)}
                  notesActivityNotes={activityNotesList}
                  onNotesActivityClick={(activityId) => {
                    const found = activityIndex.get(activityId);
                    if (found) {
                      setPanelState({ variant: "location", activity: found.activity, from: "activity" });
                    }
                  }}
                  onBack={() => {
                    if (panelState?.variant === "add-location") {
                      setPanelState(collectionEnabled ? { variant: "collection" } : null);
                    } else if (panelState?.variant === "flight-booking") {
                      setFlightBookingSeatMode(false);
                      setFlightBookingSeatId(null);
                      setPanelState({ variant: "flight-form" });
                    } else if (panelState?.variant === "flight-form" || panelState?.variant === "flight-edit") {
                      setPanelState({ variant: "flight" });
                    } else if (panelState?.variant === "lodging-form" || panelState?.variant === "lodging-edit") {
                      setPanelState({ variant: "lodging" });
                    } else if (panelState?.variant === "location" && panelState.from === "flight") {
                      setPanelState({ variant: "flight" });
                    } else if (panelState?.variant === "location" && panelState.from === "lodging") {
                      setPanelState({ variant: "lodging" });
                    } else if (panelState?.variant === "location" && panelState.from === "expenses") {
                      setPanelState({ variant: "expenses" });
                    } else {
                      setPanelState(collectionEnabled ? { variant: "collection" } : null);
                    }
                  }}
                  onAddToDay={(dayId) => {
                    if (panelState?.variant !== "location") return;
                    const loc = panelState.activity.location;
                    if (!loc) return;
                    addActivityToDay({
                      dayId,
                      name: loc.name,
                      category: "poi",
                      durationMin: loc.stay_duration ?? undefined,
                      latitude: loc.latitude,
                      longitude: loc.longitude,
                      locationId: loc.id,
                      photoUrl: loc.photo_urls?.[0] ?? null,
                      photoUrls: loc.photo_urls,
                      formattedAddress: loc.formatted_address,
                      locationContext: loc.editorial_summary,
                      regularOpeningHours: loc.regular_opening_hours,
                    });
                  }}
                  activityAttachments={[]}
                  activityNote={
                    panelStateLive?.variant === "location"
                      ? (activityNotes.get(panelStateLive.activity.id) ?? null)
                      : null
                  }
                  activityIsLocked={
                    panelStateLive?.variant === "location"
                      ? lockedIds.has(panelStateLive.activity.id)
                      : false
                  }
                  onActivityNoteSave={(note) => {
                    if (panelStateLive?.variant === "location") {
                      // New activities are saved to the server before the note
                      // editor is usable, but guard against a leftover temp id.
                      const actId = panelStateLive.activity.id;
                      if (actId.startsWith("temp-") || actId.startsWith("act-")) return;
                      saveActivityNote(actId, note);
                    }
                  }}
                  onActivityNoteClear={() => {
                    if (panelStateLive?.variant === "location") {
                      clearActivityNote(panelStateLive.activity.id);
                    }
                  }}
                  activityDaySiblings={activityDaySiblings}
                  onActivityTimeChange={(startTime, endTime) => {
                    if (panelState?.variant !== "location") return;
                    applyActivityTimeChange(panelState.activity.id, startTime, endTime);
                    setPanelState({
                      ...panelState,
                      activity: { ...panelState.activity, start_time: startTime, end_time: endTime },
                    });
                  }}
                  onActivityAddAttachment={() => {}}
                  onActivityRemoveAttachment={() => {}}
                  onActivityToggleLock={() => {
                    if (panelState?.variant === "location") {
                      const id = panelState.activity.id;
                      setLockedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        editChangeCountRef.current += 1;
                        return next;
                      });
                    }
                  }}
                  onActivityDelete={() => {
                    if (panelState?.variant === "location") {
                      const activityId = panelState.activity.id;
                      setEditLocalDays((prev) =>
                        prev.map((d) => ({
                          ...d,
                          activities: d.activities.filter((a) => a.id !== activityId),
                        })),
                      );
                      handleActivityDelete(activityId);
                      setPanelState(collectionEnabled ? { variant: "collection" } : null);
                    }
                  }}
                  availableDays={editLocalDays.map((d) => ({
                    id: d.id,
                    label: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                  }))}
                  onAddLocationDayChange={(dayId) =>
                    setPanelState((prev) => (prev?.variant === "add-location" ? { ...prev, dayId } : prev))
                  }
                  onAddSearchPlace={handleAddSearchPlace}
                  searchPlaceDetailsLoading={panelState?.variant === "search-place" && enrichingPlaceId === panelState.place.id}
                  activityLocationLoading={panelState?.variant === "location" && pendingLocationIds.has(panelState.activity.id)}
                  onActivityMoveTo={(targetDayId) => {
                    if (panelState?.variant !== "location") return;
                    const act = panelState.activity;
                    if (act.day_id === targetDayId) return;
                    const tz = ITINERARY_TIMEZONE;
                    setEditLocalDays((prev) => {
                      let updated = prev.map((d) =>
                        d.id === act.day_id
                          ? { ...d, activities: cascadeDayTimes(d.activities.filter((a) => a.id !== act.id), tz) }
                          : d,
                      );
                      updated = updated.map((d) =>
                        d.id === targetDayId
                          ? { ...d, activities: cascadeDayTimes([...d.activities, { ...act, day_id: targetDayId }], tz) }
                          : d,
                      );
                      return updated;
                    });
                    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                    if (UUID_RE.test(act.id) && act.start_time && act.end_time) {
                      const targetDay = editLocalDays.find((d) => d.id === targetDayId);
                      const dayDate = targetDay ? parseLocalDate(targetDay.date) : new Date();
                      moveActivity(itineraryId, act.id, {
                        day_id: targetDayId,
                        source_day_id: act.day_id,
                        start_time: hourToISO(timeToHour(act.start_time), dayDate, tz),
                        end_time: hourToISO(timeToHour(act.end_time), dayDate, tz),
                        recompute_times: true,
                      }).then(() => refreshCalendarDays()).catch((e) => console.error("[move-to]", e));
                    }
                    setPanelState(collectionEnabled ? { variant: "collection" } : null);
                  }}
                  collections={collections}
                  collectionsLoading={collectionsLoading}
                  itineraryCollection={currentItineraryCollection}
                  itineraryHomeCollection={itineraryCollection}
                  itineraryLocationIds={itineraryLocationIds}
                  isSecondaryCollection={isSecondaryCollection}
                  onCollectionBack={() => setActiveCollection(null)}
                  onCollectionChange={(collectionId) => {
                    if (itineraryCollection && collectionId === itineraryCollection.id) {
                      setActiveCollection(null);
                    } else {
                      const col = collections.find((c) => c.id === collectionId);
                      if (col) {
                        getCollection(collectionId)
                          .then((data) => setActiveCollection(data))
                          .catch(() => {
                            setActiveCollection({
                              ...col,
                              locations: [],
                            } as CollectionWithLocations);
                          });
                      }
                    }
                  }}
                  onLocationSelect={(location) => {
                    setPanelState({
                      variant: "location",
                      from: "collection",
                      activity: {
                        id: location.id,
                        day_id: "",
                        day_index: 0,
                        name: location.name,
                        start_time: null,
                        end_time: null,
                        category: "poi",
                        photo_url: location.photo_urls?.[0] ?? null,
                        location: {
                          id: location.id,
                          name: location.name,
                          latitude: location.latitude ?? null,
                          longitude: location.longitude ?? null,
                          photo_urls: location.photo_urls ?? null,
                          formatted_address: location.formatted_address ?? null,
                          editorial_summary: location.location_context ?? null,
                          regular_opening_hours: location.regular_opening_hours as
                            | { weekdayDescriptions: string[] }
                            | null,
                          stay_duration: location.stay_duration ?? null,
                          primary_type: location.primary_type ?? null,
                        },
                      },
                    });
                  }}
                  flights={flights}
                  flightLoading={flightUploading}
                  flightFiles={flightAttachments.map((a) => ({ id: a.id, name: a.file_name }))}
                  onFlightFilesSelected={(files) => files.forEach(handleFlightUpload)}
                  onFlightFileRemove={(id) => requestRemoveAttachment("flight", id)}
                  onFlightOpen={(id) => { void openAttachmentInNewTab("flight", id); }}
                  onFlightAddManual={() => setPanelState({ variant: "flight-form" })}
                  onFlightSearchSubmit={async (data) => {
                    const result = await searchFlightOffers({
                      origin: data.origin.code,
                      destination: data.destination.code,
                      departureDate: data.departureDate,
                    });
                    return result.offers;
                  }}
                  onFlightSearchDestinationChange={(airport) => {
                    setFlightSearchDestination(airport);
                    setEditFitBoundsKey((key) => key + 1);
                  }}
                  onFlightSearchOriginChange={(airport) => {
                    setFlightSearchOrigin(airport);
                    setEditFitBoundsKey((key) => key + 1);
                  }}
                  onFlightTrackOffer={handleFlightTrackOffer}
                  onFlightSelectOffer={(offer, search) => {
                    beginFlightBooking(offer, {
                      origin: search.origin.code,
                      destination: search.destination.code,
                      departureDate: search.departureDate,
                    });
                  }}
                  trackedFlightOfferKeys={trackedFlightOfferKeys}
                  flightPriceWatches={flightPriceWatches}
                  onFlightPriceWatchSelect={(watch) => {
                    beginFlightBooking(watch.offer, watch.search);
                  }}
                  onFlightPriceWatchRemove={handleFlightPriceWatchRemove}
                  flightBookingSeatId={flightBookingSeatId}
                  onFlightBookingSeatModeChange={setFlightBookingSeatMode}
                  onFlightBookingPassengerNameChange={setFlightBookingPassengerName}
                  onFlightBookingComplete={completeFlightBooking}
                  onFlightReanalyze={handleFlightReanalyze}
                  flightReanalyzing={flightUploading}
                  lodgings={lodgings}
                  lodgingLoading={lodgingUploading}
                  lodgingFiles={lodgingAttachments.map((a) => ({ id: a.id, name: a.file_name }))}
                  onLodgingFilesSelected={(files) => files.forEach(handleLodgingUpload)}
                  onLodgingFileRemove={(id) => requestRemoveAttachment("lodging", id)}
                  onLodgingOpen={(id) => { void openAttachmentInNewTab("lodging", id); }}
                  onLodgingAddManual={() => setPanelState({ variant: "lodging-form" })}
                  onLodgingReanalyze={handleLodgingReanalyze}
                  lodgingReanalyzing={lodgingUploading}
                  onLodgingEdit={(lodgingId) => setPanelState({ variant: "lodging-edit", lodgingId })}
                  onLodgingDelete={async (lodgingId) => {
                    if (!itineraryId) return;
                    try {
                      const { deleteLodging } = await import("@/lib/api/lodgings");
                      await deleteLodging(itineraryId, lodgingId);
                      setLodgings(prev => prev.filter(a => a.id !== lodgingId));
                      const isLodgingActivity = (a: { id: string; source_lodging_id?: string | null }) =>
                        a.source_lodging_id === lodgingId || a.id.includes(lodgingId);
                      setCalendarDays(prev => prev.map(d => ({ ...d, activities: d.activities.filter(a => !isLodgingActivity(a)) })));
                      setEditLocalDays(prev => prev.map(d => ({ ...d, activities: d.activities.filter(a => !isLodgingActivity(a)) })));
                    } catch (err) {
                      console.error("Failed to delete accommodation:", err);
                      showToast({ title: getFriendlyApiError(err, "We couldn't delete that lodging. Try again."), variant: "error" });
                    }
                  }}
                  onLodgingFormSubmit={async (data) => {
                    await handleManualLodgingSubmit(data);
                  }}
                  onLodgingEditSubmit={async (lodgingId, data) => {
                    if (!itineraryId) return;
                    try {
                      const { updateLodging } = await import("@/lib/api/lodgings");
                      const updated = await updateLodging(itineraryId, lodgingId, {
                        name: data.name,
                        address: data.address,
                        check_in_date: data.checkInDate,
                        check_in_time: data.checkInTime,
                        check_out_date: data.checkOutDate,
                        check_out_time: data.checkOutTime,
                        confirmation: data.confirmation,
                        cost: data.cost ? parseFloat(data.cost) : undefined,
                        currency: data.currency,
                      });
                      // Server awaited the Directions cascade on every touched
                      // day (new boundary + orphaned). Apply now so transport
                      // rows + polylines update immediately on the affected
                      // days, regardless of realtime UPDATE ordering.
                      if (updated.cascades && updated.cascades.length > 0) {
                        applyServerCascadeToDays(null, updated.cascades);
                      }
                      setLodgings(prev => prev.map(a => a.id === lodgingId ? {
                        ...a,
                        name: data.name,
                        address: data.address ?? "",
                        confirmation: data.confirmation ?? "",
                        cost: data.cost ?? "",
                        checkIn: formatLodgingDate(data.checkInDate),
                        checkInTime: formatTimeOfDay(data.checkInTime),
                        checkOut: formatLodgingDate(data.checkOutDate),
                        checkOutTime: formatTimeOfDay(data.checkOutTime),
                        checkInDate: data.checkInDate,
                        checkInTimeRaw: data.checkInTime,
                        checkOutDate: data.checkOutDate,
                        checkOutTimeRaw: data.checkOutTime,
                        currency: data.currency,
                      } : a));
                      // The edit deletes + recreates the check-in/check-out
                      // boundary activities server-side. Realtime doesn't reliably
                      // re-insert them into edit mode, so refetch authoritative
                      // days to keep the lodging day-list in sync without a manual
                      // page refresh.
                      await refreshCalendarDays();
                      setPanelState({ variant: "lodging" });
                    } catch (err) {
                      console.error("Failed to update accommodation:", err);
                      showToast({ title: getFriendlyApiError(err, "We couldn't save your lodging changes. Try again."), variant: "error" });
                    }
                  }}
                  expenses={[]}
                  onExpenseCreate={() => {}}
                  onAddLocation={(loc) => {
                    if (panelState?.variant !== "add-location") return;
                    const place = loc.place;
                    const isMeal = place
                      ? place.types.some((t) =>
                          ["restaurant", "cafe", "coffee_shop", "bar", "pub", "bakery", "meal_takeaway"].includes(t),
                        )
                      : loc.category === "meal" || loc.category === "restaurant" || loc.category === "cafe";
                    addActivityToDay({
                      dayId: panelState.dayId,
                      insertAtIndex: panelState.insertAtIndex,
                      name: loc.name,
                      category: isMeal ? "meal" : "poi",
                      // Start-only entries stay point-in-time (no default stay block);
                      // a duration is set only when the user also gives an end time.
                      durationMin: loc.stayDuration,
                      startTime: loc.startTime,
                      endTime: loc.endTime,
                      latitude: place ? place.latitude : loc.latitude ?? null,
                      longitude: place ? place.longitude : loc.longitude ?? null,
                      // A resolved-link / stored place already has a persisted
                      // locations row — link it directly so the server skips a
                      // redundant Google fetch. Fresh search results (no locationId)
                      // pass place_id + place_details for server-side persistence.
                      ...(place?.locationId
                        ? { locationId: place.locationId }
                        : { placeId: place?.id, placeDetails: place ? toPlaceDetailsPayload(place) : undefined }),
                      photoUrl: place?.photoUrl ?? null,
                      formattedAddress: place?.address ?? loc.address ?? null,
                      googleMapsUri: place?.googleMapsUri ?? loc.mapsLink ?? null,
                      optimisticLocation: place ? searchPlaceToActivityLocationFields(place) : undefined,
                    });
                  }}
                  onPlaceSearch={handlePlaceSearch}
                  onResolveMapsLink={handleResolveMapsLink}
                  itineraryId={itineraryId}
                  timezone={ITINERARY_TIMEZONE}
                  itineraryStartDate={dateRange?.from ? `${dateRange.from.getFullYear()}-${String(dateRange.from.getMonth() + 1).padStart(2, "0")}-${String(dateRange.from.getDate()).padStart(2, "0")}` : undefined}
                  itineraryEndDate={dateRange?.to ? `${dateRange.to.getFullYear()}-${String(dateRange.to.getMonth() + 1).padStart(2, "0")}-${String(dateRange.to.getDate()).padStart(2, "0")}` : undefined}
                  onFlightFormSubmit={async (data, expandDates) => {
                    if (!itineraryId) return;
                    try {
                      const row = await createFlight(itineraryId, {
                        source: "manual",
                        flight_number: data.flightNumber,
                        airline: data.airline,
                        depart_date: data.departDate,
                        depart_time: data.departTime,
                        depart_airport_code: data.fromCode,
                        depart_city: data.fromCity,
                        arrive_date: data.arriveDate ?? data.departDate,
                        arrive_time: data.arriveTime,
                        arrive_airport_code: data.toCode,
                        arrive_city: data.toCity,
                        cost: data.cost,
                        currency: data.currency,
                        confirmation: data.confirmation,
                        fare_class: data.fareClass,
                        terminal: data.terminal,
                        baggage_allowance: data.baggageAllowance,
                        ticket_number: data.ticketNumber,
                      });
                      // The card is built from the stored row, not from the form,
                      // so what the list shows and what a reload shows cannot
                      // disagree about a field the server normalized.
                      setFlights((prev) => [...prev, mapExtractedFlightToCardProps(row)]);
                      if (expandDates) {
                        const allDates = [data.departDate, data.arriveDate].filter(Boolean) as string[];
                        let newFrom = dateRange?.from;
                        let newTo = dateRange?.to;
                        for (const d of allDates) {
                          const parsed = parseLocalDate(d);
                          if (!newFrom || parsed < newFrom) newFrom = parsed;
                          if (!newTo || parsed > newTo) newTo = parsed;
                        }
                        if (newFrom && newTo) setDateRange({ from: newFrom, to: newTo });
                      }
                      setPanelState({ variant: "flight" });
                    } catch (err) {
                      console.error("Failed to create flight:", err);
                    }
                  }}
                  onFlightEdit={(flightId) => {
                    setPanelState({ variant: "flight-edit", flightId });
                  }}
                  onFlightDelete={async (flightId) => {
                    if (!itineraryId) return;
                    try {
                      await deleteFlight(itineraryId, flightId);
                      setFlights(prev => prev.filter(f => f.id !== flightId));
                      const isFlightActivity = (a: { id: string; source_flight_id?: string | null }) =>
                        a.source_flight_id === flightId || a.id.includes(flightId);
                      setCalendarDays(prev => prev.map(d => ({ ...d, activities: d.activities.filter(a => !isFlightActivity(a)) })));
                      setEditLocalDays(prev => prev.map(d => ({ ...d, activities: d.activities.filter(a => !isFlightActivity(a)) })));
                    } catch (err) {
                      console.error("Failed to delete flight:", err);
                    }
                  }}
                  onFlightEditSubmit={async (flightId, data, expandDates) => {
                    if (!itineraryId) return;
                    try {
                      const row = await updateFlight(itineraryId, flightId, {
                        flight_number: data.flightNumber,
                        airline: data.airline,
                        depart_date: data.departDate,
                        depart_time: data.departTime,
                        depart_airport_code: data.fromCode,
                        depart_city: data.fromCity,
                        arrive_date: data.arriveDate ?? data.departDate,
                        arrive_time: data.arriveTime,
                        arrive_airport_code: data.toCode,
                        arrive_city: data.toCity,
                        cost: data.cost,
                        currency: data.currency,
                        confirmation: data.confirmation,
                        fare_class: data.fareClass,
                        terminal: data.terminal,
                        baggage_allowance: data.baggageAllowance,
                        ticket_number: data.ticketNumber,
                      });
                      // `stops` is not a column — it belongs to the Atlas offer,
                      // not to the row — so the existing card's value is kept
                      // rather than dropped by the remap.
                      setFlights(prev => prev.map(f => f.id === flightId
                        ? { ...mapExtractedFlightToCardProps(row), stops: f.stops }
                        : f));
                      if (expandDates) {
                        const allDates = [data.departDate, data.arriveDate].filter(Boolean) as string[];
                        let newFrom = dateRange?.from;
                        let newTo = dateRange?.to;
                        for (const d of allDates) {
                          const parsed = parseLocalDate(d);
                          if (!newFrom || parsed < newFrom) newFrom = parsed;
                          if (!newTo || parsed > newTo) newTo = parsed;
                        }
                        if (newFrom && newTo) setDateRange({ from: newFrom, to: newTo });
                      }
                      setPanelState({ variant: "flight" });
                    } catch (err) {
                      console.error("Failed to update flight:", err);
                    }
                  }}
                />
              }
              rightContent={
                <div className="itinerary-edit-map-wrapper relative size-full">
                  {flightBookingSeatMode && panelStateLive?.variant === "flight-booking" ? (
                    <FlightSeatSelectionWorkspace
                      offer={panelStateLive.offer}
                      passengerName={flightBookingPassengerName || "Adult 1"}
                      selectedSeatId={flightBookingSeatId}
                      onSeatSelect={setFlightBookingSeatId}
                    />
                  ) : (
                    <>
                      {/* border/radius come from the right column wrapper; MapContainer's own are stripped (border-0 rounded-none) to avoid a double border */}
                      <MapContainer
                        locations={editFilteredMapLocations}
                        polylines={editFilteredMapPolylines}
                        defaultCenter={defaultCenter}
                        highlightedLocationId={panelState?.variant === "location" ? panelState.activity.location?.id ?? null : null}
                        interactive
                        eager
                        animateBounds
                        singleLocationZoom={14}
                        fitBoundsKey={editFitBoundsKey}
                        height="100%"
                        className="itinerary-edit-map h-full w-full border-0 rounded-none"
                        hoverVariant="name"
                        searchRequest={mapSearchRequest}
                        onLocationClick={handleMapLocationClick}
                        onSearchResultClick={handleSearchResultClick}
                        onSearchLoadingChange={setMapSearchLoading}
                        onPlaceDetailsFetcherReady={handlePlaceDetailsFetcherReady}
                        onPlaceSearchReady={handlePlaceSearchReady}
                      />
                      {/* Map Controls: Days Tab + Search */}
                      <div className="itinerary-edit-map-controls absolute top-3 left-3 right-3 z-10 flex items-start gap-2">
                        {editLocalDays.length > 1 && (
                          <DaysTab
                            totalDays={editLocalDays.length}
                            expanded={editDayFilterOpen}
                            onToggle={() => setEditDayFilterOpen(v => !v)}
                            focusedDayIndex={editFocusedDayIndex}
                            onDayClick={handleEditDayFilterClick}
                            className="itinerary-edit-days-tab shrink-0"
                          />
                        )}
                        {/* Map Search */}
                        <MapSearchBar
                          open={mapSearchOpen}
                          onOpenChange={handleMapSearchOpenChange}
                          query={mapSearchQuery}
                          onQueryChange={setMapSearchQuery}
                          onSubmit={handleMapSearchSubmit}
                          activeChipId={mapSearchChipId}
                          onChipToggle={handleMapSearchChipToggle}
                          onClear={handleMapSearchClear}
                          loading={mapSearchLoading}
                          className="itinerary-edit-map-search ml-auto min-w-0 flex-1"
                        />
                      </div>
                    </>
                  )}
                </div>
              }
            />
          </div>

          {/* Drag Drop Overlay */}
          <DragOverlay
            adjustScale={false}
            dropAnimation={{ duration: 180, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }}
          >
            {editDragActivity && (
              <div
                className="pointer-events-none rotate-[0.6deg] rounded-xl shadow-[0_20px_48px_rgba(9,11,12,0.22)]"
                style={{ width: editDragActivityWidth ?? 420 }}
              >
                <CompactActivityCard
                  activity={editDragActivity}
                  layout={getActivityCardLayout(editDragActivity, { editable: true })}
                  selected={false}
                  timezone={ITINERARY_TIMEZONE}
                  activityNotePreview={activityNotePreviews.get(editDragActivity.id) ?? null}
                  readOnlyNote
                />
              </div>
            )}
            {editDragLocation && (
              <div className="itinerary-edit-drag-location-overlay w-[200px] opacity-90 rotate-[2deg] rounded-xl border border-edge bg-surface p-1 shadow-xl">
                <div className="itinerary-edit-drag-location-card rounded-[10px] p-2 bg-surface shadow-[0px_2px_8px_rgba(0,0,0,0.08)] flex gap-2 items-start">
                  {editDragLocation.photo_urls?.[0] && (
                    <div className="itinerary-edit-drag-location-thumbnail size-10 rounded-lg overflow-hidden shrink-0">
                      <img
                        src={editDragLocation.photo_urls[0]}
                        alt={editDragLocation.name}
                        className="itinerary-edit-drag-location-image w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="itinerary-edit-drag-location-meta flex flex-col gap-0.5 min-w-0 py-0.5">
                    <span className="itinerary-edit-drag-location-name type-body-2 font-medium text-content truncate">
                      {editDragLocation.name}
                    </span>
                    <span className="itinerary-edit-drag-location-duration type-body-3 text-content-secondary">
                      {formatStayDuration(editDragLocation.stay_duration ?? 60) ?? "1 hr"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </DragOverlay>
        </Kanban>
      ) : (<>
        {/* ── View Mode: Tab Dropdown Panel ── */}
        <div
          data-region="itinerary-detail-tab-panel"
          className="itinerary-tab-dropdown mx-auto grid w-full max-w-[1600px] px-3 transition-[grid-template-rows,opacity] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-spatial)] md:px-8 lg:px-10"
          style={{
            gridTemplateRows: openTab ? "1fr" : "0fr",
            opacity: openTab ? 1 : 0,
          }}
        >
          <div className="itinerary-tab-dropdown-clip overflow-hidden">
            <div className="itinerary-tab-dropdown-card rounded-2xl border border-edge bg-surface p-1 mt-4">
              {openTab === "Notes" ? (
                <div className="itinerary-tab-notes-panel rounded-xl bg-surface-alt p-3">
                  <NotesGrid
                    itineraryId={itinerary.id}
                    className="max-h-[320px]"
                    activityNotes={activityNotesList}
                    onActivityNoteClick={(activityId) => {
                      const found = activityIndex.get(activityId);
                      if (!found) return;
                      setOpenTab(null);
                      openActivityDetail(found.activity);
                    }}
                  />
                </div>
              ) : (() => {
                const currentAttachments =
                  openTab === "Flight" ? flightAttachments :
                  openTab === "Lodging" ? lodgingAttachments : [];
                const currentTabFiles = currentAttachments.map((a) => ({
                  id: a.id,
                  name: a.file_name,
                }));
                const removeEntityType: "flight" | "lodging" | null =
                  openTab === "Flight" ? "flight" :
                  openTab === "Lodging" ? "lodging" : null;
                const isProcessing =
                  viewTabAcceptsFiles &&
                  ((openTab === "Flight" && flightUploading) ||
                    (openTab === "Lodging" && lodgingUploading));
                const hasFiles = viewTabAcceptsFiles && !isProcessing && currentTabFiles.length > 0;
                const isIdle = !isProcessing && !hasFiles;

                return (
                  <div
                    onDragEnter={handleViewTabDragEnter}
                    onDragLeave={handleViewTabDragLeave}
                    onDragOver={handleViewTabDragOver}
                    onDrop={handleViewTabDrop}
                    className={cn(
                      "itinerary-tab-dropzone rounded-xl bg-surface-alt transition-colors",
                      viewTabDragging && "bg-action-brand/10 ring-2 ring-edge-brand ring-offset-0",
                    )}
                  >
                    {/* Tab Dropzone — Processing */}
                    {isProcessing && (
                      <div className="itinerary-tab-dropzone-processing flex flex-col items-center justify-center gap-2 py-10" aria-live="polite" aria-busy="true">
                        <div className="itinerary-tab-dropzone-processing-icon size-10 rounded-full bg-surface-muted animate-pulse" />
                        <div className="itinerary-tab-dropzone-processing-line size-40 max-w-full h-4 rounded-md bg-surface-muted animate-pulse" />
                        <div className="itinerary-tab-dropzone-processing-subline w-56 max-w-full h-3 rounded-md bg-action-secondary animate-pulse" />
                        <span className="sr-only">Processing your {openTab?.toLowerCase()} document…</span>
                      </div>
                    )}

                    {/* Tab Dropzone — Files */}
                    {hasFiles && (
                      <div className="itinerary-tab-dropzone-files px-3 py-3">
                        <FilePillHeader
                          files={currentTabFiles}
                          onAddFile={handleViewTabClick}
                          onRemoveFile={
                            removeEntityType
                              ? (id) => requestRemoveAttachment(removeEntityType, id)
                              : undefined
                          }
                        />
                      </div>
                    )}

                    {/* Tab Dropzone — Idle */}
                    {isIdle && (
                      <div
                        role={viewTabAcceptsFiles ? "button" : undefined}
                        tabIndex={viewTabAcceptsFiles ? 0 : undefined}
                        aria-label={viewTabAcceptsFiles ? `Upload ${openTab?.toLowerCase()} files` : undefined}
                        onClick={handleViewTabClick}
                        onKeyDown={(e) => {
                          if (!viewTabAcceptsFiles) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleViewTabClick();
                          }
                        }}
                        className={cn(
                          "itinerary-tab-dropzone-idle flex flex-col items-center justify-center gap-2 py-10 group transition-colors rounded-xl",
                          viewTabAcceptsFiles ? "cursor-pointer hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong" : "cursor-default",
                        )}
                      >
                        <div className="itinerary-tab-dropzone-icon size-10 rounded-full bg-surface border border-edge flex items-center justify-center mb-1 group-hover:border-edge-strong transition-colors pointer-events-none">
                          {openTab === "Flight" && <PlaneTakeoff className="size-5 text-content-tertiary" />}
                          {openTab === "Lodging" && <BedDouble className="size-5 text-content-tertiary" />}
                          {openTab === "Bookings" && <Receipt className="size-5 text-content-tertiary" />}
                          {openTab === "Expenses" && <Wallet className="size-5 text-content-tertiary" />}
                        </div>
                        <p className="itinerary-tab-dropzone-prompt type-body-2 text-content-secondary pointer-events-none">
                          Drop your{" "}
                          <span className="itinerary-tab-dropzone-type text-content font-medium lowercase">{openTab}</span>
                          {" "}files here or{" "}
                          <span className="itinerary-tab-dropzone-browse text-content font-medium underline underline-offset-2 decoration-content-tertiary">browse</span>
                        </p>
                        <p className="itinerary-tab-dropzone-hint type-body-3 text-content-tertiary pointer-events-none">
                          {openTab === "Flight" && "PDF, images, or booking confirmations"}
                          {openTab === "Lodging" && "PDF, images, or reservation details"}
                          {openTab === "Bookings" && "PDF, images, or e-tickets"}
                          {openTab === "Expenses" && "PDF, images, or receipts"}
                        </p>
                      </div>
                    )}

                    {viewTabAcceptsFiles && (
                      <input
                        ref={viewTabFileInputRef}
                        type="file"
                        accept=".pdf,image/png,image/jpeg,image/webp"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          dispatchViewTabFiles(Array.from(e.target.files ?? []));
                          e.target.value = "";
                        }}
                      />
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Itinerary View */}
        <div data-region="itinerary-detail-day-board-wrapper" className="itinerary-quickview-wrapper flex-1 pt-3 md:pt-6">
          <ItineraryQuickView
            itinerary={itinerary}
            activityNotePreviews={activityNotePreviews}
            onActivityClick={openActivityDetail}
            flight={flights[0] ?? null}
            onFlightOpen={openFlightWorkspace}
          />
        </div>
      </>)}
      </div>

      {/* Attachment Delete Confirmation Modal */}
      <Dialog.Root
        open={!!pendingDeleteAttachment}
        onOpenChange={(open) => {
          if (!open && !deletingAttachment) setPendingDeleteAttachment(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="attachment-delete-backdrop fixed inset-0 bg-black/50 z-40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="attachment-delete-dialog fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[28rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-edge-strong bg-surface-alt p-4 shadow-default sm:p-6">
            <div className="attachment-delete-header flex items-start gap-3">
              <div className="attachment-delete-icon-wrapper flex items-center justify-center size-10 rounded-lg bg-surface-warning-subtle shrink-0">
                <AlertTriangle className="attachment-delete-icon size-5 text-content-on-dark" />
              </div>
              <div className="attachment-delete-text flex flex-col gap-1">
                <Dialog.Title className="attachment-delete-title type-body-1 text-glyph">
                  Remove this file?
                </Dialog.Title>
                <Dialog.Description className="attachment-delete-description type-body-2 text-content-secondary">
                  Removing{" "}
                  <span className="attachment-delete-filename font-medium text-glyph">
                    {pendingDeleteAttachment?.file_name}
                  </span>{" "}
                  will also delete the linked{" "}
                  {pendingDeleteAttachment?.entity_type === "flight" ? "flight" : "lodging"}{" "}
                  and its activity cards. This cannot be undone.
                </Dialog.Description>
              </div>
            </div>
            <div className="attachment-delete-actions flex items-center justify-end gap-2 mt-2">
              <Button
                className="attachment-delete-cancel-button h-11 sm:h-9"
                variant="ghost"
                size="sm"
                disabled={deletingAttachment}
                onClick={() => setPendingDeleteAttachment(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="attachment-delete-confirm-button h-11 bg-action-error text-content-on-dark hover:bg-action-error-hover sm:h-9"
                disabled={deletingAttachment}
                onClick={() => { void confirmDeleteAttachment(); }}
              >
                {deletingAttachment ? "Removing…" : "Remove"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {/* Deconflict Confirmation Dialog */}
      {/* Delete Itinerary Confirmation */}
      <ConfirmActionDialog
        open={deleteItineraryConfirmOpen}
        onOpenChange={setDeleteItineraryConfirmOpen}
        title="Delete itinerary?"
        confirmLabel={deletingItinerary ? "Deleting…" : "Delete"}
        onConfirm={handleDeleteItinerary}
        onCancel={() => setDeleteItineraryConfirmOpen(false)}
      >
        <p className="type-body-2 text-content-secondary">
          This will permanently delete{" "}
          <span className="font-semibold text-glyph">{itinerary?.name}</span> and everything in it.
          This can&apos;t be undone.
        </p>
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={deconflictConfirmOpen}
        onOpenChange={setDeconflictConfirmOpen}
        title="Resolve conflicts"
        confirmLabel="Resolve"
        onConfirm={handleDeconflictConfirm}
        onCancel={handleDeconflictCancel}
      >
        <p className="type-body-2 text-content-secondary">
          Resolving conflicts will adjust the times of{" "}
          <span className="font-semibold">
            {pendingDeconflict?.changes.length}{" "}
            {(pendingDeconflict?.changes.length ?? 0) === 1 ? "activity" : "activities"}
          </span>
          {(pendingDeconflict?.lockedAnchors.length ?? 0) > 0
            ? <>{" "}around your locked{" "}
                {(pendingDeconflict?.lockedAnchors.length ?? 0) === 1 ? "stop" : "stops"}:</>
            : ":"}
        </p>

        <div className="flex flex-col gap-2 max-h-[24rem] overflow-y-auto">
          {[
            ...(pendingDeconflict?.changes ?? []).map((c) => ({
              sort: c.newStart ? parseTimeMins(c.newStart) : 0,
              node: (
                <ActivityChangeRow
                  key={c.activity.id}
                  activity={c.activity}
                  newStart={c.newStart}
                  newEnd={c.newEnd}
                  timezone={ITINERARY_TIMEZONE}
                />
              ),
            })),
            ...(pendingDeconflict?.lockedAnchors ?? []).map((a) => ({
              sort: a.start_time ? parseTimeMins(a.start_time) : 0,
              node: (
                <ActivityChangeRow
                  key={a.id}
                  activity={a}
                  newStart={a.start_time ?? ""}
                  newEnd={a.end_time ?? ""}
                  locked
                  timezone={ITINERARY_TIMEZONE}
                />
              ),
            })),
          ]
            .sort((x, y) => x.sort - y.sort)
            .map((item) => item.node)}
        </div>
      </ConfirmActionDialog>

      {/* Optimize Route Confirmation Dialog */}
      <ConfirmActionDialog
        open={optimizeConfirmOpen}
        onOpenChange={setOptimizeConfirmOpen}
        title="Optimize route"
        confirmLabel="Optimize"
        onConfirm={handleOptimizeConfirm}
        onCancel={handleOptimizeCancel}
      >
        {/* Reordered Activities */}
        {(pendingOptimize?.changes.length ?? 0) > 0 && (
          <>
            <p className="type-body-2 text-content-secondary">
              Optimizing the route will adjust{" "}
              <span className="font-semibold">
                {pendingOptimize?.changes.length}{" "}
                {(pendingOptimize?.changes.length ?? 0) === 1 ? "activity" : "activities"}
              </span>
              :
            </p>

            <div className="flex flex-col gap-2 max-h-[18rem] overflow-y-auto optimize-changes-list">
              {pendingOptimize?.changes.map(({ activity, newStart, newEnd, newIndex }) => (
                <ActivityChangeRow
                  key={activity.id}
                  activity={activity}
                  newStart={newStart}
                  newEnd={newEnd}
                  timezone={ITINERARY_TIMEZONE}
                  badge={
                    <div className="size-6 rounded-md bg-surface-muted flex items-center justify-center shrink-0">
                      <span className="type-body-3 font-semibold text-content-secondary">{newIndex + 1}</span>
                    </div>
                  }
                />
              ))}
            </div>
          </>
        )}

        {/* Dropped Locations */}
        {(pendingOptimize?.dropped.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2 optimize-dropped-section">
            <p className="type-body-2 text-content-secondary">
              <span className="font-semibold text-content-warning">
                {pendingOptimize?.dropped.length}{" "}
                {(pendingOptimize?.dropped.length ?? 0) === 1 ? "location" : "locations"}
              </span>{" "}
              won&apos;t fit this day and will be removed from the schedule. They stay in your collection&apos;s unused list, so you can re-add them anytime.
            </p>
            <div className="flex flex-col gap-1.5 max-h-[12rem] overflow-y-auto optimize-dropped-list">
              {pendingOptimize?.dropped.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 p-2 rounded-lg border border-surface-warning-subtle bg-surface-warning-subtle/40 optimize-dropped-item"
                >
                  <MapPinOff className="size-4 text-content-warning shrink-0" />
                  <span className="type-body-3 text-content truncate">{d.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </ConfirmActionDialog>
      </>)}
    </div>
  );
}
