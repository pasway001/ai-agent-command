export type SalesProductForOutreach = {
  title: string;
  pipelineSummary: {
    sourceName: string | null;
    sourceUrl: string | null;
    salesRisks: string[];
    japanAngle: string | null;
  };
};

function hostFromUrl(url: string | null) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function contactLookupHint(product: SalesProductForOutreach) {
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

export function complianceNeeds(product: SalesProductForOutreach) {
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

export function complianceNeedsEn(product: SalesProductForOutreach) {
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

export function firstQuestions(product: SalesProductForOutreach) {
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

function englishJapanAngle(product: SalesProductForOutreach) {
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

function japaneseMarketFit(product: SalesProductForOutreach) {
  const angle = product.pipelineSummary.japanAngle;
  if (!angle) return "日本のMakuake/応援購入市場と相性が良い";
  return angle
    .replace(/を検証$/, "")
    .replace(/で検証$/, "")
    .replace(/検証$/, "")
    .trim();
}

export function jaSubject(product: SalesProductForOutreach) {
  return `【日本展開のご相談】${product.title} のMakuake販売について`;
}

export function enSubject(product: SalesProductForOutreach) {
  return `Japan Launch Opportunity for ${product.title}`;
}

export function jaBody(product: SalesProductForOutreach) {
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

export function enBody(product: SalesProductForOutreach) {
  const needs = complianceNeedsEn(product).slice(0, 8);
  return [
    "Hello,",
    "",
    "My name is [YOUR_NAME] from [YOUR_COMPANY], a Japan-based team helping overseas products launch through Japanese crowdfunding platforms such as Makuake.",
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

export function mailtoHref(
  product: SalesProductForOutreach,
  language: "ja" | "en"
) {
  const subject = language === "ja" ? jaSubject(product) : enSubject(product);
  const body = language === "ja" ? jaBody(product) : enBody(product);
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
