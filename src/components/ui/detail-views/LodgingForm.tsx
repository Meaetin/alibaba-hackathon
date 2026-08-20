"use client";

import { useState, type FormEvent } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { inputControlVariants, inputVariants } from "@/components/ui/primitives/Input";
import { Calendar } from "@/components/ui/primitives/Calendar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/primitives/Popover";
import { TypeableTimePicker } from "@/components/ui/detail-views/TypeableTimePicker";

export interface LodgingFormData {
  name: string;
  checkInDate: string;
  checkInTime: string;
  checkOutDate: string;
  checkOutTime: string;
  address?: string;
  confirmation?: string;
  cost?: string;
  currency?: string;
}

interface LodgingFormProps {
  initialData?: Partial<LodgingFormData>;
  /** Google Place photo for the property — shown as a hero above the fields. */
  imageUrl?: string;
  onSubmit: (data: LodgingFormData) => void;
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
  clearable = true,
}: {
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  inputClassName?: string;
  uppercase?: boolean;
  clearable?: boolean;
}) {
  const showClear = clearable && value.length > 0;
  const icon = showClear ? "trailing" : "none";

  return (
    <div className={cn(inputVariants({ variant: "default", size: "md", icon, hasValue: value.length > 0 }), className)}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputControlVariants(), "text-content font-medium", uppercase && "uppercase tracking-widest", inputClassName)}
      />
      {showClear && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onChange("")}
          aria-label="Clear"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-content-secondary transition-colors hover:bg-surface-muted [&_svg]:size-3"
        >
          <X />
        </button>
      )}
    </div>
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
          "w-full flex items-center gap-1.5 cursor-pointer",
          inputVariants({ variant: "default", size: "md", icon: "trailing", hasValue: Boolean(value) })
        )}
      >
        <span className={cn("flex-1 text-left truncate type-body-2 font-medium", value ? "text-content" : "text-content-secondary")}>
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

export function LodgingForm({ initialData, imageUrl, onSubmit }: LodgingFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [checkInDate, setCheckInDate] = useState(initialData?.checkInDate ?? "");
  const [checkInTime, setCheckInTime] = useState(initialData?.checkInTime ?? "");
  const [checkOutDate, setCheckOutDate] = useState(initialData?.checkOutDate ?? "");
  const [checkOutTime, setCheckOutTime] = useState(initialData?.checkOutTime ?? "");
  const [address, setAddress] = useState(initialData?.address ?? "");
  const [confirmation, setConfirmation] = useState(initialData?.confirmation ?? "");
  const [cost, setCost] = useState(initialData?.cost ?? "");
  const [currency, setCurrency] = useState(initialData?.currency ?? "");
  const [showErrors, setShowErrors] = useState(false);

  const isValid = name.trim() && checkInDate && checkOutDate;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isValid) { setShowErrors(true); return; }

    onSubmit({
      name: name.trim(),
      checkInDate,
      checkInTime,
      checkOutDate,
      checkOutTime,
      address: address.trim() || undefined,
      confirmation: confirmation.trim() || undefined,
      cost: cost.trim() || undefined,
      currency: currency.trim() || undefined,
    });
  }

  return (
    <form
      id="lodging-manual-form"
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-3 px-4 py-3"
    >
      {/* Place Photo */}
      <div className="lodging-form-photo w-full aspect-video overflow-hidden rounded-xl bg-surface-muted">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="lodging-form-photo-img size-full object-cover" />
        )}
      </div>

      {/* Flat field list — matches Figma DetailsSection (no section headers) */}
      <FormRow>
        <FormField label="Name" required>
          <TextInput placeholder="e.g. Grand Hyatt" value={name} onChange={setName} />
          {showErrors && !name.trim() && (
            <p role="alert" className="type-body-3 text-content-error mt-0.5">Required</p>
          )}
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="Address">
          <TextInput placeholder="e.g. 1-2-12 Nishi-Shinjuku, Tokyo" value={address} onChange={setAddress} />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="Check In Date" required>
          <DatePickerField value={checkInDate} onChange={setCheckInDate} placeholder="Date" />
        </FormField>
        <FormField label="Check In Time">
          <TypeableTimePicker value={checkInTime} onChange={setCheckInTime} placeholder="HH:MM" />
        </FormField>
      </FormRow>
      {showErrors && !checkInDate && (
        <p role="alert" className="type-body-3 text-content-error">Check-in date is required</p>
      )}
      <FormRow>
        <FormField label="Check Out Date" required>
          <DatePickerField value={checkOutDate} onChange={setCheckOutDate} placeholder="Date" />
        </FormField>
        <FormField label="Check Out Time">
          <TypeableTimePicker value={checkOutTime} onChange={setCheckOutTime} placeholder="HH:MM" />
        </FormField>
      </FormRow>
      {showErrors && !checkOutDate && (
        <p role="alert" className="type-body-3 text-content-error">Check-out date is required</p>
      )}
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
    </form>
  );
}
