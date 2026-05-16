import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { PackageOpen } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DbErrorState } from "@/components/empty-state";
import { ProductStatusBadge } from "@/components/status-badge";
import { getProductsByStage, safe } from "@/lib/db/queries";
import type { Product } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const STAGES: Array<{ key: Product["stage"]; label: string }> = [
  { key: "scout", label: "Scout" },
  { key: "lp", label: "LP" },
  { key: "ad", label: "Ad" },
  { key: "outreach", label: "Outreach" },
  { key: "cs", label: "CS" },
  { key: "archived", label: "Archived" },
];

export default async function PipelinePage() {
  const grouped = await safe(() => getProductsByStage());

  return (
    <>
      <PageHeader
        title="商品パイプライン"
        description="各ステージの商品をレーン別に表示します。"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {grouped === null ? (
          <DbErrorState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3 auto-rows-fr">
            {STAGES.map(({ key, label }) => {
              const items = grouped[key];
              return (
                <Card
                  key={key}
                  className="flex flex-col h-[calc(100vh-220px)] min-h-[420px] bg-muted/30 py-0 gap-0 overflow-hidden"
                >
                  <CardHeader className="flex-row items-center justify-between space-y-0 px-3 py-3 border-b bg-background/70 backdrop-blur-sm shrink-0">
                    <CardTitle className="text-sm font-semibold">
                      {label}
                    </CardTitle>
                    <Badge
                      variant="secondary"
                      className="font-mono tabular-nums"
                    >
                      {items.length}
                    </Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 flex-1 overflow-y-auto p-2">
                    {items.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground py-8">
                        <PackageOpen className="size-6 opacity-40" />
                        <p className="text-xs">商品なし</p>
                      </div>
                    ) : (
                      items.slice(0, 30).map((p) => (
                        <article
                          key={p.id}
                          className="rounded-md border bg-background p-3 text-xs hover:border-foreground/30 hover:shadow-sm hover:-translate-y-px transition-all"
                        >
                          <div className="font-medium line-clamp-2 text-foreground leading-snug">
                            {p.title}
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                              {p.asin && (
                                <span className="font-mono truncate">
                                  {p.asin}
                                </span>
                              )}
                            </div>
                            <ProductStatusBadge status={p.status} />
                          </div>
                          <div className="mt-1.5 text-[10px] text-muted-foreground/70">
                            更新{" "}
                            {formatDistanceToNow(p.updatedAt, {
                              addSuffix: true,
                              locale: ja,
                            })}
                          </div>
                        </article>
                      ))
                    )}
                    {items.length > 30 ? (
                      <p className="text-[11px] text-center text-muted-foreground pt-1">
                        +{items.length - 30} 件は表示されていません
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
