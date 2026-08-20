"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ───── Types ──────────────────────────────────────────────────────────────────

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ───── Intersection helper ────────────────────────────────────────────────────

function computeIntersectingIds(
  rect: SelectionRect,
  cardElements: Map<string, HTMLDivElement>,
): Set<string> {
  const result = new Set<string>();
  for (const [id, el] of cardElements) {
    const cr = el.getBoundingClientRect();
    if (
      rect.x < cr.right &&
      rect.x + rect.width > cr.left &&
      rect.y < cr.bottom &&
      rect.y + rect.height > cr.top
    ) {
      result.add(id);
    }
  }
  return result;
}

function normalizeRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): SelectionRect {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

// ───── Scroll container helper ───────────────────────────────────────────────

function findScrollContainer(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return document.documentElement;
}

// ───── Hook ───────────────────────────────────────────────────────────────────

const DEFAULT_DRAG_THRESHOLD = 3;

interface RubberBandSelectionOptions {
  dragThreshold?: number;
  /** Fired once per selection session when it first becomes a multi-select. */
  onMultiSelect?: (count: number, method: "click" | "rubber_band" | "select_all") => void;
  // When true, starting a new rubber-band drag is suppressed (e.g. while a modal
  // is open). Existing selection state is left untouched.
  disabled?: boolean;
}

export function useRubberBandSelection(options?: RubberBandSelectionOptions) {
  const DRAG_THRESHOLD = options?.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;

  // Reported once per session so a rubber-band drag over 30 cards emits one
  // event rather than one per intersecting card.
  const onMultiSelectRef = useRef(options?.onMultiSelect);
  onMultiSelectRef.current = options?.onMultiSelect;
  const multiSelectReportedRef = useRef(false);

  // Read inside document-level handlers via a ref so toggling `disabled` doesn't
  // need to re-create the memoized handlers.
  const disabledRef = useRef(options?.disabled ?? false);
  disabledRef.current = options?.disabled ?? false;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [contextMenuCoords, setContextMenuCoords] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isContextMenuOpen, _setIsContextMenuOpen] = useState(false);
  const isContextMenuOpenRef = useRef(false);

  const setIsContextMenuOpen = useCallback((open: boolean) => {
    isContextMenuOpenRef.current = open;
    _setIsContextMenuOpen(open);
  }, []);

  const cardElements = useRef(new Map<string, HTMLDivElement>());
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const exceededThreshold = useRef(false);
  const rafId = useRef<number | null>(null);
  const scrollRafId = useRef<number | null>(null);

  // Set after shift+click in handleCardMouseDown so the subsequent onClick
  // on the ContentCard knows to skip its own toggle logic.
  // Set when a rubber-band drag exceeds threshold so the subsequent onClick
  // on a ContentCard knows to skip its click handler.
  const suppressClickRef = useRef(false);

  // Track the card ID (if any) where the drag originated, so we can suppress
  // its click even if the drag started on a card.
  const dragOriginCardId = useRef<string | null>(null);

  // Deferred deselect: when clicking an already-selected card, defer toggle
  // to mouseup so a drag can start before the card is deselected.
  const deferredDeselectId = useRef<string | null>(null);

  // ── Card registration ──────────────────────────────────────────────────

  const registerCard = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) {
        cardElements.current.set(id, el);
      } else {
        cardElements.current.delete(id);
      }
    },
    [],
  );

  // ── Selection helpers ──────────────────────────────────────────────────

  const clearSelection = useCallback(() => {
    multiSelectReportedRef.current = false;
    setSelectedIds(new Set());
    setSelectionRect(null);
    setIsDragging(false);
    dragStart.current = null;
    exceededThreshold.current = false;
  }, []);

  // Replace the entire selection with the given ids (e.g. a "Select all" action).
  const selectAll = useCallback((ids: string[]) => {
    if (ids.length > 1 && !multiSelectReportedRef.current) {
      multiSelectReportedRef.current = true;
      onMultiSelectRef.current?.(ids.length, "select_all");
    }
    setSelectedIds(new Set(ids));
  }, []);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size === 0) {
        multiSelectReportedRef.current = false;
      } else if (next.size > 1 && !multiSelectReportedRef.current) {
        multiSelectReportedRef.current = true;
        onMultiSelectRef.current?.(next.size, "click");
      }
      return next;
    });
  }, []);

  // ── Click suppression (prevents double-toggle on shift+click or after drag) ─

  const consumeClickSuppression = useCallback((id?: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    if (exceededThreshold.current && dragOriginCardId.current != null && dragOriginCardId.current === id) {
      return true;
    }
    return false;
  }, []);

  // ── ESC — document-level listener, no tabIndex needed on the grid ──────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearSelection();
        setIsContextMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [clearSelection]);

  // ── Context menu ───────────────────────────────────────────────────────

  const handleGridContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const cardEl = (e.target as HTMLElement).closest("[data-card]");
      const cardId = cardEl?.getAttribute("data-card-id");

      if (cardId && selectedIds.size === 0) {
        e.preventDefault();
        setSelectedIds(new Set([cardId]));
        setContextMenuCoords({ x: e.clientX, y: e.clientY });
        setIsContextMenuOpen(true);
        return;
      }

      if (selectedIds.size > 0) {
        e.preventDefault();
        setContextMenuCoords({ x: e.clientX, y: e.clientY });
        setIsContextMenuOpen(true);
      }
    },
    [selectedIds],
  );

  // ── Grid mouse-down (start rubber band) ────────────────────────────────

  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabledRef.current) return;
      if (e.button !== 0) return;
      if (e.shiftKey) return;

      // Track if drag started on a card
      const cardEl = (e.target as HTMLElement).closest("[data-card]");
      dragOriginCardId.current = cardEl?.getAttribute("data-card-id") ?? null;

      // Clicking empty space must NOT clear the selection — deselection happens
      // only via the toolbar's ✕ (or Escape). A mousedown on empty space still
      // begins a fresh rubber band; a drag replaces the selection, a plain click
      // leaves it untouched. While a context menu is open, swallow the click so
      // it just dismisses the menu.
      if (!cardEl && isContextMenuOpenRef.current) {
        return;
      }

      dragStart.current = { x: e.clientX, y: e.clientY };
      exceededThreshold.current = false;

      const scroller = findScrollContainer(e.target as HTMLElement);
      const scrollerRect = scroller.getBoundingClientRect();
      const EDGE_ZONE = 80;
      const MAX_SCROLL_SPEED = 20;
      let startPageX = e.clientX;
      let startScrollY = scroller.scrollTop;
      let startClientY = e.clientY;
      let latestClientX = e.clientX;
      let latestClientY = e.clientY;
      const getStartClientY = () => startClientY - (scroller.scrollTop - startScrollY);

      const updateRect = () => {
        if (!dragStart.current) return;
        const rect = normalizeRect(
          startPageX,
          getStartClientY(),
          latestClientX,
          latestClientY,
        );
        setSelectionRect(rect);
        const current = computeIntersectingIds(rect, cardElements.current);
        setSelectedIds(current);
      };

      const scrollLoop = () => {
        if (!exceededThreshold.current) {
          scrollRafId.current = requestAnimationFrame(scrollLoop);
          return;
        }
        const y = latestClientY;
        const top = scrollerRect.top;
        const bottom = scrollerRect.bottom;
        let speed = 0;
        if (y > bottom - EDGE_ZONE) {
          speed = MAX_SCROLL_SPEED * Math.min(1, (y - (bottom - EDGE_ZONE)) / EDGE_ZONE);
        } else if (y < top + EDGE_ZONE) {
          speed = -MAX_SCROLL_SPEED * Math.min(1, ((top + EDGE_ZONE) - y) / EDGE_ZONE);
        }
        if (speed !== 0) {
          scroller.scrollTop += speed;
        }
        updateRect();
        scrollRafId.current = requestAnimationFrame(scrollLoop);
      };

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragStart.current) return;

        latestClientX = ev.clientX;
        latestClientY = ev.clientY;

        const dx = ev.clientX - startPageX;
        const dy = ev.clientY - getStartClientY();

        if (
          !exceededThreshold.current &&
          Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD
        ) {
          return;
        }
        if (!exceededThreshold.current) {
          document.body.style.userSelect = "none";
          document.body.style.webkitUserSelect = "none";
          startPageX = ev.clientX;
          startClientY = ev.clientY;
          startScrollY = scroller.scrollTop;
          scrollRafId.current = requestAnimationFrame(scrollLoop);
        }
        exceededThreshold.current = true;
        setIsDragging(true);
        suppressClickRef.current = true;

        if (rafId.current != null) cancelAnimationFrame(rafId.current);
        rafId.current = requestAnimationFrame(updateRect);
      };

      const onMouseUp = () => {
        if (exceededThreshold.current && !multiSelectReportedRef.current) {
          setSelectedIds((current) => {
            if (current.size > 1) {
              multiSelectReportedRef.current = true;
              onMultiSelectRef.current?.(current.size, "rubber_band");
            }
            return current;
          });
        }
        if (rafId.current != null) cancelAnimationFrame(rafId.current);
        if (scrollRafId.current != null) cancelAnimationFrame(scrollRafId.current);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        setIsDragging(false);
        setSelectionRect(null);
        dragStart.current = null;
        exceededThreshold.current = false;
        setTimeout(() => { dragOriginCardId.current = null; }, 0);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [DRAG_THRESHOLD],
  );

  // ── Card mouse-down (shift+click toggle) ───────────────────────────────

  const handleCardMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleItem(id);
        suppressClickRef.current = true;
        return;
      }

      if (selectedIds.size > 0) {
        e.preventDefault();

        if (selectedIds.has(id)) {
          // Defer deselection to mouseup so a drag can start first.
          deferredDeselectId.current = id;
          suppressClickRef.current = true;

          const onUp = () => {
            document.removeEventListener("mouseup", onUp);
            if (deferredDeselectId.current === id) {
              deferredDeselectId.current = null;
              toggleItem(id);
            }
          };
          document.addEventListener("mouseup", onUp);
        } else {
          e.stopPropagation();
          toggleItem(id);
          suppressClickRef.current = true;
        }
        return;
      }
    },
    [selectedIds, toggleItem, clearSelection],
  );

  // ── Cleanup ────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
      if (scrollRafId.current != null) cancelAnimationFrame(scrollRafId.current);
    };
  }, []);

  const getCardElements = useCallback(() => cardElements.current, []);

  const cancelDeferredDeselect = useCallback(() => {
    deferredDeselectId.current = null;
  }, []);

  return {
    selectedIds,
    isDragging,
    selectionRect,
    contextMenuCoords,
    isContextMenuOpen,
    setIsContextMenuOpen,
    registerCard,
    getCardElements,
    cancelDeferredDeselect,
    handleGridMouseDown,
    handleCardMouseDown,
    handleGridContextMenu,
    clearSelection,
    selectAll,
    toggleItem,
    consumeClickSuppression,
  };
}
