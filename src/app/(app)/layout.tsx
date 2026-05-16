import { Sidebar } from "@/components/nav/sidebar";
import { MobileTopBar } from "@/components/nav/mobile-top-bar";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOpenApprovalsCount, safe } from "@/lib/db/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const inboxCount = (await safe(() => getOpenApprovalsCount())) ?? 0;

  const sidebarUser = user
    ? {
        email: user.email ?? "",
        name:
          (user.user_metadata?.name as string | undefined) ??
          user.email ??
          "",
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
