import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DbErrorState, EmptyState } from "@/components/empty-state";
import { getSkillsWithAttachCount, safe } from "@/lib/db/queries";
import { SKILL_CATEGORY_LABELS, SKILL_CATEGORY_ORDER } from "./constants";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const list = await safe(() => getSkillsWithAttachCount());

  return (
    <>
      <PageHeader
        title="スキル"
        description="再利用可能なシステムプロンプトのフラグメント。複数のエージェントに着脱できます。"
        action={
          <Button nativeButton={false} render={<Link href="/skills/new" />}>
            <Plus />
            新規スキル
          </Button>
        }
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {list === null ? (
          <DbErrorState />
        ) : list.length === 0 ? (
          <EmptyState
            title="スキルが未登録です"
            description="右上の「新規スキル」から最初のスキルを作成してください。"
            icon={Sparkles}
            action={
              <Button nativeButton={false} render={<Link href="/skills/new" />}>
                <Plus />
                新規スキル
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-8">
            {SKILL_CATEGORY_ORDER.map((cat) => {
              const items = list.filter((s) => s.category === cat);
              if (items.length === 0) return null;
              return (
                <section key={cat} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold">
                      {SKILL_CATEGORY_LABELS[cat] ?? cat}
                    </h2>
                    <span className="h-px bg-border flex-1" />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {items.length}
                    </span>
                  </div>
                  <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {items.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/skills/${s.id}`}
                          className="group block h-full rounded-lg border bg-card p-4 hover:border-foreground/40 hover:shadow-sm hover:-translate-y-px transition-all"
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="font-semibold text-sm group-hover:underline truncate">
                              {s.name}
                            </h3>
                            <Badge
                              variant={
                                s.attachCount > 0 ? "secondary" : "outline"
                              }
                              className="shrink-0 tabular-nums"
                            >
                              {s.attachCount} 利用
                            </Badge>
                          </div>
                          <Badge
                            variant="outline"
                            className="font-mono text-[10.5px] mb-2"
                          >
                            {s.slug}
                          </Badge>
                          {s.description ? (
                            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                              {s.description}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground/40 italic mt-1">
                              説明なし
                            </p>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
