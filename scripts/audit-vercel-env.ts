import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { AI_ENV_KEYS, DB_ENV_KEYS } from "../src/lib/readiness";

type Project = {
  name: string;
  id: string;
};

type AuditResult = {
  project: Project;
  keys: Set<string>;
};

const LOCAL_AUTH_KEYS = ["APP_SESSION_SECRET", "APP_AUTH_PASSWORD"] as const;
const SUPABASE_AUTH_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

function runVercel(args: string[], cwd: string) {
  const result = spawnSync("vercel", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`vercel ${args.join(" ")} failed:\n${output}`);
  }
  return output;
}

function parseJsonFromCli(output: string) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0) throw new Error(`No JSON object found in Vercel output:\n${output}`);
  if (end <= start) {
    throw new Error(`No complete JSON object found in Vercel output:\n${output}`);
  }
  return JSON.parse(output.slice(start, end + 1)) as unknown;
}

function readLinkedProject(): Project {
  const raw = readFileSync(".vercel/project.json", "utf8");
  const parsed = JSON.parse(raw) as {
    projectId: string;
    projectName: string;
  };
  return { id: parsed.projectId, name: parsed.projectName };
}

function readLinkedOrgId() {
  const raw = readFileSync(".vercel/project.json", "utf8");
  const parsed = JSON.parse(raw) as { orgId: string };
  return parsed.orgId;
}

function listProjects(cwd: string): Project[] {
  const output = runVercel(["project", "ls", "--format=json"], cwd);
  const parsed = parseJsonFromCli(output) as {
    projects?: Array<{ name?: string; id?: string }>;
  };
  return (parsed.projects ?? [])
    .filter((p): p is { name: string; id: string } => Boolean(p.name && p.id))
    .map((p) => ({ name: p.name, id: p.id }));
}

function linkedTempDir(project: Project, orgId: string) {
  const dir = mkdtempSync(join(tmpdir(), `vercel-audit-${project.name}-`));
  mkdirSync(join(dir, ".vercel"));
  writeFileSync(
    join(dir, ".vercel", "project.json"),
    JSON.stringify({
      projectId: project.id,
      orgId,
      projectName: project.name,
    })
  );
  return dir;
}

function listEnvKeys(project: Project, orgId: string) {
  const dir = linkedTempDir(project, orgId);
  const output = runVercel(["env", "ls", "--format=json", "--cwd", dir], dir);
  const parsed = parseJsonFromCli(output) as {
    envs?: Array<{ key?: string }>;
  };
  return new Set(
    (parsed.envs ?? [])
      .map((env) => env.key)
      .filter((key): key is string => Boolean(key))
  );
}

function hasAny(keys: Set<string>, required: readonly string[]) {
  return required.some((key) => keys.has(key));
}

function hasAll(keys: Set<string>, required: readonly string[]) {
  return required.every((key) => keys.has(key));
}

function summarize(result: AuditResult) {
  const keys = result.keys;
  const authOk = hasAll(keys, LOCAL_AUTH_KEYS) || hasAll(keys, SUPABASE_AUTH_KEYS);
  const checks = [
    ["db", hasAny(keys, DB_ENV_KEYS), `one of ${DB_ENV_KEYS.join(", ")}`],
    ["auth", authOk, `local (${LOCAL_AUTH_KEYS.join(", ")}) or supabase (${SUPABASE_AUTH_KEYS.join(", ")})`],
    ["cron", hasAll(keys, ["CRON_SECRET"]), "CRON_SECRET"],
    ["app_url", hasAny(keys, ["NEXT_PUBLIC_APP_URL", "APP_URL"]), "NEXT_PUBLIC_APP_URL or APP_URL"],
    ["ai", hasAny(keys, AI_ENV_KEYS), `one of ${AI_ENV_KEYS.join(", ")}`],
  ] as const;

  const ok = checks.every(([, passed]) => passed);
  return { ok, checks };
}

function printResult(result: AuditResult) {
  const summary = summarize(result);
  console.log(`\n${summary.ok ? "OK" : "NG"} ${result.project.name} (${result.project.id})`);
  console.log(`env keys: ${result.keys.size}`);
  for (const [name, ok, detail] of summary.checks) {
    console.log(`  ${ok ? "OK " : "NG "} ${name}: ${detail}`);
  }
}

async function main() {
  const allProjects = process.argv.includes("--all-projects");
  const cwd = process.cwd();
  const orgId = readLinkedOrgId();
  const projects = allProjects ? listProjects(cwd) : [readLinkedProject()];

  const results: AuditResult[] = projects.map((project) => ({
    project,
    keys: listEnvKeys(project, orgId),
  }));

  for (const result of results) printResult(result);

  const linked = results.find((r) => r.project.id === readLinkedProject().id);
  if (linked && !summarize(linked).ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
