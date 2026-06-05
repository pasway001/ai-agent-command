import { fetchHackerNewsSource, normalizeHnItem } from "../../../src/lib/agents/sources/hackernews";
import type { SourceConfig } from "../../../src/lib/agents/sources/types";
import { assert, assertEqual, defineSuite } from "../_assert";

export const hn = defineSuite("sources/hackernews");

const cfg: SourceConfig = {
  id: "hn-show",
  name: "HackerNews Show HN",
  type: "hn",
  endpoint: "https://hacker-news.firebaseio.com/v0/showstories.json",
  enabled: true,
  category: "primary",
};

hn.test("normalizeHnItem keeps Show HN items, strips prefix", () => {
  const out = normalizeHnItem(
    {
      id: 12345,
      title: "Show HN: My cool gadget",
      url: "https://example.com/gadget",
      text: "Built this in my garage",
      time: 1700000000,
      score: 200,
      by: "alice",
      descendants: 5,
    },
    cfg
  );
  assert(out !== null, "should not be null");
  assertEqual(out!.title, "My cool gadget");
  assertEqual(out!.url, "https://example.com/gadget");
  assertEqual(out!.rawMetadata.hnId, 12345);
  assertEqual(out!.rawMetadata.score, 200);
});

hn.test("normalizeHnItem rejects non-Show items", () => {
  const out = normalizeHnItem(
    { id: 1, title: "Ask HN: How do you ship?", time: 1, score: 1 },
    cfg
  );
  assertEqual(out, null);
});

hn.test("normalizeHnItem rejects null/empty items", () => {
  assertEqual(normalizeHnItem(null, cfg), null);
  assertEqual(normalizeHnItem({ title: "" }, cfg), null);
});

hn.test("fetchHackerNewsSource fans out showstories then items", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    calls.push(url);
    if (url.includes("showstories.json")) {
      return new Response(JSON.stringify([1001, 1002, 1003]), {
        headers: { "content-type": "application/json" },
      });
    }
    const idMatch = url.match(/item\/(\d+)\.json/);
    const id = Number(idMatch?.[1] ?? 0);
    const item =
      id === 1001
        ? { id: 1001, title: "Show HN: Foo", url: "https://foo.example", time: 1, score: 10 }
        : id === 1002
          ? { id: 1002, title: "Ask HN: Bar", time: 1, score: 1 }
          : { id: 1003, title: "Show HN: Baz", url: "https://baz.example", time: 1, score: 5 };
    return new Response(JSON.stringify(item), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const out = await fetchHackerNewsSource(cfg, { limit: 10 });
    assertEqual(out.length, 2, "two Show HN items survive");
    assertEqual(out[0].title, "Foo");
    assertEqual(out[1].title, "Baz");
    assert(
      calls.some((c) => c.includes("showstories.json")),
      "called showstories"
    );
    assert(
      calls.filter((c) => c.includes("/item/")).length >= 3,
      "fetched at least 3 items"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

hn.test("fetchHackerNewsSource respects limit cap", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.includes("showstories.json")) {
      return new Response(JSON.stringify(Array.from({ length: 30 }, (_, i) => 2000 + i)));
    }
    const idMatch = url.match(/item\/(\d+)\.json/);
    const id = Number(idMatch?.[1] ?? 0);
    return new Response(
      JSON.stringify({
        id,
        title: `Show HN: Item ${id}`,
        url: `https://e/${id}`,
        time: 1,
        score: 1,
      })
    );
  }) as typeof fetch;

  try {
    const out = await fetchHackerNewsSource(cfg, { limit: 5 });
    assertEqual(out.length, 5, "limit honored");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
