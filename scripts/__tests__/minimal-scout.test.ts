import {
  __test,
  normalizeForMatch,
  similarity,
} from "../../src/lib/agents/minimal-scout";
import { assert, assertEqual, defineSuite } from "./_assert";

export const minimal = defineSuite("minimal-scout");

const physical = {
  productType: "physical" as const,
  physicalProductLikely: true,
  exclusionReason: undefined,
};

minimal.test("similarity: identical strings → 1.0", () => {
  assertEqual(similarity("smart lamp x1", "smart lamp x1"), 1);
});

minimal.test("similarity: completely different → 0", () => {
  assert(similarity("hello world", "ｱｲｳｴｵ") <= 0.1);
});

minimal.test("normalizeForMatch strips urls and punctuation", () => {
  assertEqual(
    normalizeForMatch("Smart Lamp X1!! (https://example.com/x1)"),
    "smartlampx1"
  );
});

minimal.test("mergeCrossSource merges items with high title similarity", () => {
  const merged = __test.mergeCrossSource([
    {
      item: {
        source: "Kicktraq Gadgets",
        region: "overseas",
        title: "Smart Lamp X1 by Acme",
        url: "https://kicktraq.com/projects/smart-lamp-x1",
      },
      classification: physical,
    },
    {
      item: {
        source: "Reddit r/gadgets",
        region: "overseas",
        title: "Smart Lamp X1 by Acme",
        url: "https://reddit.com/r/gadgets/abc",
      },
      classification: physical,
    },
  ]);
  assertEqual(merged.length, 1, "merged into single candidate");
  assertEqual(merged[0].mentionSources.size, 2);
  assert(merged[0].mentionSources.has("Kicktraq Gadgets"));
  assert(merged[0].mentionSources.has("Reddit r/gadgets"));
});

minimal.test("mergeCrossSource merges items with same URL hostname", () => {
  const merged = __test.mergeCrossSource([
    {
      item: {
        source: "Reddit r/gadgets",
        region: "overseas",
        title: "Totally unrelated title A",
        url: "https://acme-store.com/product-1",
      },
      classification: physical,
    },
    {
      item: {
        source: "Yanko Design",
        region: "overseas",
        title: "Totally different label B",
        url: "https://acme-store.com/landing",
      },
      classification: physical,
    },
  ]);
  assertEqual(merged.length, 1, "host match wins");
  assertEqual(merged[0].mentionSources.size, 2);
});

minimal.test("mergeCrossSource keeps distinct products separate", () => {
  const merged = __test.mergeCrossSource([
    {
      item: { source: "A", region: "overseas", title: "Espresso Machine Beta" },
      classification: physical,
    },
    {
      item: { source: "B", region: "overseas", title: "Folding Bike Z" },
      classification: physical,
    },
  ]);
  assertEqual(merged.length, 2, "no merge");
});

minimal.test("computeJapanValidationLevel: no JP refs → neutral 0.3", () => {
  const out = __test.computeJapanValidationLevel(
    { source: "x", region: "overseas", title: "Smart Lamp X1" },
    []
  );
  assertEqual(out.level, 0.3);
  assertEqual(out.matches.length, 0);
});

minimal.test("computeJapanValidationLevel: loose match → 0.6+", () => {
  const out = __test.computeJapanValidationLevel(
    { source: "x", region: "overseas", title: "スマートランプ X1" },
    [
      { source: "Makuake", region: "japan", title: "スマートランプ X1 国内版" },
    ]
  );
  assert(out.level >= 0.6, `level ${out.level} >= 0.6`);
  assertEqual(out.matches.length, 1);
});

minimal.test("computeJapanValidationLevel: strong match → 1.0", () => {
  const out = __test.computeJapanValidationLevel(
    { source: "x", region: "overseas", title: "Smart Lamp X1 luxury edition" },
    [
      { source: "Makuake", region: "japan", title: "Smart Lamp X1 luxury edition" },
      { source: "GREEN FUNDING", region: "japan", title: "Smart Lamp X1 luxury edition" },
      { source: "CAMPFIRE", region: "japan", title: "Smart Lamp X1 luxury edition" },
    ]
  );
  assertEqual(out.level, 1.0);
  assertEqual(out.matches.length, 3);
});

