"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { testRunDynamicAgent } from "./actions";

export function TestRunPanel({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [inputJson, setInputJson] = useState(
    '{\n  "title": "テスト商品",\n  "category": "Beauty"\n}'
  );
  const [submitting, setSubmitting] = useState(false);
  const [lastOutput, setLastOutput] = useState<{
    runId: string;
    output: Record<string, unknown>;
  } | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="test-input">入力 JSON</Label>
        <textarea
          id="test-input"
          value={inputJson}
          onChange={(e) => setInputJson(e.target.value)}
          rows={6}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder='{ "title": "...", "category": "..." }'
        />
        <p className="text-xs text-muted-foreground">
          ユーザープロンプトテンプレの <code>{`{{key}}`}</code> をこのオブジェクトで埋めて mock 実行します。
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            const res = await testRunDynamicAgent({ agentId, inputJson });
            setSubmitting(false);
            if (res.ok) {
              setLastOutput({ runId: res.runId, output: res.output });
              toast.success(`Run ${res.runId.slice(0, 8)}… を作成しました`);
              startTransition(() => router.refresh());
            } else {
              toast.error(res.error);
            }
          }}
        >
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {submitting ? "実行中…" : "テスト実行"}
        </Button>
      </div>
      {lastOutput ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <div className="text-xs text-muted-foreground mb-1 font-mono">
            run id: {lastOutput.runId}
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(lastOutput.output, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
