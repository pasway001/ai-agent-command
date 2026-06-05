/**
 * Standalone research demo — DB 不要、Anthropic API キーだけで動く。
 *
 * 1. 実際のRSSソースから商品を取得
 * 2. ルールフィルター（無料）
 * 3. Haiku プレフィルター（Claude API 直接呼び出し）
 * 4. Sonnet + web_search でリサーチ（本番と同じプロンプト）
 * 5. 結果を見やすく表示
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... tsx scripts/demo-research.ts
 *   ANTHROPIC_API_KEY=sk-ant-... DEMO_LIMIT=3 tsx scripts/demo-research.ts
 */
import "./_loadenv";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("❌  ANTHROPIC_API_KEY が未設定です。");
  console.error("   export ANTHROPIC_API_KEY=sk-ant-... を実行してから再試行してください。");
  process.exit(1);
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";
const DEMO_LIMIT = Number(process.env.DEMO_LIMIT ?? "2"); // 何商品リサーチするか

// ─── RSS フェッチ ────────────────────────────────────────────────────────────

const DEMO_SOURCES = [
  { name: "Kicktraq Gadgets",      url: "https://www.kicktraq.com/categories/technology/gadgets/latest.rss" },
  { name: "Kicktraq Hardware",     url: "https://www.kicktraq.com/categories/technology/hardware/latest.rss" },
  { name: "BackerKit",             url: "https://www.backerkit.com/crowdfunding.rss" },
];

type RawItem = { title: string; description?: string; url?: string; source: string };

