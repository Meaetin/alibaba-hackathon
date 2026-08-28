/**
 * What a plan cost in model spend.
 *
 * **Token counts are stored; dollars are computed at render.** List prices
 * change and a stored dollar figure silently becomes a lie about a run nobody
 * can re-measure — the tokens are the fact, the price is an interpretation of
 * it. So `jobs.result.stats.cost` holds `StageUsage` per stage and this module
 * turns it into money whenever somebody looks, which also means correcting a
 * rate re-prices every historical run for free.
 *
 * **A model with no rate on file costs `null`, never zero.** Switching
 * `MODELS.narrate` to something not listed below must make the debug page say
 * "no price on file", because a run that silently reports $0.00 is worse than
 * one that reports nothing: the first is a number somebody will trust.
 */

/** Dollars per million tokens. */
interface Rate {
  input: number;
  /** The discounted rate for the cached portion of the input — 10% of `input`
   *  on every model here, but written out rather than derived, because that
   *  ratio is a fact about today's price list and not a law. */
  cachedInput: number;
  output: number;
}

/**
 * Checked against OpenAI's published pricing on this date. Anything stale is a
 * wrong number rendered confidently, so the date ships next to the figure on
 * the debug page rather than living only in a comment.
 */
export const PRICES_AS_OF = "2026-08-26";

const RATES: Record<string, Rate> = {
  "gpt-5.6-sol": { input: 4.0, cachedInput: 0.4, output: 20.0 },
  "gpt-5.6-terra": { input: 2.0, cachedInput: 0.2, output: 12.0 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

/** The Batch API's discount on every rate. */
export const BATCH_DISCOUNT = 0.5;

/** One stage's model spend. Additive across calls — `narrate` is two dozen. */
export interface StageUsage {
  /** Which pass this was: `assign`, `theme`, `narrate`, `enrich`. Named
   *  separately from `model` because two stages share one — Pass B and the
   *  theme call both run on `MODELS.assign`, and "the expensive model cost
   *  $0.04" is a useless answer when the question is which of them spent it. */
  stage: string;
  model: string;
  calls: number;
  /** Total prompt tokens, **including** the cached portion below. */
  inputTokens: number;
  /** The part of `inputTokens` that hit the prompt cache and bills at
   *  `cachedInput`. Zero across a whole fan-out means the shared prefix is not
   *  actually shared — see `buildSharedPrefix`. */
  cachedInputTokens: number;
  outputTokens: number;
  /** Batch API requests bill at half. Enrichment is the only one today. */
  batch?: boolean;
}

export interface StageCost extends StageUsage {
  /** Dollars, or null when no rate is on file for `model`. */
  usd: number | null;
}

export interface PlanCostSummary {
  stages: StageCost[];
  /** Sum of the stages that could be priced. */
  usd: number;
  /** Stages whose model has no rate, so `usd` understates the true total. */
  unpriced: string[];
}

/** An empty tally to accumulate into. */
export function emptyStageUsage(stage: string, model: string, batch = false): StageUsage {
  return {
    stage,
    model,
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    ...(batch ? { batch: true } : {}),
  };
}

/**
 * Folds one API response's usage into a running tally.
 *
 * `cached_tokens` is a **subset** of `input_tokens`, not an extra — billing
 * charges the uncached remainder at full rate and the cached part at the
 * discount. Clamped here so a provider that ever reports otherwise produces a
 * slightly wrong number rather than a negative one.
 */
export function addUsage(
  tally: StageUsage,
  usage:
    | { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } }
    | undefined,
): StageUsage {
  const input = usage?.input_tokens ?? 0;
  const cached = Math.min(input, usage?.input_tokens_details?.cached_tokens ?? 0);
  return {
    ...tally,
    calls: tally.calls + 1,
    inputTokens: tally.inputTokens + input,
    cachedInputTokens: tally.cachedInputTokens + cached,
    outputTokens: tally.outputTokens + (usage?.output_tokens ?? 0),
  };
}

/** Dollars for one stage, or null when the model has no rate on file. */
export function costOf(usage: StageUsage): number | null {
  const rate = RATES[usage.model];
  if (!rate) return null;
  const discount = usage.batch ? BATCH_DISCOUNT : 1;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const dollars =
    (uncached * rate.input + usage.cachedInputTokens * rate.cachedInput + usage.outputTokens * rate.output) /
    1_000_000;
  return dollars * discount;
}

/** Prices every stage and says which ones it could not. */
export function summarizeCost(stages: readonly StageUsage[]): PlanCostSummary {
  const priced = stages.map((stage) => ({ ...stage, usd: costOf(stage) }));
  return {
    stages: priced,
    usd: priced.reduce((total, stage) => total + (stage.usd ?? 0), 0),
    unpriced: [...new Set(priced.filter((entry) => entry.usd === null).map((e) => e.model))],
  };
}

/**
 * Money, at the precision it is actually worth reading.
 *
 * A plan costs cents, so two decimal places would round most stages to $0.00
 * and make the expensive one look like the only one that ran. Four places past
 * the point is where a per-stage figure stops lying.
 */
export function formatUsd(dollars: number): string {
  if (dollars === 0) return "$0";
  if (dollars < 0.0001) return "<$0.0001";
  return `$${dollars.toFixed(4)}`;
}
