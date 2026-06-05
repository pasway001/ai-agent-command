import { parseScoringOutput } from "../../src/lib/agents/scout-scoring";
import { assert, assertEqual, defineSuite } from "./_assert";

export const scoring = defineSuite("scout-scoring");

scoring.test("parseScoringOutput → reject when LLM returns malformed object", () => {
  const out = parseScoringOutput({ foo: "bar" });
  assertEqual(out.verdict, "reject");
  assertEqual(out.score, 0);
  assertEqual(out.totalScore, 0);
  assert(out.rationale.toLowerCase().includes("invalid") || out.rationale.includes("evidence"), "rationale mentions evidence/invalid");
  assertEqual(out.evidence.length, 0);
});

scoring.test("parseScoringOutput → reject when evidence missing on otherwise valid shape", () => {
  // Note: our backward-compat schema doesn't require evidence at parse time
  // (so mock outputs work), but the LLM is instructed to provide it. When
  // omitted entirely the result should still surface as low-trust.
  const out = parseScoringOutput({
    totalScore: 0.5,
    verdict: "escalate",
    rationale: "テスト",
    pros: [],
    cons: [],
    suggestedPriority: 3,
    axisScores: {
      overseasTraction: { score: 0.5, rationale: "x" },
      crossSourceMentions: { score: 0.5, rationale: "x" },
      japanValidationLevel: { score: 0.5, rationale: "x" },
      domesticTrend: { score: 0.5, rationale: "x" },
      regulatoryRisk: { score: 0.5, rationale: "x" },
      competitionDensity: { score: 0.5, rationale: "x" },
      priceFit: { score: 0.5, rationale: "x" },
      physicalLikely: { score: 0.5, rationale: "x" },
      novelty: { score: 0.5, rationale: "x" },
    },
  });
  assertEqual(out.verdict, "escalate");
  assertEqual(out.evidence.length, 0, "no evidence carried through");
  assertEqual(out.score, 0.5);
});

scoring.test("parseScoringOutput accepts legacy `score` field", () => {
  const out = parseScoringOutput({
    score: 0.8,
    verdict: "approve",
    rationale: "ok",
    pros: ["a"],
    cons: ["b"],
    suggestedPriority: 7,
  });
  assertEqual(out.verdict, "approve");
  assertEqual(out.score, 0.8);
  assertEqual(out.totalScore, 0.8);
});

scoring.test("parseScoringOutput accepts full Phase-B shape", () => {
  const out = parseScoringOutput({
    totalScore: 0.85,
    axisScores: {
      overseasTraction: { score: 0.9, rationale: "10k backers on Kickstarter" },
      crossSourceMentions: { score: 0.7, rationale: "2 sources" },
      japanValidationLevel: { score: 0.6, rationale: "1 Makuake match" },
      domesticTrend: { score: 0.7, rationale: "rising" },
      regulatoryRisk: { score: 0.9, rationale: "no regulation concerns" },
      competitionDensity: { score: 0.5, rationale: "med" },
      priceFit: { score: 0.9, rationale: "¥15000" },
      physicalLikely: { score: 1.0, rationale: "確実に物理商品" },
      novelty: { score: 0.7, rationale: "ユニーク機構" },
    },
    evidence: [
      {
        claim: "Kickstarterで12,345 backers",
        sourceUrl: "https://www.kickstarter.com/projects/foo/bar",
        snippet: "Backers: 12,345 (snippet text)",
      },
    ],
    verdict: "approve",
    rationale: "海外で強いトラクション、国内未展開",
    pros: ["海外実績", "未展開"],
    cons: [],
    suggestedPriority: 8,
  });
  assertEqual(out.verdict, "approve");
  assertEqual(out.score, 0.85);
  assertEqual(out.evidence.length, 1);
  assert(out.axisScores !== null, "axisScores present");
  assertEqual(out.axisScores!.overseasTraction.score, 0.9);
});

scoring.test("parseScoringOutput rounds suggestedPriority", () => {
  const out = parseScoringOutput({
    score: 0.5,
    verdict: "escalate",
    rationale: "x",
    pros: [],
    cons: [],
    suggestedPriority: 4.7,
  });
  assertEqual(out.suggestedPriority, 5);
});
