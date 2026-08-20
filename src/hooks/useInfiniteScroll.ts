"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface UseInfiniteScrollOptions {
  /** Whether infinite scroll is active (has more pages and not currently loading) */
  enabled: boolean;
  /** Distance from the scroll container edge to start loading, e.g. "400px" */
  rootMargin?: string;
}

interface UseInfiniteScrollReturn {
  /** Ref to attach to a sentinel element at the bottom of the list */
  sentinelRef: React.RefCallback<HTMLElement>;
}

/**
 * Calls `onLoadMore` when the sentinel element enters the scroll container's viewport.
 *
 * Uses a state-backed node ref so that both node changes (mount/unmount) and
 * `enabled` changes reliably trigger the IntersectionObserver to be set up or
 * torn down via useEffect — no dependency on React calling function ref callbacks
 * when their reference changes.
 *
 * The root is set to the nearest scrollable ancestor so that rootMargin works
 * correctly inside a custom scroll container (e.g. overflow-auto div) rather
 * than being measured against the browser viewport.
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  options: UseInfiniteScrollOptions,
): UseInfiniteScrollReturn {
  const { enabled, rootMargin = "400px" } = options;
  const onLoadMoreRef = useRef(onLoadMore);
  const [sentinelNode, setSentinelNode] = useState<HTMLElement | null>(null);

  // Keep callback ref current without re-creating the observer
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  // Manage observer lifecycle — re-runs whenever the node or enabled flag changes
  useEffect(() => {
    if (!sentinelNode || !enabled) return;

    // Find the nearest scrollable ancestor to use as the intersection root.
    // This makes rootMargin work correctly inside overflow-auto containers.
    const scrollParent = findScrollParent(sentinelNode);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadMoreRef.current();
        }
      },
      {
        root: scrollParent,
        rootMargin,
      },
    );

    observer.observe(sentinelNode);

    return () => {
      observer.disconnect();
    };
  }, [sentinelNode, enabled, rootMargin]);

  // Stable ref callback — just stores the node in state so the effect above
  // is retriggered when the sentinel mounts or unmounts.
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    setSentinelNode(node);
  }, []);

  return { sentinelRef };
}

/**
 * Walks up the DOM tree to find the nearest ancestor with overflow scroll/auto.
 * Returns null (viewport root) if none is found.
 */
function findScrollParent(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent) {
    const { overflow, overflowY } = window.getComputedStyle(parent);
    if (/auto|scroll/.test(overflow) || /auto|scroll/.test(overflowY)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}
