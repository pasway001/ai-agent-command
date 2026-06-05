import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRedditListing } from "../../../src/lib/agents/sources/reddit";
import type { SourceConfig } from "../../../src/lib/agents/sources/types";
import { assert, assertEqual, defineSuite } from "../_assert";

export const reddit = defineSuite("sources/reddit");

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../fixtures/reddit-gadgets.json"), "utf8")
);

const cfg: SourceConfig = {
  id: "reddit-gadgets",
  name: "Reddit r/gadgets",
  type: "reddit_json",
  endpoint: "https://www.reddit.com/r/gadgets/new.json?limit=50",
  enabled: true,
  category: "primary",
};

reddit.test("parseRedditListing returns NormalizedCandidate[] with title+url", () => {
  const out = parseRedditListing(fixture, cfg);
  assertEqual(out.length, 2, "items count (third has no title)");
  assertEqual(out[0].sourceName, "Reddit r/gadgets");
  assertEqual(out[0].sourceType, "reddit_json");
  assertEqual(out[0].title, "Smart Lamp X1 with motion detection");
  assert(out[0].url.includes("/r/gadgets/comments/abc123"), "uses permalink");
  assert(out[0].publishedAt instanceof Date, "publishedAt is Date");
});

reddit.test("parseRedditListing keeps real thumbnail and drops 'self'", () => {
  const out = parseRedditListing(fixture, cfg);
  assert(out[0].imageUrl?.startsWith("https://"), "first item has thumbnail");
  assertEqual(out[1].imageUrl, undefined, "second item drops 'self' placeholder");
});

reddit.test("parseRedditListing surfaces score/comments in rawMetadata", () => {
  const out = parseRedditListing(fixture, cfg);
  assertEqual(out[0].rawMetadata.score, 412);
  assertEqual(out[0].rawMetadata.numComments, 27);
  assertEqual(out[0].rawMetadata.subreddit, "gadgets");
});

reddit.test("parseRedditListing tolerates empty payload", () => {
  const out = parseRedditListing({}, cfg);
  assertEqual(out.length, 0);
});
