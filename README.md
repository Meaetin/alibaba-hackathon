# Argo

Argo turns saved travel content into a trip. Paste a TikTok, Instagram or
YouTube link and it pulls out the places the video actually recommends, resolves
each one against Google Places, and keeps them on a shelf. From there it plans a
day-by-day itinerary: places grouped by geography or by theme, meals seated in
their windows, opening hours respected, travel time between stops accounted for,
and a written reason for every stop.

A twelve-question quiz builds a travel persona, and that persona moves the
knobs the planner uses — how fast a day runs, what a place has to be worth, how
far you will walk between two stops.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind v4 ·
Drizzle ORM on Neon Postgres · OpenAI · Google Places API (New) · TanStack Query

Auth is our own: email and password, `scrypt`, an opaque session token in an
httpOnly cookie. No third-party auth provider.

## Running it

Node 22 or newer — the scripts use `--env-file-if-exists`.

```bash
npm install
cp .env.local.example .env.local   # then fill in the keys below
npm run db:migrate                 # applies the migrations in drizzle/
npm run dev                        # http://localhost:3000
```

Sign up at `/login`, take the quiz on `/profile`, then plan a trip from `/home`.


## Environment

Copy `.env.local.example` and read it — every variable there carries a comment
explaining what breaks without it. The short version:

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | Everything. Pooled Neon connection string. Throws on first use if unset. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Every map. Browser key, referrer-restricted. |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_LIGHT` | Every map. There is one map ID; the site is light-only. |
| `GOOGLE_PLACES_API_KEY` | Server-side place search. Separate key, **not** referrer-restricted. |
| `OPENAI_API_KEY` | Day assignment, narration, enrichment, link extraction, transcription. |

Optional, and each one degrades to something sensible when blank:

| Variable | Without it |
| --- | --- |
| `RAPIDAPI_KEY` | Link analysis fails. `/links` cannot ingest anything. |
| `PHOTO_BLOB_*` | Photos fall back to Google's `photoUri` instead of our bucket. Set all four or none. |
| `ATLAS_SANDBOX_*` | Flight search answers 503 and the form says it isn't configured. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Preference input uses the built-in deterministic matcher instead of a model. |

Leave `NEXT_PUBLIC_API_URL` **blank**. Blank means same-origin, which is how the
API routes get the session cookie. Pointing it elsewhere makes every request
anonymous.

## Scripts

```
npm run dev          # dev server, turbopack
npm run build        # production build — see the gotcha below
npm run start        # serve a production build
npm run lint         # eslint, flat config, green at zero errors
npm run type-check   # tsc --noEmit
npm test             # vitest, offline and free
```

Integration tests are excluded from `npm test` and cost real money or need a
live database. Run them on purpose:

```
npm run test:db      # needs DATABASE_URL
npm run test:blobs   # needs PHOTO_BLOB_*
npm run test:places  # needs GOOGLE_PLACES_API_KEY — bills Google
```

Database:

```
npm run db:generate  # write a migration from a schema.ts change
npm run db:migrate   # apply migrations
npm run db:studio    # browse the data
```

## Layout

```
src/app/            routes and API handlers — /home, /links, /collections, /itineraries
src/lib/planner/    the trip planner: retrieval, scoring, funnel, day assignment, packing
src/lib/db/         Drizzle schema and every read/write — the single source of column truth
src/lib/links/      the link pipeline: metadata, audio, frames, transcription, OCR, extraction
src/lib/persona/    the quiz, its scoring, and the knobs it hands the planner
docs/               design notes and docs/decisions.md, one line per settled choice
```

## Two things that will bite you

**Never run `npm run build` while `next dev` is running.** Both write `.next/`,
and the production build's manifests land on top of the dev server's. Every
route then returns a 500 that looks like the app broke. Recovery is to stop the
dev server, `rm -rf .next`, and start again. To check a change while dev is up,
use `npm run type-check` and `npm run lint` — neither touches `.next/`.

**A green `npm test` does not mean the database or Google paths work.** The
default run is deliberately offline and cannot even see the integration tests.
Skipped is not the same as covered.

## More

- `AGENTS.md` — how this codebase actually behaves, and the reasons behind it.
  Long, and the most useful thing here.
- `PRODUCT.md` — who it's for and the design principles.
- `docs/decisions.md` — one line per decision, dated.
