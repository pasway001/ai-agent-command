import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Accent = "default" | "emerald" | "rose" | "amber" | "muted";

const ACCENT_CLASS: Record<Accent, string> = {
  default: "text-foreground",
  emerald: "text-emerald-600 dark:text-emerald-400",
  rose: "text-rose-600 dark:text-rose-400",
  amber: "text-amber-600 dark:text-amber-400",
  muted: "text-muted-foreground",
};

export function SummaryCard({
  label,
  value,
  hint,
  accent = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: Accent;
  className?: string;
}) {
  return (
    <Card className={cn("py-0", className)}>
      <CardContent className="px-4 py-4 sm:px-5 sm:py-5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div
          className={cn(
            "mt-1.5 text-2xl sm:text-3xl font-bold tabular-nums",
            ACCENT_CLASS[accent]
          )}
        >
          {value}
        </div>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
