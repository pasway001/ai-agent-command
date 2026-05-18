import { PageHeader } from "@/components/nav/page-header";
import { DbErrorState } from "@/components/empty-state";
import { getOpenApprovals, safe } from "@/lib/db/queries";
import { browserRealtimeEnabled, getCurrentUser } from "@/lib/auth/server";
import { InboxList } from "./inbox-list";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const items = await safe(() => getOpenApprovals());

  const user = await getCurrentUser();

  return (
    <>
      <PageHeader
        title="承認待ちInbox"
        description="エージェントが上げてきた候補をレビューします。"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {items === null ? (
          <DbErrorState />
        ) : (
          <InboxList
            initial={items}
            currentUserId={user?.id ?? null}
            realtimeEnabled={browserRealtimeEnabled()}
          />
        )}
      </div>
    </>
  );
}
