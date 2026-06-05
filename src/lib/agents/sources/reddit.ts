import type {
  NormalizedCandidate,
  SourceConfig,
  SourceFetcher,
} from "./types";

type RedditChild = {
  data?: {
    title?: string;
    selftext?: string;
    url?: string;
    permalink?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    thumbnail?: string;
    subreddit?: string;
    author?: string;
    domain?: string;
  };
};

type RedditListing = {
  data?: {
    children?: RedditChild[];
  };
};

export function parseRedditListing(
  payload: unknown,
  cfg: SourceConfig
): NormalizedCandidate[] {
  const listing = payload as RedditListing | undefined;
  const children = listing?.data?.children ?? [];
  return children
    .map<NormalizedCandidate | null>((child) => {
      const d = child.data;
      if (!d?.title) return null;
      const permalink = d.permalink
        ? `https://www.reddit.com${d.permalink}`
        : undefined;
      const url = permalink ?? d.url ?? "";
      const description = (d.selftext ?? "").slice(0, 4000);
      const publishedAt =
        typeof d.created_utc === "number"
          ? new Date(d.created_utc * 1000)
          : undefined;
      const thumb =
        d.thumbnail &&
        d.thumbnail.startsWith("http") &&
        !d.thumbnail.includes("self") &&
        !d.thumbnail.includes("default")
          ? d.thumbnail
          : undefined;
      return {
        sourceName: cfg.name,
        sourceType: cfg.type,
        url,
        title: d.title,
        description,
        publishedAt,
        imageUrl: thumb,
        rawMetadata: {
          score: d.score ?? null,
          numComments: d.num_comments ?? null,
          subreddit: d.subreddit ?? null,
          author: d.author ?? null,
          domain: d.domain ?? null,
          externalUrl: d.url ?? null,
        },
      };
    })
    .filter((item): item is NormalizedCandidate => item !== null);
}

export const fetchRedditSource: SourceFetcher = async (cfg, opts) => {
  // Reddit hard-requires a unique User-Agent. Default endpoint is the new.json
  // listing for a given subreddit but the registry stores the full URL.
  const response = await globalThis.fetch(cfg.endpoint, {
    cache: "no-store",
    signal: opts.signal,
    headers: {
      "user-agent": "agent-command-center/0.1 (+scout/reddit)",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`${cfg.name}: HTTP ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  const parsed = parseRedditListing(json, cfg);
  return parsed.slice(0, opts.limit);
};
