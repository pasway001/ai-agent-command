import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Source-coded color badge.
 *
 * Reviewers should be able to spot the source family at a glance. Anything
 * outside these families falls through to a neutral outline.
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
    test: /cool hunting|design milk|core77/i,
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
  },
  {
    test: /trendhunter|thisiswhyimbroke/i,
    className:
      "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-500/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-300",
  },
  {
    test: /new atlas|make magazine|hackaday/i,
    className:
      "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300",
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
  {
    test: /getnavi|gizmodo|roomie|lifehacker|家電 watch|impress watch/i,
    className:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300",
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
