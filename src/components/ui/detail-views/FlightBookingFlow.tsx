"use client";

import Image from "next/image";
import {
  AlertTriangle,
  ArrowLeft,
  BaggageClaim,
  Check,
  CircleDollarSign,
  CreditCard,
  Loader2,
  LockKeyhole,
  Plane,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/primitives/Button";
import { inputControlVariants, inputVariants } from "@/components/ui/primitives/Input";
import type { FlightOffer, FlightSearchRequest } from "@/lib/flights/atlas";
import { createSandboxSeatMap, seatPositionLabel } from "@/lib/flights/seat-map";
import { cn } from "@/lib/utils";

export type FlightBookingStep = "verify" | "traveller" | "baggage" | "seat" | "review" | "payment" | "ticketing";

export interface FlightBookingConfirmation {
  offer: FlightOffer;
  search: FlightSearchRequest;
  passengerName: string;
  baggageLabel: string;
  seatId: string;
  total: number;
  bookingReference: string;
  ticketNumber: string;
}

interface FlightBookingFlowProps {
  offer: FlightOffer;
  search: FlightSearchRequest;
  selectedSeatId: string | null;
  onSeatSelectionActiveChange: (active: boolean) => void;
  onPassengerNameChange: (name: string) => void;
  onComplete: (confirmation: FlightBookingConfirmation) => void;
}

interface TravellerDetails {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  email: string;
  phone: string;
}

const BAGGAGE_OPTIONS = [
  { id: "included", label: "Cabin bag only", description: "1 cabin bag included", price: 0 },
  { id: "checked-20", label: "20 kg checked bag", description: "1 checked bag · Adult 1", price: 28 },
  { id: "checked-25", label: "25 kg checked bag", description: "1 checked bag · Adult 1", price: 42 },
] as const;

const PROGRESS_STEPS: Array<{ id: FlightBookingStep; label: string }> = [
  { id: "traveller", label: "Traveller" },
  { id: "baggage", label: "Bags" },
  { id: "seat", label: "Seat" },
  { id: "review", label: "Review" },
  { id: "payment", label: "Pay" },
];

function priceLabel(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function FormField({ label, value, onChange, type = "text", autoComplete, placeholder, required = true }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5")}>
      <span className={cn("type-body-3 font-medium text-content-tertiary")}>{label}{required ? <span className={cn("text-content-error")}> *</span> : null}</span>
      <span className={cn(inputVariants({ variant: "default", size: "md", icon: "none", hasValue: Boolean(value) }))}>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          className={cn(inputControlVariants(), "font-medium text-content")}
        />
      </span>
    </label>
  );
}

function OfferSummary({ offer, total }: { offer: FlightOffer; total?: number }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl bg-surface-alt p-3")} data-region="flight-booking-offer-summary">
      <div className={cn("flex items-center justify-between gap-3")}>
        <span className={cn("type-body-2 font-semibold text-content")}>{offer.flightNumbers.join(" · ")}</span>
        <span className={cn("type-body-2 font-semibold tabular-nums text-content")}>{priceLabel(total ?? offer.price, offer.currency)}</span>
      </div>
      <div className={cn("grid grid-cols-[1fr_auto_1fr] items-center gap-3")}>
        <div>
          <p className={cn("type-h4 font-semibold text-content")}>{offer.departureAirport}</p>
          <p className={cn("type-body-3 text-content-secondary")}>{timeLabel(offer.departureTime)}</p>
        </div>
        <div className={cn("relative flex h-14 min-w-28 items-end justify-center pb-0.5")} aria-hidden="true">
          <span className={cn("absolute inset-x-2 top-5 border-t border-dashed border-content-tertiary/60")} />
          <span className={cn("absolute left-1.5 top-[1.06rem] size-2 rounded-full border-2 border-content-tertiary/60 bg-surface")} />
          <span className={cn("absolute right-1.5 top-[1.06rem] size-2 rounded-full border-2 border-content-tertiary/60 bg-surface")} />
          <Image
            src="/images/stickers/Plane.svg"
            alt=""
            width={40}
            height={40}
            unoptimized
            className={cn("absolute left-1/2 top-0 size-10 -translate-x-1/2 object-contain")}
          />
          <span className={cn("relative type-body-2 tabular-nums text-content-secondary")}>
            {Math.floor(offer.durationMinutes / 60)}h {offer.durationMinutes % 60}m
          </span>
        </div>
        <div className={cn("text-right")}>
          <p className={cn("type-h4 font-semibold text-content")}>{offer.arrivalAirport}</p>
          <p className={cn("type-body-3 text-content-secondary")}>{timeLabel(offer.arrivalTime)}</p>
        </div>
      </div>
      <p className={cn("type-body-3 text-content-secondary")}>{dateLabel(offer.departureTime)} · {offer.stops === 0 ? "Direct" : `${offer.stops} stop${offer.stops === 1 ? "" : "s"}`}</p>
    </section>
  );
}

