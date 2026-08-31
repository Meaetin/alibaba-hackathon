"use client";

import { Button } from "@/components/ui/primitives/Button";
import {
  ARCHETYPE_ILLUSTRATIONS,
  INTRO_ILLUSTRATION,
} from "@/lib/persona/illustrations";
import type { PersonaResult } from "@/lib/persona/types";
import { cn } from "@/lib/utils";

interface PersonaCardProps {
  persona?: PersonaResult | null;
  onAction?: () => void;
  className?: string;
  isLoading?: boolean;
}

/** Home action card for taking the quiz or reopening a saved persona result. */
function PersonaCard({
  persona,
  onAction,
  className,
  isLoading = false,
}: PersonaCardProps) {
  return (
    <div
      className={cn(
        "persona-card flex flex-col items-center justify-between rounded-2xl border border-edge bg-surface p-3 shadow-default",
        className,
      )}
      aria-busy={isLoading || undefined}
      data-name="persona-card"
    >
      {/* Persona Card Content */}
      <div
        className={cn(
          "persona-card-content flex w-full flex-1 flex-col items-center gap-3 pb-3",
        )}
        data-region="home-persona-card-content"
      >
        {isLoading ? (
          <>
            <div className={cn("aspect-video w-full animate-pulse rounded-xl bg-surface-muted")} />
            <div className={cn("flex w-full flex-col items-center gap-2")}>
              <div className={cn("h-4 w-28 animate-pulse rounded-full bg-surface-muted")} />
              <div className={cn("h-3 w-40 animate-pulse rounded-full bg-surface-muted")} />
            </div>
          </>
        ) : persona ? (
          <>
            <div
              className={cn(
                "persona-card-artwork w-full overflow-hidden rounded-xl border border-edge-subtle bg-surface-alt",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ARCHETYPE_ILLUSTRATIONS[persona.archetype.id]}
                alt={persona.archetype.name}
                className={cn("block h-auto w-full")}
                draggable="false"
              />
            </div>
            <div className={cn("flex flex-col items-center gap-1 text-center")}>
              <h3 className={cn("type-body-2 type-secondary font-semibold text-content")}>
                {persona.archetype.name}
              </h3>
              <p className={cn("line-clamp-2 type-body-3 text-content-placeholder")}>
                {persona.archetype.tagline}
              </p>
            </div>
          </>
        ) : (
          <>
            <div
              className={cn(
                "persona-card-sticker relative flex size-[80px] items-end justify-center drop-shadow-sm",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={INTRO_ILLUSTRATION.owl}
                alt=""
                aria-hidden="true"
                className={cn("size-full object-contain")}
                draggable="false"
              />
            </div>
            <div className={cn("flex flex-col items-center gap-2 text-center")}>
              <h3 className={cn("type-body-2 type-secondary font-semibold text-content")}>
                Find Your Travel Persona
              </h3>
              <p className={cn("type-body-3 text-content-placeholder")}>
                Take a quick quiz to discover how you like to travel
              </p>
            </div>
          </>
        )}
      </div>

      {/* Persona Card Action */}
      <Button
        variant="primary"
        size="sm"
        className={cn("persona-card-button w-full")}
        onClick={onAction}
        disabled={isLoading}
      >
        {persona ? "View Full Details" : "Take Persona Quiz"}
      </Button>
    </div>
  );
}

export { PersonaCard };
export type { PersonaCardProps };
