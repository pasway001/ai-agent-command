"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { createSkill, updateSkill, deleteSkill } from "./actions";
import { SKILL_CATEGORIES, SKILL_CATEGORY_LABELS } from "./constants";

const fieldClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type SkillFormInitial = {
  id?: string;
  slug?: string;
  category?: string;
  name?: string;
  description?: string;
  promptFragment?: string;
  parametersSchemaJson?: string;
};

export function SkillForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: SkillFormInitial;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [category, setCategory] = useState(initial?.category ?? "research");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [promptFragment, setPromptFragment] = useState(initial?.promptFragment ?? "");
  const [parametersSchemaJson, setParametersSchemaJson] = useState(
    initial?.parametersSchemaJson ?? "{}"
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const payload = {
      slug: slug.trim(),
      category: category as (typeof SKILL_CATEGORIES)[number],
      name: name.trim(),
      description: description.trim() || undefined,
      promptFragment,
      parametersSchemaJson,
    };

    if (mode === "create") {
      const res = await createSkill(payload);
      // createSkill calls redirect() on success — only get here on error.
      setSubmitting(false);
      if (!res.ok) toast.error(res.error);
    } else {
      const res = await updateSkill(initial!.id!, payload);
      setSubmitting(false);
      if (res.ok) {
        toast.success("更新しました");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    }
  }

  async function onDelete() {
    if (!initial?.id) return;
    if (!confirm(`スキル「${initial.name}」を削除しますか？\nアタッチされている全エージェントから外れます。`)) return;
    setDeleting(true);
    const res = await deleteSkill(initial.id);
    setDeleting(false);
    if (res.ok) {
      toast.success("削除しました");
      router.push("/skills");
    } else {
      toast.error(res.error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-3xl">
      <section className="rounded-md border p-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-slug">slug</Label>
            <Input
              id="skill-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="jp_market_research"
              className="font-mono"
              required
            />
            <p className="text-xs text-muted-foreground">
              ユニーク。小文字英数 + <code>_</code>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-category">カテゴリ</Label>
            <select
              id="skill-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={fieldClass}
            >
              {SKILL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SKILL_CATEGORY_LABELS[c] ?? c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-name">表示名</Label>
          <Input
            id="skill-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 国内市場リサーチ"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="skill-desc">説明 (任意)</Label>
          <textarea
            id="skill-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={fieldClass}
            placeholder="このスキルが何をするかの一行説明"
          />
        </div>
      </section>

      <section className="rounded-md border p-4 flex flex-col gap-4">
        <h2 className="text-base font-semibold">プロンプトフラグメント</h2>
        <p className="text-sm text-muted-foreground">
          エージェントの base system prompt の後に、このフラグメントが連結されて LLM に渡されます。
          役割・手順・出力フォーマットの指示などを書きます。
        </p>
        <textarea
          value={promptFragment}
          onChange={(e) => setPromptFragment(e.target.value)}
          rows={12}
          className={`${fieldClass} font-mono`}
          placeholder="You are an expert in JP e-commerce market research. When asked about a product..."
          required
        />
      </section>

      <section className="rounded-md border p-4 flex flex-col gap-3">
        <Label htmlFor="skill-params">parameters_schema (任意, JSON)</Label>
        <textarea
          id="skill-params"
          value={parametersSchemaJson}
          onChange={(e) => setParametersSchemaJson(e.target.value)}
          rows={5}
          className={`${fieldClass} font-mono`}
        />
        <p className="text-xs text-muted-foreground">
          スキル固有のパラメータ形状。空 (<code>{`{}`}</code>) で OK。将来的にエージェント側でパラメータをオーバーライドできるようにする予定。
        </p>
      </section>

      <div className="flex justify-between items-center">
        {mode === "edit" ? (
          <Button
            variant="destructive"
            type="button"
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {deleting ? "削除中…" : "削除"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            type="button"
            disabled={submitting}
            onClick={() => router.push("/skills")}
          >
            キャンセル
          </Button>
          <Button
            type="submit"
            disabled={submitting || !name.trim() || !slug.trim() || !promptFragment.trim()}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {submitting
              ? "保存中…"
              : mode === "create"
                ? "スキルを作成"
                : "更新"}
          </Button>
        </div>
      </div>
    </form>
  );
}
