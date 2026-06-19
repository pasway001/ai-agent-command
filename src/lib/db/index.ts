import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof postgres>;
  db?: ReturnType<typeof createDb>;
};

function getConnectionString() {
  const connectionString =
    process.env.DATABASE_POOL_URL ??
    process.env.DATABASE_URL ??
    process.env.DATABASE_URL_DIRECT;

  if (!connectionString) {
    throw new Error(
      "DATABASE_POOL_URL, DATABASE_URL, or DATABASE_URL_DIRECT must be set"
    );
  }

  return connectionString;
}

function getClient() {
  const client =
    globalForDb.client ??
    postgres(getConnectionString(), {
      prepare: false, // required when using Supabase pooler in transaction mode
      max: 10,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.client = client;
  }

  return client;
}

function createDb() {
  return drizzle(getClient(), {
    schema,
    casing: "snake_case",
  });
}

export function getDb() {
  const database = globalForDb.db ?? createDb();

  if (process.env.NODE_ENV !== "production") {
    globalForDb.db = database;
  }

  return database;
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
