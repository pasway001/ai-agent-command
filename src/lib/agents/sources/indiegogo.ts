import type { SourceFetcher } from "./types";

/**
 * Indiegogo intentionally removed their public RSS feed in 2023; the only
 * remaining options are paid third-party API resellers or a brittle HTML
 * scrape against a JS-rendered SPA.
 *
 * TODO(phase-c): implement HTML scrape with Playwright headless and
 *   per-campaign normalization. For now this is a stub so the registry can
 *   still list Indiegogo as a "planned" source without breaking the run.
 */
export const fetchIndiegogoSource: SourceFetcher = async (cfg) => {
  console.warn(
    `[${cfg.name}] Indiegogo fetcher is a stub (RSS discontinued, scrape not implemented). Returning [].`
  );
  return [];
};
