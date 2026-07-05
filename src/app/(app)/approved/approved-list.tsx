"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { StageBadge, ProductStatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ApprovedItem } from "@/lib/db/queries";
import {
  AiScoreBadge,
  ReviewDetailsDialog,
  SourceLink,
  VerdictBadge,
  reviewCategoryLabel,
} from "../inbox/review-details-dialog";

function AutomationBadge({
  automation,
}: {
  automation: ApprovedItem["automation"];
}) {
  if (automation.status === "running") {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 font-normal border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300"
      >
        <Loader2 className="size-3 animate-spin" />
        自動実行中
      </Badge>
    );
  }
  if (automation.status === "failed") {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 font-normal border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
      >
        <AlertTriangle className="size-3" />
        自動化失敗
      </Badge>
    );
  }
  if (automation.status === "ok") {
    return (
      <Badge
        variant="outline"
        className="h-6 gap-1 font-normal border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
      >
        <CheckCircle2 className="size-3" />
        次工程へ進行
      </Badge>
    );
  }
  return (
    <span className="text-xs text-muted-foreground/60">記録なし</span>
  );
}

function DecidedByBadge({
  item,
  currentUserId,
}: {
  item: ApprovedItem;
  currentUserId: string | null;
}) {
  const ownedByMe =
    currentUserId !== null && item.decidedBy === currentUserId;
  return ownedByMe ? (
    <Badge variant="secondary" className="h-5 text-[10px]">
      自分
    </Badge>
  ) : (
    <Badge variant="outline" className="h-5 text-[10px] font-normal">
      他レビュアー
    </Badge>
  );
}

export function ApprovedList({
  initial,
  currentUserId,
  realtimeEnabled,
}: {
  initial: ApprovedItem[];
  currentUserId: string | null;
  realtimeEnabled: boolean;
}) {
  const router = useRouter();
  const items = initial;
  const [, startTransition] = useTransition();
  const [detailsItem, setDetailsItem] = useState<ApprovedItem | null>(null);

  useEffect(() => {
    if (!realtimeEnabled) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("approval_queue_approved")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "approval_queue" },
        () => startTransition(() => router.refresh())
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "products" },
        () => startTransition(() => router.refresh())
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [realtimeEnabled, router]);

  if (items.length === 0) {
    return (
      <EmptyState
        title="承認済みの候補はまだありません"
        description="Inboxで承認するとここに表示され、後続工程の自動実行状況もあわせて確認できます。"
      />
    );
  }

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground tabular-nums">
        {items.length} 件の承認済み
        {items.length >= 300 ? "（直近300件を表示）" : null}
      </p>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-md border bg-card md:block">
        <Table className="min-w-[1160px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[340px]">商品</TableHead>
              <TableHead className="w-[280px]">AI評価</TableHead>
              <TableHead className="w-[220px]">承認情報</TableHead>
              <TableHead className="w-[260px]">後続工程の自動実行</TableHead>
              <TableHead className="w-20 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                className="hover:bg-muted/40 transition-colors"
              >
                <TableCell className="overflow-hidden align-top">
                  <div className="min-w-0 space-y-1">
                    <div className="break-words font-medium leading-snug">
                      {item.productTitle ?? (
                        <span className="text-muted-foreground italic">
                          (商品未紐付け)
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <SourceLink review={item.review} />
                      {reviewCategoryLabel(item.review.category) ? (
                        <span className="text-xs text-muted-foreground">
                          {reviewCategoryLabel(item.review.category)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StageBadge stage={item.productStage} />
                      {item.productStatus ? (
                        <ProductStatusBadge status={item.productStatus} />
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="overflow-hidden align-top">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <AiScoreBadge review={item.review} />
                      <VerdictBadge review={item.review} />
                    </div>
                    <p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
                      {item.review.rationale ?? "AI評価の詳細は保存されていません。"}
                    </p>
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <DecidedByBadge item={item} currentUserId={currentUserId} />
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {item.decidedAt
                          ? formatDistanceToNow(item.decidedAt, {
                              addSuffix: true,
                              locale: ja,
                            })
                          : "—"}
                      </span>
                    </div>
                    {item.decisionNote ? (
                      <p className="line-clamp-3 break-words text-xs leading-5 text-muted-foreground">
                        {item.decisionNote}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-1.5">
                    <AutomationBadge automation={item.automation} />
                    {item.automation.message ? (
                      <p
                        className={cn(
                          "line-clamp-2 break-words text-xs leading-5",
                          item.automation.status === "failed"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground"
                        )}
                      >
                        {item.automation.message}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right align-top">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDetailsItem(item)}
                  >
                    <Info className="size-3.5" />
                    詳細
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <ul className="md:hidden flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-md border bg-card p-4 flex flex-col gap-3"
          >
            <div className="min-w-0">
              <div className="font-medium truncate">
                {item.productTitle ?? "(商品未紐付け)"}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <StageBadge stage={item.productStage} />
                {item.productStatus ? (
                  <ProductStatusBadge status={item.productStatus} />
                ) : null}
                <AiScoreBadge review={item.review} />
                <VerdictBadge review={item.review} />
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <SourceLink review={item.review} />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <DecidedByBadge item={item} currentUserId={currentUserId} />
              <span className="text-xs text-muted-foreground tabular-nums">
                {item.decidedAt
                  ? formatDistanceToNow(item.decidedAt, {
                      addSuffix: true,
                      locale: ja,
                    })
                  : "—"}
              </span>
            </div>
            <div className="space-y-1.5">
              <AutomationBadge automation={item.automation} />
              {item.automation.message ? (
                <p
                  className={cn(
                    "line-clamp-2 break-words text-xs leading-5",
                    item.automation.status === "failed"
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-muted-foreground"
                  )}
                >
                  {item.automation.message}
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() => setDetailsItem(item)}
            >
              <Info className="size-3.5" />
              詳細
            </Button>
          </li>
        ))}
      </ul>

      <ReviewDetailsDialog
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
      />
    </>
  );
}
