import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { requireDatabaseUrl } from "./url";

const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof postgres>;
  db?: ReturnType<typeof createDb>;
};

function getConnectionString() {
  return requireDatabaseUrl();
}

function getMaxConnections() {
  const raw = process.env.DATABASE_MAX_CONNECTIONS;
  const parsed = raw ? Number.parseInt(raw, 10) : 2;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

function getClient() {
  if (!globalForDb.client) {
    globalForDb.client = postgres(getConnectionString(), {
      prepare: false, // required when using Supabase pooler in transaction mode
      max: getMaxConnections(),
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  return globalForDb.client;
}

function createDb() {
  return drizzle(getClient(), {
    schema,
    casing: "snake_case",
  });
}

export function getDb() {
  if (!globalForDb.db) {
    globalForDb.db = createDb();
  }

  return globalForDb.db;
}

export async function closeDb() {
  const client = globalForDb.client;
  globalForDb.client = undefined;
  globalForDb.db = undefined;
  await client?.end({ timeout: 5 });
}

type Database = ReturnType<typeof createDb>;

export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const database = getDb();
    const value = Reflect.get(database, prop, receiver);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export { schema };
