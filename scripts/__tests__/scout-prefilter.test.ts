import { assertEqual, defineSuite } from "./_assert";
import { runPrefilter } from "../../src/lib/agents/scout-prefilter";

const t = defineSuite("scout-prefilter");

t.test("mock prefilter keeps app-connected physical gadgets", async () => {
  const result = await runPrefilter(
    "Smart Projection Bulb",
    "A physical light bulb with motion effects and mobile app control for rooms."
  );

  assertEqual(result.viable, true);
});

t.test("mock prefilter still rejects pure software", async () => {
  const result = await runPrefilter(
    "AI Workflow Platform",
    "A SaaS app and API for automating internal software operations."
  );

  assertEqual(result.viable, false);
  assertEqual(result.confidence, "high");
});

export const scoutPrefilter = t;
