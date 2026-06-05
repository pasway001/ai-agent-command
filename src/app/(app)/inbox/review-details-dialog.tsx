"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Quote,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { sourceBadgeClasses } from "@/components/source-badge";
import type {
  OpenApproval,
  ScoutAxisKey,
  ScoutAxisScores,
  ScoutEvidenceItem,
} from "@/lib/db/queries";
import { SCOUT_AXIS_KEYS } from "@/lib/db/queries";

type Review = OpenApproval["review"];
type Verdict = NonNullable<Review["verdict"]>;

const VERDICT_META: Record<
  Verdict,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  approve: {
    label: "AI承認",
    icon: CheckCircle2,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  escalate: {
    label: "要確認",
    icon: AlertTriangle,
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
  },
  reject: {
    label: "AI却下",
    icon: XCircle,
    className:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
  },
};

function scoreClass(score: number | null) {
  if (score === null) return "border-border text-muted-foreground";
  if (score >= 0.7) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  if (score >= 0.5) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300";
  }
  return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300";
}

function scoreLabel(score: number | null) {
  return score === null ? "スコアなし" : `${Math.round(score * 100)}点`;
}

function hostFromUrl(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function productTypeLabel(type: Review["productType"]) {
  if (type === "physical") return "物理商品";
  if (type === "digital") return "デジタル/ソフトウェア";
  if (type === "service") return "サービス";
  if (type === "unknown") return "判断不能";
  return null;
}

export function AiScoreBadge({
  review,
  className,
}: {
  review: Review;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("h-6 font-mono text-[11px]", scoreClass(review.score), className)}
    >
      AI {scoreLabel(review.score)}
    </Badge>
  );
}

export function VerdictBadge({
  review,
  className,
}: {
  review: Review;
  className?: string;
}) {
  if (!review.verdict) {
    return (
      <Badge variant="outline" className={cn("h-6 font-normal", className)}>
        判定なし
      </Badge>
    );
  }
  const meta = VERDICT_META[review.verdict];
  const Icon = meta.icon;
  return (
    <Badge
      variant="outline"
      className={cn("h-6 gap-1 font-normal", meta.className, className)}
    >
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

export function SourceLink({
  review,
  className,
}: {
  review: Review;
  className?: string;
}) {
  if (!review.sourceUrl) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        商品URLなし
      </span>
    );
  }
  const label =
    review.sourceName ?? hostFromUrl(review.sourceUrl) ?? "商品URL";
  const badgeClass = sourceBadgeClasses(review.sourceName ?? null);
  return (
    <a
      href={review.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-xs underline-offset-3 hover:underline",
        className
      )}
    >
      <Badge
        variant="outline"
        className={cn(
          "h-5 px-2 text-[10.5px] font-medium tracking-wide",
          badgeClass
        )}
      >
        <span className="truncate">{label}</span>
      </Badge>
      <ExternalLink className="size-3 shrink-0 text-primary" />
    </a>
  );
}

function DetailLine({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value ?? "—"}</dd>
    </div>
  );
}

const AXIS_LABELS: Record<ScoutAxisKey, string> = {
  overseasTraction: "海外トラクション",
  crossSourceMentions: "クロスソース言及",
  japanValidationLevel: "日本クラファン検証",
  domesticTrend: "国内需要トレンド",
  regulatoryRisk: "規制リスク (1=安全)",
  competitionDensity: "競合密度 (1=空白)",
  priceFit: "価格適合",
  physicalLikely: "物理商品確度",
  novelty: "新規性",
};

function axisBarColor(score: number) {
  if (score >= 0.7) return "bg-emerald-500/80";
  if (score >= 0.5) return "bg-amber-500/80";
  if (score >= 0.3) return "bg-orange-500/70";
  return "bg-rose-500/60";
}

function AxisBars({ scores }: { scores: ScoutAxisScores | null }) {
  if (!scores || Object.keys(scores).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        9軸スコアは保存されていません（旧スキーマ）。
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {SCOUT_AXIS_KEYS.map((key) => {
        const ax = scores[key];
        if (!ax) {
          return (
            <div
              key={key}
              className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2 text-xs"
            >
              <span className="truncate text-muted-foreground">
                {AXIS_LABELS[key]}
              </span>
              <div className="h-2 rounded-full bg-muted" />
              <span className="text-right font-mono text-muted-foreground">
                —
              </span>
            </div>
          );
        }
        const pct = Math.round(ax.score * 100);
        return (
          <div
            key={key}
            className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2 text-xs"
            title={ax.rationale}
          >
            <span className="truncate" title={AXIS_LABELS[key]}>
              {AXIS_LABELS[key]}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-all", axisBarColor(ax.score))}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
            <span className="text-right font-mono">{pct}</span>
          </div>
        );
      })}
    </div>
  );
}

