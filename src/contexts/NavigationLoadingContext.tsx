"use client";

import { createContext, useCallback, useContext, useState } from "react";

interface NavigationLoadingConfig {
  title?: string;
  subtitle?: string;
}

interface NavigationLoadingContextValue {
  isLoading: boolean;
  title: string | undefined;
  subtitle: string | undefined;
  startLoading: (config?: NavigationLoadingConfig) => void;
  stopLoading: () => void;
}

const NavigationLoadingContext = createContext<NavigationLoadingContextValue | null>(null);

export function NavigationLoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(false);
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [subtitle, setSubtitle] = useState<string | undefined>(undefined);

  const startLoading = useCallback((config?: NavigationLoadingConfig) => {
    setTitle(config?.title);
    setSubtitle(config?.subtitle);
    setIsLoading(true);
  }, []);

  const stopLoading = useCallback(() => {
    setIsLoading(false);
  }, []);

  return (
    <NavigationLoadingContext.Provider
      value={{ isLoading, title, subtitle, startLoading, stopLoading }}
    >
      {children}
    </NavigationLoadingContext.Provider>
  );
}

export function useNavigationLoading(): NavigationLoadingContextValue {
  const ctx = useContext(NavigationLoadingContext);
  if (!ctx) throw new Error("useNavigationLoading must be used within NavigationLoadingProvider");
  return ctx;
}
