"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { savePromptVersion } from "./actions";

export function PromptEditor({
  agentId,
  initialSystemPrompt,
  currentVersion,
}: {
  agentId: string;
  initialSystemPrompt: string;
  currentVersion: number | null;
}) {
  const router = useRouter();
  const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt);
  const [notes, setNotes] = useState("");
  const [activate, setActivate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  const nextVersion =
    currentVersion !== null ? `v${currentVersion + 1}` : "v1";

  const dirty =
    systemPrompt !== initialSystemPrompt || notes.length > 0;

  async function save() {
    if (submitting || !systemPrompt.trim()) return;
    setSubmitting(true);
    const res = await savePromptVersion({
      agentId,
      systemPrompt,
      notes,
      activate,
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success(`${nextVersion} を保存しました`);
      setNotes("");
      startTransition(() => router.refresh());
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border bg-card p-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="system-prompt">
          System プロンプト{" "}
          <span className="text-muted-foreground font-normal">
            ({nextVersion} になります)
          </span>
        </Label>
        <textarea
          id="system-prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className="w-full min-h-[280px] max-h-[60vh] resize-y rounded-md border bg-background px-3 py-2 text-sm font-mono shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 leading-relaxed"
          placeholder="LLM に渡す System プロンプトを記述... （⌘ + Enter で保存）"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="prompt-notes">
          変更メモ{" "}
          <span className="text-muted-foreground font-normal">(任意)</span>
        </Label>
        <input
          id="prompt-notes"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例: 規制リスクが高い案件をより厳しく落とすよう指示を追加"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={activate}
          onChange={(e) => setActivate(e.target.checked)}
          className="size-4 rounded border-input accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        保存後にアクティブ化（次の run から使用）
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          type="button"
          disabled={submitting || !dirty}
          onClick={() => {
            if (window.confirm("変更を破棄しますか？")) {
              setSystemPrompt(initialSystemPrompt);
              setNotes("");
            }
          }}
        >
          リセット
        </Button>
        <Button
          disabled={submitting || !systemPrompt.trim()}
          onClick={save}
        >
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {nextVersion} として保存
        </Button>
      </div>
    </div>
  );
}
