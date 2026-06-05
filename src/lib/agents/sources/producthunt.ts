import type {
  NormalizedCandidate,
  SourceConfig,
  SourceFetcher,
} from "./types";

/**
 * Product Hunt GraphQL fetcher. Requires PRODUCT_HUNT_TOKEN.
 * When the token is missing we log a warning and return an empty array
 * rather than throwing, so a missing key never breaks the whole run.
 */

const PH_QUERY = `
query LatestPosts($first: Int!) {
  posts(first: $first, order: NEWEST) {
    edges {
      node {
        id
        name
        tagline
        description
        url
        website
        slug
        createdAt
        votesCount
        thumbnail { url }
        topics { edges { node { name } } }
      }
    }
  }
}`;

type PhPost = {
  id?: string;
  name?: string;
  tagline?: string;
  description?: string;
  url?: string;
  website?: string;
  slug?: string;
  createdAt?: string;
  votesCount?: number;
  thumbnail?: { url?: string } | null;
  topics?: { edges?: Array<{ node?: { name?: string } }> } | null;
};

type PhResponse = {
  data?: {
    posts?: {
      edges?: Array<{ node?: PhPost }>;
    };
  };
  errors?: unknown;
};

export function normalizeProductHuntPost(
  post: PhPost,
  cfg: SourceConfig
): NormalizedCandidate | null {
  if (!post.name) return null;
  const url = post.website ?? post.url ?? "";
  const description = [post.tagline, post.description].filter(Boolean).join("\n").slice(0, 4000);
  const publishedAt = post.createdAt ? new Date(post.createdAt) : undefined;
  const topics =
    post.topics?.edges
      ?.map((edge) => edge?.node?.name)
      .filter((n): n is string => Boolean(n)) ?? [];
  return {
    sourceName: cfg.name,
    sourceType: cfg.type,
    url,
    title: post.name,
    description,
    publishedAt,
    imageUrl: post.thumbnail?.url,
    rawMetadata: {
      phId: post.id ?? null,
      phUrl: post.url ?? null,
      slug: post.slug ?? null,
      votes: post.votesCount ?? null,
      topics,
    },
  };
}

export const fetchProductHuntSource: SourceFetcher = async (cfg, opts) => {
  const token = process.env.PRODUCT_HUNT_TOKEN;
  if (!token) {
    console.warn(
      `[${cfg.name}] PRODUCT_HUNT_TOKEN not set — returning empty result set (stub).`
    );
    return [];
  }
  const response = await globalThis.fetch(cfg.endpoint, {
    method: "POST",
    cache: "no-store",
    signal: opts.signal,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "agent-command-center/0.1 (+scout/producthunt)",
    },
    body: JSON.stringify({
      query: PH_QUERY,
      variables: { first: Math.min(opts.limit * 2, 50) },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `${cfg.name}: HTTP ${response.status} ${text.slice(0, 200)}`
    );
  }
  const json = (await response.json()) as PhResponse;
  if (json.errors) {
    throw new Error(
      `${cfg.name}: graphql errors ${JSON.stringify(json.errors).slice(0, 300)}`
    );
  }
  const edges = json.data?.posts?.edges ?? [];
  const normalized = edges
    .map((edge) => edge?.node)
    .filter((node): node is PhPost => Boolean(node))
    .map((node) => normalizeProductHuntPost(node, cfg))
    .filter((n): n is NormalizedCandidate => n !== null);
  return normalized.slice(0, opts.limit);
};
