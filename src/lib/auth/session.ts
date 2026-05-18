export type AuthProvider = "local" | "supabase";

export type AppUser = {
  id: string;
  email: string;
  name: string;
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

export function getLocalLoginEmail() {
  return process.env.APP_AUTH_EMAIL ?? "admin@example.com";
}

export function getLocalUser(): AppUser {
  const email = getLocalLoginEmail();
  return {
    id: process.env.APP_LOCAL_USER_ID ?? DEFAULT_LOCAL_USER_ID,
    email,
    name: process.env.APP_AUTH_NAME ?? email,
  };
}

export function localAuthIsConfigured() {
  return Boolean(process.env.APP_SESSION_SECRET && process.env.APP_AUTH_PASSWORD);
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
