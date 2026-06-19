import "./_loadenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

type ResearchJson = {
  generatedAt?: string;
  errors?: string[];
  items?: ShortlistItem[];
};

type ShortlistItem = {
  rank: number;
  title: string;
  source: string;
  url: string;
  score: number;
  publishedAt: string | null;
  reasons: string[];
  risks: string[];
  japanAngle: string;
  nextAction: string;
  description: string;
};

type Args = {
  input: string;
  out: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: "reports/scout-products-2026-06-19.json",
    out: "reports/sales-pack-2026-06-19.md",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" && next) {
      args.input = next;
      i++;
    }
    if (arg === "--out" && next) {
      args.out = next;
      i++;
    }
  }
  return args;
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function textFor(item: ShortlistItem) {
  return `${item.title} ${item.description} ${item.japanAngle}`.toLowerCase();
}

function categoryFor(item: ShortlistItem) {
  const text = textFor(item);
  if (/\b(sleep|mask|pillow|headphones|air purifier|wellness|calm)\b/i.test(text)) {
    return "ウェルネス/睡眠";
  }
  if (/\b(light|flashlight|bulb|speaker|dock|display|hub|earbuds|sensor|robot|joystick|clock)\b/i.test(text)) {
    return "ガジェット/家電";
  }
  if (/\b(bag|wallet|jewelry|watch|pins|pendants|earrings|wearable art)\b/i.test(text)) {
    return "ファッション/アクセサリー";
  }
  if (/\b(kitchen|cutting board|chef|coffee|bottle)\b/i.test(text)) {
    return "キッチン/生活雑貨";
  }
  if (/\b(mower|tufting|tool|driver|controller|diy)\b/i.test(text)) {
    return "工具/ホビー";
  }
  return "生活改善プロダクト";
}

function personaFor(item: ShortlistItem) {
  const category = categoryFor(item);
  if (category === "ウェルネス/睡眠") {
    return "睡眠の質や集中力を上げたい30〜50代のビジネス層、出張・旅行が多い層";
  }
  if (category === "ガジェット/家電") {
    return "新しいデスク環境・スマート家電に反応する20〜40代のガジェット好き";
  }
  if (category === "ファッション/アクセサリー") {
    return "人と被らない小物やギフトを探す20〜40代、推し活・デザイン雑貨好き";
  }
  if (category === "キッチン/生活雑貨") {
    return "家事時短・アウトドア・ギフト用途を重視する共働き世帯、料理好き";
  }
  if (category === "工具/ホビー") {
    return "DIY、クリエイター、クラフト、芝生管理など明確な趣味課題を持つ層";
  }
  return "日常の小さな不便を解決したいMakuake新商品好き";
}

function priceBandFor(item: ShortlistItem) {
  const text = textFor(item);
  if (/\b(robot|mower|machine|tufting|terminal|hub)\b/i.test(text)) {
    return "想定売価: 39,800〜99,800円。CFでは強い実演動画と早割が必須。";
  }
  if (/\b(earbuds|headphones|speaker|dock|display|watch|air purifier|sleep system)\b/i.test(text)) {
    return "想定売価: 12,800〜39,800円。比較表と限定カラーで単価を上げる。";
  }
  if (/\b(bag|pins|pendants|earrings|cutting board|flashlight|bulb|clock|sensor)\b/i.test(text)) {
    return "想定売価: 4,980〜14,800円。ギフト需要と複数購入セットが狙える。";
  }
  return "想定売価: 8,800〜24,800円。早割/セット割で初速を作る。";
}

function lpHeadlineFor(item: ShortlistItem) {
  const text = textFor(item);
  if (/\b(sleep|mask|pillow|headphones|calm)\b/i.test(text)) {
    return "忙しい毎日に、持ち運べるリカバリー習慣を。";
  }
  if (/\b(dock|display|hub|terminal|desk|clock)\b/i.test(text)) {
    return "デスクの情報と道具を、ひとつの美しい体験に。";
  }
  if (/\b(flashlight|bulb|light)\b/i.test(text)) {
    return "停電・キャンプ・日常をこれ一つで明るく整える。";
  }
  if (/\b(bag|jewelry|pins|earrings|watch)\b/i.test(text)) {
    return "身につけるだけで会話が生まれる、まだ日本に少ないデザイン。";
  }
  if (/\b(robot|mower|machine|controller|tool)\b/i.test(text)) {
    return "面倒な作業を、プロ仕様のスマート体験へ。";
  }
  return "海外で注目される新しい便利さを、日本の暮らしへ。";
}

