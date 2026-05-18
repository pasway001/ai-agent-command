"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
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
import type { OpenApproval } from "@/lib/db/queries";

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
  return (
    <a
      href={review.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-xs font-medium text-primary underline-offset-3 hover:underline",
        className
      )}
    >
      <span className="truncate">
        {review.sourceName ?? hostFromUrl(review.sourceUrl) ?? "商品URL"}
      </span>
      <ExternalLink className="size-3 shrink-0" />
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
