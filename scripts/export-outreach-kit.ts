import "./_loadenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { closeDb } from "../src/lib/db";
import { getPipelineProductsByStage } from "../src/lib/db/queries";
import type { Product } from "../src/lib/db/schema";

type Args = {
  csv: string;
  markdown: string;
  limit: number;
};

type ProductWithSummary = Product & {
  pipelineSummary: Awaited<
    ReturnType<typeof getPipelineProductsByStage>
  >[Product["stage"]][number]["pipelineSummary"];
};

const DEFAULT_CSV = "reports/outreach-kit-2026-06-19.csv";
const DEFAULT_MD = "reports/outreach-kit-2026-06-19.md";

function parseArgs(argv: string[]): Args {
  const args: Args = { csv: DEFAULT_CSV, markdown: DEFAULT_MD, limit: 30 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--csv" && next) {
      args.csv = next;
      i++;
    } else if (arg === "--markdown" && next) {
      args.markdown = next;
      i++;
    } else if (arg === "--limit" && next) {
      const parsed = Number(next);
      args.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
      i++;
    }
  }
  return args;
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function rankProducts(grouped: Awaited<ReturnType<typeof getPipelineProductsByStage>>) {
  return Object.values(grouped)
    .flat()
    .filter((product) => !product.title.startsWith("[SMOKE]"))
    .sort((a, b) => {
      const scoreA = a.pipelineSummary.shortlistScore ?? 0;
      const scoreB = b.pipelineSummary.shortlistScore ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      const priorityA = a.pipelineSummary.salesPriority ?? 0;
      const priorityB = b.pipelineSummary.salesPriority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;
      return a.title.localeCompare(b.title);
    });
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]) {
  return values.map(csvCell).join(",");
}

function hostFromUrl(url: string | null) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function contactLookupHint(product: ProductWithSummary) {
  const source = product.pipelineSummary.sourceName ?? "";
  const host = hostFromUrl(product.pipelineSummary.sourceUrl);
  if (source.includes("Kicktraq") || host.includes("kicktraq")) {
    return "Kicktraqの商品ページからKickstarter本体へ遷移し、Creator profile / campaign contact / official site / Instagramを確認";
  }
  if (host.includes("yankodesign")) {
    return "Yanko Design記事内のブランド名・公式サイト・掲載元リンクからメーカー連絡先を確認";
  }
  return "商品ページ、公式サイト、Instagram、LinkedIn、press/contactページからメーカー連絡先を確認";
}

function complianceNeeds(product: ProductWithSummary) {
  const risks = product.pipelineSummary.salesRisks.join(" ");
  const needs = [
    "卸価格/希望小売価格",
    "MOQ",
    "サンプル提供可否",
    "量産リードタイム",
    "日本での販売権/独占可否",
    "商品画像・動画の利用許諾",
    "保証/初期不良対応条件",
  ];
  if (risks.includes("PSE")) {
    needs.push("PSE対象可否", "ACアダプタ/充電器仕様", "認証書類");
  }
  if (risks.includes("技適")) {
    needs.push("Bluetooth/Wi-Fi等の無線仕様", "技適取得状況", "モジュール認証情報");
  }
  if (risks.includes("食品衛生")) {
    needs.push("食品接触材質", "検査証明", "材質表示");
  }
  needs.push("商標登録/日本代理店の有無");
  return Array.from(new Set(needs));
}

function complianceNeedsEn(product: ProductWithSummary) {
  const risks = product.pipelineSummary.salesRisks.join(" ");
  const needs = [
    "Wholesale price / suggested retail price",
    "MOQ",
    "Sample availability and sample cost",
    "Mass-production lead time",
    "Availability of Japan distribution or crowdfunding rights",
    "Permission to use product images, videos, and review materials",
    "Warranty and defect-handling terms",
  ];
  if (risks.includes("PSE")) {
    needs.push("Whether PSE applies", "AC adapter / charger specifications", "Certification documents");
  }
  if (risks.includes("技適")) {
    needs.push("Bluetooth/Wi-Fi radio specifications", "Japan TELEC/Giteki certification status", "Module certification details");
  }
  if (risks.includes("食品衛生")) {
    needs.push("Food-contact material details", "Inspection certificates", "Material labeling information");
  }
  needs.push("Trademark status and existing Japan distributors");
  return Array.from(new Set(needs));
}

function firstQuestions(product: ProductWithSummary) {
  return [
    "日本でのMakuake/クラウドファンディング展開は可能でしょうか。",
    "日本での既存代理店、販売制限、商標上の制限はありますか。",
    "初回ロットのMOQ、卸価格、サンプル費用、量産リードタイムを教えてください。",
    "日本語LP/広告で商品画像・動画・レビュー素材を使用できますか。",
    ...complianceNeeds(product)
      .filter((need) => /PSE|技適|食品/.test(need))
      .map((need) => `${need}について確認できますか。`),
  ];
}

function englishJapanAngle(product: ProductWithSummary) {
  const angle = product.pipelineSummary.japanAngle ?? "";
  if (angle.includes("持ち運び") || angle.includes("旅行")) {
    return "it can be positioned around portability, travel, and compact daily use for Japanese early adopters";
  }
  if (angle.includes("睡眠") || angle.includes("デスク") || angle.includes("ウェルネス")) {
    return "it has a strong desk, wellness, and daily productivity angle for Japanese crowdfunding supporters";
  }
  if (angle.includes("Makuake類似") || angle.includes("競合")) {
    return "there may be comparable demand on Makuake, Rakuten, and Amazon Japan if the product can be differentiated clearly";
  }
  return "it has a clear problem-solution angle for Japanese crowdfunding supporters";
}

