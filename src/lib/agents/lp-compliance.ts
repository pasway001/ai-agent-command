import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "lp.compliance_check";

export const DEFAULT_SYSTEM_PROMPT = `You are a Japanese regulatory compliance specialist for crowdfunding LP copy (Makuake / GREEN FUNDING).
Expertise: 薬機法, 景表法, PSE法, 電波法(技適), 食品衛生法, and CF-specific advertising rules.

## Regulation checklist

### 薬機法 (highest priority)
Flag: therapeutic claims (治る/効果がある/症状が改善/医師が推薦),
drug-like efficacy for cosmetics/supplements, before/after body transformation without evidence.
Severity: high if explicit; medium if implied.

### 景表法
Flag: unsubstantiated No.1/最高/業界最高, misleading price comparisons,
vague 数量限定 without actual cap, ambiguous country-of-origin.
Severity: medium; high if numbers are fabricated.

### PSE / 技適
Flag: electronics copy without PSE mention (required for electrical appliances).
Flag: wireless products (Bluetooth/Wi-Fi/NFC) without 技適 mention.
Severity: medium — seller must verify compliance.

### 食品衛生法 / 機能性表示食品
Flag: health foods claiming specific body effects without 機能性表示食品 registration,
supplement copy using disease names, before/after weight/blood-value claims.
Severity: high.

### CF-specific risks (Makuake固有)
Flag: guaranteed delivery dates (必ず〇月に届きます → must be 予定).
Flag: 返金保証 without explaining CF refund policy.
Flag: implying product is already on sale when it is a pre-order.
Severity: medium.

## Output rules
- Be exhaustive — better to over-flag than miss a real violation
- For each violation: exact snippet + regulation name + corrected suggestion
- riskLevel: high if any high violation; medium if any medium; else low
- Return strict JSON only`;

const ComplianceOutputSchema = z.object({
  riskLevel: z.enum(["low", "medium", "high"]),
  violations: z.array(
    z.object({
      snippet: z.string(),
      regulation: z.string(),
      severity: z.enum(["low", "medium", "high"]),
    })
  ),
  suggestions: z.array(z.string()),
});
export type ComplianceOutput = z.infer<typeof ComplianceOutputSchema>;

const RISKY_PHRASES: { phrase: string; regulation: string; severity: "low" | "medium" | "high" }[] = [
  { phrase: "効きます", regulation: "薬機法 第66条 (誇大広告)", severity: "high" },
  { phrase: "治る", regulation: "薬機法 第66条", severity: "high" },
  { phrase: "やせる", regulation: "薬機法 / 景表法 (優良誤認)", severity: "high" },
  { phrase: "ダイエット", regulation: "景表法 (優良誤認の恐れ)", severity: "medium" },
  { phrase: "美白", regulation: "薬機法 (化粧品表示)", severity: "medium" },
  { phrase: "完治", regulation: "薬機法 第66条", severity: "high" },
  { phrase: "確実に", regulation: "景表法 (優良誤認)", severity: "medium" },
  { phrase: "No.1", regulation: "景表法 (優良誤認)", severity: "low" },
];

function flatten(copy: Record<string, unknown> | null | undefined): string {
  if (!copy) return "";
  return Object.values(copy)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === "string")
    .join(" ");
}

function mockCompliance(text: string): ComplianceOutput {
  const violations = RISKY_PHRASES.flatMap((r) =>
    text.includes(r.phrase)
      ? [{ snippet: r.phrase, regulation: r.regulation, severity: r.severity }]
      : []
  );
  const hasHigh = violations.some((v) => v.severity === "high");
  const hasMedium = violations.some((v) => v.severity === "medium");
  const riskLevel: ComplianceOutput["riskLevel"] = hasHigh
    ? "high"
    : hasMedium
      ? "medium"
      : "low";
  const suggestions =
    violations.length === 0
      ? ["特に修正不要。表現を維持して問題ありません。"]
      : violations.map(
          (v) => `「${v.snippet}」は ${v.regulation} に抵触する恐れ。代替表現に置き換えてください。`
        );
  return { riskLevel, violations, suggestions };
}

export async function runComplianceCheck(productId: string, parentRunId?: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) throw new Error(`product ${productId} not found`);

  const meta = (product.metadata ?? {}) as { lp?: { copy?: Record<string, unknown> } };
  const copyText = flatten(meta.lp?.copy);

  const outcome = await runAgent({
    agentId: AGENT_ID,
    productId,
    parentRunId,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    user: `Copy text to review:\n${copyText}`,
    schema: ComplianceOutputSchema,
    mock: () => mockCompliance(copyText),
    inputPayload: { copyText },
  });

  await mergeProductMetadata(productId, {
    lp: { compliance: outcome.data },
  });

  return outcome;
}
