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
 * ## It is owner-only, and still not linked from anywhere
 *
 * It renders every place id, every score and every model rationale for a trip,
 * so it is gated exactly as `GET /api/itineraries/[id]` is: sign in, and own
 * the trip, or get a 404. Somebody else's is a 404 rather than a 403 for the
 * same reason it is there — a 403 confirms the id names something real.
 *
 * This is the one place in the app that reads the cookie through `next/headers`
 * rather than off a `Request`. There is no `Request` in a server component, and
 * the reason the route handlers avoid it — staying drivable from a plain
 * `Request` in a test — does not apply to a page with no handler test.
 *
 * You still reach it by typing the URL. The gate makes it safe to link; nothing
 * links it yet.
 */

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { PlannerDebugView } from "@/components/ui/debug/PlannerDebugView";
import { getDb } from "@/lib/db/client";
import { readPlanDiagnostics } from "@/lib/db/diagnostics";
import { readItineraryOwner } from "@/lib/db/itineraries";
import { createUserStore } from "@/lib/db/users";

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

  // Read first, decide after. `notFound()` signals by throwing a Next
  // control-flow error, so calling it inside the `catch` below would have a
  // trip that simply isn't yours render as "the database is unavailable".
  let read: Awaited<ReturnType<typeof readOwnedDiagnostics>>;
  try {
    read = await readOwnedDiagnostics(id);
  } catch (error) {
    // The technical detail stays in the log. A Next error overlay for
    // "DATABASE_URL is not set" is a worse answer than a sentence naming the
    // one thing that is actually wrong.
    console.error(`[/itineraries/${id}/debug] could not read the diagnostics`, error);
    return (
      <Unavailable
        detail="The planner database could not be reached. Check DATABASE_URL and that migrations are applied."
        itineraryId={id}
      />
    );
  }

  // An id that names nothing, one that is not a uuid, one that belongs to
  // somebody else, and a visitor who is not signed in: all 404.
  if (!read) notFound();
  const diagnostics = read;

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

/**
 * The diagnostics for a trip, but only for the person who owns it. Returns
 * `null` for every way of not being allowed to see it — signed out, not the
 * owner, no such trip — because the page renders all four the same way, and a
 * function that distinguished them would invite a caller to leak the
 * difference. Throws only when the database itself is unreachable.
 */
async function readOwnedDiagnostics(id: string) {
  const db = getDb();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const user = await createUserStore(db).userForToken(token, new Date());
  if (!user) return null;

  const owner = await readItineraryOwner(db, id);
  if (!owner || owner.userId !== user.id) return null;

  return (await readPlanDiagnostics(db, id)) ?? null;
}
