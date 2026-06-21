import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  LOCAL_SESSION_COOKIE,
  createLocalSessionValue,
  findLocalUserByCredentials,
  getAuthProvider,
  hasSupabaseAuthEnv,
  localAuthIsConfigured,
  verifyLocalSessionValue,
  type AppUser,
} from "./session";

export async function getCurrentUser(): Promise<AppUser | null> {
  if (getAuthProvider() === "supabase") {
    if (!hasSupabaseAuthEnv()) return null;
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return {
      id: user.id,
      email: user.email ?? "",
      name: (user.user_metadata?.name as string | undefined) ?? user.email ?? "",
    };
  }

  const cookieStore = await cookies();
  return verifyLocalSessionValue(cookieStore.get(LOCAL_SESSION_COOKIE)?.value);
}

export async function requireCurrentUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("認証されていません");
  return user;
}

export async function signInWithPasswordAuth(email: string, password: string) {
  if (getAuthProvider() === "supabase") {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return;
  }

  if (!localAuthIsConfigured()) {
    throw new Error(
      "APP_SESSION_SECRET and APP_AUTH_PASSWORD are required when AUTH_PROVIDER=local"
    );
  }

  const user = findLocalUserByCredentials(email, password);
  if (!user) {
    throw new Error("メールアドレスまたはパスワードが違います");
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCAL_SESSION_COOKIE, await createLocalSessionValue(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function signOutAuth() {
  if (getAuthProvider() === "supabase" && hasSupabaseAuthEnv()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  const cookieStore = await cookies();
  cookieStore.delete(LOCAL_SESSION_COOKIE);
}

export function browserRealtimeEnabled() {
  return getAuthProvider() === "supabase" && hasSupabaseAuthEnv();
}
