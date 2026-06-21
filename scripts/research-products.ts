import "./_loadenv";
import { writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  getEnabledSources,
  getFetcher,
  rateLimitCheck,
  type NormalizedCandidate,
  type SourceConfig,
} from "../src/lib/agents/sources";
import {
  classifyProductText,
  isPhysicalProductCandidate,
} from "../src/lib/agents/product-classification";

type Args = {
  limit: number;
  perSource: number;
  timeoutMs: number;
  json: boolean;
  out: string | null;
};

type ShortlistItem = {
  rank: number;
  title: string;
  source: string;
  market: "global" | "japan";
  url: string;
  score: number;
  publishedAt: string | null;
  reasons: string[];
  risks: string[];
  japanAngle: string;
  nextAction: string;
  description: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: Number(process.env.RESEARCH_PRODUCTS_LIMIT ?? "30"),
    perSource: Number(process.env.RESEARCH_PRODUCTS_PER_SOURCE ?? "30"),
    timeoutMs: Number(process.env.SCOUT_FETCH_TIMEOUT_MS ?? "15000"),
    json: false,
    out: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--json") args.json = true;
    if (arg === "--limit" && next) {
      args.limit = Number(next);
      i++;
    }
    if (arg === "--per-source" && next) {
      args.perSource = Number(next);
      i++;
    }
    if (arg === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      i++;
    }
    if (arg === "--out" && next) {
      args.out = next;
      i++;
    }
  }

  args.limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 30;
  args.perSource =
    Number.isFinite(args.perSource) && args.perSource > 0
      ? Math.floor(args.perSource)
      : 30;
  args.timeoutMs =
    Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
      ? Math.floor(args.timeoutMs)
      : 15_000;
  return args;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function dedupeKey(item: NormalizedCandidate) {
  const host = hostOf(item.url);
  const title = normalize(item.title).slice(0, 80);
  return host ? `${host}:${title}` : title;
}

