import { describe, expect, it } from "vitest";

import { createSandboxSeatMap, seatPositionLabel } from "./seat-map";

describe("createSandboxSeatMap", () => {
  it("builds a stable six-seat-wide aircraft cabin", () => {
    const seats = createSandboxSeatMap();

    expect(seats).toHaveLength(96);
    expect(seats[0]).toMatchObject({ id: "5A", row: 5, column: "A", state: "available", price: 0 });
    expect(seats.find((seat) => seat.id === "6A")?.state).toBe("occupied");
    expect(seats.find((seat) => seat.id === "12A")).toMatchObject({ state: "extra-legroom", price: 28 });
    expect(seats.find((seat) => seat.id === "15F")).toMatchObject({ state: "paid", price: 18 });
  });

  it("labels window, aisle and middle positions", () => {
    expect(seatPositionLabel("A")).toBe("Window");
    expect(seatPositionLabel("C")).toBe("Aisle");
    expect(seatPositionLabel("E")).toBe("Middle");
  });
});
