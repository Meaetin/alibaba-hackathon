- PRICE_FIT_NEUTRAL is still 0.5, which now docks any place Google didn't price — most temples and parks — relative to a ¥¥ café scoring 1.0. It's within the plan's spec so I left it, but it's the same class of problem as the bug I fixed. One line plus a snapshot update if you want it at ~0.8.

- The days are lopsided: 19 candidates for day 1, 5 for day 5. Fine for Pass B now; revisit when pack.ts lands.

- Cluster labels are blank
  - The planner groups places into neighborhoods, and each group has an empty name tag. Nothing in the code knows that a cluster of coordinates around Kyoto is called "Arashiyama" — it only knows latitude and longitude. So unless something fills that tag in, the trip screen says "Day 2: Cluster 3" instead of "Day 2: Arashiyama". Someone has to either ask Google what that area is called, or ask the AI to name it. Just don't discover this at demo time.

- The AI could hand us a zero-minute visit
  - Later on, an AI pass estimates "this temple takes 40–60 minutes." The code takes that estimate on faith. If the AI ever returns something silly — "0 to 0 minutes", or the numbers backwards like "120 to 30" — the scheduler will happily book a visit that lasts no time at all, or one whose minimum is bigger than its maximum. It hasn't happened because that AI pass isn't built yet. Add a sanity check when it is.
  
