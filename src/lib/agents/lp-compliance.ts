import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "lp.compliance_check";

export const DEFAULT_SYSTEM_PROMPT = `You are a Japanese 薬機法 / 景表法 compliance checker for e-commerce LP copy.
Given the LP copy of a product, return JSON:
{
  riskLevel: "low" | "medium" | "high",
  violations: [{ snippet, regulation, severity }],
  suggestions: [string]
}
Be conservative — flag any unsupported efficacy claims.`;

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
