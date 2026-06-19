export const SALES_EXECUTION_STATUSES = [
  "uncontacted",
  "contacted",
  "replied",
  "sample_requested",
  "terms_review",
  "won",
  "lost",
] as const;

export type SalesExecutionStatus = (typeof SALES_EXECUTION_STATUSES)[number];

export const SALES_EXECUTION_LABELS: Record<SalesExecutionStatus, string> = {
  uncontacted: "未連絡",
  contacted: "連絡済み",
  replied: "返信あり",
  sample_requested: "サンプル依頼",
  terms_review: "条件確認",
  won: "仕入れOK",
  lost: "見送り",
};

export const SALES_EXECUTION_VIEWS = [
  "all",
  "uncontacted",
  "due",
  "active",
  "won",
  "lost",
] as const;

export type SalesExecutionView = (typeof SALES_EXECUTION_VIEWS)[number];

export const SALES_EXECUTION_VIEW_LABELS: Record<SalesExecutionView, string> = {
  all: "すべて",
  uncontacted: "未連絡",
  due: "本日対応",
  active: "商談中",
  won: "仕入れOK",
  lost: "見送り",
};

export type SalesExecutionEvent = {
  id: string;
  status: SalesExecutionStatus;
  note: string | null;
  supplierEmail: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type SalesExecution = {
  status: SalesExecutionStatus;
  supplierEmail: string | null;
  contactName: string | null;
  contactUrl: string | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  history: SalesExecutionEvent[];
};

export type SalesFollowUpState = "none" | "overdue" | "today" | "upcoming";

export type SalesPipelineStage =
  | "scout"
  | "lp"
  | "ad"
  | "outreach"
  | "cs"
  | "archived";

export type SalesExecutionUpdateInput = {
  previous: SalesExecution;
  status: SalesExecutionStatus;
  supplierEmail: string | null;
  contactName: string | null;
  contactUrl: string | null;
  nextFollowUpAt: string | null;
  note: string | null;
  now: string;
  userId: string | null;
  eventId: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function stringValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseSalesExecutionStatus(
  value: unknown
): SalesExecutionStatus | null {
  if (typeof value !== "string") return null;
  return SALES_EXECUTION_STATUSES.includes(value as SalesExecutionStatus)
    ? (value as SalesExecutionStatus)
    : null;
}

export function parseSalesExecutionView(value: unknown): SalesExecutionView {
  if (typeof value !== "string") return "all";
  return SALES_EXECUTION_VIEWS.includes(value as SalesExecutionView)
    ? (value as SalesExecutionView)
    : "all";
}

function salesEventFromRecord(record: JsonRecord): SalesExecutionEvent | null {
  const status = parseSalesExecutionStatus(record.status);
  const createdAt = stringValue(record, "createdAt");
  if (!status || !createdAt) return null;
  return {
    id: stringValue(record, "id") ?? createdAt,
    status,
    note: stringValue(record, "note"),
    supplierEmail: stringValue(record, "supplierEmail"),
    nextFollowUpAt: stringValue(record, "nextFollowUpAt"),
    createdAt,
    createdBy: stringValue(record, "createdBy"),
  };
}

export function salesExecutionFromMetadata(
  metadataValue: unknown
): SalesExecution {
  const metadata = asRecord(metadataValue);
  const execution = asRecord(metadata?.salesExecution);
  const history = Array.isArray(execution?.history)
    ? execution.history
        .map((item) => asRecord(item))
        .filter((item): item is JsonRecord => item !== null)
        .map(salesEventFromRecord)
        .filter((item): item is SalesExecutionEvent => item !== null)
    : [];

  return {
    status: parseSalesExecutionStatus(execution?.status) ?? "uncontacted",
    supplierEmail: stringValue(execution, "supplierEmail"),
    contactName: stringValue(execution, "contactName"),
    contactUrl: stringValue(execution, "contactUrl"),
    nextFollowUpAt: stringValue(execution, "nextFollowUpAt"),
    lastContactedAt: stringValue(execution, "lastContactedAt"),
    note: stringValue(execution, "note"),
    updatedAt: stringValue(execution, "updatedAt"),
    updatedBy: stringValue(execution, "updatedBy"),
    history,
  };
}

export function nextStageForSalesStatus(
  currentStage: SalesPipelineStage,
  status: SalesExecutionStatus
): SalesPipelineStage {
  if (status === "lost") return "archived";
  if (status === "uncontacted") return currentStage;
  return "outreach";
}

export function buildSalesExecutionUpdate(
  input: SalesExecutionUpdateInput
): SalesExecution {
  const event: SalesExecutionEvent = {
    id: input.eventId,
    status: input.status,
    note: input.note,
    supplierEmail: input.supplierEmail,
    nextFollowUpAt: input.nextFollowUpAt,
    createdAt: input.now,
    createdBy: input.userId,
  };

  return {
    status: input.status,
    supplierEmail: input.supplierEmail,
    contactName: input.contactName,
    contactUrl: input.contactUrl,
    nextFollowUpAt: input.nextFollowUpAt,
    lastContactedAt:
      input.status === "uncontacted"
        ? input.previous.lastContactedAt
        : input.now,
    note: input.note,
    updatedAt: input.now,
    updatedBy: input.userId,
    history: [event, ...input.previous.history].slice(0, 30),
  };
}

export function followUpState(
  execution: SalesExecution,
  now = new Date()
): SalesFollowUpState {
  if (
    !execution.nextFollowUpAt ||
    execution.status === "uncontacted" ||
    execution.status === "won" ||
    execution.status === "lost"
  ) {
    return "none";
  }

  const followUp = new Date(execution.nextFollowUpAt);
  if (Number.isNaN(followUp.getTime())) return "none";

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(followUp);
  target.setHours(0, 0, 0, 0);

  if (target.getTime() < today.getTime()) return "overdue";
  if (target.getTime() === today.getTime()) return "today";
  return "upcoming";
}

export function isActiveSalesStatus(status: SalesExecutionStatus) {
  return status !== "uncontacted" && status !== "won" && status !== "lost";
}

export function salesExecutionMatchesView(
  execution: SalesExecution,
  view: SalesExecutionView,
  now = new Date()
) {
  if (view === "all") return true;
  if (view === "uncontacted") return execution.status === "uncontacted";
  if (view === "active") return isActiveSalesStatus(execution.status);
  if (view === "won") return execution.status === "won";
  if (view === "lost") return execution.status === "lost";
  const state = followUpState(execution, now);
  return state === "overdue" || state === "today";
}
