import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/nav/page-header";

export default function Loading() {
  return (
    <>
      <PageHeader
        title="商品パイプライン"
        description="各ステージの商品をレーン別に表示します。"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[calc(100vh-220px)] min-h-[420px] rounded-md"
            />
          ))}
        </div>
      </div>
    </>
  );
}