function strip(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function rulesReject(item: NormalizedCandidate, source?: SourceConfig): string | null {
  const title = item.title.toLowerCase();
  if (!title.trim()) return "empty title";
  if (/^(ask|tell|poll)\s+hn[:]/i.test(item.title)) return "HN discussion";
  if (/\b(series [a-e]|seed round|fundraising|vc funding)\b/i.test(title)) {
    return "funding announcement";
  }
  if (/^(\[hiring\]|hiring[:,]|we'?re hiring|job:|jobs:)/i.test(item.title)) {
    return "job posting";
  }
  if (/\b(acqui[a-z]*|merger|acquired by|acquires)\b/i.test(title)) {
    return "acquisition news";
  }
  if (/\b(newsletter|course|webinar|template|plugin|sdk|api|saas)\b/i.test(title)) {
    return "digital/service";
  }
  if (/\b(stl|3d\s+printable|printable\s+files?|digital\s+files?|3d\s+models?|model\s+packs?)\b/i.test(title)) {
    return "digital 3D file";
  }
  if (/\b(sex\s+toys?|adult\s+toys?|erotic|pornographic|firearms?|guns?|knives|knife|weapons?|ammo|ammunition|cbd|cannabis|nicotine|vape|tobacco)\b/i.test(title)) {
    return "restricted/adult product";
  }
  if (
    source &&
    !/kicktraq/i.test(source.name) &&
    /\b(apple|samsung|lenovo|sony|xiaomi|google|microsoft|lg|dell|hp|asus|acer|huawei|tesla|nintendo)\b/i.test(title)
  ) {
    return "major-brand news, low exclusive resale potential";
  }
  return null;
}

function riskFlags(text: string) {
  const risks: string[] = [];
  if (/\b(bluetooth|wi-?fi|wireless|radio|gps|lte|cellular)\b/i.test(text)) {
    risks.push("技適確認が必要");
  }
  if (/\b(charger|battery|power bank|adapter|heater|lamp|electric|usb)\b/i.test(text)) {
    risks.push("PSE確認が必要");
  }
  if (/\b(supplement|medical|therapy|beauty|skin|sleep apnea|pain relief)\b/i.test(text)) {
    risks.push("薬機法/景表法表現に注意");
  }
  if (/\b(food|drink|tea|coffee|snack|cookware|bottle)\b/i.test(text)) {
    risks.push("食品衛生法・材質表示を確認");
  }
  return risks.length > 0 ? risks : ["通常の輸入/PL保険/商標確認"];
}

function scoreItem(item: NormalizedCandidate, source: SourceConfig) {
  const text = `${item.title} ${item.description} ${source.name}`;
  let score = 50;
  const reasons: string[] = [];

  if (source.category === "japan_reference") {
    score += 8;
    reasons.push("国内メディア/国内CFで需要文脈を確認");
  }
  if (/kicktraq/i.test(source.name)) {
    score += 12;
    reasons.push("海外クラファン初動を確認できる");
  }
  if (/yanko|cool hunting|design milk|core77/i.test(source.name)) {
    score += 8;
    reasons.push("デザイン性の高いプロダクト文脈");
  }
  if (/trendhunter|thisiswhyimbroke/i.test(source.name)) {
    score += 7;
    reasons.push("海外の商品キュレーションで発見");
  }
  if (/new atlas|make magazine|hackaday/i.test(source.name)) {
    score += 6;
    reasons.push("海外テック/メーカー文脈からの候補");
  }
  if (item.url) {
    score += 5;
    reasons.push("一次ソースURLあり");
  }
  if (item.publishedAt) {
    const ageDays = (Date.now() - item.publishedAt.getTime()) / 86_400_000;
    if (ageDays <= 14) {
      score += 8;
      reasons.push("直近公開で鮮度が高い");
    } else if (ageDays <= 45) {
      score += 4;
      reasons.push("比較的新しい候補");
    }
  }
  if (/\b(travel|portable|pocket|compact|mini|foldable|edc|camp|outdoor)\b/i.test(text)) {
    score += 8;
    reasons.push("日本CFで訴求しやすい携帯性/省スペース性");
  }
  if (/\b(kitchen|coffee|bottle|desk|sleep|pillow|bag|wallet|stationery|organizer)\b/i.test(text)) {
    score += 7;
    reasons.push("ギフト/生活改善ニーズに接続しやすい");
  }
  if (/\b(robot|ai|sensor|smart|dock|display|camera|wearable|3d|tool)\b/i.test(text)) {
    score += 7;
    reasons.push("機能差別化を作りやすい");
  }
  if (/\b(generic|replacement|cable only|sticker|poster)\b/i.test(text)) {
    score -= 12;
    reasons.push("汎用品化リスクあり");
  }

  const risks = riskFlags(text);
  if (risks.some((risk) => risk.includes("薬機法"))) score -= 6;
  if (risks.some((risk) => risk.includes("PSE") || risk.includes("技適"))) {
    score -= 3;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons,
    risks,
  };
}

function japanAngleFor(item: NormalizedCandidate) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (/makuake|campfire|green funding|getnavi|gizmodo japan|roomie|lifehacker japan|家電 watch|impress watch/i.test(item.sourceName)) {
    return "国内で見えている需要を起点に、海外仕入れ元/独占代理店可否を確認";
  }
  if (/\b(travel|portable|pocket|compact|foldable|edc)\b/i.test(text)) {
    return "Makuakeで「持ち運び/省スペース/出張・旅行」訴求を検証";
  }
  if (/\b(kitchen|coffee|bottle|cook|food)\b/i.test(text)) {
    return "家事時短・ギフト需要・共働き世帯向けで検証";
  }
  if (/\b(sleep|pillow|desk|chair|health|wellness)\b/i.test(text)) {
    return "睡眠/デスク環境/ウェルネスの悩み解決軸で検証";
  }
  if (/\b(camera|display|dock|sensor|smart|robot|3d|tool)\b/i.test(text)) {
    return "ガジェット好き・クリエイター・仕事効率化層で検証";
  }
  return "Makuake類似成功例、Amazon JP競合、仕入れ可否を優先確認";
}

function nextActionFor(risks: string[]) {
  if (risks.some((risk) => risk.includes("技適"))) {
    return "メーカーに技適/無線仕様と日本代理店有無を確認";
  }
  if (risks.some((risk) => risk.includes("PSE"))) {
    return "PSE対象可否、認証書類、ACアダプタ構成を確認";
  }
  if (risks.some((risk) => risk.includes("薬機法"))) {
    return "効能表現を避けたLP訴求と法務チェック前提で確認";
  }
  return "Makuake/楽天/Amazon JP類似、卸条件、商標を確認";
}

function sourceGroups() {
  const sources = [
    ...getEnabledSources("primary"),
    ...getEnabledSources("japan_reference"),
  ];
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

async function fetchSource(source: SourceConfig, args: Args) {
  const rate = rateLimitCheck(source);
  if (!rate.allowed) {
    throw new Error(`rate limited; retry after ${Math.ceil(rate.retryAfterMs / 1000)}s`);
  }
  const fetcher = getFetcher(source.type);
  return fetcher(source, {
    limit: args.perSource,
    signal: AbortSignal.timeout(args.timeoutMs),
  });
}

function toMarkdown(items: ShortlistItem[], errors: string[]) {
  const lines: string[] = [
    "# Scout Product Shortlist",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
  ];
  if (errors.length > 0) {
    lines.push("## Source Warnings", "");
    errors.forEach((error) => lines.push(`- ${error}`));
    lines.push("");
  }
  lines.push("## Top Candidates", "");
  for (const item of items) {
    lines.push(
      `${item.rank}. ${item.title} (${item.score}/100)`,
      `   - Source: ${item.source}${item.url ? ` <${item.url}>` : ""}`,
      `   - Why: ${item.reasons.join(" / ") || "物理商品ソースからの候補"}`,
      `   - Japan angle: ${item.japanAngle}`,
      `   - Risks: ${item.risks.join(" / ")}`,
      `   - Next: ${item.nextAction}`,
      ""
    );
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = sourceGroups();
  const fetched = await Promise.allSettled(
    sources.map(async (source) => ({
      source,
      items: await fetchSource(source, args),
    }))
  );

  const errors: string[] = [];
  const seen = new Set<string>();
  const candidates: Array<{
    item: NormalizedCandidate;
    source: SourceConfig;
    score: number;
    reasons: string[];
    risks: string[];
  }> = [];

  for (const settled of fetched) {
    if (settled.status === "rejected") {
      errors.push(String(settled.reason instanceof Error ? settled.reason.message : settled.reason));
      continue;
    }
    const { source, items } = settled.value;
    for (const item of items) {
      if (rulesReject(item, source)) continue;
      const classification = classifyProductText({
        title: item.title,
        description: item.description,
        source: source.name,
        category: source.name,
      });
      if (!isPhysicalProductCandidate(classification)) continue;
      const key = dedupeKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const scored = scoreItem(item, source);
      candidates.push({
        item,
        source,
        score: scored.score,
        reasons: scored.reasons,
        risks: scored.risks,
      });
    }
  }

  const shortlist: ShortlistItem[] = candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, args.limit)
    .map((entry, index) => ({
      rank: index + 1,
      title: strip(entry.item.title),
      source: entry.source.name,
      market: entry.source.category === "japan_reference" ? "japan" : "global",
      url: entry.item.url,
      score: entry.score,
      publishedAt: entry.item.publishedAt?.toISOString() ?? null,
      reasons: entry.reasons,
      risks: entry.risks,
      japanAngle: japanAngleFor(entry.item),
      nextAction: nextActionFor(entry.risks),
      description: strip(entry.item.description).slice(0, 500),
    }));

  const output = args.json
    ? JSON.stringify({ generatedAt: new Date().toISOString(), errors, items: shortlist }, null, 2)
    : toMarkdown(shortlist, errors);

  if (args.out) {
    const outPath = isAbsolute(args.out) ? args.out : join(process.cwd(), args.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, output, "utf8");
    console.log(`wrote ${outPath}`);
  } else {
    console.log(output);
  }

  if (shortlist.length < args.limit) {
    console.warn(
      `warning: only ${shortlist.length}/${args.limit} candidates found. Increase --per-source or add sources.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
