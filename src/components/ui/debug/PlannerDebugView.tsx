/**
 * The planner's diagnostic record, rendered.
 *
 * This answers one question in six sections: **why does this trip look like
 * this?** Reading top to bottom you get the funnel's cuts, the stages' counts,
 * the days as they were built with Pass B's own sentence under each stop, the
 * ids it named that we refused, the cards that fell back to a template, and the
 * places that had no enrichment to draw on.
 *
 * It is a server component on purpose. Every value it renders is already on a
 * row in Postgres, so there is nothing to fetch on the client, nothing to poll
 * and no loading state to design — and no reason to ship the shapes of our
 * diagnostics to a browser bundle.
 *
 * It is also deliberately plain. A debug view that needs its own design system
 * stops being maintained; this is tokens, tables and monospace ids. The one
 * rule it does keep is the repo's: no hardcoded colors, only the semantic
 * tokens, because a page that quietly invents its own greys is how a palette
 * gets forked.
 */

import { AlertTriangle, Check, Info } from "lucide-react";

import type { PlanDiagnostics } from "@/lib/db/diagnostics";
import {
  PRICES_AS_OF,
  formatUsd,
  summarizeCost,
  type PlanCostSummary,
  type StageUsage,
} from "@/lib/planner/pricing";
import { hhmm } from "@/lib/planner/validate";
import { formatDuration } from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";

interface PlannerDebugViewProps {
  diagnostics: PlanDiagnostics;
}

