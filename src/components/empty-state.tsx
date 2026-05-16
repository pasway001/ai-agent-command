import { Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({
  title,
  description,
  hint,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center text-center gap-3">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <h3 className="text-base font-medium">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground max-w-sm">
            {description}
          </p>
        ) : null}
        {hint ? (
          <div className="text-xs text-muted-foreground">{hint}</div>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

export function DbErrorState() {
  return (
    <EmptyState
      title="DBに接続できませんでした"
      description="マイグレーション未実行か、.env.local の DATABASE_URL が未設定の可能性があります。"
      hint={
        <code className="text-xs">
          pnpm db:push && pnpm db:apply-rls && pnpm db:seed
        </code>
      }
    />
  );
}
