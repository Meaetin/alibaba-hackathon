/**
 * The session cookie's name, and nothing else.
 *
 * It lives in its own module because **`middleware.ts` runs on the Edge
 * runtime**, which has no `node:crypto`. `session.ts` imports `node:crypto` for
 * the token hashing, so a middleware that imported the name from there would
 * drag the whole module in and fail to build — a failure `tsc` cannot see,
 * because it is a runtime constraint rather than a type error.
 *
 * One constant, no imports, safe from anywhere. `session.ts` re-exports it so
 * that the Node-side callers still have one place to look.
 */
export const SESSION_COOKIE_NAME = "argo_session";
