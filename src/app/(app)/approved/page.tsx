import { PageHeader } from "@/components/nav/page-header";
import { DbErrorState } from "@/components/empty-state";
import { getApprovedItems, safe } from "@/lib/db/queries";
import { browserRealtimeEnabled, getCurrentUser } from "@/lib/auth/server";
import { ApprovedList } from "./approved-list";

export const dynamic = "force-dynamic";

export default async function ApprovedPage() {
  const [items, user] = await Promise.all([
    safe(() => getApprovedItems()),
    getCurrentUser(),
  ]);

  return (
    <>
      <PageHeader
        title="承認済み"
        description="承認された候補と、後続工程の自動実行状況を確認できます。"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {items === null ? (
          <DbErrorState />
        ) : (
          <ApprovedList
            initial={items}
            currentUserId={user?.id ?? null}
            realtimeEnabled={browserRealtimeEnabled()}
          />
        )}
      </div>
    </>
  );
}
