import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { SkillForm } from "../skill-form";

export const dynamic = "force-dynamic";

export default function NewSkillPage() {
  return (
    <>
      <PageHeader
        title="スキルを新規作成"
        description="作成後は /agents/[id] からエージェントに着脱できます。"
        breadcrumb={
          <Link
            href="/skills"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft className="size-3.5" />
            スキル一覧
          </Link>
        }
      />
      <div className="flex-1 px-8 py-6">
        <SkillForm mode="create" />
      </div>
    </>
  );
}
