export type ScoutVerdict = "approve" | "reject" | "escalate";
export type ScoutProductType = "physical" | "digital" | "service" | "unknown";

export type ScoutAxisScore = { score: number; rationale: string };
export const SCOUT_AXIS_KEYS = [
  "overseasTraction",
  "crossSourceMentions",
  "japanValidationLevel",
  "domesticTrend",
  "regulatoryRisk",
  "competitionDensity",
  "priceFit",
  "physicalLikely",
  "novelty",
] as const;
export type ScoutAxisKey = (typeof SCOUT_AXIS_KEYS)[number];
export type ScoutAxisScores = Partial<Record<ScoutAxisKey, ScoutAxisScore>>;

export type ScoutEvidenceItem = {
  claim: string;
  sourceUrl: string;
  snippet: string;
};

export type ScoutReviewDetails = {
  sourceName: string | null;
  sourceUrl: string | null;
  description: string | null;
  publishedAt: string | null;
  category: string | null;
  score: number | null;
  verdict: ScoutVerdict | null;
  rationale: string | null;
  pros: string[];
  cons: string[];
  suggestedPriority: number | null;
  provider: string | null;
  model: string | null;
  productType: ScoutProductType | null;
  physicalProductLikely: boolean | null;
  exclusionReason: string | null;
  japanSummary: string | null;
  domesticExamples: string[];
  similarProductCount: number | null;
  notYetInJapan: boolean | null;
  axisScores: ScoutAxisScores | null;
  evidence: ScoutEvidenceItem[];
  mentionSources: string[];
  japanValidationLevel: number | null;
};
