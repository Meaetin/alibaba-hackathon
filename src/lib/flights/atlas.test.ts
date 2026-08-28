import { describe, expect, it } from "vitest";

import { normalizeAtlasSearch } from "./atlas";

describe("normalizeAtlasSearch", () => {
  it("turns a one-way Atlas routing into a stable offer signature", () => {
    const offers = normalizeAtlasSearch({
      status: 0,
      routings: [{
        routingIdentifier: "opaque-routing-id",
        currency: "SGD",
        adultPrice: 120,
        adultTax: 10,
        transactionFeePerPax: 2,
        fromSegments: [{
          carrier: "TR",
          flightNumber: "TR286",
          depAirport: "SIN",
          arrAirport: "DPS",
          depTime: "202609040730",
          arrTime: "202609041015",
          duration: 165,
          depTerminal: "1",
          arrTerminal: "I",
          seatCount: 4,
          fareFamily: "Economy",
        }],
        rule: {
          baggageElements: [{
            passengerType: 0,
            baggageType: "StandardCheckInBaggage",
            baggagePiece: 1,
            baggageWeight: 20,
          }],
        },
      }],
    });

    expect(offers).toEqual([expect.objectContaining({
      id: "opaque-routing-id",
      offerKey: "TR286|2026-09-04T07:30|2026-09-04T10:15",
      flightNumbers: ["TR286"],
      departureAirport: "SIN",
      arrivalAirport: "DPS",
      durationMinutes: 165,
      stops: 0,
      price: 132,
      baseFare: 120,
      taxesAndFees: 12,
      currency: "SGD",
      seatsRemaining: 4,
      departureTerminal: "1",
      arrivalTerminal: "I",
      baggage: "1 × 20 kg checked",
    })]);
  });

  it("drops incomplete routings instead of inventing bookable data", () => {
    expect(normalizeAtlasSearch({ routings: [{ routingIdentifier: "id", fromSegments: [] }] })).toEqual([]);
    expect(normalizeAtlasSearch(null)).toEqual([]);
  });
});
