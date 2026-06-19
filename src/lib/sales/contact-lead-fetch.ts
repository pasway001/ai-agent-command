import {
  extractContactLeadCandidates,
  type ContactLeadSnapshot,
} from "./contact-leads";

export type FetchContactLeadOptions = {
  sourceUrl: string | null;
  timeoutMs: number;
  maxCandidates: number;
  fetchedAt?: string;
};

function shortError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, " ").slice(0, 120);
}

async function fetchHtml(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (compatible; AgentCommandCenter/0.1; +https://github.com/pasway001/ai-agent-command)",
      },
    });
    const html = await response.text();
    return {
      status: response.ok ? `ok:${response.status}` : `http:${response.status}`,
      html,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchContactLeadSnapshot(
  options: FetchContactLeadOptions
): Promise<ContactLeadSnapshot> {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  if (!options.sourceUrl) {
    return {
      fetchedAt,
      sourceUrl: null,
      fetchStatus: "missing_source_url",
      candidates: [],
    };
  }

  try {
    const fetched = await fetchHtml(options.sourceUrl, options.timeoutMs);
    return {
      fetchedAt,
      sourceUrl: options.sourceUrl,
      fetchStatus: fetched.status,
      candidates: extractContactLeadCandidates(
        fetched.html,
        options.sourceUrl,
        options.maxCandidates
      ),
    };
  } catch (err) {
    return {
      fetchedAt,
      sourceUrl: options.sourceUrl,
      fetchStatus: `error:${shortError(err)}`,
      candidates: [],
    };
  }
}

export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
