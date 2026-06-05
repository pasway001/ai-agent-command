"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  Kanban,
  Bot,
  ScrollText,
  Coins,
  Activity,
  LogOut,
  Sparkles,
  Radar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";

type SidebarUser = { email: string; name: string };

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
};

type Section = {
  label: string;
  items: NavItem[];
};

function buildSections(inboxCount: number): Section[] {
  return [
    {
      label: "オペレーション",
      items: [
        { href: "/inbox", label: "承認待ち", icon: Inbox, badge: inboxCount },
        { href: "/pipeline", label: "パイプライン", icon: Kanban },
      ],
    },
    {
      label: "エージェント",
      items: [
        { href: "/agents", label: "稼働状況", icon: Bot },
        { href: "/skills", label: "スキル", icon: Sparkles },
      ],
    },
    {
      label: "観測",
      items: [
        { href: "/scout-runs", label: "スカウト履歴", icon: Radar },
        { href: "/runs", label: "実行ログ", icon: ScrollText },
        { href: "/cost", label: "コスト", icon: Coins },
      ],
    },
  ];
}

export function SidebarContent({
  user,
  inboxCount = 0,
  onNavigate,
}: {
  user: SidebarUser | null;
  inboxCount?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = buildSections(inboxCount);
  return (
    <>
      <div className="px-5 py-5 flex items-center gap-2 border-b shrink-0">
        <Activity className="size-5 text-primary" />
        <span className="font-semibold tracking-tight">Command Center</span>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 flex flex-col gap-5">
        {sections.map((sec) => (
          <div key={sec.label} className="flex flex-col gap-1">
            <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {sec.label}
            </div>
            {sec.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
                      : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground text-sidebar-foreground/80"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge && item.badge > 0 ? (
                    <Badge
                      variant={active ? "secondary" : "outline"}
                      className="h-5 min-w-[1.25rem] px-1.5 text-[10px] tabular-nums"
                    >
                      {item.badge}
                    </Badge>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t">
        {user ? (
          <div className="px-3 py-3 flex flex-col gap-2">
            <div className="px-2 leading-tight">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="text-xs text-sidebar-foreground/60 truncate">
                {user.email}
              </div>
            </div>
            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
              >
                <LogOut className="size-4" />
                ログアウト
              </Button>
            </form>
          </div>
        ) : null}
        <div className="px-5 py-2 text-[11px] text-sidebar-foreground/60 border-t">
          v0.1.0 · {new Date().getFullYear()}
        </div>
      </div>
    </>
  );
}

export function Sidebar({
  user,
  inboxCount = 0,
  className,
}: {
  user: SidebarUser | null;
  inboxCount?: number;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground flex-col h-full",
        className
      )}
    >
      <SidebarContent user={user} inboxCount={inboxCount} />
    </aside>
  );
}
