"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ToastVariant = "default" | "success" | "error";

export interface ToastConfig {
  title: string;
  description?: string;
  variant?: ToastVariant;
  thumbnail?: string;
  action?: { label: string; href: string };
  duration?: number;
}

interface Toast extends ToastConfig {
  id: string;
  duration: number;
}

interface ToastContextValue {
  showToast: (config: ToastConfig) => void;
  removeToast: (id: string) => void;
  pauseToast: (id: string) => void;
  resumeToast: (id: string) => void;
  toasts: Toast[];
  pausedToasts: Set<string>;
  getRemainingTime: (id: string) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pausedToasts, setPausedToasts] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startTimes = useRef<Map<string, number>>(new Map());
  const remainingTimes = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      clearTimer(id);
      startTimes.current.delete(id);
      remainingTimes.current.delete(id);
      setPausedToasts((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer]
  );

  const startTimer = useCallback(
    (id: string, duration: number) => {
      clearTimer(id);
      startTimes.current.set(id, Date.now());
      remainingTimes.current.set(id, duration);
      const timer = setTimeout(() => removeToast(id), duration);
      timers.current.set(id, timer);
    },
    [clearTimer, removeToast]
  );

  const showToast = useCallback(
    (config: ToastConfig) => {
      const id = crypto.randomUUID();
      const duration = config.duration ?? DEFAULT_DURATION;
      setToasts((prev) => [...prev, { ...config, id, duration }]);
      startTimer(id, duration);
    },
    [startTimer]
  );

  const pauseToast = useCallback(
    (id: string) => {
      const start = startTimes.current.get(id);
      const remaining = remainingTimes.current.get(id);
      if (start == null || remaining == null) return;

      const elapsed = Date.now() - start;
      remainingTimes.current.set(id, Math.max(0, remaining - elapsed));
      clearTimer(id);
      setPausedToasts((prev) => new Set(prev).add(id));
    },
    [clearTimer]
  );

  const resumeToast = useCallback(
    (id: string) => {
      const remaining = remainingTimes.current.get(id);
      if (remaining != null && remaining > 0) {
        startTimer(id, remaining);
      }
      setPausedToasts((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [startTimer]
  );

  const getRemainingTime = useCallback((id: string) => {
    return remainingTimes.current.get(id) ?? 0;
  }, []);

  return (
    <ToastContext.Provider
      value={{
        showToast,
        removeToast,
        pauseToast,
        resumeToast,
        toasts,
        pausedToasts,
        getRemainingTime,
      }}
    >
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
