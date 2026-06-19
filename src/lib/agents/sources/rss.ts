import type {
  NormalizedCandidate,
  SourceConfig,
  SourceFetcher,
} from "./types";

/**
 * Generic RSS / Atom fetcher. Migrated from the legacy minimal-scout.ts
 * inline parser. fetch() is called via globalThis so tests can stub it.
 */

function repairMojibake(value: string) {
  let current = value;
  for (let i = 0; i < 2; i++) {
    if (!/[ÃÂ]|â[\u0080-\u00bf]/.test(current)) break;
    const repaired = Buffer.from(current, "latin1").toString("utf8");
    if (repaired === current) break;
    current = repaired;
  }
  return current;
}

function decodeHtml(value: string) {
  const decoded = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
  return repairMojibake(decoded);
}

function stripTags(value: string) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string) {
  const match = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")
  );
  return match?.[1] ? stripTags(match[1]) : undefined;
}

function linkFromBlock(block: string) {
  const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
  if (href) return decodeHtml(href);
  return tag(block, "link");
}

function imageFromBlock(block: string): string | undefined {
  const enclosure = block.match(
    /<enclosure[^>]+url=["']([^"']+)["'][^>]*\/?>(?:<\/enclosure>)?/i
  )?.[1];
  if (enclosure) return decodeHtml(enclosure);
  const mediaThumb = block.match(
    /<media:thumbnail[^>]+url=["']([^"']+)["']/i
  )?.[1];
  if (mediaThumb) return decodeHtml(mediaThumb);
  const mediaContent = block.match(
    /<media:content[^>]+url=["']([^"']+)["']/i
  )?.[1];
  if (mediaContent) return decodeHtml(mediaContent);
  return undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

export function parseRssFeed(
  xml: string,
  cfg: SourceConfig
): NormalizedCandidate[] {
  const blocks = [
    ...xml.matchAll(/<entry[\s\S]*?<\/entry>/gi),
    ...xml.matchAll(/<item[\s\S]*?<\/item>/gi),
  ].map((match) => match[0]);

  return blocks
    .map<NormalizedCandidate | null>((block) => {
      const title = tag(block, "title") ?? "";
      if (!title) return null;
      const url = linkFromBlock(block) ?? "";
      const description =
        tag(block, "content") ??
        tag(block, "description") ??
        tag(block, "summary") ??
        "";
      const publishedRaw =
        tag(block, "published") ??
        tag(block, "pubDate") ??
        tag(block, "updated");
      return {
        sourceName: cfg.name,
        sourceType: cfg.type,
        url,
        title,
        description,
        publishedAt: parseDate(publishedRaw),
        imageUrl: imageFromBlock(block),
        rawMetadata: {
          publishedRaw: publishedRaw ?? null,
          configId: cfg.id,
        },
      };
    })
    .filter((item): item is NormalizedCandidate => item !== null);
}

export const fetchRssSource: SourceFetcher = async (cfg, opts) => {
  const response = await globalThis.fetch(cfg.endpoint, {
    cache: "no-store",
    signal: opts.signal,
    headers: {
      "user-agent": "agent-command-center/0.1 (+scout/rss)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5",
    },
  });
  if (!response.ok) {
    throw new Error(`${cfg.name}: HTTP ${response.status}`);
  }
  const charset = response.headers
    .get("content-type")
    ?.match(/charset=([^;]+)/i)?.[1]
    ?.trim()
    .toLowerCase();
  const encoding =
    charset === "iso-8859-1" || charset === "latin1"
      ? "windows-1252"
      : (charset ?? "utf-8");
  const buffer = await response.arrayBuffer();
  let body: string;
  try {
    body = new TextDecoder(encoding).decode(buffer);
  } catch {
    body = new TextDecoder("utf-8").decode(buffer);
  }
  const parsed = parseRssFeed(body, cfg);
  return parsed.slice(0, opts.limit);
};
