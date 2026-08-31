"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useToast } from "@/contexts/ToastContext";
import { Button } from "@/components/ui/primitives/Button";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/lib/motion/presets";

/**
 * Toast thumbnails come from analyzed third-party links, whose signed CDN
 * hosts are not known at build time. A native image is intentional here:
 * `next/image` rejects an unlisted host during render and turns a successful
 * analysis notification into a page-level runtime error.
 */
export function ToastThumbnailImage({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Runtime-provided CDN hosts cannot be safely allowlisted in Next config.
    <img
      src={src}
      alt=""
      width={40}
      height={40}
      className={cn("toast-thumbnail-image size-full object-cover")}
      referrerPolicy="no-referrer"
    />
  );
}

// Auto-dismiss indicator: a thin neutral bar that drains along the bottom edge.
function ProgressBar({ duration, paused }: { duration: number; paused: boolean }) {
  const startRef = useRef(Date.now());
  const elapsedRef = useRef(0);
  const [animStyle, setAnimStyle] = useState<React.CSSProperties>({
    animation: `progress-drain ${duration}ms linear forwards`,
  });

  useEffect(() => {
    if (paused) {
      elapsedRef.current += Date.now() - startRef.current;
      const progress = Math.min(elapsedRef.current / duration, 1);
      setAnimStyle({
        animationPlayState: "paused",
        transform: `scaleX(${1 - progress})`,
      });
    } else {
      startRef.current = Date.now();
      const remaining = duration - elapsedRef.current;
      setAnimStyle({
        animation: `progress-drain ${remaining}ms linear forwards`,
        animationPlayState: "running",
      });
    }
  }, [paused, duration]);

  return (
    <div
      className="pointer-events-none absolute bottom-0 left-0 right-0 h-0.5 origin-left bg-edge-strong"
      style={animStyle}
    />
  );
}

export function ToastContainer() {
  const prefersReducedMotion = useReducedMotion();
  const { toasts, removeToast, pauseToast, resumeToast, pausedToasts } =
    useToast();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="toast-container fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const variant = toast.variant ?? "default";
          const isError = variant === "error";
          const hasThumbnail = Boolean(toast.thumbnail);
          const hasDescription = Boolean(toast.description);
          const showAction = Boolean(toast.action) && !isError;
          const isPaused = pausedToasts.has(toast.id);

          // Figma padding model (py always 12): a bare text edge gets 20px only in
          // an "expanded" toast; an edge next to a thumbnail/action stays 12px.
          const padLeft =
            !hasThumbnail && (hasDescription || showAction) ? "pl-5" : "pl-3";
          const padRight = !showAction && hasDescription ? "pr-5" : "pr-3";

          return (
            <motion.div
              key={toast.id}
              layout={prefersReducedMotion ? false : "position"}
              initial={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, transform: "translateY(16px)" }
              }
              animate={{ opacity: 1, transform: "translate(0, 0)" }}
              exit={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, transform: "translateX(16px)" }
              }
              transition={motionTransitions.control}
              className="pointer-events-auto"
            >
              <div
                data-variant={variant}
                className={cn(
                  "toast-card pointer-events-auto flex items-center gap-4 py-3 max-w-sm",
                  padLeft,
                  padRight,
                  "bg-surface border border-edge-subtle rounded-2xl",
                  "shadow-[0px_2px_3px_0px_rgba(0,0,0,0.04),0px_8px_12px_0px_rgba(0,0,0,0.08)]",
                  "relative overflow-hidden",
                )}
                role={isError ? "alert" : "status"}
                aria-live={isError ? "assertive" : "polite"}
                onMouseEnter={() => pauseToast(toast.id)}
                onMouseLeave={() => resumeToast(toast.id)}
              >
                {/* Thumbnail (40×40, tilted 6°) */}
                {toast.thumbnail && (
                  <div className="toast-thumbnail-wrapper flex shrink-0 items-center justify-center size-11">
                    <div className="rotate-6">
                      <div className="toast-thumbnail relative size-10 overflow-hidden rounded-lg bg-surface-muted shadow-[0px_2px_8px_0px_rgba(0,0,0,0.12)]">
                        <ToastThumbnailImage src={toast.thumbnail} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Text Content */}
                <div className="flex flex-col min-w-0 flex-1">
                  <span
                    className={cn(
                      "toast-title type-body-2 font-medium text-content",
                      isError
                        ? "whitespace-normal text-balance"
                        : "whitespace-nowrap"
                    )}
                  >
                    {toast.title}
                  </span>
                  {toast.description && (
                    <span className="type-body-2 text-content-secondary">
                      {toast.description}
                    </span>
                  )}
                </div>

                {/* Action */}
                {showAction && toast.action && (
                  <Button
                    variant="dark"
                    size="sm"
                    className="toast-action shrink-0"
                    nativeButton={false}
                    render={<Link href={toast.action.href} />}
                    onClick={() => removeToast(toast.id)}
                  >
                    {toast.action.label}
                  </Button>
                )}

                {/* Progress Bar */}
                <ProgressBar duration={toast.duration} paused={isPaused} />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body
  );
}
