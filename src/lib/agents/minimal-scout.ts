import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scoutRuns, type PerFeedEntry } from "@/lib/db/schema/scoutRuns";
import { hasDatabaseUrl } from "@/lib/db/url";
import {
  scoreCandidate,
  type CandidateSignals,
  type ScoringOutput,
} from "./scout-scoring";
import {
  classifyProductText,
  isPhysicalProductCandidate,
  type ProductClassification,
} from "./product-classification";
import {
  getEnabledSources,
  getFetcher,
  rateLimitCheck,
  type NormalizedCandidate,
  type SourceConfig,
} from "./sources";
import { runPrefilter } from "./scout-prefilter";
import { runPerplexityResearch, type JpMarketResearch } from "./scout-perplexity";
import { runDeepResearch } from "./scout-deep-research";

type FeedRegion = "overseas" | "japan";

/**
 * Phase B uses the source registry as the single source of truth. The legacy
 * `FeedConfig` / `FeedItem` types are retained as compatibility aliases so
 * scripts/tests that import them keep building.
 */
type FeedConfig = {
  source: string;
  url: string;
  region: FeedRegion;
};

type FeedItem = {
  sourceId?: string;
  source: string;
  sourceFamily?: string;
  sourcePriority?: number;
  region: FeedRegion;
  title: string;
  url?: string;
  description?: string;
  publishedAt?: string;
};

export type MinimalScoutRunOptions = {
  /** @deprecated use limitPerFeed / llmMax. Kept for backward compatibility. */
  limit?: number;
  /** Hard cap on raw items pulled per source. Default MINIMAL_SCOUT_LIMIT_PER_FEED or 20. */
  limitPerFeed?: number;
  /** Hard cap on items sent to the LLM. Default MINIMAL_SCOUT_LLM_MAX or 15. */
  llmMax?: number;
  /** @deprecated use the registry. Optional override of overseas sources. */
  overseasFeeds?: FeedConfig[];
  /** @deprecated use the registry. Optional override of japan sources. */
  japanFeeds?: FeedConfig[];
  /**
   * Optional override of the entire source list. When provided, the registry
   * is ignored. Primarily used by tests.
   */
  sources?: SourceConfig[];
  /** Tags the scout_runs row. Defaults to "manual". Cron route sets "cron". */
  triggeredBy?: string;
  /** When true, skip persisting to scout_runs (for unit tests / dry runs). */
  skipPersistence?: boolean;
};

export type MinimalScoutRunResult = {
  feedCount: number;
  overseasCount: number;
  japanCount: number;
  candidateCount: number;
  filteredCount: number;
  /** Items dropped by the Haiku pre-filter (obvious non-starters). */
  prefilterDroppedCount: number;
  /** Products whose Perplexity research was served from cache. */
  perplexityCacheHits: number;
  /** Products that received deep research (score >= SCOUT_DEEP_RESEARCH_THRESHOLD). */
  deepResearchCount: number;
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
  // ---- Phase A additions (Visibility Layer) ----
  scoutRunId: string | null;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  rawItemCount: number;
  physicalCount: number;
  dedupDroppedCount: number;
  perFeed: PerFeedEntry[];
};

// ---- legacy env override (kept as a fallback when no opts supplied) ----

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

// ---- normalisation helpers (also exported for tests) ----

export function normalizeForMatch(value: string) {
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

export function similarity(a: string, b: string) {
  const aGrams = grams(a);
  const bGrams = grams(b);
  if (aGrams.size === 0 || bGrams.size === 0) return 0;
  let overlap = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) overlap++;
  }
  return overlap / Math.min(aGrams.size, bGrams.size);
}

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sourceFamilyFromName(name: string) {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && word !== "the" && word !== "www");
  return words[0] ?? normalizeForMatch(name) ?? "unknown";
}

function boundedSourcePriority(value: number | undefined) {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value as number)));
}

function toFeedItem(
  c: NormalizedCandidate,
  region: FeedRegion,
  source?: SourceConfig
): FeedItem {
  return {
    sourceId: source?.id,
    source: c.sourceName,
    sourceFamily: source?.sourceFamily ?? sourceFamilyFromName(c.sourceName),
    sourcePriority: boundedSourcePriority(source?.candidatePriority),
    region,
    title: c.title,
    url: c.url || undefined,
    description: c.description || undefined,
    publishedAt: c.publishedAt?.toISOString(),
  };
}

