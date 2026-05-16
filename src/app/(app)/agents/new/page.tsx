import { PageHeader } from "@/components/nav/page-header";
import { AgentCreateForm } from "./agent-create-form";

export const dynamic = "force-dynamic";

export default function NewAgentPage() {
  return (
    <>
      <PageHeader
        title="エージェントを新規作成"
        description="UI から追加した汎用エージェントは TS ファイル不要で動きます (mock provider 対応)。"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <AgentCreateForm />
      </div>
    </>
  );
}
