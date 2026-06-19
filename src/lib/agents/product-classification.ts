export const PRODUCT_TYPES = ["physical", "digital", "service", "unknown"] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export type ProductClassification = {
  productType: ProductType;
  physicalProductLikely: boolean;
  exclusionReason?: string;
};

type Pattern = {
  pattern: RegExp;
  label: string;
};

type ClassifyProductTextInput = {
  title: string;
  category?: string;
  description?: string;
  source?: string;
  summary?: string;
  declaredProductType?: ProductType;
  declaredPhysicalProductLikely?: boolean;
};

const HARD_DIGITAL_PATTERNS: Pattern[] = [
  { pattern: /\bsaas\b/i, label: "SaaS" },
  { pattern: /\b(web|mobile|ios|android)\s+apps?\b/i, label: "app" },
  { pattern: /\b(browser|chrome|safari|firefox)\s+extensions?\b/i, label: "browser extension" },
  { pattern: /\b(api|sdk)\b/i, label: "API/SDK" },
  { pattern: /\b(stl|3d\s+printable|printable\s+files?|digital\s+files?|3d\s+models?|model\s+packs?)\b/i, label: "3D printable/digital file" },
  { pattern: /\b(ai\s+tools?|developer\s+tools?|devtools?)\b/i, label: "AI/developer tool" },
  { pattern: /\b(seo|website|web|site)\s+(audit|auditor|crawler|analytics?|analysis|optimizer|optimization|tools?)\b/i, label: "SEO/web tool" },
  { pattern: /\b(audit|crawler)\s+tools?\b/i, label: "SEO/web tool" },
  { pattern: /\b(llm|chatgpt|claude|ai\s+(workspace|writing|research|coding|chat|editor|generator|automation|agent|apps?))\b/i, label: "AI software" },
  { pattern: /\b(chatbots?|copilots?)\b/i, label: "AI software" },
  { pattern: /\b(newsletters?|courses?|masterclasses?|webinars?)\b/i, label: "content/course" },
  { pattern: /\b(communities|community|memberships?)\b/i, label: "community" },
  { pattern: /\b(templates?|notion\s+templates?|figma\s+templates?|prompt\s+packs?)\b/i, label: "template" },
  { pattern: /\b(e-?books?|pdfs?|digital\s+downloads?)\b/i, label: "digital content" },
  { pattern: /SaaS|AIツール|ブラウザ拡張|拡張機能|API|SDK|ニュースレター|講座|コース|ウェビナー|教材|電子書籍|テンプレ|プロンプト集|コミュニティ|会員/i, label: "digital/service keyword" },
];

const SOFT_DIGITAL_PATTERNS: Pattern[] = [
  { pattern: /\b(software|platform|crm|dashboard|analytics|automation|workflow|no-code|low-code)\b/i, label: "software/platform" },
  { pattern: /\bplugins?\b/i, label: "plugin" },
  { pattern: /\bapps?\b/i, label: "app" },
  { pattern: /ソフトウェア|プラットフォーム|アプリ|自動化|ワークフロー|ダッシュボード|分析ツール|ノーコード|ローコード/i, label: "software/app keyword" },
];

const SERVICE_PATTERNS: Pattern[] = [
  { pattern: /\b(consulting|agency|done-for-you|managed\s+service|service\s+business)\b/i, label: "service" },
  { pattern: /サービス|代行|コンサル|相談|スクール|教室|オンラインサロン|体験プラン/i, label: "service keyword" },
];

const PROHIBITED_PATTERNS: Pattern[] = [
  { pattern: /\b(sex\s+toys?|adult\s+toys?|erotic|pornographic)\b/i, label: "adult product" },
  { pattern: /\b(firearms?|guns?|knives|knife|weapons?|ammo|ammunition)\b/i, label: "weapon-related product" },
  { pattern: /\b(cbd|cannabis|nicotine|vape|tobacco)\b/i, label: "regulated product" },
];

const PHYSICAL_PATTERNS: Pattern[] = [
  {
    pattern:
      /\b(products?|gadgets?|devices?|hardware|electronics?|chargers?|power\s+banks?|batter(?:y|ies)|cables?|adapters?|cameras?|lights?|lamps?|bulbs?|projectors?|bags?|backpacks?|wallets?|cases?|stands?|mounts?|docks?|desks?|chairs?|bottles?|cups?|mugs?|kitchen|hand\s+tools?|power\s+tools?|fabrication\s+tools?|woodworking\s+tools?|garden\s+tools?|kitchen\s+tools?|beauty\s+tools?|kits?|toys?|robots?|watches?|clocks?|wearables?|rings?|headphones?|earbuds?|speakers?|keyboards?|mice|drones?|bikes?|cycling|gear|tents?|shoes?|sneakers?|sandals?|apparel|jackets?|gloves?|organizers?|scanners?|printers?|supplements?|sprays?|tea|pajamas?|showers?|pillows?|shelves?|sensors?|humidifiers?|stationery|notebooks?)\b/i,
    label: "physical product keyword",
  },
  {
    pattern:
      /商品|製品|ガジェット|デバイス|ハードウェア|家電|充電器|モバイルバッテリー|バッテリー|電池|ケーブル|アダプター|カメラ|ライト|ランプ|電球|プロジェクター|バッグ|リュック|財布|ケース|スタンド|マウント|ドック|デスク|机|椅子|チェア|ボトル|タンブラー|キッチン|調理|工具|キット|玩具|おもちゃ|ロボット|時計|置き時計|目覚まし時計|ウェアラブル|指輪|イヤホン|ヘッドホン|スピーカー|キーボード|マウス|ドローン|自転車|キャンプ|アウトドア|靴|シューズ|服|アパレル|収納|スキャナー|プリンター|サプリ|プロテイン|スプレー|食洗機|パジャマ|ティー|シャワー|枕|ピロー|棚|センサー|加湿器|文具|ノート/i,
    label: "physical product keyword",
  },
];

