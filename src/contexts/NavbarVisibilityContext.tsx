"use client";

import { createContext, useContext, type ReactNode } from "react";

interface NavbarVisibilityContextValue {
  setNavbarHidden: (hidden: boolean) => void;
}

const NavbarVisibilityContext = createContext<NavbarVisibilityContextValue | null>(null);

export function NavbarVisibilityProvider({
  setNavbarHidden,
  children,
}: {
  setNavbarHidden: (hidden: boolean) => void;
  children: ReactNode;
}) {
  return (
    <NavbarVisibilityContext.Provider value={{ setNavbarHidden }}>
      {children}
    </NavbarVisibilityContext.Provider>
  );
}

export function useNavbarVisibility() {
  return useContext(NavbarVisibilityContext);
}
