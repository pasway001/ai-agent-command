import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DbErrorState } from "@/components/empty-state";
import { systemLabel } from "@/lib/utils";
import {
  getAgentById,
  getAgentAttachedSkills,
  getAllSkills,
  getPromptHistory,
  getPromptVersionStats,
  getRecentDisagreements,
  safe,
} from "@/lib/db/queries";
import { PromptEditor } from "./prompt-editor";
import { PromptHistoryRow } from "./prompt-history-row";
import { TestRunPanel } from "./test-run-panel";
import { SkillAttachPanel } from "./skill-attach-panel";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = await safe(() => getAgentById(id));
  if (agent === null) return <DbErrorState />;
  if (!agent) notFound();

  const [history, stats, disagreements, attachedSkills, allSkills] =
    await Promise.all([
      safe(() => getPromptHistory(id)),
      safe(() => getPromptVersionStats(id)),
      safe(() => getRecentDisagreements(id, 5)),
      safe(() => getAgentAttachedSkills(id)),
      safe(() => getAllSkills()),
    ]);

  if (
    history === null ||
    stats === null ||
    disagreements === null ||
    attachedSkills === null ||
    allSkills === null
  )
    return <DbErrorState />;

  const statsByPrompt = new Map(stats.map((s) => [s.prompt_id, s]));
  const active = history.find((h) => h.isActive) ?? history[0] ?? null;

  return (
    <>
      <PageHeader
        title={agent.name}
        description={agent.description ?? undefined}
        breadcrumb={
          <Link
            href="/agents"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-3.5" />
            エージェント一覧
          </Link>
        }
        action={
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link href={`/runs?agent=${encodeURIComponent(agent.id)}`} />
            }
          >
            <ScrollText />
            実行ログ
          </Button>
        }
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
        <section className="flex flex-wrap gap-2 items-center text-sm text-muted-foreground">
          <Badge variant="outline" className="font-mono">
            {agent.id}
          </Badge>
          <Badge variant="secondary">{systemLabel(agent.systemNo)}</Badge>
          {agent.isDynamic ? <Badge>UI製 (dynamic)</Badge> : null}
          {agent.signalKey ? (
            <Badge variant="outline" className="font-mono">
              signal: {agent.signalKey}
            </Badge>
          ) : null}
          {agent.scheduleCron ? (
            <Badge variant="outline" className="font-mono">
              cron: {agent.scheduleCron}
            </Badge>
          ) : null}
          <span className="text-xs">同時実行 {agent.concurrencyLimit}</span>
        </section>

        <Tabs defaultValue="overview" className="gap-6">
          <TabsList variant="line" className="border-b w-full justify-start">
            <TabsTrigger value="overview">概要</TabsTrigger>
            <TabsTrigger value="prompts">プロンプト</TabsTrigger>
            <TabsTrigger value="skills">スキル ({attachedSkills.length})</TabsTrigger>
            {agent.isDynamic ? (
              <TabsTrigger value="test">テスト実行</TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-8 mt-2">
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Quality
                  </p>
                  <h2 className="text-lg font-semibold">
                    直近の人間判断との不一致
                  </h2>
                </div>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {disagreements.length}件
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                次回 run の few-shot に自動注入されます。Inbox で承認/却下が積まれるとここに反映されます。
              </p>
              {disagreements.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-4 py-6 text-center">
                  不一致の記録はまだありません。
                </p>
              ) : (
                <ul className="rounded-md border divide-y bg-card">
                  {disagreements.map((d) => (
                    <li key={d.run_id} className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="outline" className="font-mono text-xs">
                          auto: {d.auto_verdict}
                        </Badge>
                        <span className="text-muted-foreground">→</span>
                        <Badge className="font-mono text-xs">
                          human: {d.human_verdict}
                        </Badge>
                        <span className="font-medium ml-2 truncate">
                          {d.product_title ?? "(no title)"}
                        </span>
                      </div>
                      {d.human_note ? (
                        <p className="text-muted-foreground">
                          レビュアーメモ: {d.human_note}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>

          <TabsContent value="prompts" className="flex flex-col gap-8 mt-2">
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Versions
                  </p>
                  <h2 className="text-lg font-semibold">プロンプト履歴</h2>
                </div>
                <span className="text-sm text-muted-foreground">
                  現在 v{active?.version ?? "—"} がアクティブ
                </span>
              </div>
              <div className="rounded-md border divide-y bg-card">
                {history.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground">
                    プロンプト未登録
                  </div>
                ) : (
                  history.map((p) => (
                    <PromptHistoryRow
                      key={p.id}
                      prompt={p}
                      stats={statsByPrompt.get(p.id) ?? null}
                    />
                  ))
                )}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Editor
                </p>
                <h2 className="text-lg font-semibold">新しいバージョンを作成</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                空欄の場合、現在アクティブなプロンプトを下敷きにして編集します。「アクティブにする」をオンにすると次の run から使われます。
              </p>
              <PromptEditor
                agentId={agent.id}
                initialSystemPrompt={active?.systemPrompt ?? ""}
                currentVersion={active?.version ?? null}
              />
            </section>
          </TabsContent>

          <TabsContent value="skills" className="flex flex-col gap-3 mt-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Skills
              </p>
              <h2 className="text-lg font-semibold">スキルのアタッチ</h2>
              <p className="text-sm text-muted-foreground mt-1">
                アタッチされたスキルの prompt fragment が base system prompt の後に順番に連結されます。
              </p>
            </div>
            <SkillAttachPanel
              agentId={agent.id}
              basePrompt={active?.systemPrompt ?? ""}
              attachedInitial={attachedSkills.map((s) => ({
                id: s.skill.id,
                slug: s.skill.slug,
                category: s.skill.category,
                name: s.skill.name,
                promptFragment: s.skill.promptFragment,
                position: s.position,
              }))}
              allSkills={allSkills.map((s) => ({
                id: s.id,
                slug: s.slug,
                category: s.category,
                name: s.name,
                promptFragment: s.promptFragment,
              }))}
            />
          </TabsContent>

          {agent.isDynamic ? (
            <TabsContent value="test" className="mt-2">
              <section className="flex flex-col gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Sandbox
                  </p>
                  <h2 className="text-lg font-semibold">
                    テスト実行 (mock provider)
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  このエージェントを単発で起動して、現在のアクティブプロンプト・テンプレ・出力スキーマで何が出るかを確認します。
                  入力 JSON はテンプレ <code>{`{{key}}`}</code> 置換と{" "}
                  <code>agent_runs.input_payload</code> の両方に使われます。
                </p>
                <TestRunPanel agentId={agent.id} />
              </section>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </>
  );
}
