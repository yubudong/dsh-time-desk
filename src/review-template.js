import { today } from "./dates.js";
export const MAX_REVIEW_PROMPTS = 8;
export const MAX_REVIEW_TEMPLATE = 2000;
export const DEFAULT_REVIEW_TEMPLATE =
  "今天值得记下的事：\n今天的感受或收获：\n接下来想保持或调整的一件事：";
export function reviewPrompts(template, fallback = DEFAULT_REVIEW_TEMPLATE) {
  const source =
    typeof template === "string" && template.trim() ? template : fallback;
  return [
    ...new Set(
      String(source)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_REVIEW_PROMPTS);
}
export function normalizeTemplate(text) {
  const value = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  if (value.length > MAX_REVIEW_TEMPLATE) throw Error("模板最多 2000 字");
  if (value.split("\n").length > MAX_REVIEW_PROMPTS)
    throw Error("模板最多 8 个问题");
  return value;
}
export function hasReviewContent(
  text,
  template = "",
  fallback = DEFAULT_REVIEW_TEMPLATE,
) {
  const content = String(text || "").trim();
  if (!content) return false;
  const clean = (s) =>
    s
      .replace(/^\s*(?:[-*#]+|\d+[.)、])\s*/, "")
      .replace(/[：:?？\s]+$/, "")
      .trim();
  const prompts = new Set(
    [
      ...reviewPrompts(template, fallback),
      ...reviewPrompts("", fallback),
      "What is worth remembering today?",
      "How did it feel, or what did you notice?",
      "What would you like to keep or adjust?",
    ].map(clean),
  );
  return content
    .split(/\r?\n/)
    .some((line) => clean(line) && !prompts.has(clean(line)));
}
// A bounded, date-specific context for an explicitly requested AI session.
export function reviewContext(state, date, draft = "") {
  const review = state.reviews.find(
    (x) => !x.deletedAt && x.kind === "day" && x.date === date,
  );
  return {
    date,
    timeZone: state.settings.timeZone,
    prompts: reviewPrompts(state.settings.reviewTemplate),
    draft: String(draft || review?.text || "").slice(0, 20000),
    sourceVersion: review?.version || 0,
    completedTasks: state.tasks
      .filter(
        (x) =>
          !x.deletedAt &&
          x.status === "done" &&
          today(state.settings.timeZone, Date.parse(x.updatedAt)) === date,
      )
      .slice(0, 30)
      .map((x) => x.title),
    completedOccurrences: state.occurrences
      .filter((x) => !x.deletedAt && x.status === "done" && x.date === date)
      .slice(0, 30)
      .map((x) => state.tasks.find((t) => t.id === x.taskId)?.title || ""),
    focusMinutes: Math.floor(
      state.focusLogs
        .filter((x) => !x.deletedAt && x.date === date)
        .reduce((sum, x) => sum + x.seconds, 0) / 60,
    ),
    habits: state.habitLogs
      .filter((x) => !x.deletedAt && x.date === date && !x.skipped)
      .slice(0, 30)
      .map((x) => ({
        title: state.habits.find((h) => h.id === x.habitId)?.title || "",
        value: x.value,
      })),
  };
}
