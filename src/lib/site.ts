/** Canonical public origin, used for metadataBase and OG tags.
 *  Set NEXT_PUBLIC_SITE_URL on preview deployments so crawlers and social
 *  scrapers don't resolve relative URLs against the production domain. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '')
