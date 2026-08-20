export function snapHour(hour: number, maxHour: number = 23.75): number {
  return Math.max(0, Math.min(maxHour, Math.round(hour * 4) / 4));
}

export function formatTime(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const period = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:${m.toString().padStart(2, "0")} ${period}`;
}

export function formatTimeRange(startHour: number, durationHours: number): string {
  return `${formatTime(startHour)} – ${formatTime(startHour + durationHours)}`;
}

export function formatDuration(minutes?: number): string {
  if (!minutes) return "1h";
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function toHHMM(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function fromHHMM(value: string): number | undefined {
  if (!value) return undefined;
  const [h, m] = value.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return undefined;
  return h + m / 60;
}
