"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * SSR-safe media-query hook. Subscribes to `window.matchMedia(query)` and
 * returns its `matches` result. Returns `false` on the server and on the first
 * client render (via a distinct server snapshot), so it never causes a
 * hydration mismatch, then re-renders with the live value after mount.
 * Never throws when `window`/`matchMedia` is unavailable.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = () =>
    typeof window !== "undefined" && !!window.matchMedia
      ? window.matchMedia(query).matches
      : false;

  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export type Breakpoint = "base" | "sm" | "md" | "lg" | "xl";

export interface BreakpointState {
  /** `< 768` (below Tailwind `md`) — bottom-sheet, overlay sidebar */
  isPhone: boolean;
  /** `768–1023` (Tailwind `md`..<`lg`) — side-drawer, overlay sidebar */
  isTablet: boolean;
  /** `>= 1024` (Tailwind `lg`+) — inline sidebar, multi-pane */
  isDesktop: boolean;
  /** Current named breakpoint bucket. */
  active: Breakpoint;
}

/**
 * Convenience layer over {@link useMediaQuery}. Reports the current viewport
 * bucket using the Tailwind v4 default min-width edges (sm 640 / md 768 /
 * lg 1024 / xl 1280) so JS branching stays in lockstep with the CSS variants.
 * SSR-safe: reports `isPhone` (the mobile-first base) on the server and first
 * client render.
 */
export function useBreakpoint(): BreakpointState {
  const sm = useMediaQuery("(min-width: 640px)");
  const md = useMediaQuery("(min-width: 768px)");
  const lg = useMediaQuery("(min-width: 1024px)");
  const xl = useMediaQuery("(min-width: 1280px)");

  const active: Breakpoint = xl ? "xl" : lg ? "lg" : md ? "md" : sm ? "sm" : "base";

  return {
    isPhone: !md,
    isTablet: md && !lg,
    isDesktop: lg,
    active,
  };
}
