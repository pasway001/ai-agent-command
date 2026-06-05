import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";

/**
 * scout_runs — per-execution summary of the minimal-scout pipeline.
 *
 * Each row is one invocation of runMinimalScout(): cron tick, manual CLI run,
 * or test harness. It captures *what feeds were touched and what came out*,
 * so a non-developer can see "the 08:31 cron pulled 4 sources, got 73 items,
 * filtered to 12, scored 3, enqueued 2" without opening the code.
 */
export const scoutRuns = pgTable(
  "scout_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Where the run came from: "cron" | "manual" | "test" */
    triggeredBy: text("triggered_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    /** Number of feed URLs configured for this run (overseas + japan). */
    feedCount: integer("feed_count").notNull().default(0),
    /** Total RSS items observed before any filtering (sum across all feeds). */
    rawItemCount: integer("raw_item_count").notNull().default(0),
    /** Items that survived physical-product classification. */
    physicalCount: integer("physical_count").notNull().default(0),
    /** Items dropped by dedup vs. previously-seen titles. */
    dedupDroppedCount: integer("dedup_dropped_count").notNull().default(0),
    /** Items actually sent to scoring (after slice(limit)). */
    scoredCount: integer("scored_count").notNull().default(0),
    /** Of scored items, how many were enqueued to approval_queue. */
    enqueuedCount: integer("enqueued_count").notNull().default(0),
    /** Of scored items, how many were rejected by the LLM. */
    rejectedCount: integer("rejected_count").notNull().default(0),
    /**
     * Per-feed breakdown:
     *   { name, url, region, fetched, errorMessage, rawItemCount,
     *     physicalItemCount, dedupSurvivorCount }[]
     */
    perFeed: jsonb("per_feed")
      .$type<PerFeedEntry[]>()
      .notNull()
      .default([]),
    /** Free-form error messages collected during the run. */
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    notes: text("notes"),
  },
  (table) => [
    index("scout_runs_started_idx").on(table.startedAt),
    index("scout_runs_triggered_idx").on(table.triggeredBy),
  ]
);

export type PerFeedEntry = {
  name: string;
  url: string;
  region: "overseas" | "japan";
  fetched: boolean;
  errorMessage: string | null;
  rawItemCount: number;
  physicalItemCount: number;
  dedupSurvivorCount: number;
};

export type ScoutRun = typeof scoutRuns.$inferSelect;
export type NewScoutRun = typeof scoutRuns.$inferInsert;
