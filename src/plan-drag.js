import { planKey } from "./planning.js";

export const PLAN_DRAG_TYPE = "application/x-dsh-time-desk-carried-task";

// Keep the real task/occurrence only in this page; the native payload is an opaque nonce.
export function startPlanDrag(task, context, backlog) {
  const item = backlog.find((x) => planKey(x) === planKey(task));
  if (
    !item ||
    item.event ||
    item.status === "done" ||
    context.busy ||
    !context.token
  )
    return null;
  return {
    key: planKey(item),
    date: context.date,
    revision: context.revision,
    dataEpoch: context.dataEpoch,
    token: context.token,
  };
}

export function planDropAction(session, context, backlog, token) {
  if (
    !session ||
    context.busy ||
    !token ||
    token !== session.token ||
    session.date !== context.date ||
    session.revision !== context.revision ||
    session.dataEpoch !== context.dataEpoch
  )
    return null;
  const item = backlog.find((x) => planKey(x) === session.key);
  if (!item || item.event || item.status === "done") return null;
  return {
    action: "plan",
    command: "pick",
    date: context.date,
    id: item.id,
    originalDate: item.originalDate || item.date || "",
    dataEpoch: context.dataEpoch,
    requestId: "plan-drag:" + session.token,
  };
}
