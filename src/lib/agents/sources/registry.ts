import { fetchRssSource } from "./rss";
import { fetchRedditSource } from "./reddit";
import { fetchHackerNewsSource } from "./hackernews";
import { fetchProductHuntSource } from "./producthunt";
import { fetchIndiegogoSource } from "./indiegogo";
import type {
  SourceCategory,
  SourceConfig,
  SourceFetcher,
  SourceType,
} from "./types";

/**
 * Central registry of every external source the scout pipeline knows about.
 *
 * To add a new source: append a SourceConfig below. minimal-scout.ts iterates
 * registry entries directly — no other code needs to change.
 *
 * `enabled` can be flipped via env (SCOUT_DISABLED_SOURCE_IDS=ph,indiegogo)
 * without removing the entry.
 */

export const SOURCE_REGISTRY: ReadonlyArray<SourceConfig> = [
  {
    id: "kicktraq-gadgets",
    name: "Kicktraq Gadgets",
    type: "rss",
    endpoint:
      "https://www.kicktraq.com/categories/technology/gadgets/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-product-design",
    name: "Kicktraq Product Design",
    type: "rss",
    endpoint:
      "https://www.kicktraq.com/categories/design/product%20design/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-hardware",
    name: "Kicktraq Hardware",
    type: "rss",
    endpoint:
      "https://www.kicktraq.com/categories/technology/hardware/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-home",
    name: "Kicktraq Home",
    type: "rss",
    endpoint: "https://www.kicktraq.com/categories/design/home/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "backerkit",
    name: "BackerKit",
    type: "rss",
    endpoint: "https://www.backerkit.com/crowdfunding.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "yanko-design",
    name: "Yanko Design",
    type: "rss",
    endpoint: "https://www.yankodesign.com/feed/",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "reddit-gadgets",
    name: "Reddit r/gadgets",
    type: "reddit_json",
    endpoint: "https://www.reddit.com/r/gadgets/new.json?limit=50",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "reddit-somethingimadeforyou",
    name: "Reddit r/somethingimadeforyou",
    type: "reddit_json",
    endpoint:
      "https://www.reddit.com/r/somethingimadeforyou/new.json?limit=50",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "hn-show",
    name: "HackerNews Show HN",
    type: "hn",
    endpoint: "https://hacker-news.firebaseio.com/v0/showstories.json",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 120,
  },
  {
    id: "producthunt",
    name: "Product Hunt",
    type: "ph_graphql",
    endpoint: "https://api.producthunt.com/v2/api/graphql",
    // Auto-disabled at fetch time if PRODUCT_HUNT_TOKEN missing; flag stays
    // true so the registry can advertise it as a planned source.
    enabled: true,
    category: "primary",
    rateLimitPerHour: 900,
  },
  {
    id: "greenfunding",
    name: "GREEN FUNDING",
    type: "rss",
    // RSS URL is unverified — if it 404s the run surfaces the error in
    // perFeed.errorMessage. Used as Japan reference (makuake validation).
    endpoint: "https://greenfunding.jp/feed",
    enabled: true,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
  {
    id: "campfire",
    name: "CAMPFIRE",
    type: "rss",
    // CAMPFIRE has no documented public RSS. This endpoint is unverified;
    // if it 404s, disable via SCOUT_DISABLED_SOURCE_IDS=campfire.
    endpoint: "https://camp-fire.jp/projects.rss",
    enabled: true,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
  {
    id: "boredpanda-design",
    name: "BoredPanda Design",
    type: "rss",
    endpoint: "https://www.boredpanda.com/blog/category/design/feed/",
    // Disabled: BoredPanda is a viral content blog, not a product discovery
    // source. Items are mostly art/concept pieces with no path to CF launch.
    enabled: false,
    category: "primary",
    rateLimitPerHour: 30,
  },
  // ---- japan_reference sources (used for japanValidationLevel only) ----
  {
    id: "makuake",
    name: "Makuake",
    type: "rss",
    endpoint: "https://www.makuake.com/rss/",
    enabled: true,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
];

const FETCHERS: Record<SourceType, SourceFetcher> = {
  rss: fetchRssSource,
  reddit_json: fetchRedditSource,
  hn: fetchHackerNewsSource,
  ph_graphql: fetchProductHuntSource,
  html_scrape: fetchIndiegogoSource,
};

export function getFetcher(type: SourceType): SourceFetcher {
  const fn = FETCHERS[type];
  if (!fn) throw new Error(`No fetcher registered for source type "${type}"`);
  return fn;
}

function parseDisabledIds(): Set<string> {
  const raw = process.env.SCOUT_DISABLED_SOURCE_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function getEnabledSources(category?: SourceCategory): SourceConfig[] {
  const disabled = parseDisabledIds();
  return SOURCE_REGISTRY.filter(
    (s) => s.enabled && !disabled.has(s.id) && (!category || s.category === category)
  );
}

// ---- In-memory rate limiter (per-process). Resets when Node restarts. ----

type RateState = { windowStart: number; count: number };
const rateState = new Map<string, RateState>();

export function rateLimitCheck(cfg: SourceConfig): {
  allowed: boolean;
  retryAfterMs: number;
} {
  if (!cfg.rateLimitPerHour) return { allowed: true, retryAfterMs: 0 };
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const state = rateState.get(cfg.id) ?? { windowStart: now, count: 0 };
  if (now - state.windowStart >= windowMs) {
    state.windowStart = now;
    state.count = 0;
  }
  if (state.count >= cfg.rateLimitPerHour) {
    rateState.set(cfg.id, state);
    return {
      allowed: false,
      retryAfterMs: windowMs - (now - state.windowStart),
    };
  }
  state.count++;
  rateState.set(cfg.id, state);
  return { allowed: true, retryAfterMs: 0 };
}

/** Test-only: clear in-memory rate-limit state. */
export function _resetRateLimitState() {
  rateState.clear();
}
