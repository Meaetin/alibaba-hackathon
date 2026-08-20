/**
 * Smoothly scrolls the nearest scrollable ancestor of `el` (including `el`
 * itself) to the top, falling back to the window.
 *
 * Use when a view swaps in at the top of a scroll region but the actual
 * scroller is an ancestor (e.g. MainLayout's `<main className="main-layout-content">`)
 * rather than the page's own container — calling `scrollTo` on a non-scrolling
 * inner element is a silent no-op.
 */
export function scrollScrollableAncestorToTop(el: HTMLElement | null): void {
  let node: HTMLElement | null = el;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      node.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    node = node.parentElement;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}
