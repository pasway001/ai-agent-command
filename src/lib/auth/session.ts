export type AuthProvider = "local" | "supabase";

export type AppUser = {
  id: string;
  email: string;
  name: string;
};

type LocalAuthUser = AppUser & {
  password: string;
};

export const LOCAL_SESSION_COOKIE = "acc_local_session";
const DEFAULT_LOCAL_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function getAuthProvider(): AuthProvider {
  const raw = process.env.AUTH_PROVIDER?.toLowerCase();
  if (raw === "local" || raw === "supabase") return raw;
  return hasSupabaseAuthEnv() ? "supabase" : "local";
}

export function hasSupabaseAuthEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function fnv1a32(input: string, seed: number) {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function uuidFromText(input: string) {
  const bytes = new Uint8Array(16);
  const normalized = input.trim().toLowerCase();
  [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].forEach((seed, index) => {
    const hash = fnv1a32(`${normalized}:${index}`, seed);
    bytes[index * 4] = (hash >>> 24) & 0xff;
    bytes[index * 4 + 1] = (hash >>> 16) & 0xff;
    bytes[index * 4 + 2] = (hash >>> 8) & 0xff;
    bytes[index * 4 + 3] = hash & 0xff;
  });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function stripPassword(user: LocalAuthUser): AppUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

function legacyLocalAuthUser(): LocalAuthUser | null {
  const password = process.env.APP_AUTH_PASSWORD;
  if (!password) return null;

  const email = process.env.APP_AUTH_EMAIL ?? "admin@example.com";
  const configuredId = process.env.APP_LOCAL_USER_ID;
  return {
    id: configuredId && isUuid(configuredId) ? configuredId : DEFAULT_LOCAL_USER_ID,
    email,
    name: process.env.APP_AUTH_NAME ?? email,
    password,
  };
}

function normalizeLocalAuthUser(value: unknown): LocalAuthUser | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.email !== "string" ||
    !input.email.includes("@") ||
    typeof input.password !== "string" ||
    input.password.length === 0
  ) {
    return null;
  }

  const email = input.email.trim();
  const name =
    typeof input.name === "string" && input.name.trim().length > 0
      ? input.name.trim()
      : email;
  const id = typeof input.id === "string" && isUuid(input.id) ? input.id : uuidFromText(email);

  return {
    id,
    email,
    name,
    password: input.password,
  };
}

function additionalLocalAuthUsers() {
  const raw = process.env.APP_AUTH_USERS_JSON?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeLocalAuthUser(item))
      .filter((item): item is LocalAuthUser => item !== null);
  } catch {
    return [];
  }
}

export function getLocalAuthUsers(): LocalAuthUser[] {
  const users: LocalAuthUser[] = [];
  const seen = new Set<string>();
  const add = (user: LocalAuthUser | null) => {
    if (!user) return;
    const key = user.email.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    users.push({ ...user, email: user.email.trim() });
  };

  add(legacyLocalAuthUser());
  additionalLocalAuthUsers().forEach(add);
  return users;
}

export function getLocalLoginEmail() {
  return getLocalAuthUsers()[0]?.email ?? process.env.APP_AUTH_EMAIL ?? "admin@example.com";
}

export function getLocalUser(email?: string): AppUser {
  const normalized = email?.trim().toLowerCase();
  const user =
    (normalized
      ? getLocalAuthUsers().find((candidate) => candidate.email.toLowerCase() === normalized)
      : getLocalAuthUsers()[0]) ?? {
      id: process.env.APP_LOCAL_USER_ID ?? DEFAULT_LOCAL_USER_ID,
      email: process.env.APP_AUTH_EMAIL ?? "admin@example.com",
      name: process.env.APP_AUTH_NAME ?? process.env.APP_AUTH_EMAIL ?? "admin@example.com",
      password: "",
    };

  return stripPassword(user);
}

export function findLocalUserByCredentials(email: string, password: string): AppUser | null {
  const normalized = email.trim().toLowerCase();
  const user = getLocalAuthUsers().find(
    (candidate) =>
      candidate.email.trim().toLowerCase() === normalized && candidate.password === password
  );
  return user ? stripPassword(user) : null;
}

export function localAuthIsConfigured() {
  return Boolean(process.env.APP_SESSION_SECRET && getLocalAuthUsers().length > 0);
}

function getSessionSecret() {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) {
    throw new Error("APP_SESSION_SECRET is required when AUTH_PROVIDER=local");
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "="
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function signaturesMatch(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createLocalSessionValue(
  user: AppUser,
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS
) {
  const payload = stringToBase64Url(
    JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    })
  );
  const signature = await sign(payload, getSessionSecret());
  return `${payload}.${signature}`;
}

export async function verifyLocalSessionValue(
  value: string | undefined
): Promise<AppUser | null> {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = await sign(payload, getSessionSecret());
  if (!signaturesMatch(signature, expected)) return null;

  try {
    const parsed = JSON.parse(base64UrlToString(payload)) as AppUser & {
      exp?: number;
    };
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!parsed.id || !parsed.email) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      name: parsed.name ?? parsed.email,
    };
  } catch {
    return null;
  }
}

export const __test = {
  uuidFromText,
};
