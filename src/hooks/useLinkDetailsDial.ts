export function useLinkDetailsDial() {
  return {
    grid: {
      columns: 6,
      gap: 8,
      cardHeight: 320,
    },
    rubberBand: {
      color: "var(--edge-brand)",
      bgOpacity: 0.2,
      borderRadius: 2,
    },
    selectedCard: {
      ringWidth: 2,
      ringOffsetWidth: 1,
      badgeSize: 24,
      badgeIconSize: 16,
      badgeOffsetX: 8,
      badgeOffsetY: 8,
      badgeBorderRadius: 9999,
    },
    unselected: {
      opacity: 0.6,
      grayscale: 10,
      blur: 0,
      scale: 1,
    },
    drag: {
      threshold: 20,
    },
  } as const;
}