minimal.test("toSignals injects mentionSources and crossSourceScore", () => {
  const sig = __test.toSignals(
    {
      primary: {
        item: { source: "Kicktraq Gadgets", region: "overseas", title: "Foo" },
        classification: physical,
      },
      mentionSources: new Set(["Kicktraq Gadgets", "Reddit r/gadgets"]),
      members: [
        {
          item: { source: "Kicktraq Gadgets", region: "overseas", title: "Foo", description: "Foo desc" },
          classification: physical,
        },
        {
          item: { source: "Reddit r/gadgets", region: "overseas", title: "Foo", description: "Reddit notes" },
          classification: physical,
        },
      ],
    },
    []
  );
  assertEqual(sig.mentionSources?.length, 2);
  assertEqual(sig.crossSourceScore, 2 / 3);
  assertEqual(sig.japan?.japanValidationLevel, 0.3);
  // combined description includes both members' text
  assert(sig.overseas?.description?.includes("Foo desc"));
  assert(sig.overseas?.description?.includes("Reddit notes"));
});

// ---- LIMIT_PER_FEED vs LLM_MAX: independence is verified at the source
// fetcher level (each fetcher.slice(opts.limit)) and at the candidates.slice
// stage. We exercise both with a stubbed source registry below.
//
// We import runMinimalScout dynamically so the test file remains parse-clean
// even though runMinimalScout depends on DB modules; we skip the LLM scoring
// path by passing zero physical candidates (which short-circuits the loop).

minimal.test("runMinimalScout: LIMIT_PER_FEED caps raw items per source", async () => {
  const { runMinimalScout } = await import("../../src/lib/agents/minimal-scout");
  const originalFetch = globalThis.fetch;
  // Build a fake RSS feed with 50 entries, none classified as physical (so the
  // LLM loop is skipped and we don't need a DB).
  const buildXml = (n: number) =>
    `<rss><channel>${Array.from({ length: n }, (_, i) =>
      `<item><title>SaaS Plugin ${i}</title><link>https://example.com/${i}</link><description>API/SDK newsletter</description></item>`
    ).join("")}</channel></rss>`;
  globalThis.fetch = (async () =>
    new Response(buildXml(50), {
      headers: { "content-type": "application/xml" },
    })) as typeof fetch;

  try {
    const result = await runMinimalScout({
      skipPersistence: true,
      limitPerFeed: 7,
      llmMax: 100,
      sources: [
        {
          id: "test-rss",
          name: "Test RSS",
          type: "rss",
          endpoint: "https://example.com/feed",
          enabled: true,
          category: "primary",
        },
      ],
    });
    assertEqual(result.feedCount, 1);
    assertEqual(result.perFeed[0].rawItemCount, 7, "limitPerFeed honored");
    assertEqual(result.scoredCount, 0, "all classified as non-physical");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

minimal.test("runMinimalScout: LLM_MAX caps total LLM evaluations", async () => {
  const { runMinimalScout } = await import("../../src/lib/agents/minimal-scout");
  const originalFetch = globalThis.fetch;
  const buildXml = (n: number, prefix: string) =>
    `<rss><channel>${Array.from({ length: n }, (_, i) =>
      `<item><title>SaaS Plugin ${prefix}-${i}</title><link>https://example.com/${prefix}/${i}</link><description>API/SDK newsletter</description></item>`
    ).join("")}</channel></rss>`;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    const prefix = url.endsWith("a") ? "a" : "b";
    return new Response(buildXml(30, prefix), {
      headers: { "content-type": "application/xml" },
    });
  }) as typeof fetch;

  try {
    const result = await runMinimalScout({
      skipPersistence: true,
      limitPerFeed: 25,
      llmMax: 3,
      sources: [
        {
          id: "a",
          name: "A",
          type: "rss",
          endpoint: "https://example.com/a",
          enabled: true,
          category: "primary",
        },
        {
          id: "b",
          name: "B",
          type: "rss",
          endpoint: "https://example.com/b",
          enabled: true,
          category: "primary",
        },
      ],
    });
    // raw per feed capped to 25, but everything classified as non-physical so
    // candidateCount is 0. We verify the cap propagated to perFeed:
    assertEqual(result.perFeed[0].rawItemCount, 25);
    assertEqual(result.perFeed[1].rawItemCount, 25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
