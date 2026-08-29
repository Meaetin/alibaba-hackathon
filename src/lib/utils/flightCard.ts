import type { ExtractedFlight } from "@/lib/api/flights";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import { formatFlightDate } from "@/lib/utils/formatters";

/**
 * Maps a persisted/extracted flight row to the props consumed by FlightCard.
 * Single source of truth for the initial-load, paginated, and realtime-sync
 * paths so they can't drift apart on which fields they populate.
 */
export function mapExtractedFlightToCardProps(f: ExtractedFlight): FlightCardProps {
  const depTime = f.depart_time ?? "00:00";
  const arrTime = f.arrive_time ?? "00:00";
  const depDate = new Date(f.depart_date + "T00:00:00");
  const arrDate = new Date(f.arrive_date + "T00:00:00");
  const durationStr = f.duration_minutes
    ? `${Math.floor(f.duration_minutes / 60)}h ${f.duration_minutes % 60}m`
    : undefined;

  return {
    id: f.id,
    fromCode: f.depart_airport_code ?? "",
    fromCity: f.depart_city ?? "",
    fromCountry: f.depart_country,
    toCode: f.arrive_airport_code ?? "",
    toCity: f.arrive_city ?? "",
    toCountry: f.arrive_country,
    time: `${formatFlightDate(depDate)} ${depTime} → ${formatFlightDate(arrDate)} ${arrTime}`,
    departTime: depTime,
    departDate: f.depart_date,
    arriveDate: f.arrive_date,
    arriveTime: arrTime,
    airline: f.airline,
    fareClass: f.fare_class,
    cost: f.cost ?? "",
    currency: f.currency,
    confirmation: f.confirmation ?? "",
    flightNumber: f.flight_number ?? "",
    flightDuration: durationStr,
    terminal: f.terminal,
    baggageAllowance: f.baggage_allowance,
    ticketNumber: f.ticket_number,
    seat: f.seat,
    sourceAttachmentId: f.source_attachment_id ?? null,
  };
}
