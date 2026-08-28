export interface FlightSearchRequest {
  origin: string;
  destination: string;
  departureDate: string;
}

export interface FlightOffer {
  id: string;
  offerKey: string;
  carrier: string;
  flightNumbers: string[];
  departureAirport: string;
  arrivalAirport: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  stops: number;
  price: number;
  baseFare: number;
  taxesAndFees: number;
  currency: string;
  seatsRemaining?: number;
  fareFamily?: string;
  departureTerminal?: string;
  arrivalTerminal?: string;
  baggage?: string;
}

export interface FlightPriceWatch {
  offer: FlightOffer;
  search: FlightSearchRequest;
  initialPrice: number;
  latestPrice: number;
  previousPrice: number;
  lastCheckedAt: string;
  status: "watching" | "changed" | "unavailable" | "error";
}

interface AtlasSegment {
  arrAirport?: unknown;
  arrTime?: unknown;
  carrier?: unknown;
  depAirport?: unknown;
  depTime?: unknown;
  duration?: unknown;
  depTerminal?: unknown;
  arrTerminal?: unknown;
  fareFamily?: unknown;
  flightNumber?: unknown;
  seatCount?: unknown;
}

interface AtlasRouting {
  routingIdentifier?: unknown;
  currency?: unknown;
  adultPrice?: unknown;
  adultTax?: unknown;
  transactionFeePerPax?: unknown;
  fromSegments?: unknown;
  rule?: unknown;
}

interface AtlasBaggageElement {
  baggagePiece?: unknown;
  baggageSize?: unknown;
  baggageType?: unknown;
  baggageWeight?: unknown;
  passengerType?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function atlasTime(value: unknown): string {
  const raw = text(value);
  if (!/^\d{12}$/.test(raw)) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
}

function baggageLabel(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const elements = (value as { baggageElements?: unknown }).baggageElements;
  if (!Array.isArray(elements)) return undefined;

  const baggage = elements
    .filter((element): element is AtlasBaggageElement => Boolean(element && typeof element === "object"))
    .filter((element) => number(element.passengerType) === 0)
    .sort((left, right) => {
      const checked = (element: AtlasBaggageElement) => text(element.baggageType).toLowerCase().includes("check") ? 1 : 0;
      return checked(right) - checked(left);
    })[0];
  if (!baggage) return undefined;

  const piece = number(baggage.baggagePiece);
  const weight = number(baggage.baggageWeight);
  const size = text(baggage.baggageSize);
  const kind = text(baggage.baggageType).toLowerCase().includes("check") ? "checked" : "cabin";
  if (piece > 0 && weight > 0) return `${piece} × ${weight} kg ${kind}`;
  if (weight > 0) return `${weight} kg ${kind}`;
  if (piece > 0) return `${piece} ${piece === 1 ? "bag" : "bags"} ${kind}`;
  return size ? `${size} ${kind}` : undefined;
}

export function normalizeAtlasSearch(payload: unknown): FlightOffer[] {
  if (!payload || typeof payload !== "object") return [];
  const routings = (payload as { routings?: unknown }).routings;
  if (!Array.isArray(routings)) return [];

  return routings.flatMap((candidate): FlightOffer[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const routing = candidate as AtlasRouting;
    const segments = Array.isArray(routing.fromSegments)
      ? routing.fromSegments.filter((segment): segment is AtlasSegment => Boolean(segment && typeof segment === "object"))
      : [];
    const first = segments[0];
    const last = segments.at(-1);
    const id = text(routing.routingIdentifier);
    if (!id || !first || !last) return [];

    const flightNumbers = segments.map((segment) => text(segment.flightNumber)).filter(Boolean);
    const departureTime = atlasTime(first.depTime);
    const arrivalTime = atlasTime(last.arrTime);
    const departureAirport = text(first.depAirport);
    const arrivalAirport = text(last.arrAirport);
    const baseFare = number(routing.adultPrice);
    const taxesAndFees = number(routing.adultTax) + number(routing.transactionFeePerPax);
    const price = baseFare + taxesAndFees;
    if (!departureAirport || !arrivalAirport || !departureTime || !arrivalTime || price <= 0) return [];

    const seatCounts = segments.map((segment) => number(segment.seatCount)).filter((count) => count > 0);
    return [{
      id,
      offerKey: [flightNumbers.join("+"), departureTime, arrivalTime].join("|"),
      carrier: text(first.carrier),
      flightNumbers,
      departureAirport,
      arrivalAirport,
      departureTime,
      arrivalTime,
      durationMinutes: segments.reduce((total, segment) => total + number(segment.duration), 0),
      stops: Math.max(0, segments.length - 1),
      price: Math.round(price * 100) / 100,
      baseFare: Math.round(baseFare * 100) / 100,
      taxesAndFees: Math.round(taxesAndFees * 100) / 100,
      currency: text(routing.currency) || "USD",
      seatsRemaining: seatCounts.length > 0 ? Math.min(...seatCounts) : undefined,
      fareFamily: text(first.fareFamily) || undefined,
      departureTerminal: text(first.depTerminal) || undefined,
      arrivalTerminal: text(last.arrTerminal) || undefined,
      baggage: baggageLabel(routing.rule),
    }];
  }).slice(0, 20);
}

export async function searchAtlasFlights(
  request: FlightSearchRequest,
  config: { clientId: string; clientSecret: string; fetch?: typeof fetch },
): Promise<FlightOffer[]> {
  const fetcher = config.fetch ?? fetch;
  const response = await fetcher("https://sandbox.atriptech.com/search.do", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "Content-Type": "application/json",
      "x-atlas-client-id": config.clientId,
      "x-atlas-client-secret": config.clientSecret,
    },
    body: JSON.stringify({
      tripType: "1",
      adultNum: 1,
      childNum: 0,
      infantNum: 0,
      fromCity: request.origin,
      fromAirport: "",
      toCity: request.destination,
      toAirport: "",
      fromDate: request.departureDate.replaceAll("-", ""),
      retDate: "",
      airlines: [],
      fromFlightNumbers: [],
      retFlightNumbers: [],
      includeMultipleFareFamily: false,
      currency: null,
      displayCurrency: "",
      requestSource: null,
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Atlas search returned ${response.status}.`);
  const payload = await response.json() as unknown;
  if (payload && typeof payload === "object" && (payload as { status?: unknown }).status !== 0) {
    throw new Error(text((payload as { msg?: unknown }).msg) || "Atlas could not search this route.");
  }
  return normalizeAtlasSearch(payload);
}
