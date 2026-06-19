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

export type LpCopyAsset = {
  headline: string | null;
  subheadline: string | null;
  bullets: string[];
  cta: string | null;
  problemStatement: string | null;
  productSolution: string | null;
};

export type ComplianceAsset = {
  riskLevel: string | null;
  violations: Array<{
    snippet: string | null;
    regulation: string | null;
    severity: string | null;
  }>;
  suggestions: string[];
};

export type FaqAsset = { question: string; answer: string };
export type ImageAsset = {
  slot: string | null;
  prompt: string | null;
  source: string | null;
};

export type AdAsset = {
  headlines: string[];
  descriptions: string[];
};

export type OutreachAsset = {
  ja: { subject: string | null; body: string | null };
  en: { subject: string | null; body: string | null };
};

export type CsAsset = Record<
  "inquiry" | "complaint" | "refund",
  { subject: string | null; body: string | null }
>;

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
  shortlistRank: number | null;
  shortlistScore: number | null;
  japanAngle: string | null;
  nextAction: string | null;
  salesPriority: number | null;
  salesReasons: string[];
  salesRisks: string[];
  importedAt: string | null;
  sourceReportGeneratedAt: string | null;
  lpCopy: LpCopyAsset | null;
  lpCompliance: ComplianceAsset | null;
  lpFaqs: FaqAsset[];
  lpImages: ImageAsset[];
  ad: AdAsset | null;
  outreach: OutreachAsset | null;
  cs: CsAsset | null;
};
