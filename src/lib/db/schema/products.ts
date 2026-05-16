import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { productStageEnum, productStatusEnum } from "./enums";

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    asin: text("asin"),
    jan: text("jan"),
    title: text("title").notNull(),
    sourceAgentId: text("source_agent_id"),
    stage: productStageEnum("stage").notNull().default("scout"),
    status: productStatusEnum("status").notNull().default("pending"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("products_stage_idx").on(table.stage),
    index("products_status_idx").on(table.status),
    index("products_asin_idx").on(table.asin),
  ]
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