const PHYSICAL_SOURCE_HINTS: Pattern[] = [
  { pattern: /kicktraq.*(gadgets|product design|hardware|wearables|home|camera equipment|diy electronics|fabrication tools|accessories|apparel|footwear|jewelry|woodworking|diy|pottery|candles|stationery|crochet|embroidery|glass|knitting|letterpress|printing|quilts|weaving|ready-to-wear|pet fashion|ceramics|sculpture|textiles|tabletop games|playing cards)/i, label: "physical crowdfunding category" },
  { pattern: /yanko design/i, label: "product design source" },
  { pattern: /makuake/i, label: "crowdfunding source" },
];

function compactText(parts: Array<string | undefined>) {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(patterns: Pattern[], text: string) {
  return patterns.find(({ pattern }) => pattern.test(text));
}

function isDeclaredPhysical(input: ClassifyProductTextInput) {
  return (
    input.declaredProductType === "physical" ||
    input.declaredPhysicalProductLikely === true
  );
}

export function classifyProductText(
  input: ClassifyProductTextInput
): ProductClassification {
  const productText = compactText([
    input.title,
    input.category,
    input.description,
    input.summary,
  ]);
  const sourceText = input.source ?? "";
  const text = compactText([productText, sourceText]);
  const titlePhysical = firstMatch(PHYSICAL_PATTERNS, input.title);
  const sourceHint = firstMatch(PHYSICAL_SOURCE_HINTS, sourceText);

  const prohibited = firstMatch(PROHIBITED_PATTERNS, text);
  if (prohibited) {
    return {
      productType: "unknown",
      physicalProductLikely: false,
      exclusionReason: `${prohibited.label} のため日本向け販売候補から除外`,
    };
  }

  if (input.declaredProductType === "digital") {
    return {
      productType: "digital",
      physicalProductLikely: false,
      exclusionReason: "productType=digital のため無形商材と判定",
    };
  }

  if (input.declaredProductType === "service") {
    return {
      productType: "service",
      physicalProductLikely: false,
      exclusionReason: "productType=service のため物販対象外",
    };
  }

  if (
    input.declaredProductType === "unknown" &&
    input.declaredPhysicalProductLikely === false
  ) {
    return {
      productType: "unknown",
      physicalProductLikely: false,
      exclusionReason: "物理的に製造・発送できる商品か判断できないため対象外",
    };
  }

  const hardDigital = firstMatch(HARD_DIGITAL_PATTERNS, text);
  if (hardDigital && !titlePhysical && !sourceHint && !isDeclaredPhysical(input)) {
    return {
      productType: "digital",
      physicalProductLikely: false,
      exclusionReason: `${hardDigital.label} のため無形商材と判定`,
    };
  }

  const service = firstMatch(SERVICE_PATTERNS, text);
  if (service && !titlePhysical && !sourceHint && !isDeclaredPhysical(input)) {
    return {
      productType: "service",
      physicalProductLikely: false,
      exclusionReason: `${service.label} のため物販対象外`,
    };
  }

  const physical = firstMatch(PHYSICAL_PATTERNS, productText);
  if (physical || sourceHint || isDeclaredPhysical(input)) {
    return {
      productType: "physical",
      physicalProductLikely: true,
    };
  }

  if (hardDigital) {
    return {
      productType: "digital",
      physicalProductLikely: false,
      exclusionReason: `${hardDigital.label} のため無形商材と判定`,
    };
  }

  if (service) {
    return {
      productType: "service",
      physicalProductLikely: false,
      exclusionReason: `${service.label} のため物販対象外`,
    };
  }

  const softDigital = firstMatch(SOFT_DIGITAL_PATTERNS, text);
  if (softDigital) {
    return {
      productType: "digital",
      physicalProductLikely: false,
      exclusionReason: `${softDigital.label} のため無形商材と判定`,
    };
  }

  return {
    productType: "unknown",
    physicalProductLikely: false,
    exclusionReason: "物理的に製造・発送できる商品か判断できないため対象外",
  };
}

export function isPhysicalProductCandidate(
  classification: ProductClassification
) {
  return (
    classification.productType === "physical" &&
    classification.physicalProductLikely
  );
}