export function PlannerDebugView({ diagnostics }: PlannerDebugViewProps) {
  const { itinerary, days, debug, funnelStats, job } = diagnostics;

  // Pass B's sentences arrive as a flat list; every day section wants only its
  // own, and every stop wants only its own line. Indexed once, here.
  const rationale = new Map(
    (debug?.assignment.rationale ?? []).map((entry) => [
      `${entry.dayIndex}:${entry.placeId}`,
      entry,
    ]),
  );
  // `job.stats` is `unknown` by design — `diagnostics.ts` passes the blob
  // through rather than re-declaring the pipeline's stats shape one table over.
  // So the cost array is narrowed here, and a plan from before it existed reads
  // as "not recorded" rather than as a run that made no calls.
  const cost = costFrom(job?.stats);

  const fallbackDays = new Set(debug?.assignment.fallbackDays ?? []);
  const narrationFallbacks = new Map(
    (debug?.narration.fallbacks ?? []).map((entry) => [entry.placeId, entry.message]),
  );

  return (
    <div
      data-region="itinerary-debug-page"
      className="planner-debug-page mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10"
    >
      {/* Header */}
      <header data-region="itinerary-debug-header" className="planner-debug-header flex flex-col gap-2">
        <p className="type-body-3 text-content-tertiary">Planner diagnostics</p>
        <h1 className="type-h2 text-content">{itinerary.name}</h1>
        <p className="type-body-2 text-content-secondary">
          {[itinerary.city, itinerary.country].filter(Boolean).join(", ")} ·{" "}
          {itinerary.totalDays} {itinerary.totalDays === 1 ? "day" : "days"} from{" "}
          {itinerary.startDate} · planned {itinerary.createdAt.toISOString().slice(0, 16)}Z
        </p>
        <div className="planner-debug-profile flex flex-wrap gap-1.5 pt-1">
          <Chip label={`pace: ${itinerary.profile.pace}`} />
          {itinerary.profile.budget !== undefined && (
            <Chip label={`budget: ${"$".repeat(itinerary.profile.budget)}`} />
          )}
          {itinerary.profile.interests.map((interest) => (
            <Chip key={interest} label={interest} />
          ))}
          {itinerary.profile.dietary.map((need) => (
            <Chip key={need} label={need} tone="warning" />
          ))}
        </div>
      </header>

      {debug === null && (
        <Callout
          tone="info"
          title="No diagnostic record on this itinerary"
          body="It was planned before `itineraries.planner_debug` existed, so Pass B's reasoning and its refused ids were never stored. Everything below comes from the columns that did exist. Replan the trip to get the rest."
        />
      )}

      {job?.status === "failed" && (
        <Callout
          tone="error"
          title="The job that produced this failed"
          body={job.error ?? "No error was recorded on the job row."}
        />
      )}

      {/* The Themes */}
      {debug?.themes && (
        <Section
          region="itinerary-debug-themes"
          title="What each day was about"
          note="Themed runs only. A day with no premise fell back to geography, and the reason is here rather than in a log line."
        >
          {debug.themes.titles.length === 0 ? (
            <Empty>No day kept its theme — every one fell back to geography.</Empty>
          ) : (
            <table className="planner-debug-theme-table w-full text-left">
              <thead>
                <tr>
                  <Th>Day</Th>
                  <Th>Title</Th>
                  <Th>Anchor</Th>
                </tr>
              </thead>
              <tbody>
                {debug.themes.titles.map((theme) => (
                  <tr key={theme.dayIndex}>
                    <Td>{theme.dayIndex + 1}</Td>
                    <Td>{theme.title}</Td>
                    <Td mono>{theme.anchorPlaceId}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {debug.themes.fallbacks.length > 0 && (
            <ul className="planner-debug-theme-fallbacks flex flex-col gap-1">
              {debug.themes.fallbacks.map((fallback) => (
                <li key={fallback.dayIndex} className="type-body-3 text-content-secondary">
                  Day {fallback.dayIndex + 1} — {fallback.reason}
                  {fallback.anchorPlaceId ? ` (${fallback.anchorPlaceId})` : ""}
                </li>
              ))}
            </ul>
          )}

          {debug.themes.repairs.length > 0 ? (
            <ul className="planner-debug-theme-repairs flex flex-col gap-1">
              {debug.themes.repairs.map((repair) => (
                <li
                  key={`${repair.dayIndex}:${repair.rung}`}
                  className="type-body-3 text-content-secondary"
                >
                  Day {repair.dayIndex + 1} — {repair.rung}: {repair.reason} (
                  {repair.before} → {repair.after} places to eat)
                </li>
              ))}
            </ul>
          ) : (
            <Ok>No day needed the feasibility ladder.</Ok>
          )}
        </Section>
      )}

      {/* The Funnel */}
      <Section
        region="itinerary-debug-funnel"
        title="The funnel"
        note="Every cut between what Google returned and what Pass B was allowed to choose from."
      >
        {funnelStats ? (
          <FunnelBars stats={funnelStats} />
        ) : (
          <Empty>No funnel stats on this row.</Empty>
        )}
      </Section>

      {/* Model Cost */}
      <Section
        region="itinerary-debug-cost"
        title="Model spend"
        note={`Token counts are what the run recorded; the dollars are today's list prices applied to them, checked ${PRICES_AS_OF}. Enrichment is not here — its batch serves every later trip, so it is billed to the batch row instead.`}
      >
        {cost === null ? (
          <Empty>Not recorded — this plan ran before token usage was tracked.</Empty>
        ) : cost.stages.length === 0 ? (
          <Empty>No model calls were made.</Empty>
        ) : (
          <div className="planner-debug-cost flex flex-col gap-2">
            <div className="overflow-x-auto">
              <table className="planner-debug-cost-table w-full min-w-[34rem] text-left type-body-3">
                <thead className="text-content-tertiary">
                  <tr>
                    <th className="py-1 pr-4 font-normal">Stage</th>
                    <th className="py-1 pr-4 font-normal">Model</th>
                    <th className="py-1 pr-4 text-right font-normal">Calls</th>
                    <th className="py-1 pr-4 text-right font-normal">In</th>
                    <th className="py-1 pr-4 text-right font-normal">Cached</th>
                    <th className="py-1 pr-4 text-right font-normal">Out</th>
                    <th className="py-1 text-right font-normal">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.stages.map((stage) => (
                    <tr key={stage.stage} className="border-t border-edge-subtle text-content-secondary">
                      <td className="py-1 pr-4 font-medium text-content">{stage.stage}</td>
                      <td className="py-1 pr-4 font-mono text-content-tertiary">
                        {stage.model}
                        {stage.batch ? " (batch)" : ""}
                      </td>
                      <td className="py-1 pr-4 text-right">{stage.calls}</td>
                      <td className="py-1 pr-4 text-right">{stage.inputTokens.toLocaleString()}</td>
                      <td className="py-1 pr-4 text-right">
                        {stage.cachedInputTokens.toLocaleString()}
                      </td>
                      <td className="py-1 pr-4 text-right">{stage.outputTokens.toLocaleString()}</td>
                      <td className="py-1 text-right">
                        {stage.usd === null ? (
                          <span className="text-content-error">no price on file</span>
                        ) : (
                          formatUsd(stage.usd)
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-edge text-content">
                    <td className="py-1 pr-4 font-medium" colSpan={6}>
                      Total
                    </td>
                    <td className="py-1 text-right font-medium">{formatUsd(cost.usd)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {cost.unpriced.length > 0 && (
              // The total is a floor, not the answer, and saying so is the whole
              // reason an unpriced model reports null instead of zero.
              <p className="type-body-3 text-content-error">
                No rate on file for {cost.unpriced.join(", ")} — the total above is lower than
                what this run actually cost.
              </p>
            )}
          </div>
        )}
      </Section>

      {/* Stage Counters */}
      <Section
        region="itinerary-debug-stages"
        title="Stage counters"
        note="From `jobs.result.stats` — the per-stage numbers, kept on the job rather than copied here."
      >
        {job?.stats ? (
          <StatTree value={job.stats} />
        ) : (
          <Empty>
            {job
              ? "The job row has no stats — it failed before the pipeline returned."
              : "No job row is left for this itinerary."}
          </Empty>
        )}
      </Section>

      {/* The Days */}
      <Section
        region="itinerary-debug-days"
        title="The days, as built"
        note="Each stop with the score the funnel gave it and the sentence Pass B wrote for it."
      >
        <div className="planner-debug-days flex flex-col gap-6">
          {days.length === 0 && <Empty>This itinerary has no stored days.</Empty>}
          {days.map((day) => (
            <div
              key={day.dayIndex}
              data-region="itinerary-debug-day"
              className="planner-debug-day flex flex-col gap-2 rounded-xl border border-edge-subtle bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="type-h4 text-content">
                  Day {day.dayIndex + 1} · {day.areaName ?? "unnamed area"}
                </h3>
                <span className="type-body-3 text-content-tertiary">{day.date}</span>
                {fallbackDays.has(day.dayIndex) && (
                  <Chip label="ranked fallback filled this day" tone="warning" />
                )}
              </div>

              {day.stops.length === 0 ? (
                <Empty>No stops were stored for this day.</Empty>
              ) : (
                <ol className="planner-debug-stops flex flex-col gap-3">
                  {day.stops.map((stop) => {
                    const why = stop.placeId
                      ? rationale.get(`${day.dayIndex}:${stop.placeId}`)?.why
                      : undefined;
                    const fellBack = stop.placeId
                      ? narrationFallbacks.get(stop.placeId)
                      : undefined;
                    return (
                      <li
                        key={stop.position}
                        data-region="itinerary-debug-stop"
                        className="planner-debug-stop border-l-2 border-edge-muted pl-3"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="type-body-3 font-mono text-content-tertiary">
                            {hhmm(stop.startMin)}–{hhmm(stop.endMin)}
                          </span>
                          <span className="type-body-2 text-content">{stop.name}</span>
                          <Chip label={stop.role} />
                          <span className="type-body-4 text-content-tertiary">
                            {formatDuration(stop.endMin - stop.startMin)}
                            {stop.score !== null && ` · score ${stop.score.toFixed(3)}`}
                            {stop.stayDuration !== null &&
                              ` · stay_duration ${stop.stayDuration}m`}
                          </span>
                        </div>

                        {why && (
                          <p className="type-body-3 pt-1 text-content-secondary">
                            <span className="text-content-tertiary">Pass B: </span>
                            {why}
                          </p>
                        )}
                        {stop.matchReasons.length > 0 && (
                          <p className="type-body-4 pt-0.5 text-content-tertiary">
                            {stop.matchReasons.join(" · ")}
                          </p>
                        )}
                        {fellBack && (
                          <p className="type-body-4 pt-0.5 text-content-warning">
                            narration fell back — {fellBack}
                          </p>
                        )}
                        {stop.placeId === null && (
                          <p className="type-body-4 pt-0.5 text-content-warning">
                            no `locations` row — the stop is real, the join is missing
                          </p>
                        )}
                        {stop.travelToNext && (
                          <p className="type-body-4 pt-0.5 text-content-tertiary">
                            → {stop.travelToNext.minutes}m {stop.travelToNext.mode},{" "}
                            {stop.travelToNext.meters}m away
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Refused Assignments */}
      <Section
        region="itinerary-debug-dropped"
        title="Ids Pass B named that we refused"
        note="A well-formed response can still name a place that was never retrieved. Every rejection is here with its reason."
      >
        {debug === null ? (
          <Empty>Not recorded for this itinerary.</Empty>
        ) : debug.assignment.dropped.length === 0 ? (
          <Ok>Pass B named only ids it was given.</Ok>
        ) : (
          <table className="planner-debug-table w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-edge-subtle">
                <Th>Day</Th>
                <Th>Place id</Th>
                <Th>Reason</Th>
              </tr>
            </thead>
            <tbody>
              {debug.assignment.dropped.map((drop, index) => (
                <tr key={`${drop.placeId}-${index}`} className="border-b border-edge-subtle">
                  <Td>{drop.dayIndex + 1}</Td>
                  <Td mono>{drop.placeId}</Td>
                  <Td>{drop.reason}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Narration */}
      <Section
        region="itinerary-debug-narration"
        title="Narration"
        note="A stop whose call failed ships a card built from cached enrichment. Fifteen failures still return fifteen stops."
      >
        {debug === null ? (
          <Empty>Not recorded for this itinerary.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              <Chip
                label={`${debug.narration.fallbacks.length} fallback${debug.narration.fallbacks.length === 1 ? "" : "s"}`}
                tone={debug.narration.fallbacks.length > 0 ? "warning" : "default"}
              />
              <Chip
                label={`${debug.narration.truncated} cut off at max_output_tokens`}
                tone={debug.narration.truncated > 0 ? "error" : "default"}
              />
              {/* Not a fault: a rejected dish is the grounding rule working. */}
              <Chip label={`${debug.narration.rejectedDishes} ungrounded dishes rejected`} />
            </div>
            {debug.narration.fallbacks.length > 0 && (
              <ul className="flex flex-col gap-1">
                {debug.narration.fallbacks.map((entry) => (
                  <li key={entry.placeId} className="type-body-3 text-content-secondary">
                    <span className="font-mono text-content-tertiary">{entry.placeId}</span> —{" "}
                    {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      {/* Enrichment */}
      <Section
        region="itinerary-debug-enrichment"
        title="Enrichment misses"
        note="A miss means the live fetch before Pass B had no answer for that place, so it ships on the type heuristic in `duration.ts` rather than an estimate of the place itself."
      >
        {debug === null ? (
          <Empty>Not recorded for this itinerary.</Empty>
        ) : debug.enrichment.misses.length === 0 ? (
          <Ok>Every shortlisted place had a fresh cached enrichment.</Ok>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="type-body-3 text-content-secondary">
              {debug.enrichment.misses.length} shortlisted places had no usable enrichment when
              this ran.
            </p>
            <ul className="flex flex-col gap-1">
              {debug.enrichment.misses.map((placeId) => (
                <li key={placeId} className="type-body-3">
                  <span className="font-mono text-content-tertiary">{placeId}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Route Order */}
      <Section
        region="itinerary-debug-sequencing"
        title="Route order"
        note="Pass B orders a day without ever seeing a coordinate. This is what reordering it before the clock was stamped bought, in travel minutes."
      >
        {debug === null || debug.sequencing === undefined ? (
          <Empty>Not recorded — this itinerary was planned before the reorder existed.</Empty>
        ) : debug.sequencing.length === 0 ? (
          <Empty>No days to sequence.</Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {debug.sequencing.map((day) => (
              <li
                key={day.dayIndex}
                className="type-body-3 flex flex-wrap items-baseline gap-2 text-content-secondary"
              >
                <span className="font-medium text-content">Day {day.dayIndex + 1}</span>
                <span>
                  {day.beforeMinutes} → {day.afterMinutes} travel minutes
                </span>
                <span className="text-content-tertiary">{(day.meters / 1000).toFixed(1)} km</span>
                {day.reordered ? (
                  <Chip label={`saved ${day.savedMinutes}m`} />
                ) : (
                  // Not the same claim as "saved 0m". This day's stops were
                  // already in their shortest order.
                  <span className="text-content-tertiary">already shortest</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Footer */}
      <footer className="planner-debug-footer type-body-4 border-t border-edge-subtle pt-4 text-content-tertiary">
        {debug
          ? `planner_debug v${debug.version}, recorded ${debug.recordedAt}`
          : "No planner_debug record."}
        {job && ` · job ${job.id} (${job.status})`}
      </footer>
    </div>
  );
}

// ── the small pieces ─────────────────────────────────────────────────────────

/**
 * Pulls `stats.cost` out of the untyped job blob and prices it.
 *
 * Null for a plan that predates the field. That is not the same answer as an
 * empty stage list, which means the plan ran and made no model calls — and the
 * one page whose job is the truth must not conflate them.
 */
function costFrom(stats: unknown): PlanCostSummary | null {
  const raw = (stats as { cost?: unknown } | null | undefined)?.cost;
  if (!Array.isArray(raw)) return null;
  return summarizeCost(raw as StageUsage[]);
}

function Section({
  region,
  title,
  note,
  children,
}: {
  region: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section data-region={region} className="planner-debug-section flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="type-h3 text-content">{title}</h2>
        <p className="type-body-3 text-content-tertiary">{note}</p>
      </div>
      {children}
    </section>
  );
}

function Chip({ label, tone = "default" }: { label: string; tone?: "default" | "warning" | "error" }) {
  return (
    <span
      className={cn(
        "planner-debug-chip rounded-full px-2 py-0.5 type-body-4",
        tone === "default" && "bg-surface-muted text-content-secondary",
        tone === "warning" && "bg-surface-warning-subtle text-content-warning",
        tone === "error" && "bg-surface-error-subtle text-content-error",
      )}
    >
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="planner-debug-empty type-body-3 rounded-lg border border-dashed border-edge-muted px-3 py-2 text-content-tertiary">
      {children}
    </p>
  );
}

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <p className="planner-debug-ok type-body-3 flex items-center gap-2 text-content-success">
      <Check className="size-4 text-glyph-success" aria-hidden />
      {children}
    </p>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="type-body-4 px-2 py-1.5 font-medium text-content-tertiary">{children}</th>;
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={cn("type-body-3 px-2 py-1.5 text-content-secondary", mono && "font-mono")}>
      {children}
    </td>
  );
}

function Callout({
  tone,
  title,
  body,
}: {
  tone: "info" | "error";
  title: string;
  body: string;
}) {
  const Icon = tone === "error" ? AlertTriangle : Info;
  return (
    <div
      data-region="itinerary-debug-callout"
      className={cn(
        "planner-debug-callout flex gap-3 rounded-xl border p-4",
        tone === "info" && "border-edge-info bg-surface-info-subtle",
        tone === "error" && "border-edge-error bg-surface-error-subtle",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "info" ? "text-glyph-brand" : "text-glyph-error",
        )}
        aria-hidden
      />
      <div className="flex flex-col gap-1">
        <p className="type-body-2 text-content">{title}</p>
        <p className="type-body-3 text-content-secondary">{body}</p>
      </div>
    </div>
  );
}

/**
 * The funnel as four bars, each measured against the widest.
 *
 * A bar rather than four numbers because the shape is the point: a run where
 * the cluster cap does all the cutting looks completely different from one
 * where the hard filters do, and four right-aligned integers hide that.
 */
function FunnelBars({ stats }: { stats: Record<string, number> }) {
  const rows: { label: string; value: number }[] = [
    { label: "retrieved", value: stats.retrieved ?? 0 },
    { label: "after hard filters", value: stats.afterFilters ?? 0 },
    { label: "after cluster cap", value: stats.afterClusterCap ?? 0 },
    { label: "after global cap", value: stats.afterGlobalCap ?? 0 },
  ];
  const widest = Math.max(1, ...rows.map((row) => row.value));

  return (
    <div className="planner-debug-funnel flex flex-col gap-2">
      {rows.map((row, index) => {
        const previous = index === 0 ? undefined : rows[index - 1].value;
        const cut = previous === undefined ? undefined : previous - row.value;
        return (
          <div key={row.label} className="flex items-center gap-3">
            <span className="type-body-3 w-40 shrink-0 text-content-secondary">{row.label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-sm bg-surface-muted">
              <div
                className="h-full rounded-sm bg-surface-brand"
                style={{ width: `${(row.value / widest) * 100}%` }}
              />
            </div>
            <span className="type-body-3 w-24 shrink-0 text-right font-mono text-content">
              {row.value}
              {cut ? <span className="text-content-tertiary"> −{cut}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * `jobs.result.stats` printed as a nested definition list.
 *
 * Rendered generically rather than field by field on purpose: `PlanStats` grows
 * a counter every time a stage learns to count something new, and a view that
 * named each one would silently stop showing the newest — which is always the
 * one you added because you were debugging.
 */
function StatTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || typeof value !== "object") {
    return <span className="font-mono text-content">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="font-mono text-content">
        {value.length === 0 ? "[]" : `[${value.length} items]`}
      </span>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <dl
      className={cn(
        "planner-debug-stats grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-1",
        depth > 0 && "border-l border-edge-subtle pl-3",
      )}
    >
      {entries.map(([key, child]) => {
        const nested = child !== null && typeof child === "object" && !Array.isArray(child);
        return (
          <div key={key} className={cn("contents", nested && "col-span-2")}>
            {nested ? (
              <div className="col-span-2 flex flex-col gap-1 pt-2">
                <dt className="type-body-3 text-content-secondary">{key}</dt>
                <dd>
                  <StatTree value={child} depth={depth + 1} />
                </dd>
              </div>
            ) : (
              <>
                <dt className="type-body-3 text-content-tertiary">{key}</dt>
                <dd className="type-body-3">
                  <StatTree value={child} depth={depth + 1} />
                </dd>
              </>
            )}
          </div>
        );
      })}
    </dl>
  );
}
