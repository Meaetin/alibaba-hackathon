/**
 * Errors from this pipeline whose message was written to be read by a person.
 *
 * `getFriendlyApiError` refuses to show a message unless it is on a literal
 * allowlist, and that rule is right: a backend's own words leak stack detail
 * and tell the reader nothing. But two of this pipeline's failures are the
 * opposite case — "that video is 17 minutes long; the limit is 10" is the
 * complete answer, and replacing it with "we couldn't analyze that link" turns
 * a fixable mistake into a mystery. The message is also *dynamic*, so a Set of
 * literals cannot hold it however long the list grows.
 *
 * So the pipeline says which of its errors are safe by construction. Anything
 * that is not one of these — a yt-dlp crash, an OpenAI 429, a dead socket —
 * still falls through to the generic sentence, which is the behaviour the rule
 * exists to guarantee.
 */
export class LinkUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkUserError";
  }
}

/** True when `error`'s own message is fit to render. */
export function isLinkUserError(error: unknown): error is LinkUserError {
  return error instanceof LinkUserError;
}
