import { assertEqual, defineSuite } from "./_assert";
import { salesExecutionFromMetadata } from "../../src/lib/sales/execution";
import {
  salesTaskDescriptor,
  salesTaskSortScore,
} from "../../src/lib/sales/tasks";

const t = defineSuite("sales-tasks");

t.test("salesTaskDescriptor prioritizes overdue follow-ups", () => {
  const now = new Date("2026-06-19T12:00:00.000+09:00");
  const execution = salesExecutionFromMetadata({
    salesExecution: {
      status: "contacted",
      nextFollowUpAt: "2026-06-18T00:00:00.000+09:00",
    },
  });
  const descriptor = salesTaskDescriptor(execution, now);

  assertEqual(descriptor.taskType, "follow_up");
  assertEqual(descriptor.taskPriority, "urgent");
  assertEqual(descriptor.followUpState, "overdue");
});

t.test("salesTaskDescriptor classifies active deals and initial outreach", () => {
  const active = salesTaskDescriptor(
    salesExecutionFromMetadata({ salesExecution: { status: "replied" } })
  );
  const uncontacted = salesTaskDescriptor(
    salesExecutionFromMetadata({ salesExecution: { status: "uncontacted" } })
  );

  assertEqual(active.taskType, "active_deal");
  assertEqual(active.taskPriority, "high");
  assertEqual(uncontacted.taskType, "initial_outreach");
  assertEqual(uncontacted.taskPriority, "normal");
});

t.test("salesTaskSortScore keeps follow-ups above high-score initial outreach", () => {
  const due = salesTaskDescriptor(
    salesExecutionFromMetadata({
      salesExecution: {
        status: "contacted",
        nextFollowUpAt: "2026-06-19T00:00:00.000+09:00",
      },
    }),
    new Date("2026-06-19T12:00:00.000+09:00")
  );
  const uncontacted = salesTaskDescriptor(
    salesExecutionFromMetadata({ salesExecution: { status: "uncontacted" } })
  );

  const dueScore = salesTaskSortScore(due, 65, 60);
  const uncontactedScore = salesTaskSortScore(uncontacted, 99, 99);

  assertEqual(dueScore > uncontactedScore, true);
});

export const salesTasks = t;
