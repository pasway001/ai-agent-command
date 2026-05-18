"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { Check, X, Hand, Loader2, Undo2 } from "lucide-react";
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
import { StageBadge } from "@/components/status-badge";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { OpenApproval } from "@/lib/db/queries";
import { claimItem, releaseItem, decideItem } from "./actions";
import { DecisionDialog } from "./decision-dialog";

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
  const [items] = useState(initial);
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
  const knownIds = useRef(new Set(initial.map((i) => i.id)));

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
      | { ok: true; pipelineMessage?: string; nextStage?: string }
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
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          {items.length} 件の未処理
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-md border overflow-x-auto bg-card">
        <Table className="min-w-[920px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">優先度</TableHead>
              <TableHead>商品</TableHead>
              <TableHead>ステージ</TableHead>
              <TableHead>エージェント</TableHead>
              <TableHead>担当</TableHead>
              <TableHead className="w-32">経過</TableHead>
              <TableHead className="w-72 text-right">アクション</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
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
                  <TableCell className="font-medium max-w-[280px] truncate">
                    {item.productTitle ?? (
                      <span className="text-muted-foreground italic">
                        (商品未紐付け)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={item.productStage} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.agentId ?? "—"}
                  </TableCell>
                  <TableCell>
                    {ownedByMe ? (
                      <Badge>自分</Badge>
                    ) : claimedByOther ? (
                      <Badge variant="secondary">他レビュアー</Badge>
                    ) : (
                      <span className="text-muted-foreground/60 text-sm">
                        未割当
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {formatDistanceToNow(item.createdAt, {
                      addSuffix: true,
                      locale: ja,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1.5">
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
                              "クレームしました"
                            )
                          }
                        >
                          {isPending && pendingAction === "claim" ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Hand className="size-3.5" />
                          )}
                          担当する
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
        {items.map((item) => {
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
                  <div className="mt-1.5 text-xs text-muted-foreground flex flex-wrap gap-1.5 items-center">
                    <StageBadge stage={item.productStage} />
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
                  <Badge variant="secondary">他レビュアー</Badge>
                ) : (
                  <span className="text-muted-foreground/60 text-xs">
                    未割当
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
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
                        "クレームしました"
                      )
                    }
                  >
                    {isPending && pendingAction === "claim" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Hand className="size-3.5" />
                    )}
                    担当する
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
    </>
  );
}
