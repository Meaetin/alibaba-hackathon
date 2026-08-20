/**
 * Day color palettes — maps to CSS custom properties in globals.css.
 * Each entry uses `--cal-{name}-bg`, `--cal-{name}-marker`, `--cal-{name}-fg`.
 */
const DAY_PALETTES = [
  "rose",
  "teal",
  "indigo",
  "amber",
  "violet",
  "sky",
  "mist",
  "slate",
  "flight",
] as const;

export type DayPalette = (typeof DAY_PALETTES)[number];

export function getDayPalette(dayIndex: number): DayPalette {
  return DAY_PALETTES[dayIndex % DAY_PALETTES.length];
}

/**
 * Vibrant per-day colors (hex) for polyline strokes, map pins, and day chips.
 * Keyed by palette; pick `light`/`dark` by the active theme. Kept here beside
 * getDayPalette so the whole day-color system has a single source of truth
 * (hex is required — Google Maps API + SVG fills consume color strings).
 */
export const PALETTE_COLORS: Record<DayPalette, { light: string; dark: string }> = {
  mist:   { light: '#f45f00', dark: '#ff9636' },
  teal:   { light: '#00b5a4', dark: '#00e5d4' },
  indigo: { light: '#4f52f5', dark: '#8b90ff' },
  rose:   { light: '#e8005e', dark: '#ff5cae' },
  amber:  { light: '#d96b00', dark: '#ffc030' },
  slate:  { light: '#f01f8e', dark: '#ff5cc8' },
  violet: { light: '#6d00e8', dark: '#b67cff' },
  sky:    { light: '#0070d6', dark: '#1fc7ff' },
  flight: { light: '#0045d6', dark: '#4d90ff' },
};

/** Resolve a day index straight to its hex color for the active theme. */
export function getDayColor(dayIndex: number, isDark: boolean): string {
  const c = PALETTE_COLORS[getDayPalette(dayIndex)];
  return isDark ? c.dark : c.light;
}

export interface CalendarActivity {
  id: string;
  dayId: string;
  dayIndex: number;
  locationId?: string;
  name: string;
  startHour: number; // e.g. 9.5 = 9:30 AM
  endHour: number;
  address?: string;
  category?: "poi" | "meal" | "flight" | "accommodation";
  sourceFlightId?: string;
  sourceLodgingId?: string;
  photoUrl?: string;
  photoUrls?: string[];
  placeId?: string;
  latitude?: number;
  longitude?: number;
  googleMapsUri?: string;
  locationContext?: string;
  openingHours?: string;
  paletteOverride?: DayPalette;
  travelPolyline?: string;
  travelDistanceMeters?: number;
  travelDurationSeconds?: number;
}
