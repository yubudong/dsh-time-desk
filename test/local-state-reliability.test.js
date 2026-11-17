import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { createService, applyAction, validateState } from "../src/model.js";
import { lessonAccount, lessonOccurrences } from "../src/lessons.js";
import {
  HOME_MODULES,
  homeModules,
  reorderHomeRegion,
} from "../src/home-modules.js";
import { createLessonDraftStore } from "../src/lesson-drafts.js";
const NOW = Date.parse("2026-11-17T14:00:00Z");
const storage = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) || null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
};
test("course drafts survive reload, keep the original record version and isolate devices", () => {
  const s = storage();
  const first = createLessonDraftStore(s);
  const draft = {
    format: 1,
    values: { item: { title: "Synthetic draft" }, opening: "8" },
    base: { lesson: 2, term: 0, session: 0 },
    requestId: "synthetic-draft",
    dirty: true,
  };
  assert.equal(first.put("device-a:editor", draft), true);
  draft.values.opening = "999";
  const second = createLessonDraftStore(s);
  assert.equal(second.read("device-a:editor").values.opening, "8");
  assert.equal(second.read("device-a:editor").base.lesson, 2);
  assert.equal(second.read("device-b:editor"), null);
  second.remove("device-a:editor");
  assert.equal(createLessonDraftStore(s).read("device-a:editor"), null);
});
test("blocked browser storage retains a draft in memory and reports it is not durable", () => {
  const s = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("quota");
    },
    removeItem() {
      throw Error("blocked");
    },
  };
  const store = createLessonDraftStore(s),
    draft = {
      format: 1,
      values: { text: "Synthetic" },
      base: { lesson: 0 },
      dirty: true,
    };
  assert.equal(store.put("a", draft), false);
  assert.equal(store.read("a").values.text, "Synthetic");
  assert.doesNotThrow(() => store.remove("a"));
  assert.equal(store.read("a"), null);
});
test("sorting either home region preserves the other, including hidden modules", () => {
  const settings = blankState("synthetic").settings;
  settings.homeModules = {
    hidden: ["timer"],
    folded: ["lessons"],
    order: ["upcoming", "weekly", "habits", "timer", "inbox", "plan"],
  };
  const main = HOME_MODULES.filter((x) => x.region === "main")
    .map((x) => x.id)
    .reverse();
  const order = reorderHomeRegion(settings, "main", main);
  const next = { ...settings, homeModules: { ...settings.homeModules, order } };
  assert.deepEqual(
    homeModules(next, "main").map((x) => x.id),
    main,
  );
  const all = { ...next, homeModules: { ...next.homeModules, hidden: [] } };
  assert.deepEqual(
    homeModules(all, "support").map((x) => x.id),
    ["upcoming", "weekly", "habits", "timer"],
  );
  const support = ["timer", "habits", "weekly", "upcoming"];
  const third = {
    ...next,
    homeModules: {
      ...next.homeModules,
      order: reorderHomeRegion(next, "support", support),
    },
  };
  assert.deepEqual(
    homeModules(third, "main").map((x) => x.id),
    main,
  );
  assert.throws(() => reorderHomeRegion(next, "main", ["timer"]), /区域/);
});
test("home settings reject overwriting a newer layout even with latest global revision", () => {
  let s = blankState("synthetic");
  const previous = JSON.stringify(s.settings.homeModules);
  s = applyAction(
    s,
    {
      action: "settings",
      revision: s.revision,
      item: { homeModules: { ...s.settings.homeModules, hidden: ["timer"] } },
    },
    NOW,
  );
  assert.throws(
    () =>
      applyAction(
        s,
        {
          action: "settings",
          command: "homeModules",
          text: previous,
          revision: s.revision,
          item: { homeModules: { hidden: [], order: [], folded: [] } },
        },
        NOW,
      ),
    /其他窗口/,
  );
});
test("full course backup restores financial audit links, schedule versions, terms and layout after reopen", async () => {
  let global = null;
  const backups = {};
  const unit = {
    async loadAll() {
      return structuredClone({ global, tables: { backups } });
    },
    async setGlobal(v) {
      global = structuredClone(v);
    },
    async putRecord(_t, k, v) {
      backups[k] = structuredClone(v);
    },
    async close() {},
  };
  let service = await createService(unit, () => NOW);
  let state = await service.operate({ action: "read" });
  const run = async (a) =>
    (state = await service.operate({ revision: state.revision, ...a }));
  await run({
    action: "lesson",
    opening: 10,
    item: {
      title: "Synthetic credits",
      mode: "credit",
      effective: "2026-11-01",
      weekdays: [1, 0],
      time: "19:00",
      weekdayTimes: [{ weekday: 0, time: "10:00" }],
    },
  });
  const id = state.lessons[0].id;
  await run({
    action: "lessonSession",
    command: "complete",
    id,
    originalDate: "2026-11-15",
    deduction: 2,
  });
  await run({
    action: "lessonSession",
    command: "undo",
    id,
    originalDate: "2026-11-15",
  });
  await run({
    action: "lessonSession",
    command: "complete",
    id,
    originalDate: "2026-11-15",
    deduction: 0.5,
  });
  await run({
    action: "lesson",
    id,
    from: "2026-11-18",
    confirm: true,
    item: {
      weekdays: [3, 0],
      weekdayTimes: [{ weekday: 0, time: "10:00" }],
      time: "18:00",
    },
  });
  await run({
    action: "lesson",
    item: {
      title: "Synthetic annual",
      mode: "term",
      effective: "2026-11-01",
      weekdays: [1],
      time: "09:00",
    },
    term: { start: "2026-11-01", end: "2026-11-30" },
  });
  await run({
    action: "lessonSession",
    command: "complete",
    id: state.lessons[1].id,
    originalDate: "2026-11-16",
    deduction: 2,
  });
  await run({
    action: "settings",
    item: {
      homeModules: {
        hidden: ["timer"],
        order: ["lessons", "plan"],
        folded: ["due"],
      },
    },
  });
  const before = structuredClone(state),
    backup = await service.operate({ action: "backup" });
  await run({
    action: "lessonCharge",
    id,
    item: { date: "2026-11-17", delta: 7, kind: "purchase" },
  });
  await run({ action: "restoreBackup", backup, confirm: true });
  assert.deepEqual(state.lessonCharges, before.lessonCharges);
  assert.deepEqual(state.lessonSessions, before.lessonSessions);
  assert.deepEqual(state.lessons, before.lessons);
  assert.deepEqual(state.lessonTerms, before.lessonTerms);
  assert.deepEqual(state.settings.homeModules, before.settings.homeModules);
  assert.equal(lessonAccount(state, state.lessons[0]).balance, 9.5);
  assert.equal(
    lessonOccurrences(state, state.lessons[0], "2026-11-15", "2026-11-15")[0]
      .time,
    "10:00",
  );
  await service.close();
  service = await createService(unit, () => NOW);
  const reopened = await service.operate({ action: "read" });
  assert.deepEqual(reopened.lessons, state.lessons);
  assert.equal(lessonAccount(reopened, reopened.lessons[0]).balance, 9.5);
  const bad = structuredClone(backup);
  bad.state.lessonCharges.find((x) => x.kind === "refund").reversesId =
    "missing-use";
  assert.equal(reopened.dataEpoch, 1);
  await assert.rejects(
    service.operate({
      action: "lesson",
      id,
      version: before.lessons[0].version,
      dataEpoch: 0,
      revision: reopened.revision,
      item: { note: "stale draft after restore" },
    }),
    /备份恢复/,
  );
  const persisted = structuredClone(global);
  await assert.rejects(
    service.operate({
      action: "restoreBackup",
      revision: reopened.revision,
      confirm: true,
      backup: bad,
    }),
    /返还/,
  );
  assert.deepEqual(global, persisted);
  await service.close();
});

test("reopening the local service keeps a running timer and never ends or counts it", async () => {
  let global = null;
  const unit = {
    async loadAll() {
      return structuredClone({ global, tables: { backups: {} } });
    },
    async setGlobal(value) {
      global = structuredClone(value);
    },
    async close() {},
  };
  let clock = NOW;
  let service = await createService(unit, () => clock);
  const started = await service.operate({
    action: "timer",
    command: "start",
    revision: 0,
    item: { minutes: 5 },
  });
  const timer = structuredClone(started.timer);
  await service.close();
  clock += 8 * 60000;
  service = await createService(unit, () => clock);
  const reopened = await service.operate({ action: "read" });
  assert.deepEqual(reopened.timer, timer);
  assert.equal(reopened.focusLogs.length, 0);
  assert.equal(reopened.revision, started.revision);
  await service.close();
});
