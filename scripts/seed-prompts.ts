import "./_loadenv";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { agentPrompts } from "../src/lib/db/schema";
import { createPromptVersion } from "../src/lib/agent-sdk";

import * as scoringAgent from "../src/lib/agents/scout-scoring";
import * as keepaAgent from "../src/lib/agents/scout-keepa";
import * as sellerspriteAgent from "../src/lib/agents/scout-sellersprite";
import * as perplexityAgent from "../src/lib/agents/scout-perplexity";
import * as copyAgent from "../src/lib/agents/lp-copy-writer";
import * as complianceAgent from "../src/lib/agents/lp-compliance";
import * as faqAgent from "../src/lib/agents/lp-faq";
import * as imageAgent from "../src/lib/agents/lp-image";
import * as adAgent from "../src/lib/agents/ad-headline";
import * as outreachAgent from "../src/lib/agents/outreach-message";
import * as csAgent from "../src/lib/agents/cs-response";

type SeedPrompt = {
  agentId: string;
  systemPrompt: string;
  model?: string;
  notes: string;
};

const seeds: SeedPrompt[] = [
  { agentId: scoringAgent.AGENT_ID,    systemPrompt: scoringAgent.DEFAULT_SYSTEM_PROMPT,    model: "mock", notes: "v1: 初期版。スコアリング基本ルール" },
  { agentId: keepaAgent.AGENT_ID,      systemPrompt: keepaAgent.DEFAULT_SYSTEM_PROMPT,      model: "mock", notes: "v1: 初期版。Keepaシグナル取得" },
  { agentId: sellerspriteAgent.AGENT_ID, systemPrompt: sellerspriteAgent.DEFAULT_SYSTEM_PROMPT, model: "mock", notes: "v1: 初期版。SellerSpriteリサーチ" },
  { agentId: perplexityAgent.AGENT_ID, systemPrompt: perplexityAgent.DEFAULT_SYSTEM_PROMPT, model: "mock", notes: "v1: 初期版。国内市場リサーチ" },
  { agentId: copyAgent.AGENT_ID,       systemPrompt: copyAgent.DEFAULT_SYSTEM_PROMPT,       model: "mock", notes: "v1: 初期版。LPコピー生成" },
  { agentId: complianceAgent.AGENT_ID, systemPrompt: complianceAgent.DEFAULT_SYSTEM_PROMPT, model: "mock", notes: "v1: 初期版。薬機法/景表法チェック" },
  { agentId: faqAgent.AGENT_ID,        systemPrompt: faqAgent.DEFAULT_SYSTEM_PROMPT,        model: "mock", notes: "v1: 初期版。FAQ生成" },
  { agentId: imageAgent.AGENT_ID,      systemPrompt: imageAgent.DEFAULT_SYSTEM_PROMPT,      model: "mock", notes: "v1: 初期版。画像案生成" },
  { agentId: adAgent.AGENT_ID,         systemPrompt: adAgent.DEFAULT_SYSTEM_PROMPT,         model: "mock", notes: "v1: 初期版。広告見出し生成" },
  { agentId: outreachAgent.AGENT_ID,   systemPrompt: outreachAgent.DEFAULT_SYSTEM_PROMPT,   model: "mock", notes: "v1: 初期版。仕入れ文面ドラフト" },
  { agentId: csAgent.AGENT_ID,         systemPrompt: csAgent.DEFAULT_SYSTEM_PROMPT,         model: "mock", notes: "v1: 初期版。CS応対テンプレ" },
];

async function main() {
  for (const s of seeds) {
    const existing = await db
      .select({ id: agentPrompts.id, version: agentPrompts.version })
      .from(agentPrompts)
      .where(eq(agentPrompts.agentId, s.agentId))
      .limit(1);

    if (existing.length > 0) {
      console.log(
        `  skip ${s.agentId}: already has ${existing.length}+ version(s) (v${existing[0].version})`
      );
      continue;
    }

    const row = await createPromptVersion({
      agentId: s.agentId,
      systemPrompt: s.systemPrompt,
      model: s.model,
      notes: s.notes,
      activate: true,
    });
    console.log(`  ✔ seeded ${s.agentId} v${row.version} (id=${row.id})`);
  }
  console.log("✔ done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
