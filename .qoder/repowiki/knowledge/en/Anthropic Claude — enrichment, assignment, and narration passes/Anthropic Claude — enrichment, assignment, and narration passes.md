---
kind: external_dependency
name: Anthropic Claude — enrichment, assignment, and narration passes
slug: anthropic-claude
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
    - framework_behavior
scope:
    - '**'
source_files:
    - docs/personalization-pipeline.md
    - docs/implementation-plan.md
---

### Identity + role
The personalization pipeline uses Anthropic's Claude (default model `claude-opus-5`) in three distinct roles, each with its own contract:

1. **Enrichment (Stage 7 / Step 12)** — batches API (`client.messages.batches.create`) runs one-time, cached tag/description/signature-dish extraction over ~60 candidates. Results keyed by `custom_id` (= `place_id`) because batch responses arrive unordered. Runs at `output_config: { effort: 'low' }`.
3. **Narration (Pass C / Step 14)** — ~15 parallel calls, one per scheduled stop, generating `whyForYou`, highlights, food recommendations, tips. Uses `cache_control: { type: 'ephemeral' }` breakpoints so shared system prompt/profile slice is cached across calls.

### Stable integration pattern
- Pass C failures are non-fatal: `Promise.allSettled` ensures one failing narration call does not kill the itinerary; fallback is cached enrichment description plus match reasons.
- Food recommendations are grounded: dishes must come from the enrichment-provided `signature_dishes` list, never invented.

### SDK real API notes
- Enrichment uses the Batches endpoint; results are keyed by `custom_id`, not array position.
- Pass B uses structured output parsing (`zodOutputFormat`).
- Pass C uses message blocks with ephemeral cache breakpoints; the breakpoint must be placed on the last shared block with per-stop content strictly after it.