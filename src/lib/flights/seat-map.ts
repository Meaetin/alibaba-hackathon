export type SeatState = "available" | "occupied" | "paid" | "extra-legroom";

export interface FlightSeat {
  id: string;
  column: string;
  row: number;
  state: SeatState;
  price: number;
}

export const SEAT_COLUMNS = ["A", "B", "C", "D", "E", "F"] as const;
export const SEAT_ROWS = Array.from({ length: 16 }, (_, index) => index + 5);

const OCCUPIED_SEATS = new Set([
  "6A", "6B", "6C", "6D", "6E", "6F",
  "7A", "7B", "7C", "7D", "7E", "7F",
  "8A", "8B", "8C", "8D", "8E", "8F",
  "12C", "13A", "13B", "13C", "13D", "13E", "13F",
  "14A", "14B", "14C", "14D", "14E", "14F",
  "15B", "15C", "15D", "15E", "16B", "16C", "16D", "16E",
  "17B", "17C", "17D", "17E", "18A", "18B", "18C", "18D", "18E", "18F",
  "19B", "19C", "19D", "19E", "20B", "20C", "20D", "20E",
]);

const PAID_SEATS = new Set(["9F", "15A", "15F", "16F", "17A", "17F", "19A", "19F", "20A", "20F"]);
const EXTRA_LEGROOM_SEATS = new Set(["11A", "11F", "12A", "12F"]);

export const SEAT_STATE_LABELS: Record<SeatState, string> = {
  available: "Available",
  occupied: "Occupied",
  paid: "Preferred seat",
  "extra-legroom": "Extra legroom",
};

function seatState(id: string): SeatState {
  if (OCCUPIED_SEATS.has(id)) return "occupied";
  if (PAID_SEATS.has(id)) return "paid";
  if (EXTRA_LEGROOM_SEATS.has(id)) return "extra-legroom";
  return "available";
}

function seatPrice(state: SeatState): number {
  if (state === "extra-legroom") return 28;
  if (state === "paid") return 18;
  return 0;
}

export function createSandboxSeatMap(): FlightSeat[] {
  return SEAT_ROWS.flatMap((row) => SEAT_COLUMNS.map((column) => {
    const id = `${row}${column}`;
    const state = seatState(id);
    return { id, column, row, state, price: seatPrice(state) };
  }));
}

export function seatPositionLabel(column: string): "Window" | "Aisle" | "Middle" {
  if (column === "A" || column === "F") return "Window";
  if (column === "C" || column === "D") return "Aisle";
  return "Middle";
}
