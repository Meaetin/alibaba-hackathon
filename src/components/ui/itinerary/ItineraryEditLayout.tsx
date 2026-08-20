"use client";

import { PanelRightOpen } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/primitives/Button";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/lib/motion/presets";
import { useRef } from "react";

const EASE = "var(--motion-ease-spatial)";
const TRANSITION_WIDTH = `width var(--motion-duration-slow) ${EASE}`;

interface ItineraryEditLayoutProps {
  leftContent: React.ReactNode;
  leftOpen?: boolean;
  centerContent: React.ReactNode | null;
  centerOpen: boolean;
  rightContent: React.ReactNode;
  onPanelOpen?: () => void;
  panelOpenLabel?: string;
  className?: string;
}

export function ItineraryEditLayout({
  leftContent,
  leftOpen = true,
  centerContent,
  centerOpen,
  rightContent,
  onPanelOpen,
  panelOpenLabel = "Open details panel",
  className,
}: ItineraryEditLayoutProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion
    ? motionTransitions.instant
    : motionTransitions.spatial;

  return (
    <div
      data-slot="itinerary-edit-layout"
      data-region="itinerary-edit-layout"
      className={cn("itinerary-edit-layout relative flex h-full overflow-hidden", className)}
    >
      {/*
        Tablet keeps the day board only while editing the itinerary timeline.
        Support tabs reclaim the workspace instead of preserving an empty rail
        beside compressed Flight, Lodging, or Notes content.
      */}
      <div
        ref={leftRef}
        data-region="itinerary-edit-day-list"
        className={cn(
          "itinerary-edit-left-column shrink-0 overflow-hidden transition-[width,opacity] duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-spatial)]",
          leftOpen
            ? "w-[44%] min-w-[300px] opacity-100 lg:w-[calc((100%_-_1rem)_/_3)] lg:min-w-[280px]"
            : "w-0 min-w-0 opacity-0 lg:w-[calc((100%_-_1rem)_/_3)] lg:min-w-[280px] lg:opacity-100",
        )}
      >
        <div className="itinerary-edit-left-scroll w-full h-full overflow-y-auto scrollbar-none">
          {leftContent}
        </div>
      </div>

      {/* The tablet panel overlays the map directly beside the itinerary rail. */}
      <ResizeHandle className="hidden lg:flex" targetRef={leftRef} minWidth={280} />

      <AnimatePresence initial={false}>
        {centerOpen && (
          <motion.div
            ref={centerRef}
            key="itinerary-edit-panel"
            data-region="itinerary-edit-panel"
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18 }}
            transition={panelTransition}
            className={cn(
              "itinerary-edit-center-column relative z-10 shrink-0 overflow-hidden lg:w-[calc((100%_-_1rem)_/_3)] lg:min-w-[200px]",
              "max-lg:absolute max-lg:inset-y-0 max-lg:left-[44%] max-lg:z-20 max-lg:w-[44%] max-lg:min-w-[420px] max-lg:max-w-[480px] max-lg:rounded-xl max-lg:border max-lg:border-edge max-lg:bg-surface max-lg:shadow-[0_6px_8px_var(--neutral-shadow)]",
            )}
          >
            <div className="itinerary-edit-center-scroll h-full">
              {centerContent}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The map remains visible behind the tablet panel and to its right. */}
      <div
        data-region="itinerary-edit-map"
        className={cn(
          "itinerary-edit-right-column min-w-0 flex-1 h-full rounded-xl overflow-hidden border border-edge ml-2",
        )}
      >
        {rightContent}
      </div>

      {!centerOpen && onPanelOpen && (
        <div
          className={cn(
            "fixed bottom-4 z-30 lg:hidden",
            leftOpen ? "left-[44%]" : "left-4",
          )}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon="leading"
            onClick={onPanelOpen}
            aria-label={panelOpenLabel}
          >
            <PanelRightOpen className="size-4" />
            Details
          </Button>
        </div>
      )}

      {centerOpen && <ResizeHandle className="hidden lg:flex" targetRef={centerRef} minWidth={200} />}
    </div>
  );
}

function ResizeHandle({
  targetRef,
  minWidth,
  className,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>;
  minWidth: number;
  className?: string;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  function onPointerDown(e: React.PointerEvent) {
    const el = targetRef.current;
    if (!el) return;
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = el.offsetWidth;

    // Direct manipulation must track the pointer exactly. A width tween here
    // trails every pointermove and makes the handle feel detached.
    el.style.transition = "none";
    el.style.width = `${el.offsetWidth}px`;

    e.currentTarget.setPointerCapture(e.pointerId);
    handleRef.current?.setAttribute("data-dragging", "");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const el = targetRef.current;
    if (!el) return;
    const delta = e.clientX - startX.current;
    el.style.width = `${Math.max(minWidth, startWidth.current + delta)}px`;
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;

    handleRef.current?.removeAttribute("data-dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const el = targetRef.current;
    if (el) el.style.transition = reduceMotion ? "none" : TRANSITION_WIDTH;
  }

  function onDoubleClick() {
    const el = targetRef.current;
    if (!el) return;
    el.style.transition = reduceMotion ? "none" : TRANSITION_WIDTH;
    el.style.width = "";
  }

  return (
    <div
      ref={handleRef}
      data-region="itinerary-edit-resize-handle"
      className={cn("itinerary-edit-resize-handle group relative flex w-2 items-center justify-center cursor-col-resize", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div className="itinerary-edit-resize-handle-indicator h-full w-0.5 rounded-full bg-action-brand opacity-0 transition-opacity group-hover:opacity-50 group-[[data-dragging]]:opacity-100" />
    </div>
  );
}
