export const DB_ENV_KEYS = [
  "DATABASE_POOL_URL",
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
] as const;

type EnvSource = Record<string, string | undefined>;

export function getDatabaseUrlFromEnv(env: EnvSource = process.env) {
  for (const key of DB_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function hasDatabaseUrl(env: EnvSource = process.env) {
  return Boolean(getDatabaseUrlFromEnv(env));
}

export function requireDatabaseUrl(env: EnvSource = process.env) {
  const url = getDatabaseUrlFromEnv(env);
  if (!url) {
    throw new Error(`${DB_ENV_KEYS.join(", ")}のいずれかを設定してください`);
  }
  return url;
}
