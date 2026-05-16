import { cn } from "@/lib/utils";

export function StatusDot({
  active,
  label,
  className,
}: {
  active: boolean;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          active
            ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
            : "bg-muted-foreground/40"
        )}
      />
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
    </span>
  );
}
