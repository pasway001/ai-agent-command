import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type UserInput = {
  email: string;
  password: string;
  name: string;
  role?: string;
};

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

function isUserInput(value: unknown): value is UserInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Partial<Record<keyof UserInput, unknown>>;
  return (
    typeof input.email === "string" &&
    input.email.includes("@") &&
    typeof input.password === "string" &&
    input.password.length >= 8 &&
    typeof input.name === "string" &&
    input.name.trim().length > 0 &&
    (input.role === undefined || typeof input.role === "string")
  );
}

function userMetadata(input: UserInput) {
  return {
    name: input.name.trim(),
    role: input.role ?? "reviewer",
  };
}

async function findUserByEmail(email: string) {
  const admin = getSupabaseAdmin();
  const target = email.toLowerCase();
  const perPage = 1000;

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < perPage) return null;
  }

  return null;
}

async function upsertAuthUser(input: UserInput) {
  const admin = getSupabaseAdmin();
  const existing = await findUserByEmail(input.email);
  const metadata = userMetadata(input);

  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password: input.password,
      user_metadata: metadata,
      app_metadata: { role: metadata.role },
    });
    if (error) throw error;
    return {
      action: "updated",
      id: data.user?.id ?? existing.id,
      email: data.user?.email ?? existing.email ?? input.email,
      name: metadata.name,
      role: metadata.role,
    };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: metadata,
    app_metadata: { role: metadata.role },
  });
  if (error) throw error;
  return {
    action: "created",
    id: data.user?.id,
    email: data.user?.email ?? input.email,
    name: metadata.name,
    role: metadata.role,
  };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as { users?: unknown };
  const inputs = Array.isArray(body.users) ? body.users : [];
  if (inputs.length === 0 || !inputs.every(isUserInput)) {
    return Response.json(
      {
        ok: false,
        error:
          "Body must be { users: [{ email, password, name, role? }] } with password length >= 8.",
      },
      { status: 400 }
    );
  }

  const results = [];
  for (const input of inputs) {
    results.push(await upsertAuthUser(input));
  }

  return Response.json({
    ok: true,
    users: results,
  });
}
