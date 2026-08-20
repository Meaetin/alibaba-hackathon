---
kind: error_handling
name: Error Handling — Typed API Errors, Friendly Message Mapping, and Toast Presentation
category: error_handling
scope:
    - '**'
source_files:
    - src/lib/api/client.ts
    - src/lib/api/itineraries.ts
    - src/lib/errors/userMessages.ts
    - src/contexts/ToastContext.tsx
    - src/components/ui/primitives/Toast.tsx
    - src/lib/query/queryClient.ts
---

## Overview

The Next.js frontend centralizes error handling around three layers: (1) typed domain errors thrown from the API client, (2) a whitelist-based friendly message mapper that prevents technical backend messages from leaking into the UI, and (3) a React `ToastContext` + `ToastContainer` component for presenting user-facing notifications. There is no global error boundary or centralized React Query `onError` handler; instead, each feature page catches errors locally and surfaces them via toasts.

## Core Error Types (src/lib/api)

- **`ApiError`** (`src/lib/api/client.ts`): an `Error` augmented with a numeric `status` field, used as the base type for all HTTP-layer failures.
- **`AlreadyAnalyzedError`**: thrown when the server returns 409 `{ error: 'already_analyzed', content }`; callers can render the pre-analyzed content inline.
- **`LinkQuotaError`**: thrown on 402 quota-exceeded responses; carries `tier`, `displayName`, `monthlyLimit`, `used` so the UI can show an upgrade prompt.
- **`ItineraryQuotaError`** (`src/lib/api/itineraries.ts`): thrown on 403 `ITINERARY_QUOTA_EXCEEDED`; carries `current_count` and `max_itineraries`.

These are thrown by dedicated helpers rather than raw `new Error('...')` strings:
- `authFetch()` attaches the Supabase session token and throws an `ApiError` with `status: 401` when unauthenticated.
- `ensureOk(res)` / `unwrap(res)` normalize non-`ok` responses into `ApiError`s, reading `body.error` from the JSON payload.
- `createJob()` intercepts 409/402 before falling through to `unwrap`, converting them into the typed `AlreadyAnalyzedError` / `LinkQuotaError`.

## User-Facing Message Policy (src/lib/errors/userMessages.ts)

Two functions enforce a strict separation between internal diagnostics and what users see:

- **`getFriendlyAuthError(error)`**: maps Supabase `AuthError` codes/messages (`invalid_credentials`, `email_not_confirmed`, `user_already_exists`, `weak_password`, `over_request_rate_limit`, SMTP failures, network errors, signups disabled) to plain-language strings. Technical detail stays in `console.error` / network panel.
- **`getFriendlyApiError(err, fallback)`**: if `err.message` is on the `FRIENDLY_BACKEND_MESSAGES` whitelist (e.g. `'Collection not found'`, `'Access denied'`, `'Only PDF files are supported'`, etc.) it is shown verbatim; otherwise the caller-provided `fallback` sentence is used. This guarantees no raw backend error leaks into the UI.

## Presentation Layer (src/contexts/ToastContext.tsx + src/components/ui/primitives/Toast.tsx)

- `ToastProvider` exposes `showToast({ title, description?, variant?: 'default'|'success'|'error', thumbnail?, action?, duration? })`. The `variant === 'error'` renders with `role="alert"` and `aria-live="assertive"`.
- `useToast()` throws `new Error("useToast must be used within ToastProvider")` if called outside the provider — a development-time invariant.
- `ToastContainer` is mounted via `createPortal` into `document.body` and auto-dismisses after a default 3-second duration (pausable on hover).

## Call-Site Conventions

Feature pages import both the typed error classes and the friendly mappers:

```ts
try {
  await createItinerary(...)
} catch (err) {
  if (err instanceof ItineraryQuotaError) {
    // show upgrade modal
  } else {
    showToast({
      title: getFriendlyApiError(err, "We couldn't load this collection."),
      variant: "error",
    })
  }
}
```

This pattern appears across `src/app/collections/[id]/page.tsx`, `src/app/collections/public/[token]/page.tsx`, and similar route handlers: catch → classify (instanceof typed error) → map to friendly text → toast.

## Data Fetching & Retries

React Query is configured in `src/lib/query/queryClient.ts` with `retry: 1` and no global `onError` handler. Each query hook handles its own error path, typically by setting local state or showing a toast. There is no centralized retry or error-boundary strategy at the query layer.

## Constraints Observed

- Backend error messages are never interpolated directly into JSX; they pass through `getFriendlyApiError` which whitelists safe strings and falls back to a caller-supplied friendly sentence.
- Auth errors from Supabase go through `getFriendlyAuthError` before reaching the user.
- Quota limits are surfaced as typed exceptions (`ItineraryQuotaError`, `LinkQuotaError`) rather than string-matched messages, enabling precise UI branches (upgrade prompts).
- Unauthenticated requests are caught at the `authFetch` layer and rethrown as `ApiError` with `status: 401`, so callers do not need to check for missing tokens.
- Context usage requires the corresponding Provider; calling `useToast` or `useNavigationLoading` outside their providers throws a descriptive `Error`.