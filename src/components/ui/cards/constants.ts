/**
 * Grid row height for link cards on /links (page grid + loading skeleton).
 * Must stay a complete class string — Tailwind only generates CSS for class
 * names that appear verbatim in source, so `auto-rows-[${height}]`
 * interpolation would silently produce no CSS.
 */
export const LINK_CARD_GRID_ROWS = "auto-rows-[var(--card-height)]";