function classifyFeedItem(item: FeedItem) {
  return classifyProductText({
    title: item.title,
    description: item.description,
    source: item.source,
  });
}

// ---- legacy override path: read RSS via the registry's rss fetcher ----

async function fetchLegacyFeed(feed: FeedConfig): Promise<NormalizedCandidate[]> {
  const cfg: SourceConfig = {
    id: `legacy-${feed.source}`,
    name: feed.source,
    type: "rss",
    endpoint: feed.url,
    enabled: true,
    category: feed.region === "japan" ? "japan_reference" : "primary",
  };
  const fetcher = getFetcher("rss");
  return fetcher(cfg, { limit: 200 });
}

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value || (value as number) < 1) return fallback;
  return Math.floor(value as number);
}

function hasDatabaseConfig() {
  return hasDatabaseUrl();
}

// ---- cross-source merge ----

type MergedCandidate = {
  primary: { item: FeedItem; classification: ProductClassification };
  mentionSources: Set<string>;
  /** All raw FeedItems that merged into this candidate (incl. the primary). */
  members: Array<{ item: FeedItem; classification: ProductClassification }>;
};

/**
 * Merge candidates that look like the same product across sources.
 *
 * Two items match when:
 *  - their URL hostname is identical (and non-empty), OR
 *  - their title bigram similarity >= 0.6.
 *
 * This is intentionally generous on the title side so that "Acme X Lamp"
 * on Kicktraq matches "Acme X" on Reddit. False positives are cheaper than
 * false negatives at this stage — the LLM still sees the merged set.
 */
function mergeCrossSource(
  items: Array<{ item: FeedItem; classification: ProductClassification }>
): MergedCandidate[] {
  const merged: MergedCandidate[] = [];
  for (const entry of items) {
    const host = hostnameOf(entry.item.url);
    const match = merged.find((m) => {
      const mHost = hostnameOf(m.primary.item.url);
      if (host && mHost && host === mHost) return true;
      return similarity(m.primary.item.title, entry.item.title) >= 0.6;
    });
    if (match) {
      match.mentionSources.add(entry.item.source);
      match.members.push(entry);
    } else {
      merged.push({
        primary: entry,
        mentionSources: new Set([entry.item.source]),
        members: [entry],
      });
    }
  }
  return merged;
}

function memberPriority(member: MergedCandidate["members"][number]) {
  const item = member.item;
  const urlScore = item.url ? 2 : 0;
  const descriptionScore = item.description ? Math.min(item.description.length / 500, 2) : 0;
  return boundedSourcePriority(item.sourcePriority) + urlScore + descriptionScore;
}

function representativeMember(merged: MergedCandidate) {
  return merged.members
    .slice()
    .sort((a, b) => memberPriority(b) - memberPriority(a))[0]!;
}

const PRODUCT_SIGNAL_KEYWORDS = [
  "gadget",
  "gear",
  "portable",
  "compact",
  "desk",
  "kitchen",
  "cook",
  "travel",
  "camp",
  "outdoor",
  "tool",
  "organizer",
  "bag",
  "wallet",
  "lamp",
  "light",
  "charger",
  "battery",
  "speaker",
  "headphone",
  "watch",
  "wearable",
  "bike",
  "home",
  "storage",
  "folding",
  "modular",
  "smart",
  "minimal",
  "waterproof",
  "coffee",
  "espresso",
  "stationery",
  "knife",
  "keyboard",
];

function recencyScore(publishedAt: string | undefined) {
  if (!publishedAt) return 0;
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published)) return 0;
  const ageDays = (Date.now() - published) / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) return 8;
  if (ageDays <= 30) return 5;
  if (ageDays <= 90) return 2;
  return 0;
}

function productKeywordScore(merged: MergedCandidate) {
  const text = merged.members
    .map((m) => `${m.item.title} ${m.item.description ?? ""}`)
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const keyword of PRODUCT_SIGNAL_KEYWORDS) {
    if (text.includes(keyword)) score += 1.5;
  }
  return Math.min(score, 12);
}

function candidateRankScore(merged: MergedCandidate) {
  const representative = representativeMember(merged);
  const item = representative.item;
  const sourcePriority = Math.max(
    ...merged.members.map((m) => boundedSourcePriority(m.item.sourcePriority))
  );
  return (
    merged.mentionSources.size * 18 +
    sourcePriority * 7 +
    (item.url ? 6 : 0) +
    recencyScore(item.publishedAt) +
    productKeywordScore(merged)
  );
}

