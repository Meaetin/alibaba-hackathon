const selectionStyle = {
  rubberBand: {
    color: "var(--edge-brand)",
    bgOpacity: 0.2,
    borderRadius: 2,
  },
  unselected: {
    opacity: 0.6,
    grayscale: 10,
    blur: 0,
    scale: 1,
  },
} as const;

export function rubberBandStyle(rect: { x: number; y: number; width: number; height: number }) {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    borderRadius: selectionStyle.rubberBand.borderRadius,
    backgroundColor: `color-mix(in srgb, ${selectionStyle.rubberBand.color} ${Math.round(selectionStyle.rubberBand.bgOpacity * 100)}%, transparent)`,
  } as const;
}

export function unselectedCardStyle() {
  const { opacity, grayscale, blur, scale } = selectionStyle.unselected;
  return {
    opacity,
    filter: [
      grayscale > 0 ? `grayscale(${grayscale}%)` : "",
      blur > 0 ? `blur(${blur}px)` : "",
    ].filter(Boolean).join(" ") || undefined,
    transform: scale < 1 ? `scale(${scale})` : undefined,
  } as const;
}