function japaneseMarketFit(product: ProductWithSummary) {
  const angle = product.pipelineSummary.japanAngle;
  if (!angle) return "日本のMakuake/応援購入市場と相性が良い";
  return angle
    .replace(/を検証$/, "")
    .replace(/で検証$/, "")
    .replace(/検証$/, "")
    .trim();
}

function jaSubject(product: ProductWithSummary) {
  return `【日本展開のご相談】${product.title} のMakuake販売について`;
}

function enSubject(product: ProductWithSummary) {
  return `Japan Launch Opportunity for ${product.title}`;
}

function jaBody(product: ProductWithSummary) {
  const questions = firstQuestions(product).slice(0, 5);
  return [
    "突然のご連絡失礼いたします。",
    "",
    `私たちは日本市場向けに海外発プロダクトのクラウドファンディング展開を支援している [YOUR_COMPANY] です。御社の「${product.title}」を拝見し、${japaneseMarketFit(product)}という切り口で日本市場に提案できると感じ、ご連絡いたしました。`,
    "",
    "日本向け展開の可能性を検討したく、まず以下を確認させてください。",
    ...questions.map((question) => `- ${question}`),
    "",
    "条件が合えば、商品サンプル確認後に日本語LP、広告、初期顧客対応、販売後サポートまで弊社側で進行可能です。",
    "ご担当者様と20分ほどオンラインでお話しできる候補日時をいただけますと幸いです。",
    "",
    "どうぞよろしくお願いいたします。",
    "[YOUR_NAME]",
    "[YOUR_COMPANY]",
  ].join("\n");
}

function enBody(product: ProductWithSummary) {
  const needs = complianceNeedsEn(product).slice(0, 8);
  return [
    "Hello,",
    "",
    `My name is [YOUR_NAME] from [YOUR_COMPANY], a Japan-based team helping overseas products launch through Japanese crowdfunding platforms such as Makuake.`,
    "",
    `We found ${product.title} and believe it could fit the Japanese market because ${englishJapanAngle(product)}.`,
    "",
    "Could you let us know whether a Japan launch or authorized distribution partnership would be possible? We would like to confirm:",
    ...needs.map((need) => `- ${need}`),
    "",
    "If there is a fit, we can support Japanese localization, campaign page preparation, ad testing, compliance checks, fulfillment coordination, and customer support for the Japan launch.",
    "",
    "Would you be open to a short 20-minute video call next week?",
    "",
    "Best regards,",
    "[YOUR_NAME]",
    "[YOUR_COMPANY]",
  ].join("\n");
}

function toCsv(products: ProductWithSummary[]) {
  const header = [
    "rank",
    "title",
    "score",
    "stage",
    "source",
    "source_url",
    "contact_lookup_hint",
    "next_action",
    "required_checks",
    "first_questions",
    "ja_subject",
    "ja_body",
    "en_subject",
    "en_body",
  ];

  const rows = products.map((product, index) => {
    const summary = product.pipelineSummary;
    return csvLine([
      index + 1,
      product.title,
      summary.shortlistScore,
      product.stage,
      summary.sourceName,
      summary.sourceUrl,
      contactLookupHint(product),
      summary.nextAction,
      complianceNeeds(product).join(" / "),
      firstQuestions(product).join(" / "),
      jaSubject(product),
      jaBody(product),
      enSubject(product),
      enBody(product),
    ]);
  });

  return [csvLine(header), ...rows].join("\n") + "\n";
}

function toMarkdown(products: ProductWithSummary[]) {
  const lines = [
    "# Outreach Kit",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Products: ${products.length}`,
    "",
    "## Product Outreach Drafts",
    "",
  ];

  for (const [index, product] of products.entries()) {
    const summary = product.pipelineSummary;
    lines.push(
      `### ${index + 1}. ${product.title}`,
      "",
      `- Score: ${summary.shortlistScore ?? "-"} / Stage: ${product.stage}`,
      `- Source: ${summary.sourceName ?? "-"}${summary.sourceUrl ? ` <${summary.sourceUrl}>` : ""}`,
      `- Contact lookup: ${contactLookupHint(product)}`,
      `- Required checks: ${complianceNeeds(product).join(" / ")}`,
      `- Next action: ${summary.nextAction ?? "-"}`,
      "",
      "#### 日本語メール",
      "",
      `Subject: ${jaSubject(product)}`,
      "",
      "```text",
      jaBody(product),
      "```",
      "",
      "#### English Email",
      "",
      `Subject: ${enSubject(product)}`,
      "",
      "```text",
      enBody(product),
      "```",
      ""
    );
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const grouped = await getPipelineProductsByStage();
  const products = rankProducts(grouped).slice(0, args.limit);
  if (products.length === 0) {
    throw new Error("No products found in the local DB. Run pnpm local:bootstrap first.");
  }

  const csvPath = abs(args.csv);
  const mdPath = abs(args.markdown);
  await mkdir(dirname(csvPath), { recursive: true });
  await mkdir(dirname(mdPath), { recursive: true });
  await writeFile(csvPath, toCsv(products), "utf8");
  await writeFile(mdPath, toMarkdown(products), "utf8");

  console.log(`wrote ${csvPath}`);
  console.log(`wrote ${mdPath}`);
  console.log(`exported ${products.length} product(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
