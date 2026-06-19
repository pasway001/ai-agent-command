import { assertDeepEqual, assertEqual, defineSuite } from "./_assert";
import {
  buildSalesExecutionUpdate,
  nextStageForSalesStatus,
  parseSalesExecutionStatus,
  salesExecutionFromMetadata,
} from "../../src/lib/sales/execution";

const t = defineSuite("sales-execution");

t.test("parseSalesExecutionStatus accepts known statuses", () => {
  assertEqual(parseSalesExecutionStatus("contacted"), "contacted");
  assertEqual(parseSalesExecutionStatus("sample_requested"), "sample_requested");
});

t.test("parseSalesExecutionStatus rejects unknown values", () => {
  assertEqual(parseSalesExecutionStatus("pending"), null);
  assertEqual(parseSalesExecutionStatus(null), null);
});

t.test("salesExecutionFromMetadata returns defaults for empty metadata", () => {
  assertDeepEqual(salesExecutionFromMetadata({}), {
    status: "uncontacted",
    supplierEmail: null,
    contactName: null,
    contactUrl: null,
    nextFollowUpAt: null,
    lastContactedAt: null,
    note: null,
    updatedAt: null,
    updatedBy: null,
    history: [],
  });
});

t.test("salesExecutionFromMetadata extracts current state and valid history", () => {
  const execution = salesExecutionFromMetadata({
    salesExecution: {
      status: "replied",
      supplierEmail: "supplier@example.com",
      contactName: "Amy",
      contactUrl: "https://example.com/contact",
      nextFollowUpAt: "2026-06-20T00:00:00.000Z",
      lastContactedAt: "2026-06-19T00:00:00.000Z",
      note: "条件確認中",
      updatedAt: "2026-06-19T01:00:00.000Z",
      updatedBy: "user-1",
      history: [
        {
          id: "event-1",
          status: "replied",
          note: "返信あり",
          supplierEmail: "supplier@example.com",
          nextFollowUpAt: "2026-06-20T00:00:00.000Z",
          createdAt: "2026-06-19T01:00:00.000Z",
          createdBy: "user-1",
        },
        { status: "unknown", createdAt: "2026-06-19T01:00:00.000Z" },
      ],
    },
  });

  assertEqual(execution.status, "replied");
  assertEqual(execution.supplierEmail, "supplier@example.com");
  assertEqual(execution.history.length, 1);
  assertEqual(execution.history[0].status, "replied");
});

t.test("nextStageForSalesStatus keeps, advances, or archives pipeline stage", () => {
  assertEqual(nextStageForSalesStatus("scout", "uncontacted"), "scout");
  assertEqual(nextStageForSalesStatus("lp", "contacted"), "outreach");
  assertEqual(nextStageForSalesStatus("outreach", "lost"), "archived");
});

t.test("buildSalesExecutionUpdate appends history and touches contacted timestamp", () => {
  const previous = salesExecutionFromMetadata({
    salesExecution: {
      status: "uncontacted",
      lastContactedAt: null,
      history: [],
    },
  });
  const next = buildSalesExecutionUpdate({
    previous,
    status: "contacted",
    supplierEmail: "supplier@example.com",
    contactName: "Amy",
    contactUrl: "https://example.com",
    nextFollowUpAt: "2026-06-20T00:00:00.000Z",
    note: "初回送信",
    now: "2026-06-19T00:00:00.000Z",
    userId: "user-1",
    eventId: "event-1",
  });

  assertEqual(next.status, "contacted");
  assertEqual(next.lastContactedAt, "2026-06-19T00:00:00.000Z");
  assertEqual(next.history.length, 1);
  assertEqual(next.history[0].id, "event-1");
  assertEqual(next.history[0].note, "初回送信");
});

t.test("buildSalesExecutionUpdate keeps last contact timestamp for uncontacted reset", () => {
  const previous = salesExecutionFromMetadata({
    salesExecution: {
      status: "contacted",
      lastContactedAt: "2026-06-18T00:00:00.000Z",
      history: [
        {
          status: "contacted",
          createdAt: "2026-06-18T00:00:00.000Z",
        },
      ],
    },
  });
  const next = buildSalesExecutionUpdate({
    previous,
    status: "uncontacted",
    supplierEmail: null,
    contactName: null,
    contactUrl: null,
    nextFollowUpAt: null,
    note: "戻し",
    now: "2026-06-19T00:00:00.000Z",
    userId: "user-1",
    eventId: "event-2",
  });

  assertEqual(next.lastContactedAt, "2026-06-18T00:00:00.000Z");
  assertEqual(next.history.length, 2);
  assertEqual(next.history[0].status, "uncontacted");
});

export const salesExecution = t;
