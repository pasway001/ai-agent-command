"use server";

import { redirect } from "next/navigation";
import { signInWithPasswordAuth, signOutAuth } from "@/lib/auth/server";

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/inbox") || "/inbox";

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("メールとパスワードを入力してください")}`);
  }

  try {
    await signInWithPasswordAuth(email, password);
  } catch (err) {
    redirect(`/login?error=${encodeURIComponent((err as Error).message)}`);
  }

  redirect(next.startsWith("/") ? next : "/inbox");
}

export async function signOut() {
  await signOutAuth();
  redirect("/login");
}
