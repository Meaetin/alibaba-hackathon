"use client";

import { useCallback } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { QuotaType } from "@/lib/domain-types";

/**
 * The single place a "you've hit your plan limit" message is produced.
 *
 * This copy used to be duplicated across seven call sites (three itinerary
 * catch blocks, three pre-emptive client gates, and the link submission path),
 * which meant the upgrade CTA had to be added in seven places and could drift
 * in six. Everything routes through here instead.
 */

export function useQuotaGate() {
  const { showToast } = useToast();

  const showQuotaToast = useCallback(
    (type: QuotaType, limit: number) => {
      showToast({
        variant: "error",
        title:
          type === "itinerary"
            ? "You've reached your itinerary limit"
            : "You've used all your links this month",
        description:
          type === "itinerary"
            ? `Your plan includes ${limit} itineraries. Delete one, or upgrade for more.`
            : `Your plan includes ${limit} links a month. Upgrade for more, or wait for your monthly reset.`,
        action: { label: "View plans", href: "/billing" },
      });
    },
    [showToast],
  );

  return { showQuotaToast };
}
