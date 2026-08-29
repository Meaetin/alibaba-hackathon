import { NextResponse } from "next/server";

import { searchAtlasFlights } from "@/lib/flights/atlas";

export const runtime = "nodejs";

const IATA = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a destination and departure date." }, { status: 400 });
  }

  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const origin = typeof input.origin === "string" ? input.origin.trim().toUpperCase() : "";
  const destination = typeof input.destination === "string" ? input.destination.trim().toUpperCase() : "";
  const departureDate = typeof input.departureDate === "string" ? input.departureDate.trim() : "";
  if (!IATA.test(origin) || !IATA.test(destination) || !ISO_DATE.test(departureDate) || origin === destination) {
    return NextResponse.json({ error: "Choose a valid destination and departure date." }, { status: 400 });
  }

  const clientId = process.env.ATLAS_SANDBOX_ACCESS_KEY;
  const clientSecret = process.env.ATLAS_SANDBOX_SECRET_KEY;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Flight search is not configured yet." }, { status: 503 });
  }

  try {
    const offers = await searchAtlasFlights({ origin, destination, departureDate }, { clientId, clientSecret });
    return NextResponse.json({ offers, searchedAt: new Date().toISOString(), environment: "sandbox" });
  } catch (error) {
    console.error("[atlas flight search]", error);
    return NextResponse.json({ error: "We couldn't search flights right now. Try again shortly." }, { status: 502 });
  }
}