function EvidenceList({ items }: { items: ScoutEvidenceItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        引用情報源は記録されていません。
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((ev, idx) => {
        let host: string | null = null;
        try {
          host = new URL(ev.sourceUrl).hostname.replace(/^www\./, "");
        } catch {
          host = null;
        }
        return (
          <li
            key={`${ev.sourceUrl}-${idx}`}
            className="rounded-lg border border-border bg-muted/30 p-3"
          >
            <div className="mb-1 flex items-start gap-2">
              <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <p className="text-sm font-medium leading-snug">{ev.claim}</p>
            </div>
            <blockquote className="mb-2 border-l-2 border-border pl-2.5 text-xs italic text-foreground/80">
              {ev.snippet}
            </blockquote>
            <a
              href={ev.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary underline-offset-3 hover:underline"
            >
              <ExternalLink className="size-3" />
              {host ?? ev.sourceUrl}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function PointList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
          <span className="break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReviewDetailsDialog({
  item,
  onClose,
}: {
  item: OpenApproval | null;
  onClose: () => void;
}) {
  if (!item) return null;

  const review = item.review;
  const publishedAt = dateLabel(review.publishedAt);
  const host = hostFromUrl(review.sourceUrl);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <AiScoreBadge review={review} />
            <VerdictBadge review={review} />
          </div>
          <DialogTitle className="leading-snug">
            {item.productTitle ?? "(商品未紐付け)"}
          </DialogTitle>
          <DialogDescription className="break-words">
            {review.description ??
              review.category ??
              "Scoutが取得した候補の詳細です。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <SourceLink review={review} />
          {host ? (
            <span className="text-xs text-muted-foreground">({host})</span>
          ) : null}
          {publishedAt ? (
            <span className="text-xs text-muted-foreground">
              掲載日 {publishedAt}
            </span>
          ) : null}
        </div>

        <section className="border-t pt-4">
          <div className="mb-2 flex items-center gap-2">
            <Info className="size-4 text-muted-foreground" />
            <h3 className="font-medium">AIスコア根拠</h3>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">
            {review.rationale ?? "AIスコアの根拠は保存されていません。"}
          </p>
        </section>

        <section className="border-t pt-4">
          <h3 className="mb-3 font-medium">9軸スコア</h3>
          <AxisBars scores={review.axisScores} />
          {review.mentionSources.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              クロスソース言及: {review.mentionSources.join(" / ")}（
              {review.mentionSources.length} 件）
            </p>
          ) : null}
          {review.japanValidationLevel !== null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              日本クラファン検証スコア:{" "}
              {(review.japanValidationLevel * 100).toFixed(0)}/100
            </p>
          ) : null}
        </section>

        <section className="border-t pt-4">
          <h3 className="mb-3 font-medium">引用情報源 (evidence)</h3>
          <EvidenceList items={review.evidence} />
        </section>

        <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
          <section>
            <h3 className="mb-2 font-medium">強み</h3>
            <PointList items={review.pros} empty="強みの記録はありません。" />
          </section>
          <section>
            <h3 className="mb-2 font-medium">懸念</h3>
            <PointList items={review.cons} empty="懸念の記録はありません。" />
          </section>
        </div>

        <section className="border-t pt-4">
          <h3 className="mb-3 font-medium">Scoutシグナル</h3>
          <dl className="space-y-2">
            <DetailLine label="取得元" value={review.sourceName} />
            <DetailLine label="カテゴリ" value={review.category} />
            <DetailLine
              label="商品種別"
              value={productTypeLabel(review.productType)}
            />
            <DetailLine
              label="物理商品判定"
              value={
                review.physicalProductLikely === null
                  ? null
                  : review.physicalProductLikely
                    ? "物販候補"
                    : "対象外"
              }
            />
            <DetailLine label="除外理由" value={review.exclusionReason} />
            <DetailLine
              label="日本未展開"
              value={
                review.notYetInJapan === null
                  ? null
                  : review.notYetInJapan
                    ? "はい"
                    : "いいえ"
              }
            />
            <DetailLine
              label="国内類似数"
              value={review.similarProductCount}
            />
            <DetailLine label="国内調査" value={review.japanSummary} />
            <DetailLine
              label="国内例"
              value={
                review.domesticExamples.length > 0
                  ? review.domesticExamples.join(" / ")
                  : null
              }
            />
            <DetailLine label="LLM" value={review.model ?? review.provider} />
          </dl>
        </section>

        {review.sourceUrl ? (
          <div className="border-t pt-4">
            <a
              href={review.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted"
            >
              <ExternalLink className="size-3.5" />
              商品URLを開く
            </a>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
