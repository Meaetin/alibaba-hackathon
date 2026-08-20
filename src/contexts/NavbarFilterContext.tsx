"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type FilterType = "link" | "collection" | "itinerary" | "location";

interface NavbarFilterData {
  type: FilterType;
  label: string;
  thumbnailUrl?: string;
  entityId?: string;
  localityEntityIds?: Set<string>;
}

interface NavbarFilterContextValue {
  filter: NavbarFilterData | null;
  setFilter: (filter: NavbarFilterData | null) => void;
}

const NavbarFilterContext = createContext<NavbarFilterContextValue | undefined>(
  undefined,
);

export function useNavbarFilter() {
  const context = useContext(NavbarFilterContext);
  if (!context) {
    return {
      filter: null,
      setFilter: () => {},
    };
  }
  return context;
}

export function NavbarFilterProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<NavbarFilterData | null>(null);

  return (
    <NavbarFilterContext.Provider value={{ filter, setFilter }}>
      {children}
    </NavbarFilterContext.Provider>
  );
}

export type { NavbarFilterData };
