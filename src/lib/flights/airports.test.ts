import { describe, expect, it } from "vitest";

import { searchAirports, searchDestinationAirports } from "./airports";

describe("searchDestinationAirports", () => {
  it("matches airport code, city, and airport name", () => {
    expect(searchDestinationAirports("DPS")[0]?.city).toBe("Bali");
    expect(searchDestinationAirports("Tokyo")[0]?.code).toBe("HND");
    expect(searchDestinationAirports("Heathrow")[0]?.code).toBe("LHR");
  });

  it("includes Changi when searching possible origins", () => {
    expect(searchAirports("Singapore")[0]?.code).toBe("SIN");
  });
});
