import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DbErrorState } from "@/components/empty-state";
import { getSkillById, getAgentsUsingSkill, safe } from "@/lib/db/queries";
import { systemLabel } from "@/lib/utils";
import { SkillForm } from "../skill-form";
import { SKILL_CATEGORY_LABELS } from "../constants";

export const dynamic = "force-dynamic";

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const skill = await safe(() => getSkillById(id));
  if (skill === null) return <DbErrorState />;
  if (!skill) notFound();

  const usedBy = await safe(() => getAgentsUsingSkill(skill.id));

  return (
    <>
      <PageHeader
        title={skill.name}
        description={skill.description ?? undefined}
        breadcrumb={
          <Link
            href="/skills"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-3.5" />
            スキル一覧
          </Link>
        }
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
        <section className="flex flex-wrap gap-2 items-center">
          <Badge variant="outline" className="font-mono">
            {skill.slug}
          </Badge>
          <Badge variant="secondary">
            {SKILL_CATEGORY_LABELS[skill.category as keyof typeof SKILL_CATEGORY_LABELS] ?? skill.category}
          </Badge>
          <span className="text-sm text-muted-foreground ml-auto tabular-nums">
            {usedBy?.length ?? 0} エージェントで利用中
          </span>
        </section>

        <Tabs defaultValue="edit" className="gap-6">
          <TabsList variant="line" className="border-b w-full justify-start">
            <TabsTrigger value="edit">編集</TabsTrigger>
            <TabsTrigger value="usage">
              利用エージェント ({usedBy?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="mt-2">
            <SkillForm
              mode="edit"
              initial={{
                id: skill.id,
                slug: skill.slug,
                category: skill.category,
                name: skill.name,
                description: skill.description ?? "",
                promptFragment: skill.promptFragment,
                parametersSchemaJson: JSON.stringify(
                  skill.parametersSchema ?? {},
                  null,
                  2
                ),
              }}
            />
          </TabsContent>

          <TabsContent value="usage" className="mt-2">
            {usedBy === null ? (
              <p className="text-sm text-muted-foreground">取得に失敗しました</p>
            ) : usedBy.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-4 py-6 text-center">
                まだどのエージェントにもアタッチされていません。
              </p>
            ) : (
              <ul className="rounded-md border divide-y bg-card">
                {usedBy.map((a) => (
                  <li
                    key={a.agentId}
                    className="px-4 py-3 flex items-center justify-between hover:bg-muted/40 transition-colors"
                  >
                    <Link
                      href={`/agents/${encodeURIComponent(a.agentId)}`}
                      className="font-medium hover:underline"
                    >
                      {a.agentName}
                    </Link>
                    <Badge variant="outline">
                      {systemLabel(a.systemNo)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