- The funnel answers "what got cut, and why." It returns the shortlist three ways: flat, grouped by cluster (Pass B assigns one cluster per day and can'tre-derive membership from a flat list), and dropped with a stage and a reasonper casualty. Adding a cut means adding a stage, a stat, and a drop reason — acut that only shrinks a list is a silent bug.

- The restaurant quota is denominated in the cap, not the output. In a thincity the shortlist tips past 40% restaurants rather than shrink; 34 candidatesfor Pass B beats 16. It reads like a bug, so it's pinned by a test and recordedin docs/decisions.md.

- Invariants 1–4 describe a packed day, so they arrive with pack.ts rather than being stubbed. An invariant that passes because it checks nothing is worse than no invariant.

- PlaceCluster.label stays undefined — nothing in the deterministic core knows a neighborhood name. Noted at Step 13, which decides Pass B vs reverse-geocode. resolveVisitDuration trusts avgVisitMinutes from enrichment unvalidated. Noted at Step 12; a model-authored range is untrusted input.

Concerns
Gate A earned its keep twice. Both bugs passed every unit test. The first: durationBias was decoration — I grew every pace to max, so relaxed and balanced produced identical durations and "packed" gave a 150-minute Fushimi Inari. The second: soft-clamping non-meal roles to their window open made a thin day 27% activity and 73% dead air, holding Ryoan-ji until 20:00 and billing three hours of "free break". Both are fixed; both are the class of bug that only a whole-trip test finds.
Role labels can now read wrong on a thin day. With the wait bounded at 60 minutes, a segment can say evening_activity at 12:20. I judged dead air the worse failure, but if the UI renders the role to users this needs either a post-pack relabel or a role-aware renderer. Not pinned by any test — reverse it freely.
A 113-minute ramen lunch shows up on day 1. That's duration.ts's SPREAD.max = 1.5 on a 75-minute restaurant default, not the packer — but it's the kind of thing worth a look before demo.
Cafe breaks will be rare in production. Growth consumes idle before the 15:30–17:00 window can claim it, and the window is narrow. It fires on days 1, 2 and 5 of the Kyoto fixture and won't on tighter ones.
The travel provider is called hundreds of times per day by the fit search. It must be memoized and must never reach the network per call — documented on TravelLegProvider, but it's a live foot-gun for whoever wires Routes in.
Two of the five Kyoto clusters hold no restaurant at all, so those days get no meal. That's the funnel's per-cluster composition, not the packer — but the real Pass B will hit the same wall, and Step 8's repair path is where it should be answered.


Concerns
The assumption is doing real work, not hypothetical work. 1 of 20 probe places (MacRitchie Nature Trail) has no periods. For a trail that's genuinely correct; for a museum whose hours failed to return, it's an unverified stop reported as fine. Watch this ratio when real city retrieval lands — 5% is tolerable, 30% would mean invariant 3 is mostly decorative.
hasKnownHours counts unusable periods as no periods. A zero-length or malformed-only period means we know exactly as much as if the field were missing, so reporting it as "known" would defeat the flag's only purpose. This is stricter than "the array is non-empty" and is deliberate.
A zero-length period is dropped, not read as a wrap. close === open would otherwise become a 168-hour window under the wrap rule — the single worst failure mode available here, since it silently makes a place always-open.
I validate periods at the boundary (day 0–6, hour 0–24, minute 0–59) rather than trusting them. Normally I'd skip defensive checks, but this is external API data, and a day: 9 would land as a plausible-looking span in the middle of next week rather than failing loudly.
Nothing populates openingPeriods yet. The type and the arithmetic exist; retrieval (Step 10) has to fill it. Until then hours.ts is correct and unused — every place looks like the missing-hours case.
Next
The remaining blocker for invariant 3 is item 3 from my earlier answer, unchanged: a packed day doesn't know its weekday. start_date sits on GenerateItineraryParams in src/lib/api/itineraries.ts and stops at the API seam. Threading day N → weekday into the planner touches the same boundary Steps 9 and 15 depend on, which is why it's worth deciding rather than improvising — happy to sketch it when you want to start Step 8.

- Migrations were applied to the Neon **production** branch of project
  `hackathon` (`curly-union-42502230`), not a scratch branch — that's what
  `neon env pull` wired up. The integration tests namespace their rows with
  `itest-step9` and delete them, but if that project ever holds real data,
  point `DATABASE_URL` at a child branch before running `npm run test:db`.

- Rows written to `locations.price_range` **before** today are Google's nested
  shape if any came from the planner path, and flat if they came from the
  browser path. `toPriceRange` is idempotent so new writes converge, but nothing
  backfills what's already there. There is no such data yet — the table was
  created today — so this only matters if an older dump gets loaded.

- neon-http has no interactive transactions. Fine for the two retrieval ports,
  which are single statements. The itinerary write path is not single-statement
  — itinerary → days → activities — and will either need `neon-serverless`
  (WebSocket) or a deliberate decision to write it non-atomically and repair.

- `formatMinutes` exists but nothing calls it yet. It's the read handler's
  conversion and the read handler isn't built, so the "HH:MM" contract with the
  card components is asserted only against my reading of them.

- Nothing wires the blob store into a production path, because there is no
  production path yet. `s3ConfigFromEnv`, `getDb`, `retrievePlaces` and
  `resolvePhotos` have **no callers outside tests** — no route handler, no job
  runner; that arrives with Pass B and the queue. Until then the bucket is
  proven but idle, and the first thing that composes `PhotoDeps` must remember
  to pass `blobs` or it silently re-bills Google forever. Worth a single factory
  that assembles all the ports from env, so no call site hand-rolls it.

- The bucket has to be publicly readable. `createPhotoBlobStore` returns
  `publicBaseUrl + key` and issues no signed URLs, because the URL is persisted
  into `locations.photo_urls` and rendered from an `<img src>` weeks later — a
  presigned URL would expire, which is the exact problem the store exists to
  fix. If the photos must be private, that needs a signing route handler, not a
  change to this store.

- Nothing evicts from the bucket. Keys are content-addressed by Google photo
  resource name, so they never collide and never go stale, but a place whose
  photo Google later replaces keeps serving the old image forever, and objects
  for itineraries nobody kept are never reclaimed.

Nothing wires the blob store into a production path yet — because there is no production path. s3ConfigFromEnv, getDb, retrievePlaces and resolvePhotos have zero callers outside tests: no route handler, no job runner. So the bucket is proven but idle, and no photo is being cached today. That's expected — the orchestrator arrives with Pass B and the queue — but I don't want you reading "it works" as "photos are now cached."

The follow-on risk: whoever first constructs PhotoDeps has to remember to pass blobs, and forgetting is invisible — the itinerary looks identical and just re-bills the Photos SKU forever. Same shape of trap for RetrievalDeps.cache.

Next
A single createPlannerPorts(env) factory that assembles cache, store, blobs and apiKey from the environment, so no call site hand-rolls the deps and "forgot the cache" stops being expressible. ~50 lines. I'd hold it until Pass B defines what a plan run looks like, unless you want it now as the seam to build against.

Deferred from the Singapore Gate A review (2026-08-24) — revisit after later steps land, since each may get easier or moot once its owning step exists:
- Zoo/type-heuristic gaps in duration.ts (Step 6 rung 3): leave to Step 12 enrichment (avgVisitMinutes) rather than hand-adding types one at a time.
- Cafe-hopping / per-day variety: leave to Pass B (Step 13) — it's a vibe decision, not a funnel quota.
- Same-bucket repair rule (validate.ts:347, restaurant may not fill a plain activity slot): correct for Kyoto (temple vs. dinner rush), untested against a hawker-centre city where breakfast-at-a-food-centre is normal. Don't rework blind — revisit once Pass B exists and there's a real assignment to observe, not just the assignDay stand-in.
- Cross-cluster fallback in validate's alternate queue: user vetoed — risks pulling in far-away swaps, more travel, possible near-duplicates. Not doing this.
- clusterPlaces on a dense-core city (2 of 4 Singapore days starved of food): the fix isn't blunt outlier-dropping — the user's read is that the real problem is Pass B/clustering not reasoning about "what makes a good day together," and that's a rework of the assignment step, not a quick geometric patch. Revisit once Step 13 (Pass B) exists — a smarter assignment pass may need less of a clustering fix than a distance-threshold band-aid would.
