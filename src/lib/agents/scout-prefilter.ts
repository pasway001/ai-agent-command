import { z } from "zod";
import { HAIKU_MODEL, runStructured } from "../llm";
import { resolveScoutClaudeProvider } from "./provider";
import {
  classifyProductText,
  isPhysicalProductCandidate,
} from "./product-classification";

/**
 * Stage 1 lightweight pre-filter: runs Claude Haiku (~$0.001) before the
 * expensive Perplexity + Sonnet stages. Rejects obvious non-starters without
 * touching the main agent budget.
 *
 * Deliberately bypasses runAgent() (no agent_runs row) to keep the runs table
 * clean. The decision is logged in the scout_runs.perFeed breakdown instead.
 */

export type PrefilterResult = {
  viable: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  blockers: string[];
};

const PrefilterSchema = z.object({
  viable: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().max(200),
  blockers: z.array(z.string()).default([]),
});

const SYSTEM_PROMPT = `You are a concise Japan-market viability screener for an import crowdfunding business.
Evaluate quickly whether an overseas product is worth deeper research for a Japan launch.

PASS (viable=true) when ALL of these hold:
• Physical, shippable product (NOT software, SaaS, app, service, digital content)
• Plausible retail price ¥3,000–¥120,000
• At least one distinctive feature, design point, or use case
• No hard regulatory blocker obvious from the title/description

REJECT (viable=false) immediately if ANY of:
• Intangible: software, app, platform, community, newsletter, course, template
• Pure commodity: generic phone case, cheap USB cable, unbranded power bank
• Price clearly below ¥1,500 or above ¥200,000
• Obvious 薬機法/PSE/電波法 blocker: medical device claims, uncertified radio, pharma
• Adult, weapons, or otherwise Japan-import-prohibited

Return compact JSON only. The 'reason' field must be one short Japanese sentence (≤60 chars).
Do NOT add prose. No markdown.

Schema: {"viable":bool,"confidence":"high"|"medium"|"low","reason":"...","blockers":["..."]}`;

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function mockPrefilter(title: string, description?: string): PrefilterResult {
  const seed = hashStr(`pf:${title}`);
  const text = `${title} ${description ?? ""}`.toLowerCase();
  const classification = classifyProductText({ title, description });
  const physicalLikely = isPhysicalProductCandidate(classification);

  const softwareKeywords = ["app", "software", "saas", "platform", "ai tool", "extension", "api"];
  const isSoftware = softwareKeywords.some((k) => text.includes(k));
  if (isSoftware && !physicalLikely) {
    return {
      viable: false,
      confidence: "high",
      reason: "ソフトウェア・デジタルコンテンツのため対象外",
      blockers: ["intangible_product"],
    };
  }

  if (!physicalLikely) {
    return {
      viable: false,
      confidence: classification.productType === "unknown" ? "medium" : "high",
      reason:
        classification.exclusionReason ??
        "物理的に製造・発送できる商品か判断できないため対象外",
      blockers: [classification.productType],
    };
  }

  const regulatoryKeywords = ["supplement", "サプリ", "beauty", "pharma", "医薬", "medical device"];
  const hasRegFlag = regulatoryKeywords.some((k) => text.includes(k));
  if (hasRegFlag) {
    return {
      viable: seed % 3 !== 0,
      confidence: "medium",
      reason: "規制リスク（薬機法/景表法）が懸念される",
      blockers: hasRegFlag ? ["regulatory_risk"] : [],
    };
  }

  const viabilities = [true, true, true, false] as const;
  const viable = physicalLikely ? true : viabilities[seed % viabilities.length];
  return {
    viable,
    confidence: physicalLikely ? "low" : "medium",
    reason: viable
      ? "基本条件を満たす物理商品と判断"
      : classification.exclusionReason ?? "差別化ポイントが不明確または汎用品の可能性",
    blockers: viable ? [] : [classification.exclusionReason ?? "low_differentiation"],
  };
}

/**
 * Run the Haiku pre-filter for a single candidate.
 * Returns immediately from mock when LLM_PROVIDER=mock or ANTHROPIC_API_KEY is absent.
 */
export async function runPrefilter(
  title: string,
  description?: string,
  category?: string
): Promise<PrefilterResult> {
  const lines = [`Title: ${title}`];
  if (category) lines.push(`Category: ${category}`);
  if (description) lines.push(`Description: ${description.slice(0, 400)}`);
  const user = lines.join("\n");

  const { data } = await runStructured({
    system: SYSTEM_PROMPT,
    user,
    schema: PrefilterSchema,
    model: HAIKU_MODEL,
    provider: resolveScoutClaudeProvider("SCOUT_PREFILTER_PROVIDER"),
    mock: () => mockPrefilter(title, description),
  });

  return data;
}
