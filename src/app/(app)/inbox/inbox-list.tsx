"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import {
  ArrowDownWideNarrow,
  Check,
  X,
  Hand,
  Loader2,
  Undo2,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { StageBadge } from "@/components/status-badge";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { OpenApproval } from "@/lib/db/queries";
import { claimItem, releaseItem, decideItem } from "./actions";
import { DecisionDialog } from "./decision-dialog";
import {
  AiScoreBadge,
  ReviewDetailsDialog,
  SourceLink,
  VerdictBadge,
  reviewCategoryLabel,
} from "./review-details-dialog";

type InboxSortMode =
  | "priority"
  | "ai-score-desc"
  | "ai-score-asc"
  | "verdict"
  | "newest"
  | "oldest";

const SORT_OPTIONS: Array<{ value: InboxSortMode; label: string }> = [
  { value: "priority", label: "優先度 高い順" },
  { value: "ai-score-desc", label: "AI評価 高い順" },
  { value: "verdict", label: "承認推奨順" },
  { value: "newest", label: "新着順" },
  { value: "oldest", label: "古い順" },
  { value: "ai-score-asc", label: "AI評価 低い順" },
];

function isInboxSortMode(value: unknown): value is InboxSortMode {
  return (
    typeof value === "string" &&
    SORT_OPTIONS.some((option) => option.value === value)
  );
}

const VERDICT_RANK: Record<
  NonNullable<OpenApproval["review"]["verdict"]>,
  number
> = {
  approve: 3,
  escalate: 2,
  reject: 1,
};

