"use client";

import { Calendar as CalendarIcon, ChevronDown, AlertTriangle, Bell, BellOff, Circle, Plane, Search, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";

import { Calendar } from "@/components/ui/primitives/Calendar";
import { inputControlVariants, inputVariants } from "@/components/ui/primitives/Input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/primitives/Popover";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/primitives/Menu";
import { TypeableTimePicker } from "@/components/ui/detail-views/TypeableTimePicker";
import { CollapsibleSection } from "@/components/ui/primitives/CollapsibleSection";
import { Tab } from "@/components/ui/primitives/Tab";
import { Button } from "@/components/ui/primitives/Button";
import { CHANGI_AIRPORT, searchAirports, searchDestinationAirports, type FlightAirport } from "@/lib/flights/airports";
import type { FlightOffer } from "@/lib/flights/atlas";
import { cn } from "@/lib/utils";

export type FlightAddMode = "search" | "manual";

export interface FlightSearchData {
  origin: FlightAirport;
  destination: FlightAirport;
  departureDate: string;
}

export interface FlightFormData {
  fromCode: string;
  fromCity: string;
  toCode: string;
  toCity: string;
  departDate: string;
  departTime: string;
  flightNumber: string;
  arriveDate?: string;
  arriveTime?: string;
  airline?: string;
  cost?: string;
  currency?: string;
  confirmation?: string;
  fareClass?: string;
  terminal?: string;
  baggageAllowance?: string;
  ticketNumber?: string;
}

interface FlightFormProps {
  initialData?: Partial<FlightFormData>;
  itineraryStartDate?: string;
  itineraryEndDate?: string;
  onSubmit: (data: FlightFormData, expandDates?: boolean) => void;
}

interface FlightAddComposerProps extends FlightFormProps {
  mode: FlightAddMode;
  onModeChange: (mode: FlightAddMode) => void;
  onSearch: (data: FlightSearchData) => Promise<FlightOffer[]>;
  onDestinationChange?: (airport: FlightAirport | null) => void;
  onOriginChange?: (airport: FlightAirport | null) => void;
  onTrackOffer?: (offer: FlightOffer, search: FlightSearchData) => void;
  onSelectOffer?: (offer: FlightOffer, search: FlightSearchData) => void;
  trackedOfferKeys?: Set<string>;
}

function parseLocalDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDisplayDate(iso: string): string {
  const date = parseLocalDate(iso);
  if (!date) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toISODateString(date: Date | undefined): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function TextInput({
  placeholder,
  value,
  onChange,
  className,
  inputClassName,
  uppercase = false,
  type = "text",
  clearable = true,
}: {
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  inputClassName?: string;
  uppercase?: boolean;
  type?: string;
  clearable?: boolean;
}) {
  return (
    <div className={cn(inputVariants({ variant: "default", size: "md", icon: "none", hasValue: value.length > 0 }), className)}>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputControlVariants(), "text-content font-medium", uppercase && "uppercase tracking-widest", inputClassName)}
      />
      {clearable && value.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange("")}
          aria-label="Clear"
          className="flex size-6 shrink-0 items-center justify-center rounded-lg text-content-secondary transition-colors hover:bg-surface-muted [&_svg]:size-3"
        >
          <X />
        </button>
      )}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  placeholder = "Select",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  const selectedLabel = options.find(o => o.value === value)?.label;
  return (
    <Menu>
      <MenuTrigger
        className={cn(
          "w-full cursor-pointer text-left focus:outline-none focus-visible:outline-none",
          inputVariants({ variant: "default", size: "md", icon: "trailing", hasValue: Boolean(value) }),
          className
        )}
      >
        <span className={cn("input-control flex-1 min-w-0 truncate type-body-2 font-medium", value ? "text-content" : "text-content-secondary")}>
          {selectedLabel ?? placeholder}
        </span>
        <span className="flex shrink-0 items-center justify-center size-5 text-content-secondary [&_svg]:size-4" aria-hidden="true">
          <ChevronDown />
        </span>
      </MenuTrigger>
      <MenuContent align="start" side="bottom" sideOffset={4}>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            size="lg"
            selected={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function DatePickerField({
  value,
  onChange,
  placeholder = "Select date",
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "w-full cursor-pointer text-left focus:outline-none focus-visible:outline-none",
          inputVariants({ variant: "default", size: "md", icon: "trailing", hasValue: Boolean(value) })
        )}
      >
        <span className={cn("input-control flex-1 min-w-0 truncate type-body-2 font-medium", value ? "text-content" : "text-content-secondary")}>
          {value ? formatDisplayDate(value) : placeholder}
        </span>
        <span className="flex shrink-0 items-center justify-center size-5 text-content-secondary [&_svg]:size-4" aria-hidden="true">
          <CalendarIcon />
        </span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="p-2 w-auto">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => { onChange(toISODateString(date)); setOpen(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="type-body-3 font-medium text-content-secondary">
      {children}
      {required && <span className="text-content-error ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}

function FormRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex gap-3", className)}>{children}</div>;
}

function FormField({ label, required, children, className }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-1 flex-col gap-1.5 min-w-0", className)}>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

const FARE_CLASS_OPTIONS = [
  { value: "Economy", label: "Economy" },
  { value: "Premium Economy", label: "Premium Economy" },
  { value: "Business", label: "Business" },
  { value: "First", label: "First" },
];

const TERMINAL_OPTIONS = [
  { value: "T1", label: "Terminal 1" },
  { value: "T2", label: "Terminal 2" },
  { value: "T3", label: "Terminal 3" },
  { value: "T4", label: "Terminal 4" },
  { value: "T5", label: "Terminal 5" },
];

export function FlightForm({ initialData, itineraryStartDate, itineraryEndDate, onSubmit }: FlightFormProps) {
  const [fromCity, setFromCity] = useState(initialData?.fromCity ?? "");
  const [fromAirport, setFromAirport] = useState(initialData?.fromCode ?? "");
  const [toCity, setToCity] = useState(initialData?.toCity ?? "");
  const [toAirport, setToAirport] = useState(initialData?.toCode ?? "");
  const [flightNumber, setFlightNumber] = useState(initialData?.flightNumber ?? "");
  const [departDate, setDepartDate] = useState(initialData?.departDate ?? "");
  const [departTime, setDepartTime] = useState(initialData?.departTime ?? "");
  const [airline, setAirline] = useState(initialData?.airline ?? "");
  const [arriveDate, setArriveDate] = useState(initialData?.arriveDate ?? "");
  const [arriveTime, setArriveTime] = useState(initialData?.arriveTime ?? "");
  const [cost, setCost] = useState(initialData?.cost ?? "");
  const [currency, setCurrency] = useState(initialData?.currency ?? "");
  const [confirmation, setConfirmation] = useState(initialData?.confirmation ?? "");
  const [fareClass, setFareClass] = useState(initialData?.fareClass ?? "");
  const [terminal, setTerminal] = useState(initialData?.terminal ?? "");
  const [baggageAllowance, setBaggageAllowance] = useState(initialData?.baggageAllowance ?? "");
  // Ticket numbers are intentionally not collected: they add sensitive booking
  // data without helping the itinerary. Preserve one already stored on edit.
  const ticketNumber = initialData?.ticketNumber ?? "";
  const [showErrors, setShowErrors] = useState(false);
  const [showDateConfirm, setShowDateConfirm] = useState(false);
  const [expandDatesConfirmed, setExpandDatesConfirmed] = useState(false);
  const [pendingDateField, setPendingDateField] = useState<"depart" | "arrive" | null>(null);
  const [pendingDateValue, setPendingDateValue] = useState("");

  const hasOrigin = fromCity.trim() || fromAirport.trim();
  const hasDestination = toCity.trim() || toAirport.trim();
  const isValid = hasOrigin && hasDestination && flightNumber.trim() && departDate && departTime;
  const hasBookingDetails = Boolean(
    initialData?.fareClass || initialData?.terminal || initialData?.cost ||
    initialData?.currency || initialData?.confirmation || initialData?.baggageAllowance,
  );

  function isOutsideRange(date: string): boolean {
    if (!date || !itineraryStartDate || !itineraryEndDate) return false;
    return date < itineraryStartDate || date > itineraryEndDate;
  }

  function handleDateChange(field: "depart" | "arrive", value: string) {
    if (isOutsideRange(value)) {
      setPendingDateField(field);
      setPendingDateValue(value);
      setShowDateConfirm(true);
    } else {
      if (field === "depart") setDepartDate(value);
      else setArriveDate(value);
    }
  }

  function handleDateConfirm() {
    if (pendingDateField === "depart") setDepartDate(pendingDateValue);
    else if (pendingDateField === "arrive") setArriveDate(pendingDateValue);
    setExpandDatesConfirmed(true);
    setShowDateConfirm(false);
    setPendingDateField(null);
  }

  function buildFormData(): FlightFormData {
    return {
      fromCode: fromAirport.trim().toUpperCase(),
      fromCity: fromCity.trim(),
      toCode: toAirport.trim().toUpperCase(),
      toCity: toCity.trim(),
      departDate,
      departTime,
      flightNumber: flightNumber.trim(),
      arriveDate: arriveDate || undefined,
      arriveTime: arriveTime || undefined,
      airline: airline.trim() || undefined,
      cost: cost.trim() || undefined,
      currency: currency.trim() || undefined,
      confirmation: confirmation.trim() || undefined,
      fareClass: fareClass || undefined,
      terminal: terminal || undefined,
      baggageAllowance: baggageAllowance.trim() || undefined,
      ticketNumber: ticketNumber.trim() || undefined,
    };
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isValid) { setShowErrors(true); return; }
    onSubmit(buildFormData(), expandDatesConfirmed);
  }

  return (
    <>
    <form
      id="flight-manual-form"
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-3 px-4 py-3"
    >
      <p className={cn("type-body-3 text-content-tertiary")}>
        Add the route and local flight times. You only need a city or airport code for each end.
      </p>
      <FormRow>
        <FormField label="From city">
          <TextInput placeholder="Singapore" value={fromCity} onChange={setFromCity} />
        </FormField>
        <FormField label="Airport code">
          <TextInput placeholder="e.g. SIN" value={fromAirport} onChange={setFromAirport} uppercase />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="To city">
          <TextInput placeholder="Bangkok" value={toCity} onChange={setToCity} />
        </FormField>
        <FormField label="Airport code">
          <TextInput placeholder="e.g. BKK" value={toAirport} onChange={setToAirport} uppercase />
        </FormField>
      </FormRow>
      {showErrors && (!hasOrigin || !hasDestination) && (
        <p role="alert" className="type-body-3 text-content-error">Add a city or airport code for both ends of the flight.</p>
      )}
      <FormRow>
        <FormField label="Flight No." required>
          <TextInput placeholder="SQ 714" value={flightNumber} onChange={setFlightNumber} />
          {showErrors && !flightNumber.trim() && (
            <p role="alert" className="type-body-3 text-content-error mt-0.5">Required</p>
          )}
        </FormField>
        <FormField label="Airline">
          <TextInput placeholder="Singapore Airlines" value={airline} onChange={setAirline} />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="Depart Date" required>
          <DatePickerField value={departDate} onChange={(v) => handleDateChange("depart", v)} placeholder="Date" />
        </FormField>
        <FormField label="Depart Time" required>
          <TypeableTimePicker value={departTime} onChange={setDepartTime} placeholder="HH:MM" />
        </FormField>
      </FormRow>
      {showErrors && (!departDate || !departTime) && (
        <p role="alert" className="type-body-3 text-content-error">Departure date and time are required</p>
      )}
      <FormRow>
        <FormField label="Arrive Date">
          <DatePickerField value={arriveDate} onChange={(v) => handleDateChange("arrive", v)} placeholder="Date" />
        </FormField>
        <FormField label="Arrive Time">
          <TypeableTimePicker value={arriveTime} onChange={setArriveTime} placeholder="HH:MM" />
        </FormField>
      </FormRow>

      {/* Optional Booking Details */}
      <CollapsibleSection
        label="Booking details (optional)"
        defaultOpen={hasBookingDetails}
        contentClassName={cn("flex flex-col gap-3")}
      >
        <FormRow>
          <FormField label="Fare class">
            <SelectField value={fareClass} onChange={setFareClass} options={FARE_CLASS_OPTIONS} placeholder="Select class" />
          </FormField>
          <FormField label="Departure terminal">
            <SelectField value={terminal} onChange={setTerminal} options={TERMINAL_OPTIONS} placeholder="Select terminal" />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label="Cost">
            <div className={cn("flex items-center gap-2")}>
              <TextInput placeholder="0.00" value={cost} onChange={setCost} inputClassName="tabular-nums" className="flex-1" />
              <TextInput placeholder="USD" value={currency} onChange={setCurrency} uppercase className="w-16" clearable={false} />
            </div>
          </FormField>
          <FormField label="Confirmation code">
            <TextInput placeholder="ABC123" value={confirmation} onChange={setConfirmation} />
          </FormField>
        </FormRow>
        <FormField label="Baggage allowance">
          <TextInput placeholder="e.g. 23 kg checked" value={baggageAllowance} onChange={setBaggageAllowance} />
        </FormField>
      </CollapsibleSection>
    </form>

    {/* Date Confirmation Modal */}
    <Dialog.Root open={showDateConfirm} onOpenChange={setShowDateConfirm}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[360px] rounded-2xl bg-surface border border-edge p-6 shadow-lg flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center size-10 rounded-full bg-surface-warning-subtle shrink-0">
              <AlertTriangle className="size-5 text-content-warning" />
            </div>
            <div className="flex flex-col gap-1">
              <Dialog.Title className="type-body-1 font-semibold text-content">
                Date outside itinerary
              </Dialog.Title>
              <Dialog.Description className="type-body-2 text-content-secondary">
                The flight date is outside your itinerary dates ({itineraryStartDate && formatDisplayDate(itineraryStartDate)} – {itineraryEndDate && formatDisplayDate(itineraryEndDate)}). Would you like to extend the itinerary dates to include this flight?
              </Dialog.Description>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setShowDateConfirm(false); setPendingDateField(null); }}
              className="type-body-2 font-medium text-content-secondary px-4 py-2 rounded-full hover:bg-surface-muted transition-colors"
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={handleDateConfirm}
              className="type-body-2 font-medium text-white bg-action-dark px-4 py-2 rounded-full hover:bg-action-dark-hover-bg transition-colors"
            >
              Extend Dates
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
    </>
  );
}

export function FlightSearchForm({
  initialDate,
  onSearch,
  onDestinationChange,
  onOriginChange,
  onTrackOffer,
  onSelectOffer,
  trackedOfferKeys = new Set<string>(),
  submitLabel,
}: {
  initialDate?: string;
  onSearch: (data: FlightSearchData) => Promise<FlightOffer[]>;
  onDestinationChange?: (airport: FlightAirport | null) => void;
  onOriginChange?: (airport: FlightAirport | null) => void;
  onTrackOffer?: (offer: FlightOffer, search: FlightSearchData) => void;
  onSelectOffer?: (offer: FlightOffer, search: FlightSearchData) => void;
  trackedOfferKeys?: Set<string>;
  /**
   * Renders the submit button inside the form. The itinerary side panel owns a
   * sticky footer that submits by `form="flight-search-form"`, so it passes
   * nothing; a caller without a footer must pass a label or the form has no way
   * to submit at all.
   */
  submitLabel?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [originQuery, setOriginQuery] = useState(`${CHANGI_AIRPORT.city} (${CHANGI_AIRPORT.code})`);
  const [origin, setOrigin] = useState<FlightAirport | null>(CHANGI_AIRPORT);
  const [showOrigins, setShowOrigins] = useState(false);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destination, setDestination] = useState<FlightAirport | null>(null);
  const [departureDate, setDepartureDate] = useState(initialDate ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const [showDestinations, setShowDestinations] = useState(false);
  const [offers, setOffers] = useState<FlightOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedOfferKey, setSelectedOfferKey] = useState<string | null>(null);

  const destinationOptions = searchDestinationAirports(destinationQuery);
  const originOptions = searchAirports(originQuery);

  function chooseOrigin(airport: FlightAirport) {
    setOrigin(airport);
    setOriginQuery(`${airport.city} (${airport.code})`);
    setShowOrigins(false);
    setOffers([]);
    setHasSearched(false);
    setSelectedOfferKey(null);
    onOriginChange?.(airport);
  }

  function chooseDestination(airport: FlightAirport) {
    setDestination(airport);
    setDestinationQuery(`${airport.city} (${airport.code})`);
    setShowDestinations(false);
    setOffers([]);
    setHasSearched(false);
    setSelectedOfferKey(null);
    onDestinationChange?.(airport);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!origin || !destination || !departureDate) {
      setShowErrors(true);
      return;
    }
    const search = { origin, destination, departureDate };
    setLoading(true);
    setHasSearched(true);
    setSearchError("");
    setSelectedOfferKey(null);
    try {
      setOffers(await onSearch(search));
    } catch (error) {
      console.error("[flight search]", error);
      setOffers([]);
      setSearchError(error instanceof Error ? error.message : "We couldn't search flights right now.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      id="flight-search-form"
      onSubmit={handleSubmit}
      noValidate
      className={cn("flex flex-col gap-4 px-4 py-3")}
    >
      {/* Search Introduction */}
      <div className={cn("flex items-start gap-3 rounded-xl border border-edge-subtle bg-surface-alt p-3")}>
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-cal-flight-bg-subtle text-cal-flight-marker")}>
          <Search className={cn("size-4")} aria-hidden="true" />
        </div>
        <div className={cn("flex min-w-0 flex-col gap-0.5")}>
          <p className={cn("type-body-2 font-medium text-content")}>Flights from Singapore</p>
          <p className={cn("type-body-3 text-content-secondary")}>
            Changi is your starting airport. Pick where you want to go and compare current fares.
          </p>
        </div>
      </div>

      {/* Search Fields */}
      <FormField label="From" required>
        <div className={cn("relative")}>
          <TextInput
            placeholder="Search city or airport"
            value={originQuery}
            onChange={(value) => {
              setOriginQuery(value);
              setOrigin(null);
              setOffers([]);
              setHasSearched(false);
              setSelectedOfferKey(null);
              setShowOrigins(true);
              onOriginChange?.(null);
            }}
          />
          {showOrigins && (
            <AirportOptions options={originOptions} onChoose={chooseOrigin} />
          )}
        </div>
      </FormField>
      <FormField label="To" required>
        <div className={cn("relative")}>
          <TextInput
            placeholder="Search city or airport"
            value={destinationQuery}
            onChange={(value) => {
              setDestinationQuery(value);
              setDestination(null);
              setOffers([]);
              setHasSearched(false);
              setSelectedOfferKey(null);
              setShowDestinations(true);
              onDestinationChange?.(null);
            }}
          />
          {showDestinations && <AirportOptions options={destinationOptions} onChoose={chooseDestination} />}
        </div>
      </FormField>
      <FormField label="Departure date" required>
        <DatePickerField value={departureDate} onChange={setDepartureDate} placeholder="Select date" />
      </FormField>
      {showErrors && (!origin || !destination || !departureDate) && (
        <p role="alert" className={cn("type-body-3 text-content-error")}>
          Choose a destination and departure date to search.
        </p>
      )}
      {searchError && <p role="alert" className={cn("type-body-3 text-content-error")}>{searchError}</p>}

      {submitLabel && (
        <Button variant="primary" size="md" icon="leading" type="submit" disabled={loading}>
          <Search className={cn("size-4")} />
          {loading ? "Searching…" : submitLabel}
        </Button>
      )}

      {/* Flight Results */}
      {(loading || hasSearched) && (
        <div className={cn("flex flex-col gap-2")} data-region="itinerary-flight-search-results">
          <div className={cn("flex items-center justify-between px-1")}>
            <span className={cn("type-body-2 type-secondary font-semibold text-content")}>Flight options</span>
            {offers.length > 0 && <span className={cn("type-body-4 text-content-tertiary")}>Sandbox fares</span>}
          </div>
          {loading ? (
            <div className={cn("h-24 animate-pulse rounded-xl border border-edge-subtle bg-surface-alt")} />
          ) : offers.length > 0 ? offers.map((offer) => {
            const selected = selectedOfferKey === offer.offerKey;
            const tracked = trackedOfferKeys.has(offer.offerKey);
            const lowSeatsRemaining = offer.seatsRemaining != null && offer.seatsRemaining <= 5
              ? offer.seatsRemaining
              : null;
            const departureCity = searchAirports(offer.departureAirport)
              .find((airport) => airport.code === offer.departureAirport)?.city;
            const arrivalCity = searchAirports(offer.arrivalAirport)
              .find((airport) => airport.code === offer.arrivalAirport)?.city;
            return (
              <motion.div
                key={offer.id}
                whileHover={reduceMotion ? undefined : { y: -1, scale: 1.002 }}
                transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "relative flex flex-col overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] hover:shadow-default",
                  selected
                    ? "border-edge-brand shadow-xs"
                    : "border-edge-subtle hover:border-edge",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedOfferKey(offer.offerKey)}
                  className={cn("flex w-full flex-col overflow-hidden rounded-t-[11px] text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-strong/50")}
                  aria-label={`Choose ${offer.flightNumbers.join(" and ")} fare`}
                >
                  {/* Ticket Header */}
                  <span className={cn("flex min-h-10 items-center justify-between gap-3 bg-cal-flight-bg-subtle/30 px-3 py-2")}>
                    <span className={cn("flex min-w-0 items-center gap-1.5 type-body-2 text-content-secondary")}>
                      <span className={cn("type-secondary font-semibold text-content")}>{offer.flightNumbers.join(" · ")}</span>
                      <span aria-hidden="true">·</span>
                      <span>{offer.stops === 0 ? "Direct" : `${offer.stops} stop${offer.stops === 1 ? "" : "s"}`}</span>
                      {offer.baggage && <><span aria-hidden="true">·</span><span className={cn("truncate")}>{offer.baggage}</span></>}
                    </span>
                    {lowSeatsRemaining && (
                      <span className={cn("shrink-0 rounded-full border border-edge-subtle bg-surface/80 px-2 py-0.5 type-body-2 font-medium text-content-secondary")}>
                        {lowSeatsRemaining} seats left
                      </span>
                    )}
                  </span>

                  {/* Ticket Route */}
                  <span className={cn("grid min-h-24 grid-cols-[minmax(0,1fr)_minmax(7.5rem,1.25fr)_minmax(0,1fr)] items-center gap-2 bg-cal-flight-bg-subtle/30 px-3 pb-2 text-left")}>
                    <span className={cn("flex min-w-0 flex-col")}>
                      <span className={cn("type-h4 type-secondary font-semibold text-content")}>{offer.departureAirport}</span>
                      {departureCity && <span className={cn("truncate type-body-2 text-content-secondary")}>{departureCity}</span>}
                      <span className={cn("type-body-2 text-content-secondary tabular-nums")}>{formatOfferTime(offer.departureTime)}{offer.departureTerminal ? ` · T${offer.departureTerminal}` : ""}</span>
                    </span>
                    <span className={cn("relative flex h-16 min-w-0 items-end justify-center pb-0.5")} aria-hidden="true">
                      <span className={cn("absolute inset-x-2 top-6 border-t border-dashed border-content-tertiary/60")} />
                      <Circle className={cn("absolute left-[0.45rem] top-[1.18rem] size-2.5 fill-surface stroke-content-tertiary/60 stroke-2")} />
                      <Circle className={cn("absolute right-[0.45rem] top-[1.18rem] size-2.5 fill-surface stroke-content-tertiary/60 stroke-2")} />
                      <img
                        src="/images/stickers/Plane.svg"
                        alt=""
                        className={cn("absolute left-1/2 top-0 size-10 -translate-x-1/2 object-contain")}
                      />
                      <span className={cn("relative type-body-2 text-content-secondary tabular-nums")}>{formatDuration(offer.durationMinutes)}</span>
                    </span>
                    <span className={cn("flex min-w-0 flex-col text-right")}>
                      <span className={cn("type-h4 type-secondary font-semibold text-content")}>{offer.arrivalAirport}</span>
                      {arrivalCity && <span className={cn("truncate type-body-2 text-content-secondary")}>{arrivalCity}</span>}
                      <span className={cn("type-body-2 text-content-secondary tabular-nums")}>{formatOfferTime(offer.arrivalTime)}{offer.arrivalTerminal ? ` · T${offer.arrivalTerminal}` : ""}</span>
                    </span>
                  </span>
                </button>

                {/* Ticket Actions */}
                {(onTrackOffer || onSelectOffer) && (
                <div className={cn("relative flex gap-2 border-t border-dashed border-edge p-2")}>
                  <span className={cn("absolute -left-2 -top-2 size-4 rounded-full border border-edge bg-surface")} aria-hidden="true" />
                  <span className={cn("absolute -right-2 -top-2 size-4 rounded-full border border-edge bg-surface")} aria-hidden="true" />
                  {onTrackOffer && (
                    <Button
                      variant={tracked ? "secondary" : "outline"}
                      size="sm"
                      icon="leading"
                      aria-label={tracked ? "Stop tracking price" : "Track price"}
                      title={tracked ? "Stop tracking price" : "Track price"}
                      onClick={() => origin && destination && onTrackOffer(offer, { origin, destination, departureDate })}
                      className={cn("flex-1")}
                    >
                      {tracked ? <BellOff className={cn("size-4")} /> : <Bell className={cn("size-4")} />}
                      {tracked ? "Stop tracking" : "Track price"}
                    </Button>
                  )}
                  {onSelectOffer && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => origin && destination && onSelectOffer(offer, { origin, destination, departureDate })}
                      className={cn("flex-1")}
                    >
                      Select flight · {formatPrice(offer.price, offer.currency)}
                    </Button>
                  )}
                </div>
                )}
              </motion.div>
            );
          }) : (
            <p className={cn("rounded-xl border border-edge-subtle bg-surface-alt px-3 py-5 text-center type-body-3 text-content-secondary")}>No flights found for this route.</p>
          )}
        </div>
      )}
    </form>
  );
}