async function fetchRss(source: { name: string; url: string }): Promise<RawItem[]> {
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ScoutBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const items: RawItem[] = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(xml)) !== null) {
      const block = m[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                     block.match(/<title>(.*?)<\/title>/))?.[1]?.trim();
      const desc  = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                     block.match(/<description>([\s\S]*?)<\/description>/))?.[1]?.trim();
      const link  = (block.match(/<link>(.*?)<\/link>/) ||
                     block.match(/<guid[^>]*>(.*?)<\/guid>/))?.[1]?.trim();
      if (title) {
        items.push({
          title,
          description: desc ? desc.replace(/<[^>]+>/g, "").slice(0, 400) : undefined,
          url: link,
          source: source.name,
        });
      }
    }
    return items.slice(0, 30);
  } catch (err) {
    console.warn(`  [RSS] ${source.name}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// ─── Stage 0: ルールフィルター ───────────────────────────────────────────────

function rulesReject(title: string): string | null {
  const t = title.toLowerCase();
  if (!t) return "empty";
  if (/^(ask|tell|poll)\s+hn[:]/i.test(title)) return "HN discussion";
  if (/\b(series [a-e]|seed round|fundraising)\b/i.test(t)) return "funding news";
  if (/^(\[hiring\]|hiring[:,])/i.test(title)) return "job posting";
  if (/\b([3-9]|\d{2,})\s+(companies|startups|tools|apps|ways|tips|resources)\b/i.test(t)) return "listicle";
  if (/^(top|best)\s+([3-9]|\d{2,})\b/i.test(t)) return "listicle";
  if (/\b(acqui[a-z]*|merger|acquired by)\b/i.test(t)) return "acquisition news";
  if (/\b(documentary|podcast episode|new album|newsletter about)\b/i.test(t)) return "media content";
  return null;
}

// ─── Stage 1: Haiku プレフィルター ───────────────────────────────────────────

async function haikuPrefilter(item: RawItem): Promise<{ viable: boolean; reason: string; confidence: string }> {
  const prompt = `You are screening crowdfunding products for Japan import viability.

Product: ${item.title}
${item.description ? `Description: ${item.description}` : ""}

Respond with JSON only:
{
  "viable": true/false,
  "reason": "one sentence",
  "confidence": "low" | "medium" | "high"
}

Drop only if: not a physical product, price likely <$20 or >$5000, obviously illegal to import to Japan, or clearly a service/software.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 200,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Haiku API error: ${res.status}`);
  const body = await res.json() as { content?: Array<{ text?: string }> };
  const text = body.content?.find((c) => c.text)?.text?.trim() ?? "{}";
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    return { viable: json.viable ?? true, reason: json.reason ?? "", confidence: json.confidence ?? "medium" };
  } catch {
    return { viable: true, reason: "parse error, passing through", confidence: "low" };
  }
}

// ─── Stage 2: Sonnet + web_search リサーチ ───────────────────────────────────

const RESEARCH_SYSTEM_PROMPT = `You are a Japan import-business market researcher specializing in crowdfunding product sourcing.
For the given product, use all 8 web searches with this strategy:

検索戦略（8回を無駄なく使う）:
• 検索 1-2: Amazon JP・楽天・Yahoo!ショッピング — 競合品の価格帯・レビュー数・出品者数
• 検索 3-4: Makuake・GREEN FUNDING・CAMPFIRE — 類似キャンペーンの達成率・調達総額・支援者数
• 検索 5-6: 日本消費者需要 — SNS言及数・季節需要・ターゲット層の特定
• 検索 7: 規制リスク詳細 — PSE認証要否・技適・薬機法・食品衛生法の具体的適用判断
• 検索 8: 輸入障壁 — 関税分類・一般的な輸入量・既存輸入業者の有無

Return strict JSON only:
{
  "jpCompetitors": {
    "count": number,
    "priceRangeJpy": { "min": number, "median": number, "max": number },
    "examples": [{ "name": string, "platform": string, "priceJpy": number, "reviewNote": string }]
  },
  "jpCFHistory": {
    "campaigns": [{ "platform": string, "title": string, "pledgedJpy": number, "achievementPct": number, "url": string }],
    "successCount": number,
    "totalFound": number
  },
  "regulatoryFlags": [{ "law": string, "severity": "none"|"low"|"medium"|"high"|"blocker", "reason": string }],
  "demandTrend": "rising"|"flat"|"declining",
  "summary": "2-3 Japanese sentences with opportunity AND risk",
  "evidence": [{ "claim": string, "sourceUrl": string, "snippet": string }]
}`;

type ResearchResult = {
  jpCompetitors: { count: number; priceRangeJpy: { min?: number; median?: number; max?: number }; examples: Array<{name:string;platform:string;priceJpy?:number;reviewNote?:string}> };
  jpCFHistory: { campaigns: Array<{platform:string;title:string;pledgedJpy?:number;achievementPct?:number;url?:string}>; successCount: number; totalFound: number };
  regulatoryFlags: Array<{ law: string; severity: string; reason: string }>;
  demandTrend: string;
  summary: string;
  evidence: Array<{ claim: string; sourceUrl: string; snippet: string }>;
};

async function sonnetResearch(item: RawItem): Promise<{ result: ResearchResult; webSearches: number; costUsd: number }> {
  const query = [
    `Product: ${item.title}`,
    item.description ? `Description: ${item.description}` : null,
    `Source: ${item.source}`,
    item.url ? `URL: ${item.url}` : null,
    "",
    "Search for this product or close alternatives in the Japanese market.",
    "Focus on Amazon Japan, Rakuten, Yahoo Shopping, Makuake, GREEN FUNDING, and CAMPFIRE.",
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY!,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      max_tokens: 6000,
      temperature: 0.1,
      system: [{ type: "text", text: RESEARCH_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 8,
        user_location: { type: "approximate", city: "Tokyo", region: "Tokyo", country: "JP", timezone: "Asia/Tokyo" },
      }],
      messages: [{ role: "user", content: query + "\n\nReturn valid JSON only. No markdown fences." }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sonnet API error: ${res.status} — ${err.slice(0, 200)}`);
  }

  const body = await res.json() as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; server_tool_use?: { web_search_requests?: number } };
  };

  const text = body.content?.filter(c => c.type === "text").map(c => c.text ?? "").join("").trim() ?? "";
  const webSearches = body.usage?.server_tool_use?.web_search_requests ?? 0;

  const inPer1m = 3, outPer1m = 15;
  const tokensIn = body.usage?.input_tokens ?? 0;
  const tokensOut = body.usage?.output_tokens ?? 0;
  const cacheRead = body.usage?.cache_read_input_tokens ?? 0;
  const costUsd = (tokensIn / 1e6) * inPer1m + (tokensOut / 1e6) * outPer1m + (cacheRead / 1e6) * inPer1m * 0.1;

  let parsed: ResearchResult;
  try {
    // Strip markdown fences and any prose before/after the JSON object
    const stripped = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object found");
    const jsonStr = stripped.slice(start, end + 1);
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    // Fallback: try to parse the entire text as-is
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      throw new Error(`JSON parse failed (${e instanceof Error ? e.message : e}). Raw:\n${text.slice(0, 600)}`);
    }
  }

  return { result: parsed, webSearches, costUsd };
}

