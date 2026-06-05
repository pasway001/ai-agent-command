import { PageHeader } from "@/components/nav/page-header";
import { DbErrorState } from "@/components/empty-state";
import { getLatestScoutRun, getOpenApprovals, safe } from "@/lib/db/queries";
import { browserRealtimeEnabled, getCurrentUser } from "@/lib/auth/server";
import { InboxList } from "./inbox-list";
import { ScoutSummaryBand } from "./scout-summary-band";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const [items, latestScoutRun, user] = await Promise.all([
    safe(() => getOpenApprovals()),
    safe(() => getLatestScoutRun()),
    getCurrentUser(),
  ]);

  return (
    <>
      <PageHeader
        title="承認待ちInbox"
        description="エージェントが上げてきた候補をレビューします。"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <ScoutSummaryBand run={latestScoutRun ?? null} />
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
