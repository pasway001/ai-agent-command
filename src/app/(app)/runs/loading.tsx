import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/nav/page-header";

export default function Loading() {
  return (
    <>
      <PageHeader title="実行ログ・根拠" description="直近の実行 (最新100件)" />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <Skeleton className="h-4 w-20 mb-3" />
        <div className="rounded-md border divide-y bg-card">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
