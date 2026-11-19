import test from "node:test";
import assert from "node:assert/strict";
import { startPlanDrag, planDropAction } from "../src/plan-drag.js";
import { dailyPlan } from "../src/planning.js";
import { applyAction, createService } from "../src/model.js";
import { blankState } from "../src/schema.js";

const date = "2026-11-20",
  now = Date.parse(date + "T02:00:00Z");
function fixture() {
  const state = applyAction(
    blankState("synthetic-drag"),
    {
      action: "save",
      collection: "tasks",
      revision: 0,
      item: {
        title: "Synthetic carried task",
        date: "2026-11-18",
        deadline: "2026-11-21",
        minutes: 35,
      },
    },
    now,
  );
  const backlog = dailyPlan(state, date).backlog;
  const context = {
    date,
    revision: state.revision,
    dataEpoch: state.dataEpoch,
    busy: false,
    token: "synthetic-drag-1",
  };
  const session = startPlanDrag(backlog[0], context, backlog);
  return { state, backlog, context, session };
}
test("drag action selects only the displayed day and preserves the task and occurrence", () => {
  const { state, backlog, context, session } = fixture();
  const action = planDropAction(session, context, backlog, context.token);
  assert.equal(action.command, "pick");
  assert.equal(action.date, date);
  assert.equal(action.originalDate, "2026-11-18");
  const next = applyAction(state, { ...action, revision: state.revision }, now);
  assert.deepEqual(next.tasks, state.tasks);
  assert.deepEqual(next.occurrences, state.occurrences);
  assert.equal(dailyPlan(next, date).backlog.length, 0);
  assert.equal(dailyPlan(next, date).todos[0].id, backlog[0].id);
  assert.equal(dailyPlan(next, "2026-11-21").backlog.length, 1);
});
test("date change, revision conflict, restored backup epoch and busy writes invalidate drag", () => {
  const { context, backlog, session } = fixture();
  for (const change of [
    { date: "2026-11-21" },
    { revision: context.revision + 1 },
    { dataEpoch: 1 },
    { busy: true },
  ])
    assert.equal(
      planDropAction(
        session,
        { ...context, ...change },
        backlog,
        context.token,
      ),
      null,
    );
});
test("foreign and canceled drags cannot create a selection", () => {
  const { context, backlog, session } = fixture();
  for (const nonce of ["", "foreign", undefined])
    assert.equal(planDropAction(session, context, backlog, nonce), null);
  assert.equal(planDropAction(null, context, backlog, context.token), null);
  assert.equal(planDropAction(session, context, [], context.token), null);
});
test("task already picked or rescheduled is no longer a drop candidate", () => {
  const { state, context, backlog, session } = fixture();
  const action = planDropAction(session, context, backlog, context.token);
  const picked = applyAction(
    state,
    { ...action, revision: state.revision },
    now,
  );
  assert.equal(
    planDropAction(
      session,
      context,
      dailyPlan(picked, date).backlog,
      context.token,
    ),
    null,
  );
  const rescheduled = applyAction(
    state,
    {
      action: "save",
      collection: "tasks",
      id: state.tasks[0].id,
      item: { date: "2026-11-22" },
      revision: state.revision,
    },
    now,
  );
  assert.equal(
    planDropAction(
      session,
      context,
      dailyPlan(rescheduled, date).backlog,
      context.token,
    ),
    null,
  );
});
test("native payload identifies only the session, never the user's task title", () => {
  const { session, backlog } = fixture();
  assert.equal(session.token, "synthetic-drag-1");
  assert.equal(Object.hasOwn(session, "title"), false);
  assert.equal(Object.hasOwn(session, "deadline"), false);
  assert.equal(
    startPlanDrag({ ...backlog[0], id: "foreign" }, { token: "x" }, backlog),
    null,
  );
});
test("only eligible backlog rows can start a drag", () => {
  const { context, backlog } = fixture();
  assert.equal(
    startPlanDrag(backlog[0], { ...context, busy: true }, backlog),
    null,
  );
  assert.equal(
    startPlanDrag(backlog[0], { ...context, token: "" }, backlog),
    null,
  );
  for (const patch of [{ event: true }, { status: "done" }]) {
    const rows = [{ ...backlog[0], ...patch }];
    assert.equal(startPlanDrag(rows[0], context, rows), null);
  }
});
test("retrying a drop is idempotent and the existing minus action still reverses the selection", () => {
  const { state, context, backlog, session } = fixture();
  const action = {
    ...planDropAction(session, context, backlog, context.token),
    revision: state.revision,
  };
  const next = applyAction(state, action, now),
    retry = applyAction(next, action, now);
  assert.equal(retry.revision, next.revision);
  assert.equal(retry.dayPlans[0].selected.length, 1);
  const undone = applyAction(
    next,
    {
      action: "plan",
      command: "unpick",
      date,
      id: action.id,
      originalDate: action.originalDate,
      revision: next.revision,
    },
    now,
  );
  assert.equal(dailyPlan(undone, date).backlog.length, 1);
  assert.deepEqual(undone.tasks, state.tasks);
});
test("drop action is persisted by the same service as the plus button and survives reopen", async () => {
  const { state, context, backlog, session } = fixture();
  let global = state;
  const unit = {
    async loadAll() {
      return structuredClone({ global, tables: { backups: {} } });
    },
    async setGlobal(x) {
      global = structuredClone(x);
    },
    async putRecord() {},
    async close() {},
  };
  let service = await createService(unit, () => now);
  const action = planDropAction(session, context, backlog, context.token);
  await service.operate({ ...action, revision: state.revision });
  await service.close();
  service = await createService(unit, () => now);
  const plan = await service.operate({ action: "plan", command: "read", date });
  assert.equal(plan.todos[0].id, action.id);
  assert.equal(plan.backlog.length, 0);
  const fresh = await service.operate({ action: "read" });
  assert.deepEqual(fresh.tasks, state.tasks);
  await assert.rejects(
    service.operate({
      ...action,
      requestId: "synthetic-stale-write",
      revision: state.revision,
    }),
    /更新/,
  );
  assert.equal(
    (await service.operate({ action: "plan", command: "read", date })).todos
      .length,
    1,
  );
  await service.close();
});
