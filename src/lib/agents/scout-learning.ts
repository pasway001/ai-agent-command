import { z } from "zod";
import { eq, and, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { skills, agentSkills } from "@/lib/db/schema/skills";
import { approvalQueue } from "@/lib/db/schema/queue";
import { products } from "@/lib/db/schema/products";
import { HAIKU_MODEL, runStructured } from "../llm";

const AGENT_ID = "scout.scoring";
const SKILL_SLUG = "scout.learned-patterns";

const patternSchema = z.object({
  approvedPatterns: z.string(),
  rejectedPatterns: z.string(),
});

export async function runLearningCycle(): Promise<void> {
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        decision: approvalQueue.decision,
        productTitle: products.title,
      })
      .from(approvalQueue)
      .leftJoin(products, eq(approvalQueue.productId, products.id))
      .where(
        and(
          gte(approvalQueue.decidedAt, since),
        )
      );

    const decided = rows.filter(
      (r): r is typeof r & { decision: "approve" | "reject" } =>
        r.decision === "approve" || r.decision === "reject"
    );

    if (decided.length < 3) {
      console.log(
        `[scout-learning] Not enough data to learn (${decided.length} decisions, need ≥3). Skipping.`
      );
      return;
    }

    const approved = decided.filter((r) => r.decision === "approve");
    const rejected = decided.filter((r) => r.decision === "reject");

    const approvedTitles = approved.map((r) => r.productTitle).join(", ");
    const rejectedTitles = rejected.map((r) => r.productTitle).join(", ");

    const isMock = (process.env.LLM_PROVIDER ?? "") === "mock";

    let approvedPatterns: string;
    let rejectedPatterns: string;

    if (isMock) {
      approvedPatterns = `承認商品の傾向（モック）：日本未展開、クラウドファンディング実績あり、物理製品が多い。`;
      rejectedPatterns = `却下商品の傾向（モック）：既存競合多数、規制リスクあり、デジタル製品が中心。`;
    } else {
      const result = await runStructured({
        model: HAIKU_MODEL,
        provider: "anthropic",
        schema: patternSchema,
        system:
          "あなたはクラウドファンディング市場分析の専門家です。" +
          "与えられた商品リストから共通の傾向を日本語で簡潔にまとめてください。" +
          "各パターンは150文字以内で記述してください。",
        user:
          `承認された商品（${approved.length}件）: ${approvedTitles || "なし"}\n\n` +
          `却下された商品（${rejected.length}件）: ${rejectedTitles || "なし"}\n\n` +
          "承認商品の共通傾向と却下商品の共通傾向をそれぞれ日本語150文字以内で分析してください。\n" +
          'JSONで {"approvedPatterns": "...", "rejectedPatterns": "..."} の形式で返してください。',
        mock: () => ({
          approvedPatterns: `承認商品の傾向（モック）：日本未展開、クラウドファンディング実績あり、物理製品が多い。`,
          rejectedPatterns: `却下商品の傾向（モック）：既存競合多数、規制リスクあり、デジタル製品が中心。`,
        }),
      });
      approvedPatterns = result.data.approvedPatterns.slice(0, 150);
      rejectedPatterns = result.data.rejectedPatterns.slice(0, 150);
    }

    const promptFragment =
      `## 過去の承認商品の傾向\n${approvedPatterns}\n\n` +
      `## 過去の却下商品の傾向\n${rejectedPatterns}\n\n` +
      `直近${decided.length}件の実績に基づく。`;

    // Upsert the skill
    const [upsertedSkill] = await db
      .insert(skills)
      .values({
        slug: SKILL_SLUG,
        category: "auto-learned",
        name: "過去承認/却下パターン",
        description: "直近90日の実績から自動生成",
        promptFragment,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: skills.slug,
        set: {
          promptFragment,
          description: "直近90日の実績から自動生成",
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!upsertedSkill) {
      console.error("[scout-learning] Skill upsert returned no row.");
      return;
    }

    // Attach the skill to scout.scoring agent
    await db
      .insert(agentSkills)
      .values({
        agentId: AGENT_ID,
        skillId: upsertedSkill.id,
        position: 0,
      })
      .onConflictDoUpdate({
        target: [agentSkills.agentId, agentSkills.skillId],
        set: {
          position: 0,
        },
      });

    console.log(
      `[scout-learning] Skill "${SKILL_SLUG}" upserted and attached to "${AGENT_ID}". ` +
        `Based on ${decided.length} decisions (${approved.length} approved, ${rejected.length} rejected).`
    );
  } catch (err) {
    console.error("[scout-learning] Learning cycle failed:", err);
  }
}
