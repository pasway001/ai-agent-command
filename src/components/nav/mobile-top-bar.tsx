"use client";

import { useState } from "react";
import { Activity, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar";

type SidebarUser = { email: string; name: string };

export function MobileTopBar({
  user,
  inboxCount = 0,
}: {
  user: SidebarUser | null;
  inboxCount?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden sticky top-0 z-30 flex items-center gap-2 border-b bg-background/80 backdrop-blur-md px-3 py-2.5">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="メニュー">
              <Menu className="size-5" />
            </Button>
          }
        />
        <SheetContent
          side="left"
          className="w-72 max-w-[80vw] p-0 flex flex-col bg-sidebar text-sidebar-foreground"
          showCloseButton={false}
        >
          <SidebarContent
            user={user}
            inboxCount={inboxCount}
            onNavigate={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
      <div className="flex items-center gap-1.5">
        <Activity className="size-4 text-primary" />
        <span className="text-sm font-semibold tracking-tight">
          Command Center
        </span>
      </div>
    </div>
  );
}
