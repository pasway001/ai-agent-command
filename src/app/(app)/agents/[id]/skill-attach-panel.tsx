"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronUp, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  attachSkill,
  detachSkill,
  reorderAgentSkills,
} from "@/app/(app)/skills/actions";

export type SkillSummary = {
  id: string;
  slug: string;
  category: string;
  name: string;
  promptFragment: string;
};

export type AttachedSkillSummary = SkillSummary & { position: number };

export function SkillAttachPanel({
  agentId,
  basePrompt,
  attachedInitial,
  allSkills,
}: {
  agentId: string;
  basePrompt: string;
  attachedInitial: AttachedSkillSummary[];
  allSkills: SkillSummary[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [attached, setAttached] = useState<AttachedSkillSummary[]>(
    [...attachedInitial].sort((a, b) => a.position - b.position)
  );
  const [busy, setBusy] = useState(false);

  const attachedIds = useMemo(
    () => new Set(attached.map((s) => s.id)),
    [attached]
  );

  const composed = useMemo(() => {
    if (attached.length === 0) return basePrompt;
    const fragments = attached.map(
      (s) => `## Skill: ${s.name}\n${s.promptFragment}`
    );
    return [basePrompt.trim(), ...fragments].join("\n\n");
  }, [basePrompt, attached]);

  const availableSkills = useMemo(
    () => allSkills.filter((s) => !attachedIds.has(s.id)),
    [allSkills, attachedIds]
  );

  async function onAttach(skill: SkillSummary) {
    setBusy(true);
    const res = await attachSkill({ agentId, skillId: skill.id });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setAttached((prev) => [...prev, { ...skill, position: prev.length }]);
    startTransition(() => router.refresh());
  }

  async function onDetach(skillId: string) {
    setBusy(true);
    const res = await detachSkill({ agentId, skillId });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setAttached((prev) => prev.filter((s) => s.id !== skillId));
    startTransition(() => router.refresh());
  }

  async function onMove(skillId: string, dir: -1 | 1) {
    const idx = attached.findIndex((s) => s.id === skillId);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= attached.length) return;

    const next = [...attached];
    [next[idx], next[target]] = [next[target], next[idx]];
    const renumbered = next.map((s, i) => ({ ...s, position: i }));
    setAttached(renumbered);

    setBusy(true);
    const res = await reorderAgentSkills({
      agentId,
      skillIdsInOrder: renumbered.map((s) => s.id),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      setAttached(attached);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <div className="flex flex-col gap-4">
        <div className="rounded-md border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              アタッチ済み{" "}
              <span className="text-muted-foreground font-normal tabular-nums">
                ({attached.length})
              </span>
            </h3>
            <span className="text-[11px] text-muted-foreground">
              連結順 = 上から
            </span>
          </div>
          {attached.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-6 gap-2 text-muted-foreground">
              <Sparkles className="size-5 opacity-40" />
              <p className="text-xs">
                スキル未アタッチ。下から追加してください。
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {attached.map((s, i) => (
                <li
                  key={s.id}
                  className="group flex items-center gap-2 rounded-md border bg-background px-3 py-2 hover:border-foreground/30 transition-colors"
                >
                  <span className="text-[11px] text-muted-foreground font-mono tabular-nums w-5 text-center shrink-0">
                    {i + 1}
                  </span>
                  <Link
                    href={`/skills/${s.id}`}
                    className="font-medium text-sm hover:underline truncate flex-1 min-w-0"
                  >
                    {s.name}
                  </Link>
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] shrink-0 hidden sm:inline-flex"
                  >
                    {s.slug}
                  </Badge>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      disabled={busy || i === 0}
                      onClick={() => onMove(s.id, -1)}
                      aria-label="上へ移動"
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      disabled={busy || i === attached.length - 1}
                      onClick={() => onMove(s.id, 1)}
                      aria-label="下へ移動"
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => onDetach(s.id)}
                      aria-label="このスキルを外す"
                      className="text-destructive hover:text-destructive"
                    >
                      <X />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border bg-card p-4 flex flex-col gap-3">
          <h3 className="font-semibold text-sm">
            追加できるスキル{" "}
            <span className="text-muted-foreground font-normal tabular-nums">
              ({availableSkills.length})
            </span>
          </h3>
          {availableSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              利用可能なスキルがありません。
              <Link href="/skills/new" className="ml-1 underline">
                新規作成
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto">
              {availableSkills.map((s) => (
                <li
                  key={s.id}
                  className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted transition-colors"
                >
                  <Badge
                    variant="secondary"
                    className="text-[10px] shrink-0"
                  >
                    {s.category}
                  </Badge>
                  <span className="text-sm font-medium truncate flex-1 min-w-0">
                    {s.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono truncate hidden md:inline">
                    {s.slug}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    type="button"
                    disabled={busy}
                    onClick={() => onAttach(s)}
                  >
                    <Plus />
                    追加
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-md border bg-card p-4 flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)]">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">合成プロンプト プレビュー</h3>
          <Badge
            variant="outline"
            className="font-mono tabular-nums text-[10px]"
          >
            {composed.length.toLocaleString()} chars
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          実際に LLM に渡される system prompt。base prompt に各スキルの fragment が順序通りに連結されます。
        </p>
        <pre className="text-xs font-mono whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 max-h-[480px] overflow-y-auto leading-relaxed">
          {composed}
        </pre>
      </div>
    </div>
  );
}
