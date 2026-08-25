/**
 * `/itineraries/[id]/debug` — why does this trip look like this?
 *
 * A **server component**, and the only page in the app that is one. Everything
 * it renders already sits on a row in Postgres, so there is nothing to fetch on
 * the client: no TanStack query, no loading skeleton, no `"use client"`. That
 * also keeps it off the seam described in AGENTS.md — `src/lib/api/**` and
 * `src/lib/supabase/**` are for the ported UI, and this reads the planner's own
 * storage directly through `src/lib/db/diagnostics.ts`.
 *
 * It sits under `itineraries/[id]/` so the URL is the trip's URL plus
 * `/debug`, and so it inherits the navbar from the layout above — which is a
 * client component, and works fine as a parent: Next renders this on the server
 * and passes the result down as children.
 *
 * ## It is not linked from anywhere, on purpose
 *
 * You reach it by typing the URL. Auth was removed from this app, so a visible
 * link would put every place id, every score and every model rationale one
 * click from the itinerary page. Type the URL, or add a link behind a flag when
 * there is something to hide it behind.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PlannerDebugView } from "@/components/ui/debug/PlannerDebugView";
import { getDb } from "@/lib/db/client";
import { readPlanDiagnostics } from "@/lib/db/diagnostics";

/** A long-lived Node process holding a Postgres connection. Never static. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Planner diagnostics" };

export default async function ItineraryDebugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let diagnostics;
  try {
    diagnostics = await readPlanDiagnostics(getDb(), id);
  } catch (error) {
    // The technical detail stays in the log. This page has no user to protect,
    // but a Next error overlay for "DATABASE_URL is not set" is a worse answer
    // than a sentence naming the one thing that is actually wrong.
    console.error(`[/itineraries/${id}/debug] could not read the diagnostics`, error);
    return (
      <Unavailable
        detail="The planner database could not be reached. Check DATABASE_URL and that migrations are applied."
        itineraryId={id}
      />
    );
  }

  // An id that names nothing — including one that is not a uuid — is a 404.
  if (!diagnostics) notFound();

  return (
    <div className="planner-debug-route min-h-full bg-surface-alt">
      {/* Back Link */}
      <div
        data-region="itinerary-debug-back"
        className="planner-debug-back mx-auto w-full max-w-4xl px-6 pt-6"
      >
        <Link
          href={`/itineraries/${id}`}
          className="type-body-3 inline-flex items-center gap-1.5 text-content-secondary hover:text-content"
        >
          <ArrowLeft className="size-4 text-glyph-secondary" aria-hidden />
          Back to the itinerary
        </Link>
      </div>

      <PlannerDebugView diagnostics={diagnostics} />
    </div>
  );
}

function Unavailable({ detail, itineraryId }: { detail: string; itineraryId: string }) {
  return (
    <div
      data-region="itinerary-debug-unavailable"
      className="planner-debug-unavailable mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 py-10"
    >
      <h1 className="type-h3 text-content">Diagnostics unavailable</h1>
      <p className="type-body-2 text-content-secondary">{detail}</p>
      <Link
        href={`/itineraries/${itineraryId}`}
        className="type-body-3 text-content-brand hover:underline"
      >
        Back to the itinerary
      </Link>
    </div>
  );
}