function adAnglesFor(item: ShortlistItem) {
  const text = textFor(item);
  const angles = new Set<string>();
  if (/\b(portable|pocket|travel|compact|wire-free)\b/i.test(text)) {
    angles.add("外出・旅行・出張で使える携帯性");
  }
  if (/\b(sleep|wellness|calm|stress|focus)\b/i.test(text)) {
    angles.add("睡眠/集中/ストレスの悩み解決");
  }
  if (/\b(smart|ai|sensor|display|robot)\b/i.test(text)) {
    angles.add("スマート機能による時短・自動化");
  }
  if (/\b(gift|bag|jewelry|pins|earrings|watch|speaker|light)\b/i.test(text)) {
    angles.add("ギフト・限定感・所有欲");
  }
  angles.add("海外クラファン発の先行入手感");
  return Array.from(angles).slice(0, 4);
}

function outreachQuestionsFor(item: ShortlistItem) {
  const questions = [
    "日本での独占販売/先行販売の可否",
    "卸価格、MOQ、初回納期、リードタイム",
    "既存の日本代理店・商標・販売制限の有無",
  ];
  if (item.risks.some((risk) => risk.includes("PSE"))) {
    questions.push("PSE対象可否、認証書類、同梱ACアダプタ仕様");
  }
  if (item.risks.some((risk) => risk.includes("技適"))) {
    questions.push("Bluetooth/Wi-Fi等の無線仕様、技適取得予定");
  }
  if (item.risks.some((risk) => risk.includes("食品衛生"))) {
    questions.push("食品接触材質、検査証明、材質表示の提出可否");
  }
  return questions;
}

function priorityFor(item: ShortlistItem) {
  if (item.score >= 90) return "S";
  if (item.score >= 84) return "A";
  if (item.score >= 80) return "B";
  return "C";
}

function onePager(item: ShortlistItem) {
  const category = categoryFor(item);
  const adAngles = adAnglesFor(item);
  const questions = outreachQuestionsFor(item);
  return [
    `## ${item.rank}. ${item.title}`,
    "",
    `- Priority: ${priorityFor(item)} / Score: ${item.score}/100 / Category: ${category}`,
    `- Source: ${item.source}${item.url ? ` <${item.url}>` : ""}`,
    `- Target: ${personaFor(item)}`,
    `- Price: ${priceBandFor(item)}`,
    `- LP headline: ${lpHeadlineFor(item)}`,
    `- Ad angles: ${adAngles.join(" / ")}`,
    `- Japan validation: ${item.japanAngle}`,
    `- Risks: ${item.risks.join(" / ")}`,
    `- First outreach questions: ${questions.join(" / ")}`,
    `- Next action: ${item.nextAction}`,
    "",
  ].join("\n");
}

function summary(items: ShortlistItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const category = categoryFor(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const categoryLine = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${category}: ${count}`)
    .join(" / ");
  const top = items.slice(0, 5).map((item) => `${item.rank}. ${item.title}`).join(" / ");
  return [
    "# Japan Sales Readiness Pack",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Input items: ${items.length}`,
    `Category mix: ${categoryLine}`,
    `Top 5: ${top}`,
    "",
    "## Operating Notes",
    "",
    "- This is a pre-sales pack for quick human review, supplier outreach, LP angle testing, and ad hypothesis setup.",
    "- Final go/no-go still requires manufacturer confirmation, Japan compliance checks, landed-cost calculation, and direct competitor validation.",
    "- Push S/A items into the DB-backed Scout pipeline once `DATABASE_URL` and API keys are configured in Vercel.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readFile(abs(args.input), "utf8");
  const parsed = JSON.parse(raw) as ResearchJson;
  const items = parsed.items ?? [];
  if (items.length === 0) {
    throw new Error(`No items found in ${args.input}. Generate JSON with pnpm research:products -- --json --out ${args.input}`);
  }

  const body = [
    summary(items),
    ...items.map(onePager),
  ].join("\n");

  const outPath = abs(args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, body, "utf8");
  console.log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
