import { Sidebar } from "@/components/nav/sidebar";
import { MobileTopBar } from "@/components/nav/mobile-top-bar";
import { getCurrentUser } from "@/lib/auth/server";
import { getOpenApprovalsCount, safe } from "@/lib/db/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  const inboxCount = (await safe(() => getOpenApprovalsCount())) ?? 0;

  const sidebarUser = user
    ? {
        email: user.email ?? "",
        name: user.name ?? user.email ?? "",
      }
    : null;

  return (
    <div className="flex flex-1 h-screen overflow-hidden">
      <Sidebar
        user={sidebarUser}
        inboxCount={inboxCount}
        className="hidden lg:flex sticky top-0 h-screen"
      />
      <main className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <MobileTopBar user={sidebarUser} inboxCount={inboxCount} />
        {children}
      </main>
    </div>
  );
}
