"use client";

import { ArrowRight, Check, PlaneLanding, Plus } from "lucide-react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { useState, type PointerEvent } from "react";

import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import { cn } from "@/lib/utils";

interface FlightActivityCardProps {
  flight?: FlightCardProps | null;
  date?: string | null;
  onAction: () => void;
  className?: string;
}

function dateParts(value?: string | null): { day: string; month: string } {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { day: "—", month: "Trip" };
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  return { day: match[3], month };
}

export function FlightActivityCard({ flight, date, onAction, className }: FlightActivityCardProps) {
  const reduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const tiltXTarget = useMotionValue(0);
  const tiltYTarget = useMotionValue(0);
  const lightX = useMotionValue(50);
  const lightY = useMotionValue(50);
  const rotateX = useSpring(tiltXTarget, { stiffness: 260, damping: 28, mass: 0.7 });
  const rotateY = useSpring(tiltYTarget, { stiffness: 260, damping: 28, mass: 0.7 });
  const sheen = useMotionTemplate`radial-gradient(circle at ${lightX}% ${lightY}%, color-mix(in srgb, var(--category-flight-icon) 24%, transparent) 0%, color-mix(in srgb, var(--cal-flight-bg-subtle) 42%, transparent) 28%, transparent 62%)`;
  const displayedDate = dateParts(flight?.departDate ?? flight?.arriveDate ?? date);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    tiltXTarget.set((0.5 - y) * 3);
    tiltYTarget.set((x - 0.5) * 4);
    lightX.set(x * 100);
    lightY.set(y * 100);
  };

  const resetMaterial = () => {
    setHovered(false);
    tiltXTarget.set(0);
    tiltYTarget.set(0);
    lightX.set(50);
    lightY.set(50);
  };

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1, y: hovered && !reduceMotion ? -1 : 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={reduceMotion ? { transformOrigin: "center center" } : { rotateX, rotateY, transformPerspective: 900, transformOrigin: "center center" }}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetMaterial}
      data-region="itinerary-flight-activity-card"
      className={cn("relative flex h-[92px] w-full overflow-hidden rounded-2xl border border-edge bg-surface shadow-default", className)}
    >
      <motion.div
        aria-hidden="true"
        animate={{ opacity: hovered && !reduceMotion ? 0.9 : 0.38 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
        style={{ background: sheen }}
        className={cn("pointer-events-none absolute inset-0 z-0")}
      />

      {/* Departure Date */}
      <div className={cn("relative z-10 flex w-[68px] shrink-0 flex-col items-center justify-center border-r border-edge-subtle bg-cal-flight-bg-subtle/70 text-cal-flight-fg")}>
        <span className={cn("type-body-4 font-medium uppercase tracking-wide")}>Flight</span>
        <span className={cn("type-h4 type-secondary mt-0.5 font-semibold")}>{displayedDate.day}</span>
        <span className={cn("type-body-4 font-medium uppercase")}>{displayedDate.month}</span>
      </div>

      {/* Flight Summary */}
      <div className={cn("relative z-10 flex min-w-0 flex-1 items-center gap-3 px-4")}>
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-category-flight text-category-flight-on shadow-xs")}>
          <PlaneLanding className={cn("size-4")} />
        </div>
        <div className={cn("min-w-0 flex-1")}>
          {flight ? (
            <>
              <div className={cn("flex items-center gap-2")}>
                <span className={cn("type-h4 type-secondary font-semibold text-content")}>{flight.fromCode}</span>
                <ArrowRight className={cn("size-4 text-glyph-secondary")} />
                <span className={cn("type-h4 type-secondary font-semibold text-content")}>{flight.toCode}</span>
                <span className={cn("inline-flex items-center gap-1 rounded-full bg-surface/80 px-2 py-0.5 type-body-4 font-medium text-content-secondary backdrop-blur-sm")}>
                  <Check className={cn("size-3 text-glyph-success")} />On time
                </span>
              </div>
              <p className={cn("mt-0.5 truncate type-body-3 text-content-secondary")}>
                {flight.flightNumber}{flight.departTime ? ` · Departs ${flight.departTime}` : ""}{flight.arriveTime ? ` · Lands ${flight.arriveTime}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className={cn("type-body-2 type-secondary font-semibold text-content")}>Add arrival flight</p>
              <p className={cn("mt-0.5 truncate type-body-3 text-content-secondary")}>Search a flight or start tracking it</p>
            </>
          )}
        </div>
      </div>

      {/* Flight Action */}
      <button
        type="button"
        onClick={onAction}
        aria-label={flight ? `Open ${flight.flightNumber}` : "Add arrival flight"}
        className={cn("group/action relative z-10 flex w-[86px] shrink-0 flex-col items-center justify-center gap-1 border-l border-dashed border-edge bg-surface/65 type-body-3 font-medium text-content-secondary backdrop-blur-sm transition-colors duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)] hover:bg-surface/90 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-brand")}
      >
        <span className={cn("absolute -left-2 -top-2 size-4 rounded-full border border-edge bg-surface-alt")} aria-hidden="true" />
        <span className={cn("absolute -bottom-2 -left-2 size-4 rounded-full border border-edge bg-surface-alt")} aria-hidden="true" />
        {flight ? <ArrowRight className={cn("size-4")} /> : <Plus className={cn("size-4")} />}
        {flight ? "Open" : "Add flight"}
      </button>
    </motion.div>
  );
}
