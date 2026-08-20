import { useEffect } from "react";
import { useNavbarFilter } from "@/contexts/NavbarFilterContext";

/**
 * Syncs a list page's active location filter into the shared navbar filter pill,
 * resolving the locality's entity ids and clearing the pill when the filter
 * changes or the page unmounts.
 */
export function useNavbarLocationFilter(
  locationFilter: string | null,
  entityIdsByLocality: Map<string, Set<string>>,
): void {
  const { setFilter: setNavbarFilter } = useNavbarFilter();

  useEffect(() => {
    if (locationFilter) {
      const entityIds = entityIdsByLocality.get(locationFilter);
      setNavbarFilter({
        type: "location",
        label: locationFilter,
        localityEntityIds: entityIds,
      });
    } else {
      setNavbarFilter(null);
    }
    return () => setNavbarFilter(null);
  }, [locationFilter, entityIdsByLocality, setNavbarFilter]);
}
