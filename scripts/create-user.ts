import "./_loadenv";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error(
      "Usage: pnpm tsx scripts/create-user.ts <email> <password> [display_name]"
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: name ? { name } : undefined,
  });

  if (error) {
    console.error("create failed:", error.message);
    process.exit(1);
  }
  console.log("✔ created user", data.user?.id, data.user?.email);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