function sourceSelectionKey(merged: MergedCandidate) {
  const item = representativeMember(merged).item;
  return item.sourceId ?? item.source;
}

function familySelectionKey(merged: MergedCandidate) {
  const item = representativeMember(merged).item;
  return item.sourceFamily ?? sourceFamilyFromName(item.source);
}

function selectDiverseCandidates(
  ranked: MergedCandidate[],
  llmMax: number
): MergedCandidate[] {
  const perSourceCap = positiveInt(
    Number(process.env.SCOUT_LLM_PER_SOURCE_CAP ?? ""),
    2
  );
  const perFamilyCap = positiveInt(
    Number(process.env.SCOUT_LLM_PER_SOURCE_FAMILY_CAP ?? ""),
    4
  );
  const selected: MergedCandidate[] = [];
  const selectedSet = new Set<MergedCandidate>();
  const sourceCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();

  const add = (candidate: MergedCandidate) => {
    selected.push(candidate);
    selectedSet.add(candidate);
    const sourceKey = sourceSelectionKey(candidate);
    const familyKey = familySelectionKey(candidate);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);
    familyCounts.set(familyKey, (familyCounts.get(familyKey) ?? 0) + 1);
  };

  for (const candidate of ranked) {
    if (selected.length >= llmMax) break;
    const sourceKey = sourceSelectionKey(candidate);
    const familyKey = familySelectionKey(candidate);
    if ((sourceCounts.get(sourceKey) ?? 0) >= perSourceCap) continue;
    if ((familyCounts.get(familyKey) ?? 0) >= perFamilyCap) continue;
    add(candidate);
  }

  // If the cap is too strict for a sparse run, fill remaining slots by rank.
  for (const candidate of ranked) {
    if (selected.length >= llmMax) break;
    if (!selectedSet.has(candidate)) add(candidate);
  }

  return selected.slice(0, llmMax);
}

// ---- japanValidationLevel (Phase B Japan reference positive signal) ----

