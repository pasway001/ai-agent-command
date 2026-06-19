import {
  type SalesExecution,
  type SalesFollowUpState,
  followUpState,
  isActiveSalesStatus,
} from "./execution";

export const SALES_TASK_TYPE_LABELS = {
  follow_up: "要フォロー",
  active_deal: "商談確認",
  initial_outreach: "初回連絡",
  closed: "完了/見送り",
} as const;

export type SalesTaskType = keyof typeof SALES_TASK_TYPE_LABELS;

export const SALES_TASK_PRIORITY_LABELS = {
  urgent: "至急",
  high: "高",
  normal: "通常",
  closed: "完了",
} as const;

export type SalesTaskPriority = keyof typeof SALES_TASK_PRIORITY_LABELS;

export type SalesTaskDescriptor = {
  taskType: SalesTaskType;
  taskPriority: SalesTaskPriority;
  priorityScore: number;
  followUpState: SalesFollowUpState;
};

export function salesTaskDescriptor(
  execution: SalesExecution,
  now = new Date()
): SalesTaskDescriptor {
  const state = followUpState(execution, now);

  if (state === "overdue") {
    return {
      taskType: "follow_up",
      taskPriority: "urgent",
      priorityScore: 420,
      followUpState: state,
    };
  }

  if (state === "today") {
    return {
      taskType: "follow_up",
      taskPriority: "urgent",
      priorityScore: 410,
      followUpState: state,
    };
  }

  if (isActiveSalesStatus(execution.status)) {
    return {
      taskType: "active_deal",
      taskPriority: "high",
      priorityScore: 300,
      followUpState: state,
    };
  }

  if (execution.status === "uncontacted") {
    return {
      taskType: "initial_outreach",
      taskPriority: "normal",
      priorityScore: 200,
      followUpState: state,
    };
  }

  return {
    taskType: "closed",
    taskPriority: "closed",
    priorityScore: 0,
    followUpState: state,
  };
}

export function salesTaskSortScore(
  descriptor: SalesTaskDescriptor,
  shortlistScore: number | null | undefined,
  salesPriority: number | null | undefined
) {
  return (
    descriptor.priorityScore * 10000 +
    (salesPriority ?? 0) * 100 +
    (shortlistScore ?? 0)
  );
}