function createdTime(item: OpenApproval) {
  const time = new Date(item.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareCreatedAt(
  a: OpenApproval,
  b: OpenApproval,
  direction: "asc" | "desc"
) {
  const diff = createdTime(a) - createdTime(b);
  return direction === "asc" ? diff : -diff;
}

function comparePriority(a: OpenApproval, b: OpenApproval) {
  return b.priority - a.priority || compareCreatedAt(a, b, "asc");
}

function compareNullableNumber(
  a: number | null,
  b: number | null,
  direction: "asc" | "desc"
) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function compareVerdict(a: OpenApproval, b: OpenApproval) {
  const aRank = a.review.verdict ? VERDICT_RANK[a.review.verdict] : 0;
  const bRank = b.review.verdict ? VERDICT_RANK[b.review.verdict] : 0;
  return bRank - aRank;
}

function compareBySortMode(
  a: OpenApproval,
  b: OpenApproval,
  sortMode: InboxSortMode
) {
  switch (sortMode) {
    case "ai-score-desc":
      return (
        compareNullableNumber(a.review.score, b.review.score, "desc") ||
        compareVerdict(a, b) ||
        comparePriority(a, b)
      );
    case "ai-score-asc":
      return (
        compareNullableNumber(a.review.score, b.review.score, "asc") ||
        compareVerdict(a, b) ||
        comparePriority(a, b)
      );
    case "verdict":
      return (
        compareVerdict(a, b) ||
        compareNullableNumber(a.review.score, b.review.score, "desc") ||
        comparePriority(a, b)
      );
    case "newest":
      return compareCreatedAt(a, b, "desc") || comparePriority(a, b);
    case "oldest":
      return compareCreatedAt(a, b, "asc") || comparePriority(a, b);
    case "priority":
    default:
      return comparePriority(a, b);
  }
}

function ProductReviewCell({ item }: { item: OpenApproval }) {
  const review = item.review;
  return (
    <div className="min-w-0 space-y-1">
      <div className="break-words font-medium leading-snug">
        {item.productTitle ?? (
          <span className="text-muted-foreground italic">(商品未紐付け)</span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <SourceLink review={review} />
        {reviewCategoryLabel(review.category) ? (
          <span className="text-xs text-muted-foreground">
            {reviewCategoryLabel(review.category)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StageBadge stage={item.productStage} />
        {item.agentId ? (
          <span className="font-mono text-xs text-muted-foreground">
            {item.agentId}
          </span>
        ) : null}
      </div>
      {review.description ? (
        <p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
          {review.description}
        </p>
      ) : null}
    </div>
  );
}

function AiReviewCell({ item }: { item: OpenApproval }) {
  const review = item.review;
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <AiScoreBadge review={review} />
        <VerdictBadge review={review} />
      </div>
      <p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">
        {review.rationale ??
          review.nextAction ??
          review.japanAngle ??
          "AI評価の詳細は保存されていません。"}
      </p>
      {review.pros[0] || review.salesReasons[0] ? (
        <p className="truncate text-xs text-foreground/80">
          強み: {review.pros[0] ?? review.salesReasons[0]}
        </p>
      ) : null}
    </div>
  );
}

export function InboxList({
  initial,
  currentUserId,
  realtimeEnabled,
}: {
  initial: OpenApproval[];
  currentUserId: string | null;
  realtimeEnabled: boolean;
}) {
  const router = useRouter();
  const items = initial;
  const [sortMode, setSortMode] = useState<InboxSortMode>("priority");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "claim" | "release" | "approve" | "reject" | null
  >(null);
  const [, startTransition] = useTransition();
  const [dialogItem, setDialogItem] = useState<{
    id: string;
    decision: "approve" | "reject";
    title: string;
  } | null>(null);
  const [detailsItem, setDetailsItem] = useState<OpenApproval | null>(null);
  const knownIds = useRef(new Set(initial.map((i) => i.id)));
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => compareBySortMode(a, b, sortMode)),
    [items, sortMode]
  );
  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sortMode)?.label ??
    SORT_OPTIONS[0].label;

  useEffect(() => {
    for (const item of initial) {
      knownIds.current.add(item.id);
    }
  }, [initial]);

  useEffect(() => {
    if (!realtimeEnabled) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("approval_queue_inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "approval_queue" },
        (payload) => {
          const id = (payload.new as { id?: string }).id;
          if (id && !knownIds.current.has(id)) {
            knownIds.current.add(id);
            toast.info("新しい承認候補が届きました");
          }
          startTransition(() => router.refresh());
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "approval_queue" },
        () => {
          startTransition(() => router.refresh());
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [realtimeEnabled, router]);

  if (items.length === 0) {
    return (
      <EmptyState
        title="未処理の承認はありません"
        description="新しい候補が届くとここに表示されます。"
      />
    );
  }

  const runWith = async (
    id: string,
    action: "claim" | "release" | "approve" | "reject",
    fn: () => Promise<
      | { ok: true; pipelineMessage?: string }
      | { ok: false; error: string }
    >,
    successMessage: string
  ) => {
    setPendingId(id);
    setPendingAction(action);
    const res = await fn();
    setPendingId(null);
    setPendingAction(null);
    if (res.ok) {
      toast.success(successMessage, {
        description: res.pipelineMessage,
      });
      startTransition(() => router.refresh());
    } else {
      toast.error(res.error);
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground tabular-nums">
          {items.length} 件の未処理
          <span className="hidden sm:inline"> / {selectedSortLabel}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">並び順</span>
          <Select
            value={sortMode}
            onValueChange={(value) => {
              if (isInboxSortMode(value)) setSortMode(value);
            }}
          >
            <SelectTrigger
              aria-label="並び順"
              size="sm"
              className="h-8 w-[12.5rem] rounded-md"
            >
              <ArrowDownWideNarrow className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-md border bg-card md:block">
        <Table className="min-w-[1160px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">優先度</TableHead>
              <TableHead className="w-[320px]">候補</TableHead>
              <TableHead className="w-[360px]">AI評価</TableHead>
              <TableHead className="w-24">経過</TableHead>
              <TableHead className="w-[360px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedItems.map((item) => {
              const ownedByMe =
                currentUserId !== null && item.assignedTo === currentUserId;
              const claimedByOther =
                item.assignedTo !== null && !ownedByMe;
              const isPending = pendingId === item.id;
              return (
                <TableRow
                  key={item.id}
                  className="hover:bg-muted/40 transition-colors"
                >
                  <TableCell>
                    <Badge
                      variant={item.priority > 0 ? "default" : "secondary"}
                      className="tabular-nums"
                    >
                      P{item.priority}
                    </Badge>
                  </TableCell>
                  <TableCell className="overflow-hidden align-top">
                    <ProductReviewCell item={item} />
                  </TableCell>
                  <TableCell className="overflow-hidden align-top">
                    <AiReviewCell item={item} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {formatDistanceToNow(item.createdAt, {
                      addSuffix: true,
                      locale: ja,
                    })}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <div className="mb-2 flex justify-end">
                      {ownedByMe ? (
                        <Badge>自分</Badge>
                      ) : claimedByOther ? (
                        <Badge variant="secondary">他担当</Badge>
                      ) : (
                        <span className="text-muted-foreground/60 text-sm">
                          未担当
                        </span>
                      )}
                    </div>
                    <div className="inline-flex flex-wrap justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDetailsItem(item)}
                      >
                        <Info className="size-3.5" />
                        詳細
                      </Button>
                      {!item.assignedTo ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() =>
                            runWith(
                              item.id,
                              "claim",
                              () => claimItem(item.id),
                              "担当しました"
                            )
                          }
                        >
                          {isPending && pendingAction === "claim" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Hand className="size-3.5" />
                          )}
                          担当
                        </Button>
                      ) : ownedByMe ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() =>
                            runWith(
                              item.id,
                              "release",
                              () => releaseItem(item.id),
                              "担当を解除しました"
                            )
                          }
                        >
                          {isPending && pendingAction === "release" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Undo2 className="size-3.5" />
                          )}
                          解除
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isPending || claimedByOther}
                        onClick={() =>
                          setDialogItem({
                            id: item.id,
                            decision: "approve",
                            title: item.productTitle ?? "(商品未紐付け)",
                          })
                        }
                      >
                        <Check className="size-3.5" />
                        承認
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isPending || claimedByOther}
                        onClick={() =>
                          setDialogItem({
                            id: item.id,
                            decision: "reject",
                            title: item.productTitle ?? "(商品未紐付け)",
                          })
                        }
                      >
                        <X className="size-3.5" />
                        却下
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <ul className="md:hidden flex flex-col gap-3">
        {sortedItems.map((item) => {
          const ownedByMe =
            currentUserId !== null && item.assignedTo === currentUserId;
          const claimedByOther =
            item.assignedTo !== null && !ownedByMe;
          const isPending = pendingId === item.id;
          return (
            <li
              key={item.id}
              className="rounded-md border bg-card p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    {item.productTitle ?? "(商品未紐付け)"}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <StageBadge stage={item.productStage} />
                    <AiScoreBadge review={item.review} />
                    <VerdictBadge review={item.review} />
                    {item.agentId ? (
                      <span className="font-mono">{item.agentId}</span>
                    ) : null}
                    <span>
                      ·{" "}
                      {formatDistanceToNow(item.createdAt, {
                        addSuffix: true,
                        locale: ja,
                      })}
                    </span>
                  </div>
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <SourceLink review={item.review} />
                    {reviewCategoryLabel(item.review.category) ? (
                      <span className="text-xs text-muted-foreground">
                        {reviewCategoryLabel(item.review.category)}
                      </span>
                    ) : null}
                  </div>
                  {item.review.rationale || item.review.nextAction ? (
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                      {item.review.rationale ?? item.review.nextAction}
                    </p>
                  ) : null}
                </div>
                <Badge
                  variant={item.priority > 0 ? "default" : "secondary"}
                  className="tabular-nums shrink-0"
                >
                  P{item.priority}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {ownedByMe ? (
                  <Badge>自分</Badge>
                ) : claimedByOther ? (
                  <Badge variant="secondary">他担当</Badge>
                ) : (
                  <span className="text-muted-foreground/60 text-xs">
                    未担当
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDetailsItem(item)}
                >
                  <Info className="size-3.5" />
                  詳細
                </Button>
                {!item.assignedTo ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      runWith(
                        item.id,
                        "claim",
                        () => claimItem(item.id),
                        "担当しました"
                      )
                    }
                  >
                    {isPending && pendingAction === "claim" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Hand className="size-3.5" />
                    )}
                    担当
                  </Button>
                ) : ownedByMe ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() =>
                      runWith(
                        item.id,
                        "release",
                        () => releaseItem(item.id),
                        "担当を解除しました"
                      )
                    }
                  >
                    {isPending && pendingAction === "release" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Undo2 className="size-3.5" />
                    )}
                    解除
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="default"
                  disabled={isPending || claimedByOther}
                  onClick={() =>
                    setDialogItem({
                      id: item.id,
                      decision: "approve",
                      title: item.productTitle ?? "(商品未紐付け)",
                    })
                  }
                >
                  <Check className="size-3.5" />
                  承認
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isPending || claimedByOther}
                  onClick={() =>
                    setDialogItem({
                      id: item.id,
                      decision: "reject",
                      title: item.productTitle ?? "(商品未紐付け)",
                    })
                  }
                >
                  <X className="size-3.5" />
                  却下
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <DecisionDialog
        item={dialogItem}
        onClose={() => setDialogItem(null)}
        onSubmit={async (note) => {
          if (!dialogItem) return;
          await runWith(
            dialogItem.id,
            dialogItem.decision,
            () =>
              decideItem({
                id: dialogItem.id,
                decision: dialogItem.decision,
                note,
              }),
            dialogItem.decision === "approve"
              ? "承認しました"
              : "却下しました"
          );
          setDialogItem(null);
        }}
      />
      <ReviewDetailsDialog
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
      />
    </>
  );
}
