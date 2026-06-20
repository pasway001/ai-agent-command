"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { createAgent } from "./actions";

const AGENT_TYPES = [
  { value: "scout", label: "調査 (System 1)" },
  { value: "lp", label: "LP (System 2)" },
  { value: "ad", label: "広告 (System 3)" },
  { value: "outreach", label: "営業 (System 4)" },
  { value: "cs", label: "CS (System 5)" },
] as const;

type AgentType = (typeof AGENT_TYPES)[number]["value"];

const fieldClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AgentCreateForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [agentType, setAgentType] = useState<AgentType>("scout");
  const [id, setId] = useState("scout.");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPromptTemplate, setUserPromptTemplate] = useState(
    "Title: {{title}}\nCategory: {{category}}"
  );
  const [model, setModel] = useState("mock");
  const [temperature, setTemperature] = useState("0.2");
  const [maxTokens, setMaxTokens] = useState("1024");
  const [signalKey, setSignalKey] = useState("");
  const [outputSchemaJson, setOutputSchemaJson] = useState(
    '{\n  "summary": "string",\n  "score": "number"\n}'
  );

  // When agentType changes, swap the id namespace prefix to match.
  function handleAgentTypeChange(next: AgentType) {
    setAgentType(next);
    setId((cur) => {
      const rest = cur.includes(".") ? cur.split(".").slice(1).join(".") : "";
      return `${next}.${rest}`;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const tempNum = temperature.trim() ? Number(temperature) : undefined;
    const maxTokensNum = maxTokens.trim() ? Number(maxTokens) : undefined;

    const res = await createAgent({
      id: id.trim(),
      name: name.trim(),
      agentType,
      description: description.trim() || undefined,
      systemPrompt,
      userPromptTemplate: userPromptTemplate || undefined,
      model: model.trim() || undefined,
      temperature: tempNum !== undefined && Number.isFinite(tempNum) ? tempNum : undefined,
      maxTokens:
        maxTokensNum !== undefined && Number.isFinite(maxTokensNum)
          ? Math.round(maxTokensNum)
          : undefined,
      signalKey: signalKey.trim() || undefined,
      outputSchemaJson: outputSchemaJson.trim() || undefined,
    });

    // createAgent calls redirect() on success — we only get here on error.
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error);
    } else {
      // Defensive: if redirect didn't fire (shouldn't happen) navigate manually.
      toast.success("エージェントを作成しました");
      router.push(`/agents/${encodeURIComponent(res.agentId)}`);
    }
  }

  const showSignalKey = agentType === "scout";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-3xl">
      <Link
        href="/agents"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="size-3.5" /> エージェント一覧へ戻る
      </Link>

      <section className="rounded-md border p-4 flex flex-col gap-4">
        <h2 className="text-base font-semibold">基本情報</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-type">所属システム</Label>
            <select
              id="agent-type"
              value={agentType}
              onChange={(e) => handleAgentTypeChange(e.target.value as AgentType)}
              className={fieldClass}
            >
              {AGENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-id">Agent ID</Label>
            <Input
              id="agent-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="scout.us_market_research"
              className="font-mono"
              required
            />
            <p className="text-xs text-muted-foreground">
              形式: <code>{`<system>.<slug>`}</code>(小文字英数+ <code>_</code>)
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-name">表示名</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 米Amazon市場リサーチ"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-desc">説明 (任意)</Label>
          <textarea
            id="agent-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={fieldClass}
            placeholder="このエージェントが何をするかの一行説明"
          />
        </div>
      </section>

      <section className="rounded-md border p-4 flex flex-col gap-4">
        <h2 className="text-base font-semibold">プロンプト v1</h2>

        <div className="flex flex-col gap-2">
          <Label htmlFor="system-prompt">System プロンプト</Label>
          <textarea
            id="system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
            className={`${fieldClass} font-mono`}
            placeholder="LLM に渡す役割定義と指示を記述..."
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="user-template">
            ユーザープロンプトテンプレ (任意, <code>{`{{key}}`}</code> で input を埋め込み)
          </Label>
          <textarea
            id="user-template"
            value={userPromptTemplate}
            onChange={(e) => setUserPromptTemplate(e.target.value)}
            rows={4}
            className={`${fieldClass} font-mono`}
            placeholder="Title: {{title}}"
          />
        </div>
      </section>

      <section className="rounded-md border p-4 flex flex-col gap-4">
        <h2 className="text-base font-semibold">モデルパラメータ</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="model">model</Label>
            <Input
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="mock"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              実 LLM 接続前は <code>mock</code> のままでOK
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="temperature">temperature</Label>
            <Input
              id="temperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="max-tokens">max_tokens</Label>
            <Input
              id="max-tokens"
              type="number"
              min="1"
              max="32000"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-md border p-4 flex flex-col gap-4">
        <h2 className="text-base font-semibold">出力</h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="output-schema">
            出力スキーマ JSON (任意, 空ならフリー形式)
          </Label>
          <textarea
            id="output-schema"
            value={outputSchemaJson}
            onChange={(e) => setOutputSchemaJson(e.target.value)}
            rows={6}
            className={`${fieldClass} font-mono`}
            placeholder='{ "summary": "string", "score": "number" }'
          />
          <p className="text-xs text-muted-foreground">
            キーごとに型(<code>string / number / integer / boolean / array / object</code>)を文字列で指定。mock provider はこのスキーマをもとに決定論的な値を生成します。
          </p>
        </div>

        {showSignalKey ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="signal-key">
              signal_key (任意, scout 用): <code>products.metadata.signals.&lt;key&gt;</code> に保存
            </Label>
            <Input
              id="signal-key"
              value={signalKey}
              onChange={(e) => setSignalKey(e.target.value)}
              placeholder="usMarket"
              className="font-mono"
            />
          </div>
        ) : null}
      </section>

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          type="button"
          disabled={submitting}
          onClick={() => router.push("/agents")}
        >
          キャンセル
        </Button>
        <Button type="submit" disabled={submitting || !systemPrompt.trim() || !name.trim()}>
          {submitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          {submitting ? "作成中…" : "エージェントを作成"}
        </Button>
      </div>
    </form>
  );
}
