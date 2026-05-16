// Constants shared between client components and server actions.
// IMPORTANT: This file must NOT have "use server" — Next.js would otherwise
// turn these exports into server references, and `Array.map(...)` would fail
// on the client.

export const SKILL_CATEGORIES = [
  "research",
  "writing",
  "analysis",
  "communication",
  "other",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  research: "リサーチ",
  writing: "ライティング",
  analysis: "分析",
  communication: "コミュニケーション",
  other: "その他",
};

export const SKILL_CATEGORY_ORDER: SkillCategory[] = [
  "research",
  "writing",
  "analysis",
  "communication",
  "other",
];