function computeJapanValidationLevel(
  candidate: FeedItem,
  japanRefItems: FeedItem[]
): { level: number; matches: string[]; summary: string } {
  if (japanRefItems.length === 0) {
    return {
      level: 0.3,
      matches: [],
      summary: "国内参照データなし（中立 0.3）",
    };
  }
  const scored = japanRefItems
    .map((jp) => ({
      title: jp.title,
      score: similarity(`${candidate.title} ${candidate.description ?? ""}`, jp.title),
    }))
    .filter((jp) => jp.score >= 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (scored.length === 0) {
      return {
        level: 0.3,
        matches: [],
        summary: "国内参照ソースに類似なし（中立 0.3）",
      };
  }
  // 1 loose match → 0.6, 2 → 0.8, 3+ → 1.0. Strong title overlap bumps further.
  const base = Math.min(0.4 + scored.length * 0.2, 1.0);
  const bestScore = scored[0]?.score ?? 0;
  const level = Math.min(base + (bestScore >= 0.5 ? 0.1 : 0), 1.0);
  return {
    level,
    matches: scored.map((s) => s.title),
    summary: `国内参照ソースに類似 ${scored.length} 件（最大類似度 ${bestScore.toFixed(2)}） → ${level.toFixed(2)}`,
  };
}

// ---- signal assembly ----

function toSignals(
  merged: MergedCandidate,
  japanRefItems: FeedItem[]
): CandidateSignals {
  const { mentionSources, members } = merged;
  const { item, classification } = representativeMember(merged);
  const jp = computeJapanValidationLevel(item, japanRefItems);
  const sourceList = Array.from(mentionSources);
  const crossSourceScore = Math.min(sourceList.length / 3, 1);

  // Combine descriptions from all members so the LLM sees the richest signal.
  const combinedDescription =
    members
      .map((m) => m.item.description)
      .filter((d): d is string => Boolean(d))
      .join("\n---\n")
      .slice(0, 4000) || undefined;

  return {
    title: item.title,
    category: `${item.source} (${sourceList.length} sources)`,
    productType: classification.productType,
    physicalProductLikely: classification.physicalProductLikely,
    exclusionReason: classification.exclusionReason,
    mentionSources: sourceList,
    crossSourceScore,
    overseas: {
      source: item.source,
      url: item.url,
      description: combinedDescription ?? item.description,
      publishedAt: item.publishedAt,
    },
    japan: {
      // notYetInJapan retained for backward compat; true when no JP CF match.
      notYetInJapan: jp.matches.length === 0,
      similarProductCount: jp.matches.length,
      domesticExamples: jp.matches,
      searchSummary: jp.summary,
      japanValidationLevel: jp.level,
    },
  };
}

// ---- Stage 0: rules-based fast reject (no LLM) ----

/**
 * Return a rejection reason string for items that are obviously wrong before
 * any LLM call. Returning null means the item passes this gate.
 */
function rulesRejectReason(item: FeedItem): string | null {
  const title = item.title.toLowerCase().trim();

  // Empty or malformed titles
  if (!title) return "empty title";

  // HN Ask/Tell/Poll posts are discussions, not products
  if (/^(ask|tell|poll)\s+hn[:]/i.test(item.title)) return "HN discussion thread";

  // Announcements of fundraising rounds, not products
  if (/\b(series [a-e]|seed round|fundraising|vc funding)\b/i.test(title)) {
    return "funding announcement, not a product";
  }

  // Job postings
  if (/^(\[hiring\]|hiring[:,]|we'?re hiring|job:|jobs:)/i.test(title)) {
    return "job posting";
  }

  // Listicles and roundup articles: "X companies that...", "top X...", etc. where X >= 3
  if (/\b([3-9]|\d{2,})\s+(companies|startups|tools|apps|ways|tips|reasons|things|examples|plugins|extensions|resources|alternatives)\b/i.test(title)) {
    return "listicle/roundup, not a product";
  }
  if (/^(top|best)\s+([3-9]|\d{2,})\b/i.test(title)) {
    return "listicle/roundup, not a product";
  }
  if (/^(how|why)\s+([3-9]|\d{2,})\b/i.test(title)) {
    return "listicle/roundup, not a product";
  }

  // Acquisition or merger news
  if (/\b(acqui[a-z]*|merger|acquired by|acquires)\b/i.test(title)) {
    return "acquisition news";
  }

  // Pure media/content products (conservative — only obvious cases)
  if (/\b(documentary|podcast episode|new album|book about|newsletter about)\b/i.test(title)) {
    return "digital/media content";
  }

  // Political campaigns
  if (/\b(campaign for|vote for|elect\b|for governor|for senate|for congress|for president)\b/i.test(title)) {
    return "political campaign";
  }

  return null; // passes
}

// ---- Stage 3: Haiku pre-filter (concurrent batch) ----

/**
 * Run Haiku pre-filter on a batch of candidates concurrently.
 * Returns the subset that passed (viable=true or confidence != "high").
 */
async function runPrefilterBatch(
  candidates: CandidateSignals[],
  concurrency = 5
): Promise<{ passed: CandidateSignals[]; droppedCount: number }> {
  const passed: CandidateSignals[] = [];
  let droppedCount = 0;

  // Process in chunks to respect Anthropic rate limits
  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async (candidate) => {
        const result = await runPrefilter(
          candidate.title,
          candidate.overseas?.description,
          candidate.category
        );
        return { candidate, result };
      })
    );

    for (const settled of results) {
      if (settled.status === "rejected") {
        // Prefilter error: pass the candidate through (fail open)
        console.warn("[prefilter] error, passing candidate through:", settled.reason);
        passed.push(chunk[results.indexOf(settled)]);
        continue;
      }
      const { candidate, result } = settled.value;
      // Only hard-drop when confidence is high AND viable is false.
      // Low/medium confidence rejections still go through the expensive pipeline.
      if (!result.viable && result.confidence === "high") {
        console.log(
          `[prefilter] dropped (high-conf): "${candidate.title}" — ${result.reason}`
        );
        droppedCount++;
      } else {
        passed.push(candidate);
      }
    }
  }

  return { passed, droppedCount };
}

// ---- Stage 4: Perplexity research with caching ----

/**
 * Run Perplexity research for a batch of candidates (sequential to respect
 * rate limits). Returns a map from title (unique within a run) to research
 * results so we can merge them back into signals.
 */
