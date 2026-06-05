/**
 * Source abstraction for the scout pipeline.
 *
 * Each external source (RSS feed, Reddit subreddit, HN Show HN, etc.) is
 * normalized to NormalizedCandidate so downstream stages (cross-source merge,
 * physical-product classification, LLM scoring) never need to special-case
 * the protocol.
 *
 * Phase B contract: adding a new source = adding one SourceConfig +
 * (optionally) one SourceFetcher and registering them in registry.ts.
 * minimal-scout.ts MUST NOT branch on source name — it iterates the registry.
 */

export const SOURCE_TYPES = [
  "rss",
  "reddit_json",
  "hn",
  "ph_graphql",
  "html_scrape",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/** "primary" sources count toward the main candidate set. "japan_reference"
 *  sources are used only to compute japanValidationLevel and are never
 *  scored on their own. */
export type SourceCategory = "primary" | "japan_reference";

export type NormalizedCandidate = {
  sourceName: string;
  sourceType: SourceType;
  url: string;
  title: string;
  description: string;
  publishedAt?: Date;
  imageUrl?: string;
  rawMetadata: Record<string, unknown>;
};

export type SourceConfig = {
  id: string;
  name: string;
  type: SourceType;
  endpoint: string;
  enabled: boolean;
  category: SourceCategory;
  /** Optional polite-rate-limit. Enforced in-memory per Node process. */
  rateLimitPerHour?: number;
};

export type SourceFetcherOptions = {
  /** Hard cap on items returned by the fetcher. */
  limit: number;
  signal?: AbortSignal;
};

export type SourceFetcher = (
  cfg: SourceConfig,
  opts: SourceFetcherOptions
) => Promise<NormalizedCandidate[]>;