// ─── 表示ヘルパー ─────────────────────────────────────────────────────────────

const RESET = "\x1b[0m", BOLD = "\x1b[1m", DIM = "\x1b[2m";
const GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RED = "\x1b[31m", CYAN = "\x1b[36m", BLUE = "\x1b[34m";

function severityColor(s: string) {
  if (s === "blocker" || s === "high") return RED;
  if (s === "medium") return YELLOW;
  return GREEN;
}

function trendColor(t: string) {
  if (t === "rising") return GREEN;
  if (t === "declining") return RED;
  return YELLOW;
}

function printResearch(item: RawItem, r: ResearchResult, searches: number, cost: number) {
  const sep = `${DIM}${"─".repeat(70)}${RESET}`;
  console.log(`\n${BOLD}${CYAN}━━━ RESEARCH RESULT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}商品名${RESET}: ${item.title}`);
  console.log(`${BOLD}ソース${RESET}: ${item.source}`);
  if (item.url) console.log(`${BOLD}URL${RESET}:   ${DIM}${item.url}${RESET}`);
  console.log(`${BOLD}検索回数${RESET}: ${searches}回 / コスト: $${cost.toFixed(4)}`);
  console.log(sep);

  // Demand
  const trend = r.demandTrend ?? "flat";
  console.log(`\n${BOLD}📈 需要トレンド${RESET}: ${trendColor(trend)}${BOLD}${trend.toUpperCase()}${RESET}`);

  // Competitors
  console.log(`\n${BOLD}🛍️  日本競合 (${r.jpCompetitors.count}件)${RESET}`);
  const pr = r.jpCompetitors.priceRangeJpy;
  if (pr.median) console.log(`   価格帯: ¥${(pr.min ?? 0).toLocaleString()} 〜 ¥${(pr.max ?? 0).toLocaleString()} (中央値 ¥${pr.median.toLocaleString()})`);
  for (const ex of r.jpCompetitors.examples ?? []) {
    console.log(`   • ${ex.name} [${ex.platform}]${ex.priceJpy ? ` — ¥${ex.priceJpy.toLocaleString()}` : ""}${ex.reviewNote ? ` (${ex.reviewNote})` : ""}`);
  }

  // CF History
  console.log(`\n${BOLD}🚀 国内CF実績 (${r.jpCFHistory.successCount}件成功 / 計${r.jpCFHistory.totalFound}件)${RESET}`);
  for (const c of r.jpCFHistory.campaigns ?? []) {
    const pct = c.achievementPct ? ` ${c.achievementPct}%達成` : "";
    const pledged = c.pledgedJpy ? ` ¥${c.pledgedJpy.toLocaleString()}` : "";
    console.log(`   • [${c.platform}] ${c.title}${pledged}${pct}`);
  }
  if ((r.jpCFHistory.campaigns ?? []).length === 0) console.log(`   (類似事例なし)`);

  // Regulatory
  console.log(`\n${BOLD}⚖️  規制リスク${RESET}`);
  if ((r.regulatoryFlags ?? []).length === 0) {
    console.log(`   ${GREEN}問題なし${RESET}`);
  } else {
    for (const f of r.regulatoryFlags) {
      console.log(`   ${severityColor(f.severity)}[${f.severity.toUpperCase()}]${RESET} ${f.law}: ${f.reason}`);
    }
  }

  // Summary
  console.log(`\n${BOLD}💡 サマリー${RESET}`);
  console.log(`   ${r.summary}`);

  // Evidence
  if ((r.evidence ?? []).length > 0) {
    console.log(`\n${BOLD}🔗 エビデンス (${r.evidence.length}件)${RESET}`);
    for (const e of r.evidence.slice(0, 4)) {
      console.log(`   • ${DIM}${e.claim}${RESET}`);
      console.log(`     ${BLUE}${e.sourceUrl}${RESET}`);
    }
    if (r.evidence.length > 4) console.log(`   ... 他 ${r.evidence.length - 4} 件`);
  }

  console.log(`\n${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
}

// ─── メイン ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}Agent Command Center — リサーチデモ${RESET}`);
  console.log(`モデル: ${HAIKU_MODEL} (prefilter) + ${SONNET_MODEL} (research)`);
  console.log(`対象: 最大 ${DEMO_LIMIT} 商品をリサーチします\n`);

  // Step 1: RSS取得
  console.log(`${BOLD}Step 1: RSS フェッチ${RESET}`);
  const allItems: RawItem[] = [];
  for (const src of DEMO_SOURCES) {
    process.stdout.write(`  ${src.name}... `);
    const items = await fetchRss(src);
    console.log(`${items.length}件`);
    allItems.push(...items);
  }
  console.log(`  合計: ${allItems.length}件\n`);

  // Step 2: ルールフィルター
  console.log(`${BOLD}Step 2: ルールフィルター${RESET}`);
  const passed: RawItem[] = [];
  for (const item of allItems) {
    const reason = rulesReject(item.title);
    if (reason) {
      console.log(`  ${DIM}SKIP [rules] ${item.title.slice(0, 60)} — ${reason}${RESET}`);
    } else {
      passed.push(item);
    }
  }
  console.log(`  通過: ${passed.length}件\n`);

  // Step 3: Haiku プレフィルター（先頭から絞る）
  console.log(`${BOLD}Step 3: Haiku プレフィルター${RESET}`);
  const viable: RawItem[] = [];
  let prefilterChecked = 0;
  for (const item of passed) {
    if (viable.length >= DEMO_LIMIT * 2) break; // 必要数の2倍通ったら止める
    prefilterChecked++;
    process.stdout.write(`  [${prefilterChecked}] ${item.title.slice(0, 50)}... `);
    try {
      const r = await haikuPrefilter(item);
      if (!r.viable && r.confidence === "high") {
        console.log(`${RED}SKIP${RESET} (${r.confidence}) ${r.reason}`);
      } else {
        console.log(`${GREEN}OK${RESET} (${r.confidence}) ${r.reason}`);
        viable.push(item);
      }
    } catch (err) {
      console.log(`${YELLOW}ERROR — passing through${RESET}: ${err instanceof Error ? err.message : err}`);
      viable.push(item);
    }
  }
  console.log(`  通過: ${viable.length}件\n`);

  // Step 4: Sonnet リサーチ（上位 DEMO_LIMIT 件）
  const targets = viable.slice(0, DEMO_LIMIT);
  console.log(`${BOLD}Step 4: Sonnet + web_search リサーチ (${targets.length}件)${RESET}`);
  console.log(`  各商品で最大8回Web検索します。少し時間がかかります...\n`);

  let totalCost = 0;
  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    console.log(`${BOLD}  [${i + 1}/${targets.length}] ${item.title}${RESET}`);
    try {
      const { result, webSearches, costUsd } = await sonnetResearch(item);
      totalCost += costUsd;
      printResearch(item, result, webSearches, costUsd);
    } catch (err) {
      console.log(`  ${RED}リサーチ失敗${RESET}: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  console.log(`${BOLD}合計コスト: $${totalCost.toFixed(4)}${RESET}`);
  console.log(`${DIM}(本番はDB + 7日キャッシュ + スコアリング + Inboxまで続きます)${RESET}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