async function runResearchBatch(
  candidates: CandidateSignals[]
): Promise<{
  map: Map<string, { research: JpMarketResearch; cached: boolean; productId: string }>;
  errors: string[];
}> {
  const map = new Map<string, { research: JpMarketResearch; cached: boolean; productId: string }>();
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const result = await runPerplexityResearch({
        asin: candidate.asin,
        title: candidate.title,
        category: candidate.category,
        shortDescription: candidate.overseas?.description,
      });
      map.set(candidate.title, {
        research: result.research,
        cached: result.cached,
        productId: result.productId,
      });
    } catch (err) {
      const message = `[research] failed for "${candidate.title}": ${
        err instanceof Error ? err.message : String(err)
      }`;
      errors.push(message);
      console.warn(
        message
      );
      // Continue without research data — scorer handles missing perplexity gracefully
    }
  }

  return { map, errors };
}

// ---- Stage 4→5 bridge: merge research into signals ----

function deriveRegulatoryRisk(
  flags: JpMarketResearch["regulatoryFlags"]
): "low" | "medium" | "high" {
  if (flags.some((f) => f.severity === "blocker" || f.severity === "high")) return "high";
  if (flags.some((f) => f.severity === "medium")) return "medium";
  return "low";
}

function enrichSignalsWithResearch(
  signals: CandidateSignals,
  research: JpMarketResearch
): CandidateSignals {
  return {
    ...signals,
    perplexity: {
      domesticDemandTrend: research.demandTrend,
      regulatoryRisk: deriveRegulatoryRisk(research.regulatoryFlags),
      summary: research.summary,
      jpCompetitorCount: research.jpCompetitors.count,
      jpCfSuccessCount: research.jpCFHistory.successCount,
      medianPriceJpy: research.jpCompetitors.priceRangeJpy.median,
      demandDrivers: research.marketSignals.demandDrivers,
      targetSegments: research.marketSignals.targetSegments,
      purchaseOccasions: research.marketSignals.purchaseOccasions,
      makuakeAngle: research.positioning.makuakeAngle,
      differentiation: research.positioning.differentiation,
      giftability: research.positioning.giftability,
      visualStoryPotential: research.positioning.visualStoryPotential,
      recommendedPriceJpy: research.pricing.recommendedPriceJpy,
      expectedMarginRisk: research.pricing.expectedMarginRisk,
      certificationNeeds: research.importFeasibility.certificationNeeds,
      logisticsNotes: research.importFeasibility.logisticsNotes,
      blockerLikelihood: research.importFeasibility.blockerLikelihood,
      goNoGo: research.goNoGo,
      confidence: research.confidence,
      // Pass citation URLs through so scout-scoring can cite them as evidence.
      evidence: research.evidence,
    },
  };
}

// ---- Stage 5: parallel scoring with concurrency cap ----

type ScoredScoutResult = {
  title: string;
  score: number;
  verdict: ScoringOutput["verdict"];
  runId: string;
  productId: string;
  enqueuedApprovalId: string | null;
};

async function scoreBatch(
  candidates: CandidateSignals[],
  concurrency = 3
): Promise<{ results: ScoredScoutResult[]; errors: string[] }> {
  const results: ScoredScoutResult[] = [];
  const errors: string[] = [];

  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map((candidate) => scoreCandidate(candidate))
    );

    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      const candidate = chunk[j];
      if (s.status === "rejected") {
        const message = `[scoring] failed for "${candidate.title}": ${
          s.reason instanceof Error ? s.reason.message : String(s.reason)
        }`;
        errors.push(message);
        console.error(
          message
        );
        continue;
      }
      const result = s.value;
      results.push({
        title: candidate.title,
        score: result.output.score,
        verdict: result.output.verdict,
        runId: result.runId,
        productId: result.productId,
        enqueuedApprovalId: result.enqueuedApprovalId,
      });
    }
  }

  return { results, errors };
}

// ---- db helpers ----

