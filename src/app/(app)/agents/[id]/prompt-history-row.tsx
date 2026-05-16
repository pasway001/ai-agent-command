"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, Power } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentPrompt } from "@/lib/db/schema";
import { activatePromptVersion } from "./actions";

type Stats = {
  prompt_id: string | null;
  runs: number;
  reviewed: number;
  agreement: number | null;
  human_reject_rate: number | null;
};

export function PromptHistoryRow({
  prompt,
  stats,
}: {
  prompt: AgentPrompt;
  stats: Stats | null;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  const fmtPct = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          aria-label={expanded ? "プロンプトを閉じる" : "プロンプトを表示"}
          className="text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
        <Badge variant={prompt.isActive ? "default" : "outline"}>
          v{prompt.version}
        </Badge>
        {prompt.isActive ? <Badge>アクティブ</Badge> : null}
        <span className="text-sm text-muted-foreground">
          {formatDistanceToNow(prompt.createdAt, {
            addSuffix: true,
            locale: ja,
          })}
        </span>
        <span className="text-sm flex-1 truncate">{prompt.notes ?? ""}</span>
        <div className="text-xs text-muted-foreground inline-flex gap-3 whitespace-nowrap">
          <span>runs: {stats?.runs ?? 0}</span>
          <span>一致率: {fmtPct(stats?.agreement)}</span>
          <span>人却下: {fmtPct(stats?.human_reject_rate)}</span>
        </div>
        {!prompt.isActive ? (
          <Button
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              const res = await activatePromptVersion({
                agentId: prompt.agentId,
                promptId: prompt.id,
              });
              setSubmitting(false);
              if (res.ok) {
                toast.success(`v${prompt.version} をアクティブ化しました`);
                startTransition(() => router.refresh());
              } else {
                toast.error(res.error);
              }
            }}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Power className="size-3.5" />
            )}
            アクティブ化
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <div className="mt-3 ml-7 rounded-md bg-muted/40 p-3 max-h-[480px] overflow-y-auto">
          <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed">
            {prompt.systemPrompt}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
