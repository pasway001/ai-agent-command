export type ContactLeadKind =
  | "email"
  | "contact_page"
  | "official_site"
  | "crowdfunding"
  | "social"
  | "external_link";

export type ExtractedLink = {
  url: string;
  label: string;
};

export type ContactLeadCandidate = {
  kind: ContactLeadKind;
  value: string;
  label: string;
  score: number;
};

export type ContactLeadSnapshot = {
  fetchedAt: string;
  sourceUrl: string | null;
  fetchStatus: string;
  candidates: ContactLeadCandidate[];
};

export const CONTACT_LEAD_KIND_LABELS: Record<ContactLeadKind, string> = {
  email: "メール",
  contact_page: "問い合わせ",
  official_site: "公式",
  crowdfunding: "クラファン",
  social: "SNS",
  external_link: "外部",
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LINK_RE =
  /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function stringValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    );
}

function normalizeEmail(value: string) {
  return value.trim().replace(/[),.;:]+$/, "").toLowerCase();
}

export function extractEmails(text: string) {
  const matches = text.match(EMAIL_RE) ?? [];
  return Array.from(new Set(matches.map(normalizeEmail))).filter(
    (email) => !email.endsWith("@example.com")
  );
}

function resolveHref(href: string, baseUrl: string) {
  const decoded = decodeHtmlEntities(href.trim()).replace(/^\\?["']+|\\?["']+$/g, "");
  if (
    !decoded ||
    decoded.startsWith("#") ||
    /^javascript:/i.test(decoded) ||
    /^data:/i.test(decoded) ||
    /^tel:/i.test(decoded)
  ) {
    return null;
  }
  if (/^mailto:/i.test(decoded)) return decoded;
  try {
    return new URL(decoded, baseUrl).toString();
  } catch {
    return null;
  }
}

export function extractLinks(html: string, baseUrl: string) {
  const links: ExtractedLink[] = [];
  for (const match of html.matchAll(LINK_RE)) {
    const rawHref = match[1] ?? match[2] ?? match[3] ?? "";
    const url = resolveHref(rawHref, baseUrl);
    if (!url) continue;
    const label = stripTags(match[4] ?? "");
    links.push({ url, label });
  }
  return links;
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isSocial(url: string) {
  const h = host(url);
  return [
    "instagram.com",
    "linkedin.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "tiktok.com",
    "youtube.com",
  ].some((domain) => h === domain || h.endsWith(`.${domain}`));
}

function isAggregatorHost(value: string) {
  const h = host(value);
  return h.includes("kicktraq.com") || h.includes("yankodesign.com");
}

function isLikelyPlatformChrome(link: ExtractedLink, sourceUrl: string) {
  const h = host(link.url);
  const path = (() => {
    try {
      return new URL(link.url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (isAggregatorHost(sourceUrl) && h === host(sourceUrl)) return true;
  if (
    isAggregatorHost(sourceUrl) &&
    /kicktraq|yanko-?design|yankodesign/i.test(link.url)
  ) {
    return true;
  }
  if (h.includes("kicktraq.com")) return true;
  if (h.includes("facebook.com") && /kicktraq|yankodesign/i.test(link.url)) {
    return true;
  }
  if (h.includes("kickstarter.com") && path === "/") return true;
  if (h.includes("kickstarter.com") && path === "/profile/pyrowolf/") return true;
  if (h.includes("google.com") || h.includes("news.google.com")) return true;
  return false;
}

function isCrowdfunding(url: string) {
  const h = host(url);
  return [
    "kickstarter.com",
    "indiegogo.com",
    "makuake.com",
    "camp-fire.jp",
    "greenfunding.jp",
  ].some((domain) => h === domain || h.endsWith(`.${domain}`));
}

function isContactLike(text: string) {
  return /contact|inquiry|press|media|partner|wholesale|distribution|support|creator|profile/i.test(
    text
  );
}

function isOfficialLike(text: string) {
  return /official|website|homepage|brand|manufacturer|maker|about|company|store|shop/i.test(
    text
  );
}

function classifyLink(
  link: ExtractedLink,
  sourceUrl: string
): ContactLeadCandidate | null {
  const text = `${link.url} ${link.label}`;
  if (/^mailto:/i.test(link.url)) {
    const email = normalizeEmail(link.url.replace(/^mailto:/i, "").split("?")[0]);
    if (!email) return null;
    return { kind: "email", value: email, label: link.label || email, score: 100 };
  }
  if (isLikelyPlatformChrome(link, sourceUrl)) return null;
  if (isCrowdfunding(link.url)) {
    const value = link.url;
    const score = /\/(profile|creator_bio)\b/i.test(value) ? 88 : 84;
    return {
      kind: "crowdfunding",
      value,
      label: link.label || value,
      score,
    };
  }
  if (isContactLike(text)) {
    return {
      kind: "contact_page",
      value: link.url,
      label: link.label || link.url,
      score: 92,
    };
  }
  if (isSocial(link.url)) {
    return {
      kind: "social",
      value: link.url,
      label: link.label || link.url,
      score: 72,
    };
  }
  if (isOfficialLike(text) && host(link.url) !== host(sourceUrl)) {
    return {
      kind: "official_site",
      value: link.url,
      label: link.label || link.url,
      score: 78,
    };
  }
  if (host(link.url) && host(link.url) !== host(sourceUrl)) {
    return {
      kind: "external_link",
      value: link.url,
      label: link.label || link.url,
      score: 35,
    };
  }
  return null;
}

function dedupeCandidates(candidates: ContactLeadCandidate[]) {
  const seen = new Set<string>();
  const result: ContactLeadCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

export function extractContactLeadCandidates(
  html: string,
  sourceUrl: string,
  maxCandidates = 12
) {
  const emailCandidates = extractEmails(html).map<ContactLeadCandidate>((email) => ({
    kind: "email",
    value: email,
    label: email,
    score: 100,
  }));
  const linkCandidates = extractLinks(html, sourceUrl)
    .map((link) => classifyLink(link, sourceUrl))
    .filter((candidate): candidate is ContactLeadCandidate => candidate !== null);

  return dedupeCandidates([...emailCandidates, ...linkCandidates])
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.value.localeCompare(b.value);
    })
    .slice(0, maxCandidates);
}

function contactLeadKind(value: unknown): ContactLeadKind | null {
  if (
    value === "email" ||
    value === "contact_page" ||
    value === "official_site" ||
    value === "crowdfunding" ||
    value === "social" ||
    value === "external_link"
  ) {
    return value;
  }
  return null;
}

function candidateFromRecord(record: JsonRecord): ContactLeadCandidate | null {
  const kind = contactLeadKind(record.kind);
  const value = stringValue(record, "value");
  const score = numberValue(record, "score");
  if (!kind || !value || score === null) return null;
  return {
    kind,
    value,
    label: stringValue(record, "label") ?? value,
    score,
  };
}

export function contactLeadsFromMetadata(
  metadataValue: unknown
): ContactLeadSnapshot | null {
  const metadata = asRecord(metadataValue);
  const contactLeads = asRecord(metadata?.contactLeads);
  const fetchedAt = stringValue(contactLeads, "fetchedAt");
  const fetchStatus = stringValue(contactLeads, "fetchStatus");
  if (!fetchedAt || !fetchStatus) return null;

  const candidates = Array.isArray(contactLeads?.candidates)
    ? contactLeads.candidates
        .map((item) => asRecord(item))
        .filter((item): item is JsonRecord => item !== null)
        .map(candidateFromRecord)
        .filter((item): item is ContactLeadCandidate => item !== null)
    : [];

  return {
    fetchedAt,
    sourceUrl: stringValue(contactLeads, "sourceUrl"),
    fetchStatus,
    candidates,
  };
}

export function primaryContactLead(snapshot: ContactLeadSnapshot | null) {
  return snapshot?.candidates[0] ?? null;
}

export function preferredContactEmail(snapshot: ContactLeadSnapshot | null) {
  return snapshot?.candidates.find((candidate) => candidate.kind === "email")?.value ?? null;
}

export function preferredContactUrl(snapshot: ContactLeadSnapshot | null) {
  return (
    snapshot?.candidates.find((candidate) => candidate.kind !== "email")?.value ?? null
  );
}
