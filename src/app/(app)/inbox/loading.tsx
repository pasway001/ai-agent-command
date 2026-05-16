import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/nav/page-header";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="承認待ちInbox"
        description="エージェントが上げてきた候補をレビューします。"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <Skeleton className="h-4 w-32 mb-3" />
        <div className="rounded-md border divide-y bg-card">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-20 hidden md:block" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
