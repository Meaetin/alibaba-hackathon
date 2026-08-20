"use client";

import { motion } from "motion/react";
import { Car, Footprints, MapPin, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";

type TransportMode = "drive" | "walk";

// Edit-mode mode buttons (Figma `1373:5661`): walk · drive, each a bordered
// icon button.
const MODE_BUTTONS: { mode: TransportMode; Icon: LucideIcon; label: string }[] = [
  { mode: "walk", Icon: Footprints, label: "Walk" },
  { mode: "drive", Icon: Car, label: "Drive" },
];

const transportIconMap: Record<string, LucideIcon> = {
  drive: Car,
  walk: Footprints,
};

function resolveTransportIcon(mode?: string): LucideIcon {
  if (!mode) return Car;
  return transportIconMap[mode.toLowerCase()] ?? Car;
}

function formatDistance(meters: number | null): string | null {
  if (meters === null || meters === undefined) return null;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined) return null;
  return `~${Math.round(seconds / 60)} mins`;
}

const TRANSITION = { duration: 0.25, ease: [0.25, 1, 0.5, 1] as [number, number, number, number] };

interface TransportDetailRowProps {
  distanceMeters: number | null;
  durationSeconds: number | null;
  transportMode?: string;
  globalHidden?: boolean;
  /** True while the server Directions cascade is recomputing this leg — show skeleton in place of distance/duration. */
  loading?: boolean;
  /** Google returned no route in the current mode (e.g. two stops separated by water). */
  unavailable?: boolean;
  onModeChange?: (mode: string) => void;
  /** Google Maps directions URL for the leg — the map-pin button opens it in a new tab. */
  mapsUrl?: string | null;
  className?: string;
}

function TransportDetailRow({
  distanceMeters,
  durationSeconds,
  transportMode = "drive",
  globalHidden = false,
  loading = false,
  unavailable = false,
  onModeChange,
  mapsUrl,
  className,
}: TransportDetailRowProps) {
  const Icon = resolveTransportIcon(transportMode);
  // View mode = no interactive controls (read-only flat layout). Edit mode adds
  // the mode buttons + open-in-maps action.
  const isReadOnly = !onModeChange;
  // Distance and duration are exactly what Google returned for this mode. They
  // are never derived from another mode's numbers.
  const distance = formatDistance(distanceMeters);
  const duration = formatDuration(durationSeconds);

  return (
    <motion.div
      data-slot="transport-detail-row"
      initial={false}
      animate={{
        opacity: globalHidden ? 0 : 1,
        height: globalHidden ? 0 : "auto",
      }}
      transition={TRANSITION}
      className={cn("transport-detail-row", "overflow-hidden", className)}
    >
      {/* Transport Row — CategoryBadge + duration | distance (+ mode/maps controls in edit) */}
      <div
        data-region="itinerary-edit-transport-row"
        className="transport-row-content bg-surface border border-edge rounded-xl flex items-center gap-2 p-2"
      >
        <CategoryBadge category="neutral" icon={Icon} iconSize={14} />

        {loading ? (
          <div className="transport-row-info flex flex-1 items-center justify-between">
            <span
              className="transport-row-duration-loading h-3.5 w-16 rounded bg-surface-muted animate-pulse"
              aria-label="Calculating duration"
            />
            <span
              className="transport-row-distance-loading h-3.5 w-12 rounded bg-surface-muted animate-pulse"
              aria-label="Calculating distance"
            />
          </div>
        ) : unavailable ? (
          /* No Route State — the mode exists but Google has nothing for this pair */
          <div className="transport-row-info flex flex-1 items-center">
            <span className="transport-row-unavailable type-body-2 text-content-tertiary">
              No route
            </span>
          </div>
        ) : (
          <div className="transport-row-info flex flex-1 items-center justify-between">
            {duration && (
              <span className="transport-row-duration type-body-2 text-content">{duration}</span>
            )}
            {distance && (
              <span className="transport-row-distance type-body-2 text-content">{distance}</span>
            )}
          </div>
        )}

        {/* Controls — mode buttons + open in Google Maps (edit only) */}
        {!isReadOnly && (
          <div className="transport-row-controls flex items-center gap-1 shrink-0">
            {MODE_BUTTONS.map(({ mode: m, Icon: ModeIcon, label }) => (
              <button
                key={m}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onModeChange?.(m);
                }}
                disabled={loading}
                aria-label={`Set transport mode: ${label}`}
                aria-pressed={transportMode === m}
                title={label}
                className={cn(
                  "transport-mode-button flex size-6 items-center justify-center rounded-lg border transition-colors shrink-0",
                  transportMode === m
                    ? "border-edge-strong bg-surface-alt text-content"
                    : "border-edge text-content-secondary hover:text-content hover:bg-surface-alt",
                  loading && "opacity-50 cursor-not-allowed",
                )}
              >
                <ModeIcon className="transport-mode-icon size-3" />
              </button>
            ))}

            {/* Open in Google Maps — new tab */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (mapsUrl) window.open(mapsUrl, "_blank", "noopener,noreferrer");
              }}
              disabled={!mapsUrl}
              aria-label="Open in Google Maps"
              title="Open in Google Maps"
              className={cn(
                "transport-maps-button flex size-6 items-center justify-center rounded-lg border border-edge text-content-secondary transition-colors shrink-0",
                mapsUrl
                  ? "hover:text-content hover:bg-surface-alt cursor-pointer"
                  : "opacity-40 cursor-not-allowed",
              )}
            >
              <MapPin className="transport-maps-icon size-3" />
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

TransportDetailRow.displayName = "TransportDetailRow";

export { TransportDetailRow };
export type { TransportDetailRowProps };