function AirportOptions({ options, onChoose }: { options: FlightAirport[]; onChoose: (airport: FlightAirport) => void }) {
  return (
    <div className={cn("absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-edge bg-surface p-1 shadow-lg")}>
      {options.length > 0 ? options.map((airport) => (
        <button
          key={airport.code}
          type="button"
          onClick={() => onChoose(airport)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors",
            "hover:bg-surface-muted focus-visible:bg-surface-muted",
          )}
        >
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-cal-flight-bg-subtle type-body-3 font-semibold text-cal-flight-marker")}>
            {airport.code}
          </span>
          <span className={cn("flex min-w-0 flex-1 flex-col")}>
            <span className={cn("type-body-2 font-medium text-content truncate")}>{airport.city}</span>
            <span className={cn("type-body-3 text-content-tertiary truncate")}>{airport.name}</span>
          </span>
        </button>
      )) : (
        <p className={cn("px-3 py-4 text-center type-body-3 text-content-tertiary")}>No airports found</p>
      )}
    </div>
  );
}

function formatOfferTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(price);
  } catch {
    return `${currency} ${price.toFixed(0)}`;
  }
}

export function FlightAddComposer({
  mode,
  onModeChange,
  onSearch,
  onDestinationChange,
  onOriginChange,
  onTrackOffer,
  onSelectOffer,
  trackedOfferKeys,
  initialData,
  itineraryStartDate,
  itineraryEndDate,
  onSubmit,
}: FlightAddComposerProps) {
  return (
    <div className={cn("flex flex-col")} data-region="itinerary-flight-add-composer">
      {/* Add Method */}
      <div className={cn("px-4 pt-1")}>
        <div className={cn("flex border-b border-edge-subtle")} role="tablist" aria-label="Add flight method">
          <Tab
            size="sm"
            icon="leading"
            leadingIcon={<Search className={cn("size-4")} />}
            selected={mode === "search"}
            onClick={() => onModeChange("search")}
            className={cn("flex-1")}
          >
            Search flights
          </Tab>
          <Tab
            size="sm"
            icon="leading"
            leadingIcon={<Plane className={cn("size-4")} />}
            selected={mode === "manual"}
            onClick={() => onModeChange("manual")}
            className={cn("flex-1")}
          >
            Enter manually
          </Tab>
        </div>
      </div>

      {/* Both forms stay mounted so switching methods never discards input. */}
      <div className={cn(mode !== "search" && "hidden")} aria-hidden={mode !== "search"}>
        <FlightSearchForm
          initialDate={itineraryStartDate}
          onSearch={onSearch}
          onDestinationChange={onDestinationChange}
          onOriginChange={onOriginChange}
          onTrackOffer={onTrackOffer}
          onSelectOffer={onSelectOffer}
          trackedOfferKeys={trackedOfferKeys}
        />
      </div>
      <div className={cn(mode !== "manual" && "hidden")} aria-hidden={mode !== "manual"}>
        <FlightForm
          initialData={initialData}
          itineraryStartDate={itineraryStartDate}
          itineraryEndDate={itineraryEndDate}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}
