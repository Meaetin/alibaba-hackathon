import type { FlightOffer, FlightSearchRequest } from "@/lib/flights/atlas";

export async function searchFlightOffers(request: FlightSearchRequest): Promise<{ offers: FlightOffer[]; searchedAt: string }> {
  const response = await fetch("/api/flights/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as { offers?: FlightOffer[]; searchedAt?: string; error?: string };
  if (!response.ok) throw new Error(payload.error || "Flight search failed.");
  return { offers: payload.offers ?? [], searchedAt: payload.searchedAt ?? new Date().toISOString() };
}
