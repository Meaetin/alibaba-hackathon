"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

export function useHighlightLocation() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const highlightId = searchParams.get("highlight");
  const [isHighlighting, setIsHighlighting] = useState(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!highlightId) return;

    setIsHighlighting(true);
    attemptRef.current = 0;

    const tryHighlight = () => {
      const el = document.querySelector(`[data-location-id="${highlightId}"]`);
      if (el) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        el.classList.add("ring-2", "ring-action-dark", "transition-[box-shadow]");

        setTimeout(() => {
          el.classList.remove("ring-2", "ring-action-dark");
          setIsHighlighting(false);
          const params = new URLSearchParams(searchParams.toString());
          params.delete("highlight");
          const newUrl = params.size > 0 ? `${pathname}?${params}` : pathname;
          router.replace(newUrl, { scroll: false });
        }, 2000);
        return;
      }

      attemptRef.current++;
      if (attemptRef.current < 20) {
        pollTimer = setTimeout(tryHighlight, 250);
      } else {
        setIsHighlighting(false);
      }
    };

    let pollTimer = setTimeout(tryHighlight, 300);

    return () => clearTimeout(pollTimer);
  }, [highlightId, searchParams, router, pathname]);

  return { highlightId, isHighlighting };
}
