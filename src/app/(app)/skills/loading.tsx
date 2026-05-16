import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/nav/page-header";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="スキル"
        description="再利用可能なシステムプロンプトのフラグメント。"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-8">
        {Array.from({ length: 2 }).map((_, s) => (
          <section key={s} className="flex flex-col gap-3">
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-lg" />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
