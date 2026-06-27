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
 * `enabled` can be flipped via env (SCOUT_DISABLED_SOURCE_IDS=ph,cool-hunting)
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
    // Currently returns an empty feed from Kicktraq; keep listed for easy
    // re-enable if the endpoint starts serving items again.
    enabled: false,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-wearables",
    name: "Kicktraq Wearables",
    type: "rss",
    endpoint:
      "https://www.kicktraq.com/categories/technology/wearables/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-3d-printing",
    name: "Kicktraq 3D Printing",
    type: "rss",
    endpoint:
      "https://www.kicktraq.com/categories/technology/3d%20printing/latest.rss",
    // This category is often STL/downloadable model packs rather than
    // importable finished goods, so it is opt-in.
    enabled: false,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-diy-electronics",
    name: "Kicktraq DIY Electronics",
    type: "rss",
    endpoint:
      "https://www.kicktraq.com/categories/technology/diy%20electronics/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-accessories",
    name: "Kicktraq Accessories",
    type: "rss",
    endpoint:
      "https://www.kicktraq.com/categories/fashion/accessories/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-footwear",
    name: "Kicktraq Footwear",
    type: "rss",
    endpoint: "https://www.kicktraq.com/categories/fashion/footwear/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "kicktraq-fabrication-tools",
    name: "Kicktraq Fabrication Tools",
    type: "rss",
    endpoint:
      "https://www.kicktraq.com/categories/technology/fabrication%20tools/latest.rss",
    enabled: true,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "backerkit",
    name: "BackerKit",
    type: "rss",
    endpoint: "https://www.backerkit.com/crowdfunding.rss",
    // BackerKit currently returns 403 to server-side fetches. Keep disabled
    // until an authenticated or documented feed is available.
    enabled: false,
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
    candidatePriority: 9,
    rateLimitPerHour: 60,
  },
  {
    id: "trendhunter",
    name: "TrendHunter",
    type: "rss",
    endpoint: "https://www.trendhunter.com/rss",
    // Currently returns 403 from Vercel/server-side fetches.
    enabled: false,
    category: "primary",
    rateLimitPerHour: 30,
  },
  {
    id: "thisiswhyimbroke",
    name: "ThisIsWhyImBroke",
    type: "rss",
    endpoint: "https://www.thisiswhyimbroke.com/feed/",
    enabled: true,
    category: "primary",
    candidatePriority: 9,
    rateLimitPerHour: 30,
  },
  {
    id: "the-gadgeteer",
    name: "The Gadgeteer",
    type: "rss",
    endpoint: "https://the-gadgeteer.com/feed/",
    enabled: true,
    category: "primary",
    candidatePriority: 10,
    rateLimitPerHour: 30,
  },
  {
    id: "the-awesomer",
    name: "The Awesomer",
    type: "rss",
    endpoint: "https://theawesomer.com/feed/",
    enabled: true,
    category: "primary",
    candidatePriority: 10,
    rateLimitPerHour: 30,
  },
  {
    id: "coolthings",
    name: "Cool Things",
    type: "rss",
    endpoint: "https://www.coolthings.com/feed/",
    // Node/Vercel fetch currently fails even though curl can read it.
    enabled: false,
    category: "primary",
    candidatePriority: 10,
    rateLimitPerHour: 30,
  },
  {
    id: "gearjunkie",
    name: "GearJunkie",
    type: "rss",
    endpoint: "https://www.gearjunkie.com/feed/",
    enabled: true,
    category: "primary",
    candidatePriority: 8,
    rateLimitPerHour: 30,
  },
  {
    id: "mikeshouts",
    name: "mikeshouts",
    type: "rss",
    endpoint: "https://mikeshouts.com/feed/",
    // Returns 403 from Vercel/server-side fetches.
    enabled: false,
    category: "primary",
    candidatePriority: 9,
    rateLimitPerHour: 30,
  },
  {
    id: "cool-hunting",
    name: "Cool Hunting",
    type: "rss",
    endpoint: "https://coolhunting.com/feed/",
    enabled: true,
    category: "primary",
    candidatePriority: 8,
    rateLimitPerHour: 30,
  },
  {
    id: "design-milk",
    name: "Design Milk",
    type: "rss",
    endpoint: "https://design-milk.com/feed/",
    enabled: true,
    category: "primary",
    candidatePriority: 8,
    rateLimitPerHour: 30,
  },
  {
    id: "core77",
    name: "Core77",
    type: "rss",
    endpoint: "https://feeds.feedburner.com/core77/blog",
    enabled: true,
    category: "primary",
    candidatePriority: 7,
    rateLimitPerHour: 30,
  },
  {
    id: "new-atlas",
    name: "New Atlas",
    type: "rss",
    endpoint: "https://newatlas.com/index.rss",
    enabled: true,
    category: "primary",
    candidatePriority: 8,
    rateLimitPerHour: 30,
  },
  {
    id: "make-magazine",
    name: "Make Magazine",
    type: "rss",
    endpoint: "https://makezine.com/feed/",
    enabled: true,
    category: "primary",
    candidatePriority: 6,
    rateLimitPerHour: 30,
  },
  {
    id: "hackaday",
    name: "Hackaday",
    type: "rss",
    endpoint: "https://hackaday.com/blog/feed/",
    enabled: true,
    category: "primary",
    candidatePriority: 6,
    rateLimitPerHour: 30,
  },
  {
    id: "reddit-gadgets",
    name: "Reddit r/gadgets",
    type: "reddit_json",
    endpoint: "https://www.reddit.com/r/gadgets/new.json?limit=50",
    // Reddit blocks anonymous server fetches from many hosts with 403. Keep
    // the fetcher and tests, but do not make production scout runs noisy.
    enabled: false,
    category: "primary",
    rateLimitPerHour: 60,
  },
  {
    id: "reddit-somethingimadeforyou",
    name: "Reddit r/somethingimadeforyou",
    type: "reddit_json",
    endpoint:
      "https://www.reddit.com/r/somethingimadeforyou/new.json?limit=50",
    enabled: false,
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
    candidatePriority: 3,
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
    candidatePriority: 4,
    rateLimitPerHour: 900,
  },
  {
    id: "greenfunding",
    name: "GREEN FUNDING",
    type: "rss",
    // Currently returns 404 for anonymous RSS fetches. Keep listed for a quick
    // enable if GREEN FUNDING exposes a public feed again.
    endpoint: "https://greenfunding.jp/feed",
    enabled: false,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
  {
    id: "campfire",
    name: "CAMPFIRE",
    type: "rss",
    // This endpoint currently returns an empty RSS envelope; keep enabled so it
    // starts contributing automatically if CAMPFIRE adds items again.
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
  {
    id: "getnavi",
    name: "GetNavi",
    type: "rss",
    endpoint: "https://getnavi.jp/feed/",
    // Node/Vercel fetch currently fails for this feed.
    enabled: false,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
  {
    id: "gizmodo-jp",
    name: "Gizmodo Japan",
    type: "rss",
    endpoint: "https://www.gizmodo.jp/index.xml",
    enabled: true,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
  {
    id: "roomie",
    name: "ROOMIE",
    type: "rss",
    endpoint: "https://www.roomie.jp/feed/",
    enabled: true,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
  {
    id: "lifehacker-jp",
    name: "Lifehacker Japan",
    type: "rss",
    endpoint: "https://www.lifehacker.jp/index.xml",
    enabled: true,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
  {
    id: "kaden-watch",
    name: "家電 Watch",
    type: "rss",
    endpoint: "https://kaden.watch.impress.co.jp/data/rss/1.0/kdw/feed.rdf",
    enabled: true,
    category: "japan_reference",
    rateLimitPerHour: 30,
  },
  {
    id: "impress-watch",
    name: "Impress Watch",
    type: "rss",
    endpoint: "https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf",
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