function Progress({ step }: { step: FlightBookingStep }) {
  const activeIndex = PROGRESS_STEPS.findIndex((item) => item.id === step);
  if (activeIndex < 0) return null;
  return (
    <div className={cn("flex flex-col gap-2")} aria-label={`Booking step ${activeIndex + 1} of ${PROGRESS_STEPS.length}: ${PROGRESS_STEPS[activeIndex].label}`}>
      <div className={cn("flex items-center justify-between type-body-3")}>
        <span className={cn("font-medium text-content")}>{PROGRESS_STEPS[activeIndex].label}</span>
        <span className={cn("text-content-secondary")}>{activeIndex + 1} of {PROGRESS_STEPS.length}</span>
      </div>
      <div className={cn("grid grid-cols-5 gap-1")} aria-hidden="true">
        {PROGRESS_STEPS.map((item, index) => (
          <span key={item.id} className={cn("h-1 rounded-full", index <= activeIndex ? "bg-action-brand" : "bg-surface-muted-active")} />
        ))}
      </div>
    </div>
  );
}

export function FlightBookingFlow({ offer, search, selectedSeatId, onSeatSelectionActiveChange, onPassengerNameChange, onComplete }: FlightBookingFlowProps) {
  const [step, setStep] = useState<FlightBookingStep>("verify");
  const [traveller, setTraveller] = useState<TravellerDetails>({ firstName: "", lastName: "", dateOfBirth: "", nationality: "", email: "", phone: "" });
  const [baggageId, setBaggageId] = useState<(typeof BAGGAGE_OPTIONS)[number]["id"]>("included");
  const [cardholder, setCardholder] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [securityCode, setSecurityCode] = useState("");
  const bookingReference = useRef(`ARGO${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
  const ticketNumber = useRef(`618${Date.now().toString().slice(-10)}`);
  const onCompleteRef = useRef(onComplete);

  const seat = useMemo(() => createSandboxSeatMap().find((candidate) => candidate.id === selectedSeatId) ?? null, [selectedSeatId]);
  const baggage = BAGGAGE_OPTIONS.find((option) => option.id === baggageId) ?? BAGGAGE_OPTIONS[0];
  const total = offer.price + baggage.price + (seat?.price ?? 0);
  const passengerName = [traveller.firstName, traveller.lastName].filter(Boolean).join(" ");

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (step !== "verify") return;
    const timer = window.setTimeout(() => setStep("traveller"), 900);
    return () => window.clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    onSeatSelectionActiveChange(step === "seat");
    return () => onSeatSelectionActiveChange(false);
  }, [onSeatSelectionActiveChange, step]);

  useEffect(() => {
    onPassengerNameChange(passengerName);
  }, [onPassengerNameChange, passengerName]);

  useEffect(() => {
    if (step !== "ticketing") return;
    const timer = window.setTimeout(() => {
      onCompleteRef.current({
        offer,
        search,
        passengerName,
        baggageLabel: baggage.label,
        seatId: selectedSeatId ?? "",
        total,
        bookingReference: bookingReference.current,
        ticketNumber: ticketNumber.current,
      });
    }, 1300);
    return () => window.clearTimeout(timer);
  }, [baggage.label, offer, passengerName, search, selectedSeatId, step, total]);

  const updateTraveller = (key: keyof TravellerDetails) => (value: string) => setTraveller((current) => ({ ...current, [key]: value }));

  const submitTraveller = (event: FormEvent) => {
    event.preventDefault();
    setStep("baggage");
  };

  const submitPayment = (event: FormEvent) => {
    event.preventDefault();
    setStep("ticketing");
  };

  if (step === "verify") {
    return (
      <div className={cn("flex min-h-full flex-col gap-5 p-4")} data-region="flight-booking-verification">
        <OfferSummary offer={offer} />
        <div className={cn("flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center")} aria-live="polite">
          <span className={cn("flex size-12 items-center justify-center rounded-xl bg-surface-brand text-content-brand")}>
            <Loader2 className={cn("size-5 animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          </span>
          <div className={cn("flex max-w-[30ch] flex-col gap-1")}>
            <h2 className={cn("type-body-1 font-semibold text-content")}>Checking the live fare</h2>
            <p className={cn("type-body-2 text-content-secondary")}>Atlas is confirming availability, baggage and the current total before checkout.</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === "ticketing") {
    return (
      <div className={cn("flex min-h-full flex-col gap-5 p-4")} data-region="flight-booking-ticketing">
        <OfferSummary offer={offer} total={total} />
        <div className={cn("flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center")} aria-live="polite">
          <span className={cn("flex size-12 items-center justify-center rounded-xl bg-surface-brand text-content-brand")}>
            <Loader2 className={cn("size-5 animate-spin motion-reduce:animate-none")} aria-hidden="true" />
          </span>
          <div className={cn("flex max-w-[31ch] flex-col gap-1")}>
            <h2 className={cn("type-body-1 font-semibold text-content")}>Booking confirmed, ticketing</h2>
            <p className={cn("type-body-2 text-content-secondary")}>Payment was accepted. Atlas is waiting for the airline to issue your ticket.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-full flex-col gap-4 p-4")} data-region="flight-booking-flow">
      <Progress step={step} />
      <OfferSummary offer={offer} total={step === "review" || step === "payment" ? total : undefined} />

      {step === "traveller" ? (
        <form className={cn("flex flex-col gap-4")} onSubmit={submitTraveller}>
          <div className={cn("flex items-start gap-3")}>
            <UserRound className={cn("mt-0.5 size-4 shrink-0 text-glyph-secondary")} aria-hidden="true" />
            <div>
              <h2 className={cn("type-body-1 font-semibold text-content")}>Who is flying?</h2>
              <p className={cn("type-body-3 text-content-secondary")}>Enter the passenger name exactly as it appears on their travel document.</p>
            </div>
          </div>
          <div className={cn("grid grid-cols-2 gap-3")}>
            <FormField label="First name" value={traveller.firstName} onChange={updateTraveller("firstName")} autoComplete="given-name" />
            <FormField label="Last name" value={traveller.lastName} onChange={updateTraveller("lastName")} autoComplete="family-name" />
          </div>
          <div className={cn("grid grid-cols-2 gap-3")}>
            <FormField label="Date of birth" value={traveller.dateOfBirth} onChange={updateTraveller("dateOfBirth")} type="date" autoComplete="bday" />
            <FormField label="Nationality" value={traveller.nationality} onChange={updateTraveller("nationality")} autoComplete="country-name" placeholder="Singapore" />
          </div>
          <FormField label="Email" value={traveller.email} onChange={updateTraveller("email")} type="email" autoComplete="email" />
          <FormField label="Phone" value={traveller.phone} onChange={updateTraveller("phone")} type="tel" autoComplete="tel" />
          <Button type="submit" variant="primary" size="md">Continue to baggage</Button>
        </form>
      ) : null}

      {step === "baggage" ? (
        <div className={cn("flex flex-col gap-4")}>
          <div className={cn("flex items-start gap-3")}>
            <BaggageClaim className={cn("mt-0.5 size-4 shrink-0 text-glyph-secondary")} aria-hidden="true" />
            <div>
              <h2 className={cn("type-body-1 font-semibold text-content")}>Add checked baggage</h2>
              <p className={cn("type-body-3 text-content-secondary")}>{offer.baggage ?? "A cabin bag is included with this fare."}</p>
            </div>
          </div>
          <div className={cn("flex flex-col gap-2")} role="radiogroup" aria-label="Baggage allowance">
            {BAGGAGE_OPTIONS.map((option) => {
              const selected = baggageId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setBaggageId(option.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors",
                    selected ? "border-edge-brand bg-surface-brand" : "border-edge-subtle bg-surface hover:border-edge-muted",
                    "focus-visible:ring-2 focus-visible:ring-edge-brand-subtle",
                  )}
                >
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-edge-brand bg-action-brand text-content-on-brand" : "border-edge-strong bg-surface")}>
                    {selected ? <Check className={cn("size-3")} aria-hidden="true" /> : null}
                  </span>
                  <span className={cn("min-w-0 flex-1")}>
                    <span className={cn("block type-body-2 font-medium text-content")}>{option.label}</span>
                    <span className={cn("block type-body-3 text-content-secondary")}>{option.description}</span>
                  </span>
                  <span className={cn("type-body-2 font-semibold text-content")}>{option.price ? `+${priceLabel(option.price, offer.currency)}` : "Included"}</span>
                </button>
              );
            })}
          </div>
          <div className={cn("grid grid-cols-2 gap-2")}>
            <Button variant="secondary" size="md" icon="leading" onClick={() => setStep("traveller")}><ArrowLeft className={cn("size-4")} />Back</Button>
            <Button variant="primary" size="md" onClick={() => setStep("seat")}>Choose a seat</Button>
          </div>
        </div>
      ) : null}

      {step === "seat" ? (
        <div className={cn("flex flex-col gap-4")}>
          <div className={cn("flex items-start gap-3")}>
            <Plane className={cn("mt-0.5 size-4 shrink-0 text-glyph-secondary")} aria-hidden="true" />
            <div>
              <h2 className={cn("type-body-1 font-semibold text-content")}>Choose your seat on the aircraft</h2>
              <p className={cn("type-body-3 text-content-secondary")}>Pick an available seat on the aircraft map beside this panel, or continue without one.</p>
            </div>
          </div>
          {seat ? (
            <div className={cn("flex items-center justify-between rounded-xl bg-surface-brand p-3")} aria-live="polite">
              <div>
                <p className={cn("type-body-3 text-content-secondary")}>Selected seat</p>
                <p className={cn("type-body-1 font-semibold text-content")}>{seat.id} · {seatPositionLabel(seat.column)}</p>
              </div>
              <span className={cn("type-body-2 font-semibold text-content")}>{seat.price ? priceLabel(seat.price, offer.currency) : "Included"}</span>
            </div>
          ) : (
            <div className={cn("flex items-start gap-2 rounded-xl bg-surface-info-subtle p-3 text-content-info")}>
              <CircleDollarSign className={cn("mt-0.5 size-4 shrink-0")} aria-hidden="true" />
              <p className={cn("type-body-3")}>Preferred and extra-legroom seats show their additional price before you select them.</p>
            </div>
          )}
          <div className={cn("grid grid-cols-2 gap-2")}>
            <Button variant="secondary" size="md" icon="leading" onClick={() => setStep("baggage")}><ArrowLeft className={cn("size-4")} />Back</Button>
            <Button variant="primary" size="md" onClick={() => setStep("review")}>
              {seat ? "Review booking" : "Continue without seat"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "review" ? (
        <div className={cn("flex flex-col gap-4")}>
          <div>
            <h2 className={cn("type-body-1 font-semibold text-content")}>Review your booking</h2>
            <p className={cn("type-body-3 text-content-secondary")}>Check the passenger and extras before creating the Atlas order.</p>
          </div>
          <dl className={cn("flex flex-col divide-y divide-edge-subtle rounded-xl border border-edge-subtle px-3")}>
            {[
              ["Passenger", passengerName],
              ["Baggage", baggage.label],
              ["Seat", seat ? `${seat.id} · ${seatPositionLabel(seat.column)}` : "Not selected"],
              ["Fare", priceLabel(offer.price, offer.currency)],
              ["Extras", priceLabel(baggage.price + (seat?.price ?? 0), offer.currency)],
            ].map(([label, value]) => (
              <div key={label} className={cn("flex items-center justify-between gap-4 py-3")}>
                <dt className={cn("type-body-3 text-content-secondary")}>{label}</dt>
                <dd className={cn("type-body-2 font-medium text-right text-content")}>{value}</dd>
              </div>
            ))}
          </dl>
          <div className={cn("flex items-start gap-2 rounded-xl bg-surface-warning-subtle p-3 text-content-warning")}>
            <AlertTriangle className={cn("mt-0.5 size-4 shrink-0")} aria-hidden="true" />
            <p className={cn("type-body-3")}>Atlas creates a time-limited order. Complete payment promptly to keep the fare.</p>
          </div>
          <div className={cn("grid grid-cols-2 gap-2")}>
            <Button variant="secondary" size="md" icon="leading" onClick={() => setStep("seat")}><ArrowLeft className={cn("size-4")} />Back</Button>
            <Button variant="primary" size="md" onClick={() => setStep("payment")}>Continue to payment</Button>
          </div>
        </div>
      ) : null}

      {step === "payment" ? (
        <form className={cn("flex flex-col gap-4")} onSubmit={submitPayment}>
          <div className={cn("flex items-start gap-3")}>
            <CreditCard className={cn("mt-0.5 size-4 shrink-0 text-glyph-secondary")} aria-hidden="true" />
            <div>
              <h2 className={cn("type-body-1 font-semibold text-content")}>Sandbox payment</h2>
              <p className={cn("type-body-3 text-content-secondary")}>Use test details only. No card will be charged in this flow.</p>
            </div>
          </div>
          <FormField label="Name on card" value={cardholder} onChange={setCardholder} autoComplete="cc-name" />
          <FormField label="Card number" value={cardNumber} onChange={setCardNumber} autoComplete="cc-number" placeholder="4242 4242 4242 4242" />
          <div className={cn("grid grid-cols-2 gap-3")}>
            <FormField label="Expiry" value={expiry} onChange={setExpiry} autoComplete="cc-exp" placeholder="MM/YY" />
            <FormField label="Security code" value={securityCode} onChange={setSecurityCode} autoComplete="cc-csc" placeholder="123" />
          </div>
          <div className={cn("flex items-start gap-2 rounded-xl bg-surface-success-subtle p-3 text-content-success")}>
            <ShieldCheck className={cn("mt-0.5 size-4 shrink-0")} aria-hidden="true" />
            <p className={cn("type-body-3")}>The sandbox simulates Atlas order, payment and ticketing responses.</p>
          </div>
          <div className={cn("grid grid-cols-2 gap-2")}>
            <Button type="button" variant="secondary" size="md" icon="leading" onClick={() => setStep("review")}><ArrowLeft className={cn("size-4")} />Back</Button>
            <Button type="submit" variant="primary" size="md" icon="leading"><LockKeyhole className={cn("size-4")} />Pay {priceLabel(total, offer.currency)}</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
