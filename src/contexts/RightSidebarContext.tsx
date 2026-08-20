"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useBreakpoint } from "@/hooks/useMediaQuery";

interface RightSidebarContextValue {
  rightSidebar: ReactNode | null;
  setRightSidebar: (sidebar: ReactNode | null) => void;
  /** How the sidebar is mounted at the current viewport: inline column (lg+) or overlay Sheet (below lg). */
  presentation: "inline" | "overlay";
}

const RightSidebarContext = createContext<RightSidebarContextValue | undefined>(
  undefined
);

export function useRightSidebar() {
  const context = useContext(RightSidebarContext);
  if (!context) {
    // Return no-op context if not in provider (pages without sidebar)
    return {
      rightSidebar: null,
      setRightSidebar: () => {},
      presentation: "overlay" as const,
    };
  }
  return context;
}

interface RightSidebarProviderProps {
  children: ReactNode;
}

export function RightSidebarProvider({ children }: RightSidebarProviderProps) {
  const [rightSidebar, setRightSidebar] = useState<ReactNode | null>(null);
  const { isDesktop } = useBreakpoint();
  const presentation = isDesktop ? "inline" : "overlay";

  return (
    <RightSidebarContext.Provider
      value={{ rightSidebar, setRightSidebar, presentation }}
    >
      {children}
    </RightSidebarContext.Provider>
  );
}
