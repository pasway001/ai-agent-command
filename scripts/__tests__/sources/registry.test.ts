import {
  SOURCE_REGISTRY,
  getEnabledSources,
} from "../../../src/lib/agents/sources/registry";
import { assert, assertEqual, defineSuite } from "../_assert";

export const registry = defineSuite("sources/registry");

function withDisabledSources(value: string | undefined, fn: () => void) {
  const previous = process.env.SCOUT_DISABLED_SOURCE_IDS;
  if (value === undefined) {
    delete process.env.SCOUT_DISABLED_SOURCE_IDS;
  } else {
    process.env.SCOUT_DISABLED_SOURCE_IDS = value;
  }
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env.SCOUT_DISABLED_SOURCE_IDS;
    } else {
      process.env.SCOUT_DISABLED_SOURCE_IDS = previous;
    }
  }
}

registry.test("source ids are unique", () => {
  const ids = SOURCE_REGISTRY.map((source) => source.id);
  assertEqual(new Set(ids).size, ids.length);
});

registry.test("expanded overseas sources are enabled", () => {
  withDisabledSources(undefined, () => {
    const enabled = new Set(getEnabledSources("primary").map((source) => source.id));
    [
      "thisiswhyimbroke",
      "the-gadgeteer",
      "the-awesomer",
      "coolthings",
      "gearjunkie",
      "mikeshouts",
      "cool-hunting",
      "design-milk",
      "core77",
      "new-atlas",
      "make-magazine",
      "hackaday",
    ].forEach((id) => assert(enabled.has(id), `${id} should be enabled`));
    assert(!enabled.has("trendhunter"), "trendhunter should stay disabled while it returns 403");
  });
});

registry.test("expanded domestic reference sources are enabled", () => {
  withDisabledSources(undefined, () => {
    const enabled = new Set(
      getEnabledSources("japan_reference").map((source) => source.id)
    );
    [
      "makuake",
      "getnavi",
      "gizmodo-jp",
      "roomie",
      "lifehacker-jp",
      "kaden-watch",
      "impress-watch",
    ].forEach((id) => assert(enabled.has(id), `${id} should be enabled`));
  });
});

registry.test("SCOUT_DISABLED_SOURCE_IDS excludes selected sources", () => {
  withDisabledSources("trendhunter,getnavi", () => {
    const primary = new Set(getEnabledSources("primary").map((source) => source.id));
    const japan = new Set(
      getEnabledSources("japan_reference").map((source) => source.id)
    );
    assert(!primary.has("trendhunter"), "trendhunter should be disabled");
    assert(!japan.has("getnavi"), "getnavi should be disabled");
    assert(primary.has("cool-hunting"), "other primary sources should stay enabled");
    assert(japan.has("makuake"), "other japan sources should stay enabled");
  });
});
