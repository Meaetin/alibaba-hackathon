export function formatFlightDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function formatLodgingDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}

export function formatTimeOfDay(t?: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

let _countryNameToCode: Record<string, string> | null = null;

function getCountryNameToCode(): Record<string, string> {
  if (_countryNameToCode) return _countryNameToCode;
  _countryNameToCode = {};
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  for (let i = 65; i <= 90; i++) {
    for (let j = 65; j <= 90; j++) {
      const code = String.fromCharCode(i) + String.fromCharCode(j);
      try {
        const name = display.of(code);
        if (name && name !== code) {
          _countryNameToCode[name.toLowerCase()] = code;
        }
      } catch {}
    }
  }
  return _countryNameToCode;
}

export function countryNameToFlag(name: string): string {
  if (!name) return "";
  const code = getCountryNameToCode()[name.toLowerCase()];
  if (!code) return "";
  return [...code]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1f1e6))
    .join("");
}

export function formatLocationLabel(region?: string, country?: string): string {
  const parts = [region, country].filter(Boolean);
  return parts.join(", ");
}

/** "tourist_attraction" → "Tourist attraction" (drop underscores, sentence-case).
 *  Matches Google Places' own display-name casing. */
export function humanizePlaceType(type: string): string {
  const spaced = type.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
