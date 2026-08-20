/**
 * UI Component Library
 *
 * Convenience barrel for the few components imported via "@/components/ui".
 * Most of the design system is imported directly by subpath
 * (e.g. "@/components/ui/primitives/Button"); only the symbols below are
 * consumed through this barrel.
 *
 * @example
 * ```tsx
 * import { LocationCard, CategoryBadge } from "@/components/ui";
 * ```
 */

// Card components
export { ItineraryCard } from "./cards/ItineraryCard";
export { CollectionCard } from "./cards/CollectionCard";
export { LinkCard } from "./cards/LinkCard";
export { LocationCard } from "./cards/LocationCard";

// Display components
export { CategoryBadge } from "./primitives/CategoryBadge";

export { ProgressBar } from "./primitives/ProgressBar";

// Navigation components
export {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbSeparator,
} from "./primitives/Breadcrumb";

// Collapsible components
export { CollapsibleSection } from "./primitives/CollapsibleSection";
export type { CollapsibleSectionProps } from "./primitives/CollapsibleSection";

// Interactive primitives
export { CheckButton } from "./primitives/CheckButton";
export type { CheckButtonProps } from "./primitives/CheckButton";

// Detail primitives
export { DetailField } from "./primitives/DetailField";
export type { DetailFieldProps } from "./primitives/DetailField";
export { DetailRow } from "./primitives/DetailRow";
export type { DetailRowProps } from "./primitives/DetailRow";
