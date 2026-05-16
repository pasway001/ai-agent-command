import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = {
  label: string;
  className: string;
};

const PRODUCT_STATUS: Record<string, Tone> = {
  pending: {
    label: "確認待ち",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
  },
  approved: {
    label: "承認済",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
  },
  rejected: {
    label: "却下",
    className:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20",
  },
};

const RUN_STATUS: Record<string, Tone> = {
  succeeded: {
    label: "成功",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
  },
  running: {
    label: "実行中",
    className:
      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20",
  },
  queued: {
    label: "待機",
    className:
      "bg-muted text-muted-foreground border-border",
  },
  failed: {
    label: "失敗",
    className:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20",
  },
  cancelled: {
    label: "中止",
    className:
      "bg-muted text-muted-foreground border-border",
  },
};

const STAGE_LABELS: Record<string, string> = {
  scout: "Scout",
  lp: "LP",
  ad: "Ad",
  outreach: "Outreach",
  cs: "CS",
  archived: "Archived",
};

export function ProductStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone = PRODUCT_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-normal h-5", tone.className, className)}
    >
      {tone.label}
    </Badge>
  );
}

export function RunStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone = RUN_STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge
      variant="outline"
      className={cn("text-[11px] font-normal", tone.className, className)}
    >
      {tone.label}
    </Badge>
  );
}

export function StageBadge({
  stage,
  className,
}: {
  stage: string | null | undefined;
  className?: string;
}) {
  if (!stage) {
    return <span className="text-muted-foreground/60 text-xs">—</span>;
  }
  return (
    <Badge variant="outline" className={cn("font-normal", className)}>
      {STAGE_LABELS[stage] ?? stage}
    </Badge>
  );
}