async function insertScoutRunStart(
  triggeredBy: string,
  startedAt: Date,
  feedCount: number
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(scoutRuns)
      .values({
        triggeredBy,
        startedAt,
        feedCount,
      })
      .returning({ id: scoutRuns.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[scout_runs INSERT failed]", err);
    return null;
  }
}

async function updateScoutRunFinish(
  scoutRunId: string,
  patch: {
    finishedAt: Date;
    durationMs: number;
    rawItemCount: number;
    physicalCount: number;
    dedupDroppedCount: number;
    scoredCount: number;
    enqueuedCount: number;
    rejectedCount: number;
    perFeed: PerFeedEntry[];
    errors: string[];
  }
): Promise<void> {
  try {
    await db
      .update(scoutRuns)
      .set(patch)
      .where(eq(scoutRuns.id, scoutRunId));
  } catch (err) {
    console.error("[scout_runs UPDATE failed]", err);
  }
}

// ---- main entrypoint ----

export async function runMinimalScout(
  opts: MinimalScoutRunOptions = {}
): Promise<MinimalScoutRunResult> {
  if (!opts.skipPersistence && !hasDatabaseConfig()) {
    throw new Error(
      "DATABASE_POOL_URL, DATABASE_URL, or DATABASE_URL_DIRECT must be set for DB-backed scout runs. " +
        "Use `pnpm research:products -- --limit 30` for DB-free live source discovery."
    );
  }

  // Resolve limits. New env vars take precedence; legacy MINIMAL_SCOUT_LIMIT
  // is used only when the new ones are unset (backward compat).
  const legacyLimit = Number(process.env.MINIMAL_SCOUT_LIMIT ?? "");
  const limitPerFeed = positiveInt(
    opts.limitPerFeed ??
      Number(process.env.MINIMAL_SCOUT_LIMIT_PER_FEED ?? ""),
    Number.isFinite(legacyLimit) && legacyLimit > 0 ? Math.max(legacyLimit, 20) : 20
  );
  const llmMax = positiveInt(
    opts.llmMax ?? Number(process.env.MINIMAL_SCOUT_LLM_MAX ?? ""),
    Number.isFinite(legacyLimit) && legacyLimit > 0 ? legacyLimit : 30
  );
  const fetchTimeoutMs = positiveInt(
    Number(process.env.SCOUT_FETCH_TIMEOUT_MS ?? ""),
    15_000
  );

  // Resolve sources. Priority:
  //  1. opts.sources (test injection)
  //  2. opts.overseasFeeds/japanFeeds OR env feed lists (legacy)
  //  3. registry
  type ResolvedSource = SourceConfig & { region: FeedRegion };
  let resolvedSources: ResolvedSource[];
  if (opts.sources) {
    resolvedSources = opts.sources.map((s) => ({
      ...s,
      region: s.category === "japan_reference" ? "japan" : "overseas",
    }));
  } else if (
    opts.overseasFeeds ||
    opts.japanFeeds ||
    process.env.SCOUT_OVERSEAS_RSS_FEEDS ||
    process.env.SCOUT_JAPAN_RSS_FEEDS
  ) {
    const overseas =
      opts.overseasFeeds ??
      parseFeedEnv(process.env.SCOUT_OVERSEAS_RSS_FEEDS, "overseas") ??
      [];
    const japan =
      opts.japanFeeds ??
      parseFeedEnv(process.env.SCOUT_JAPAN_RSS_FEEDS, "japan") ??
      [];
    resolvedSources = [
      ...overseas.map<ResolvedSource>((f) => ({
        id: `legacy-${f.source}`,
        name: f.source,
        type: "rss",
        endpoint: f.url,
        enabled: true,
        category: "primary",
        region: "overseas",
      })),
      ...japan.map<ResolvedSource>((f) => ({
        id: `legacy-${f.source}`,
        name: f.source,
        type: "rss",
        endpoint: f.url,
        enabled: true,
        category: "japan_reference",
        region: "japan",
      })),
    ];
    if (resolvedSources.length === 0) {
      // env was set but empty; fall back to registry
      resolvedSources = getEnabledSources().map((s) => ({
        ...s,
        region: s.category === "japan_reference" ? "japan" : "overseas",
      }));
    }
  } else {
    resolvedSources = getEnabledSources().map((s) => ({
      ...s,
      region: s.category === "japan_reference" ? "japan" : "overseas",
    }));
  }

  const triggeredBy = opts.triggeredBy ?? "manual";
  const startedAt = new Date();

  // INSERT scout_runs at start so failures mid-run are still visible.
  const scoutRunId = opts.skipPersistence
    ? null
    : await insertScoutRunStart(triggeredBy, startedAt, resolvedSources.length);

  const fetched = await Promise.allSettled(
    resolvedSources.map(async (src) => {
      const rateLimit = rateLimitCheck(src);
      if (!rateLimit.allowed) {
        throw new Error(
          `${src.name}: rate limited; retry after ${Math.ceil(
            rateLimit.retryAfterMs / 1000
          )}s`
        );
      }
      const fetcher = getFetcher(src.type);
      const items = await fetcher(src, {
        limit: limitPerFeed,
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      return items;
    })
  );

  const errors: string[] = [];

  // Per-feed breakdown (preserves Phase A perFeed structure exactly).
  const perFeed: PerFeedEntry[] = resolvedSources.map((src, index) => {
    const settled = fetched[index];
    if (settled.status === "fulfilled") {
      return {
        name: src.name,
        url: src.endpoint,
        region: src.region,
        fetched: true,
        errorMessage: null,
        rawItemCount: settled.value.length,
        physicalItemCount: 0,
        dedupSurvivorCount: 0,
      };
    }
    const message = String(
      settled.reason instanceof Error
        ? settled.reason.message
        : settled.reason ?? "unknown error"
    );
    errors.push(`Skipping feed ${src.name}: ${message}`);
    return {
      name: src.name,
      url: src.endpoint,
      region: src.region,
      fetched: false,
      errorMessage: message,
      rawItemCount: 0,
      physicalItemCount: 0,
      dedupSurvivorCount: 0,
    };
  });

  // Collect items, tagging with region.
  const allItems: FeedItem[] = [];
  fetched.forEach((settled, index) => {
    if (settled.status !== "fulfilled") return;
    const src = resolvedSources[index];
    for (const c of settled.value) {
      allItems.push(toFeedItem(c, src.region, src));
    }
  });

  const overseasItems = allItems.filter((i) => i.region === "overseas");
  const japanRefItems = allItems.filter((i) => i.region === "japan");

  const classifiedItems = overseasItems.map((item) => ({
    item,
    classification: classifyFeedItem(item),
  }));
  const filteredCount = classifiedItems.filter(
    ({ classification }) => !isPhysicalProductCandidate(classification)
  ).length;

  // Per-feed physical counts.
  const physicalBySource = new Map<string, number>();
  for (const { item, classification } of classifiedItems) {
    if (isPhysicalProductCandidate(classification)) {
      physicalBySource.set(
        item.source,
        (physicalBySource.get(item.source) ?? 0) + 1
      );
    }
  }
  for (const entry of perFeed) {
    if (entry.region === "overseas") {
      entry.physicalItemCount = physicalBySource.get(entry.name) ?? 0;
    } else {
      entry.physicalItemCount = entry.rawItemCount;
    }
  }

  // ---- Phase B: cross-source merge replaces the old simple dedup ----
  const physicalCandidates = classifiedItems.filter(({ classification }) =>
    isPhysicalProductCandidate(classification)
  );
  const merged = mergeCrossSource(physicalCandidates);

  // dedupDroppedCount in Phase B = items absorbed by merge.
  const dedupDroppedCount = physicalCandidates.length - merged.length;

  // Per-feed dedupSurvivorCount: count the merged candidates by their primary
  // (representative) source. Preserves the Phase A semantics: "items from this
  // feed that made it past dedup as the canonical entry".
  const survivorBySource = new Map<string, number>();
  for (const m of merged) {
    const name = representativeMember(m).item.source;
    survivorBySource.set(name, (survivorBySource.get(name) ?? 0) + 1);
  }
  for (const entry of perFeed) {
    if (entry.region === "overseas") {
      entry.dedupSurvivorCount = survivorBySource.get(entry.name) ?? 0;
    } else {
      entry.dedupSurvivorCount = entry.rawItemCount;
    }
  }

  // ---- LLM cap (applied AFTER merge, with source diversity) ----
  //
  // Rank by cross-source signal, source quality, recency, and product-like
  // keywords, then allocate the LLM budget across source families so one
  // publisher/category cluster cannot consume the whole run.
  const ranked = merged
    .slice()
    .sort((a, b) => {
      const scoreDiff = candidateRankScore(b) - candidateRankScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return representativeMember(a).item.title.localeCompare(
        representativeMember(b).item.title
      );
    });
  const llmBatch = selectDiverseCandidates(ranked, llmMax);

  // ---- Stage 0: rules filter on raw merged items ----
  const postRulesItems = llmBatch.filter((m) => {
    const item = representativeMember(m).item;
    const reason = rulesRejectReason(item);
    if (reason) {
      console.log(`[rules-filter] dropped: "${item.title}" — ${reason}`);
      return false;
    }
    return true;
  });

  const rawCandidates: CandidateSignals[] = postRulesItems.map((m) =>
    toSignals(m, japanRefItems)
  );

  // ---- Stage 1: Haiku pre-filter (fast, cheap gate) ----
  const { passed: viableCandidates, droppedCount: prefilterDroppedCount } =
    await runPrefilterBatch(rawCandidates);

  console.log(
    `[scout] ${rawCandidates.length} candidates → prefilter kept ${viableCandidates.length} (dropped ${prefilterDroppedCount})`
  );

  // ---- Stage 2: Perplexity research with 7-day cache ----
  const { map: researchMap, errors: researchErrors } =
    await runResearchBatch(viableCandidates);
  errors.push(...researchErrors);

  const perplexityCacheHits = Array.from(researchMap.values()).filter(
    (r) => r.cached
  ).length;

  console.log(
    `[scout] Perplexity research: ${researchMap.size} items, ${perplexityCacheHits} from cache`
  );

  // Merge research results back into signals for scoring.
  const enrichedCandidates: CandidateSignals[] = viableCandidates.map((candidate) => {
    const entry = researchMap.get(candidate.title);
    if (!entry) return candidate; // no research data → score with signals only
    return enrichSignalsWithResearch(candidate, entry.research);
  });

  // ---- Stage 3: Sonnet scoring (parallel, deterministic) ----
  const scoringConcurrency = Number(process.env.SCOUT_SCORING_CONCURRENCY ?? "3");
  const { results: scoredResults, errors: scoringErrors } = await scoreBatch(
    enrichedCandidates,
    scoringConcurrency
  );
  errors.push(...scoringErrors);

  const enqueuedCount = scoredResults.filter((r) => r.enqueuedApprovalId).length;
  const rejectedCount = scoredResults.filter((r) => r.verdict === "reject").length;

  // ---- Stage 3.5: Deep research for high-scoring products ----
  // Runs Sonnet + 10 web searches per product — comprehensive due diligence.
  const deepResearchThreshold = Number(
    process.env.SCOUT_DEEP_RESEARCH_THRESHOLD ?? "0.75"
  );
  const deepResearchTargets = scoredResults.filter(
    (r) => r.score >= deepResearchThreshold
  );
  let deepResearchCount = 0;
  if (deepResearchTargets.length > 0) {
    console.log(
      `[scout] Deep research: ${deepResearchTargets.length} products (score >= ${deepResearchThreshold})`
    );
    for (const r of deepResearchTargets) {
      try {
        const candidate = enrichedCandidates.find((c) => c.title === r.title);
        await runDeepResearch({
          productId: r.productId,
          title: r.title,
          score: r.score,
          category: candidate?.category,
          description: candidate?.overseas?.description,
          researchSummary: candidate?.perplexity?.summary,
        });
        deepResearchCount++;
        console.log(
          `[deep-research] done: "${r.title}" (score ${r.score.toFixed(2)})`
        );
      } catch (err) {
        const message = `[deep-research] failed for "${r.title}": ${
          err instanceof Error ? err.message : String(err)
        }`;
        errors.push(message);
        console.warn(
          message
        );
      }
    }
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const rawItemCount = allItems.length;
  const physicalCount = physicalCandidates.length;

  if (scoutRunId) {
    await updateScoutRunFinish(scoutRunId, {
      finishedAt,
      durationMs,
      rawItemCount,
      physicalCount,
      dedupDroppedCount,
      scoredCount: scoredResults.length,
      enqueuedCount,
      rejectedCount,
      perFeed,
      errors,
    });
  }

  return {
    feedCount: resolvedSources.length,
    overseasCount: overseasItems.length,
    japanCount: japanRefItems.length,
    candidateCount: rawCandidates.length,
    filteredCount,
    prefilterDroppedCount,
    perplexityCacheHits,
    deepResearchCount,
    scoredCount: scoredResults.length,
    enqueuedCount,
    rejectedCount,
    errors,
    results: scoredResults,
    // ---- Phase A additions ----
    scoutRunId,
    startedAt,
    finishedAt,
    durationMs,
    rawItemCount,
    physicalCount,
    dedupDroppedCount,
    perFeed,
  };
}

// ---- exports retained for backward compatibility ----
export { fetchLegacyFeed as _fetchLegacyFeed };
export type { FeedConfig, FeedItem };

// ---- Test-only exports (Phase B). Not part of the public API. ----
export const __test = {
  mergeCrossSource,
  computeJapanValidationLevel,
  toSignals,
  toFeedItem,
};
