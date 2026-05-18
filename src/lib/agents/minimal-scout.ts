import {
  scoreCandidate,
  type CandidateSignals,
  type ScoringOutput,
} from "./scout-scoring";

type FeedRegion = "overseas" | "japan";

type FeedConfig = {
  source: string;
  url: string;
  region: FeedRegion;
};

type FeedItem = {
  source: string;
  region: FeedRegion;
  title: string;
  url?: string;
  description?: string;
  publishedAt?: string;
};

export type MinimalScoutRunOptions = {
  limit?: number;
  overseasFeeds?: FeedConfig[];
  japanFeeds?: FeedConfig[];
};

export type MinimalScoutRunResult = {
  feedCount: number;
  overseasCount: number;
  japanCount: number;
  candidateCount: number;
  scoredCount: number;
  enqueuedCount: number;
  rejectedCount: number;
  errors: string[];
  results: Array<{
    title: string;
    score: number;
    verdict: ScoringOutput["verdict"];
    runId: string;
    productId: string;
    enqueuedApprovalId: string | null;
  }>;
};

const DEFAULT_OVERSEAS_FEEDS: FeedConfig[] = [
  {
    source: "Product Hunt",
    region: "overseas",
    url: "https://www.producthunt.com/feed",
  },
  {
    source: "Yanko Design",
    region: "overseas",
    url: "https://www.yankodesign.com/feed/",
  },
];

const DEFAULT_JAPAN_FEEDS: FeedConfig[] = [
  {
    source: "Makuake",
    region: "japan",
    url: "https://www.makuake.com/rss/",
  },
];

function parseFeedEnv(value: string | undefined, region: FeedRegion) {
  if (!value?.trim()) return null;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [source, url] = part.includes("|")
        ? part.split("|").map((s) => s.trim())
        : [part, part];
      return { source, url, region };
    });
}

function decodeHtml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value: string) {
  return decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match?.[1] ? stripTags(match[1]) : undefined;
}

function linkFromBlock(block: string) {
  const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
  if (href) return decodeHtml(href);
  return tag(block, "link");
}

function parseFeed(xml: string, feed: FeedConfig): FeedItem[] {
  const blocks = [
    ...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi),
    ...xml.matchAll(/<item[\s\S]*?<\/item>/gi),
  ].map((match) => match[0]);

  return blocks
    .map((block) => ({
      source: feed.source,
      region: feed.region,
      title: tag(block, "title") ?? "",
      url: linkFromBlock(block),
      description: tag(block, "content") ?? tag(block, "description") ?? tag(block, "summary"),
      publishedAt: tag(block, "published") ?? tag(block, "pubDate") ?? tag(block, "updated"),
    }))
    .filter((item) => item.title.length > 0);
}

async function fetchFeed(feed: FeedConfig): Promise<FeedItem[]> {
  const response = await fetch(feed.url, {
    cache: "no-store",
    headers: { "user-agent": "AgentCommandCenter/1.0 minimal-scout" },
  });
  if (!response.ok) throw new Error(`${feed.source}: ${response.status}`);
  return parseFeed(await response.text(), feed);
}

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function grams(value: string) {
  const normalized = normalizeForMatch(value);
  if (normalized.length <= 2) return new Set(normalized ? [normalized] : []);
  const out = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    out.add(normalized.slice(i, i + 2));
  }
  return out;
}

function similarity(a: string, b: string) {
  const aGrams = grams(a);
  const bGrams = grams(b);
  if (aGrams.size === 0 || bGrams.size === 0) return 0;
  let overlap = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) overlap++;
  }
  return overlap / Math.min(aGrams.size, bGrams.size);
}

function toSignals(item: FeedItem, japanItems: FeedItem[]): CandidateSignals {
  const similar = japanItems
    .map((jp) => ({
      title: jp.title,
      score: similarity(`${item.title} ${item.description ?? ""}`, jp.title),
    }))
    .filter((jp) => jp.score >= 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    title: item.title,
    category: `${item.source} RSS`,
    overseas: {
      source: item.source,
      url: item.url,
      description: item.description,
      publishedAt: item.publishedAt,
    },
    japan: {
      notYetInJapan: similar.length === 0,
      similarProductCount: similar.length,
      domesticExamples: similar.map((jp) => jp.title),
      searchSummary:
        similar.length === 0
          ? "Makuake RSSの直近候補には近いタイトルが見当たりません。"
          : `Makuake RSSに近い候補あり: ${similar.map((jp) => jp.title).join(" / ")}`,
    },
  };
}

function positiveLimit(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value < 1) return 3;
  return Math.floor(value);
}

export async function runMinimalScout(
  opts: MinimalScoutRunOptions = {}
): Promise<MinimalScoutRunResult> {
  const limit = positiveLimit(
    opts.limit ?? Number(process.env.MINIMAL_SCOUT_LIMIT ?? "3")
  );
  const overseasFeeds =
    opts.overseasFeeds ??
    parseFeedEnv(process.env.SCOUT_OVERSEAS_RSS_FEEDS, "overseas") ??
    DEFAULT_OVERSEAS_FEEDS;
  const japanFeeds =
    opts.japanFeeds ??
    parseFeedEnv(process.env.SCOUT_JAPAN_RSS_FEEDS, "japan") ??
    DEFAULT_JAPAN_FEEDS;

  const allFeeds = [...overseasFeeds, ...japanFeeds];
  const fetched = await Promise.allSettled(allFeeds.map(fetchFeed));
  const errors: string[] = [];
  const items = fetched.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    errors.push(`Skipping feed ${allFeeds[index].source}: ${result.reason}`);
    return [];
  });

  const overseasItems = items.filter((item) => item.region === "overseas");
  const japanItems = items.filter((item) => item.region === "japan");
  const seen = new Set<string>();
  const candidates = overseasItems
    .filter((item) => {
      const key = normalizeForMatch(item.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((item) => toSignals(item, japanItems));

  let enqueuedCount = 0;
  let rejectedCount = 0;
  const results: MinimalScoutRunResult["results"] = [];

  for (const candidate of candidates) {
    const result = await scoreCandidate(candidate);
    if (result.enqueuedApprovalId) enqueuedCount++;
    if (result.output.verdict === "reject") rejectedCount++;
    results.push({
      title: candidate.title,
      score: result.output.score,
      verdict: result.output.verdict,
      runId: result.runId,
      productId: result.productId,
      enqueuedApprovalId: result.enqueuedApprovalId,
    });
  }

  return {
    feedCount: allFeeds.length,
    overseasCount: overseasItems.length,
    japanCount: japanItems.length,
    candidateCount: candidates.length,
    scoredCount: results.length,
    enqueuedCount,
    rejectedCount,
    errors,
    results,
  };
}
