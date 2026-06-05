import type {
  NormalizedCandidate,
  SourceConfig,
  SourceFetcher,
} from "./types";

type HnItem = {
  id?: number;
  title?: string;
  url?: string;
  text?: string;
  time?: number;
  score?: number;
  by?: string;
  descendants?: number;
  type?: string;
};

const HN_ITEM_BASE =
  process.env.SCOUT_HN_ITEM_BASE ??
  "https://hacker-news.firebaseio.com/v0/item";

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await globalThis.fetch(url, {
    cache: "no-store",
    signal,
    headers: {
      "user-agent": "agent-command-center/0.1 (+scout/hn)",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`HN ${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

async function parallel<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const launches = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await worker(items[i]);
      }
    }
  );
  await Promise.all(launches);
  return results;
}

export function normalizeHnItem(
  item: HnItem | null,
  cfg: SourceConfig
): NormalizedCandidate | null {
  if (!item?.title) return null;
  if (!/^show hn:/i.test(item.title)) return null;
  const title = item.title.replace(/^show hn:\s*/i, "").trim();
  if (!title) return null;
  const hnUrl = item.id ? `https://news.ycombinator.com/item?id=${item.id}` : "";
  const url = item.url ?? hnUrl;
  const description = (item.text ?? "").slice(0, 4000);
  const publishedAt =
    typeof item.time === "number" ? new Date(item.time * 1000) : undefined;
  return {
    sourceName: cfg.name,
    sourceType: cfg.type,
    url,
    title,
    description,
    publishedAt,
    rawMetadata: {
      hnId: item.id ?? null,
      hnUrl,
      score: item.score ?? null,
      author: item.by ?? null,
      comments: item.descendants ?? null,
      externalUrl: item.url ?? null,
    },
  };
}

export const fetchHackerNewsSource: SourceFetcher = async (cfg, opts) => {
  const ids = await fetchJson<number[]>(cfg.endpoint, opts.signal);
  if (!Array.isArray(ids)) return [];
  // showstories often returns 100+ ids; cap before fanning out.
  const sliceCount = Math.min(opts.limit * 3, 60);
  const slice = ids.slice(0, sliceCount);
  const items = await parallel(
    slice,
    (id) =>
      fetchJson<HnItem | null>(`${HN_ITEM_BASE}/${id}.json`, opts.signal).catch(
        () => null
      ),
    5
  );
  const normalized = items
    .map((it) => normalizeHnItem(it, cfg))
    .filter((it): it is NormalizedCandidate => it !== null);
  return normalized.slice(0, opts.limit);
};
