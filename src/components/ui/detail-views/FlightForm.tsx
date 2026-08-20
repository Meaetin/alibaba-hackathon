"use client";

import { Calendar as CalendarIcon, ChevronDown, AlertTriangle, X } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
  const [ticketNumber, setTicketNumber] = useState(initialData?.ticketNumber ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const [showDateConfirm, setShowDateConfirm] = useState(false);
  const [expandDatesConfirmed, setExpandDatesConfirmed] = useState(false);
  const [pendingDateField, setPendingDateField] = useState<"depart" | "arrive" | null>(null);
  const [pendingDateValue, setPendingDateValue] = useState("");

  const isValid =
    fromCity.trim() && toCity.trim() &&
    flightNumber.trim() && departDate && departTime;

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
      {/* Flat field list — matches Figma DetailsSection (no section headers) */}
      <FormRow>
        <FormField label="From" required>
          <TextInput placeholder="Singapore" value={fromCity} onChange={setFromCity} />
        </FormField>
        <FormField label="Airport">
          <TextInput placeholder="e.g. SIN" value={fromAirport} onChange={setFromAirport} uppercase />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="To" required>
          <TextInput placeholder="Bangkok" value={toCity} onChange={setToCity} />
        </FormField>
        <FormField label="Airport">
          <TextInput placeholder="e.g. BKK" value={toAirport} onChange={setToAirport} uppercase />
        </FormField>
      </FormRow>
      {showErrors && (!fromCity.trim() || !toCity.trim()) && (
        <p role="alert" className="type-body-3 text-content-error">From and To cities are required</p>
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
        <FormField label="Fare Class">
          <SelectField value={fareClass} onChange={setFareClass} options={FARE_CLASS_OPTIONS} placeholder="Select class" />
        </FormField>
        <FormField label="Terminal">
          <SelectField value={terminal} onChange={setTerminal} options={TERMINAL_OPTIONS} placeholder="Select terminal" />
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
      <FormRow>
        <FormField label="Cost">
          <div className="flex gap-2 items-center">
            <TextInput placeholder="0.00" value={cost} onChange={setCost} inputClassName="tabular-nums" className="flex-1" />
            <TextInput placeholder="USD" value={currency} onChange={setCurrency} uppercase className="w-16" clearable={false} />
          </div>
        </FormField>
        <FormField label="Confirmation">
          <TextInput placeholder="ABC123" value={confirmation} onChange={setConfirmation} />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="Baggage">
          <TextInput placeholder="23kg" value={baggageAllowance} onChange={setBaggageAllowance} />
        </FormField>
        <FormField label="Ticket No.">
          <TextInput placeholder="618-123456789" value={ticketNumber} onChange={setTicketNumber} />
        </FormField>
      </FormRow>
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
