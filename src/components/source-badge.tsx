import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Source-coded color badge.
 *
 * Phase A — the universe of sources is tiny (Kicktraq Gadgets / Kicktraq
 * Product Design / Yanko Design / Makuake). We hand-map them to colors so
 * reviewers can spot at a glance which feed a card came from. Anything not
 * in the map falls through to a neutral outline.
 */
const SOURCE_STYLES: Array<{ test: RegExp; className: string }> = [
  {
    test: /kicktraq/i,
    className:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300",
  },
  {
    test: /yanko/i,
    className:
      "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-300",
  },
  {
    test: /makuake/i,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  {
    test: /campfire/i,
    className:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
  },
  {
    test: /kickstarter/i,
    className:
      "border-lime-200 bg-lime-50 text-lime-700 dark:border-lime-500/20 dark:bg-lime-500/10 dark:text-lime-300",
  },
  {
    test: /indiegogo/i,
    className:
      "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300",
  },
];

export function sourceBadgeClasses(name: string | null | undefined) {
  if (!name) return "";
  const hit = SOURCE_STYLES.find((entry) => entry.test.test(name));
  return hit?.className ?? "";
}

export function SourceBadge({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  if (!name) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 px-2 text-[10.5px] font-medium tracking-wide",
        sourceBadgeClasses(name),
        className
      )}
    >
      {name}
    </Badge>
  );
}
