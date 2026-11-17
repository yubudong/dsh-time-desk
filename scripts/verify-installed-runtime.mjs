// Run using the installed Electron runtime so its ASAR-backed packages resolve.
import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { apply, inject } from "../dist/index.js";
const anchor = process.argv[2];
if (!anchor) throw new Error("Pass the verified DSH installation directory");
const require = createRequire(path.join(anchor, "package.json"));
const load = async (name) => import(pathToFileURL(require.resolve(name)).href);
const { JsonStorageBackend } = await load("@deepseek-ai/dsh-storage-json");
const { UNIT_NAME_RE } = await load("@deepseek-ai/dsh-storage");
const { HostConnectionService } = await load(
  "@deepseek-ai/dsh-client-connection",
);
const { Context } = await load("@deepseek-ai/cordis");
const workspace = await realpath(process.cwd());
const temp = await mkdtemp(path.join(workspace, ".life-desk-runtime-test-"));
const shiftDate = (date, days) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
const backend = new JsonStorageBackend(temp);
const root = new Context();
const connection = new HostConnectionService(root, [], {
  isAuthenticated: () => false,
  authenticateApi: () => undefined,
});
const disposers = [];
let tool;
try {
  await assert.rejects(
    backend.kv.open({
      name: "life-desk-v1",
      version: 1,
      tables: ["backups"],
      hasGlobal: true,
    }),
    /invalid unit name/,
  );
  assert.ok(inject.includes("storage.backend.json"));
  const ctx = {
    storage: {
      backend: {
        get(name) {
          assert.equal(name, "json");
          return backend;
        },
      },
    },
    connection,
    tools: {
      register(def) {
        tool = def;
        return () => {};
      },
    },
    effect(callback) {
      const result = callback();
      disposers.push(async () => {
        const cleanup = await result;
        if (typeof cleanup === "function") await cleanup();
      });
    },
    provide(name, value) {
      assert.equal(name, "lifeDesk");
      assert.equal(typeof value.operate, "function");
    },
  };
  await apply(ctx);
  const handler = connection.createSharedFetchHandler("/api");
  const request = (action) =>
    handler.fetch(
      new Request("http://127.0.0.1/api/life-desk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      }),
      connection.browserPeer,
    );
  const response = await request({ action: "read" });
  assert.equal(response.status, 200);
  const initial = await response.json();
  assert.equal(initial.ok, true);
  assert.equal(initial.value.revision, 0);
  await tool.execute({
    action: "save",
    revision: 0,
    collection: "tasks",
    item: { title: "Runtime test" },
  });
  const read = await (await request({ action: "read" })).json();
  assert.equal(read.value.tasks[0].title, "Runtime test");
  const bad = await request({
    action: "save",
    revision: 0,
    collection: "tasks",
    item: { title: "Stale" },
  });
  assert.equal(bad.status, 400);
  const started = await (
    await request({
      action: "timer",
      command: "start",
      revision: 1,
      item: { minutes: 10 },
    })
  ).json();
  assert.equal(started.value.timer.duration, 600);
  assert.equal(started.value.settings.focusMinutes, 25);
  const preference = await (
    await request({
      action: "settings",
      revision: 2,
      item: { focusMinutes: 45, timerFace: "ring" },
    })
  ).json();
  assert.deepEqual(preference.value.timer, started.value.timer);
  assert.equal(preference.value.settings.focusMinutes, 45);
  const status = await (
    await request({ action: "update", command: "status" })
  ).json();
  assert.equal(status.ok, true);
  assert.match(status.value.currentVersion, /^\d+\.\d+\.\d+/);
  assert.ok(
    ["development", "managed", "unknown"].includes(status.value.installKind),
  );
  assert.equal(status.value.state.kind, "none");
  const check = await (
    await request({ action: "update", command: "check", force: true })
  ).json();
  assert.equal(check.ok, true);
  // Network is optional in CI: either a verified state or an explicit error.
  assert.ok(
    check.value.state?.kind || check.value.error,
    "update check returned no state",
  );
  console.log(
    "update check:",
    JSON.stringify({
      kind: check.value.state?.kind,
      error: check.value.error?.code,
      version: check.value.currentVersion,
      install: check.value.installKind,
      dsh: check.value.dshVersion,
    }),
  );
  await assert.rejects(
    tool.execute({ action: "update", command: "settings", autoCheck: true }),
    /仅可查看/,
  );
  const ended = await request({
    action: "timer",
    command: "discard",
    revision: 3,
    timerId: started.value.timer.id,
  });
  assert.equal(ended.status, 200);
  const upgradePreflight = await (
    await request({ action: "upgrade", command: "preflight" })
  ).json();
  assert.equal(upgradePreflight.ok, true);
  assert.equal(upgradePreflight.value.timer, null);
  const versionParts = status.value.currentVersion.split(".").map(Number);
  const nextVersion = `${versionParts[0]}.${versionParts[1]}.${versionParts[2] + 1}`;
  const preparedUpgrade = await (
    await request({
      action: "upgrade",
      command: "prepare",
      fromVersion: status.value.currentVersion,
      targetVersion: nextVersion,
      revision: upgradePreflight.value.revision,
    })
  ).json();
  assert.equal(preparedUpgrade.ok, true);
  assert.equal(preparedUpgrade.value.snapshots.length, 1);
  const liveRevision = (await (await request({ action: "read" })).json()).value
    .revision;
  const restoredUpgrade = await (
    await request({
      action: "upgrade",
      command: "restoreSnapshot",
      id: preparedUpgrade.value.snapshots[0].id,
      confirm: true,
      revision: liveRevision,
    })
  ).json();
  assert.equal(restoredUpgrade.ok, true);
  assert.equal(restoredUpgrade.value.pending, null);
  const afterRestore = (await (await request({ action: "read" })).json()).value;
  assert.equal(afterRestore.tasks[0].title, "Runtime test");
  console.log("upgrade snapshot: prepared and restored through the real route");
  const planDate = "2026-11-16";
  const planSaved = await tool.execute({
    action: "plan",
    command: "capacity",
    date: planDate,
    revision: afterRestore.revision,
    item: { availableMinutes: 90 },
  });
  assert.equal(planSaved.ok, true);
  const planRead = await (
    await request({ action: "plan", command: "read", date: planDate })
  ).json();
  const agentPlan = await tool.execute({
    action: "plan",
    command: "read",
    date: planDate,
  });
  assert.equal(planRead.value.load.availableMinutes, 90);
  assert.deepEqual(planRead.value, agentPlan);
  console.log(
    "daily plan: UI route and Agent share the same persisted capacity and workload",
  );

  const revisionNow = async () =>
    (await (await request({ action: "read" })).json()).value.revision;
  const templateSaved = await (
    await request({
      action: "settings",
      revision: await revisionNow(),
      item: { reviewTemplate: "最有收获的是什么？\n下一步想调整什么？" },
    })
  ).json();
  assert.equal(templateSaved.ok, true);
  const reviewHabit = await tool.execute({
    action: "save",
    revision: await revisionNow(),
    collection: "habits",
    item: {
      title: "Synthetic review",
      reviewLinked: true,
      rules: [{ effective: planDate, mode: "daily", allowNextDay: true }],
    },
  });
  const emptyReview = await request({
    action: "review",
    kind: "day",
    date: planDate,
    text: "最有收获的是什么？\n下一步想调整什么？",
    revision: await revisionNow(),
    version: 0,
  });
  assert.equal(emptyReview.status, 400);
  const reviewSaved = await (
    await request({
      action: "review",
      kind: "day",
      date: planDate,
      id: reviewHabit.lastRecord.id,
      text: "A synthetic review answer",
      revision: await revisionNow(),
      version: 0,
    })
  ).json();
  assert.equal(reviewSaved.ok, true);
  assert.equal(reviewSaved.value.habitLogs.length, 1);
  assert.equal(reviewSaved.value.habitLogs[0].date, planDate);
  assert.ok(reviewSaved.value.reviews[0].completedAt);
  const firstCompletion = reviewSaved.value.reviews[0].completedAt;
  const staleReview = await request({
    action: "review",
    kind: "day",
    date: planDate,
    text: "stale",
    revision: await revisionNow(),
    version: 0,
  });
  assert.equal(staleReview.status, 400);
  const editedReview = await (
    await request({
      action: "review",
      kind: "day",
      date: planDate,
      text: "Edited synthetic review",
      revision: await revisionNow(),
      version: 1,
    })
  ).json();
  assert.equal(editedReview.value.reviews[0].completedAt, firstCompletion);
  assert.equal(editedReview.value.habitLogs.length, 1);
  const agentReview = await tool.execute({
    action: "read",
    collection: "reviews",
  });
  assert.equal(agentReview.reviews.items[0].text, "Edited synthetic review");
  console.log(
    "review: personal template, question-only rejection, shared content, one completion, version conflict and edit-time preservation passed",
  );

  const homeSaved = await (
    await request({
      action: "settings",
      revision: await revisionNow(),
      item: {
        homeModules: {
          hidden: ["due"],
          order: ["lessons", "plan"],
          folded: ["priority"],
        },
      },
    })
  ).json();
  assert.equal(homeSaved.ok, true);
  assert.deepEqual(homeSaved.value.settings.homeModules.order, [
    "lessons",
    "plan",
  ]);
  const lessonCreated = await (
    await request({
      action: "lesson",
      revision: await revisionNow(),
      item: {
        title: "Synthetic course",
        participant: "Child",
        weekdays: [1],
        time: "18:00",
        durationMinutes: 60,
        effective: planDate,
        mode: "credit",
      },
    })
  ).json();
  assert.equal(lessonCreated.ok, true);
  const lessonId = lessonCreated.value.lessons[0].id;
  const chargeSaved = await (
    await request({
      action: "lessonCharge",
      id: lessonId,
      revision: await revisionNow(),
      item: { date: planDate, delta: 8, kind: "opening", note: "opening" },
    })
  ).json();
  assert.equal(chargeSaved.value.lessonCharges.length, 1);
  const attended = await (
    await request({
      action: "lessonSession",
      command: "complete",
      id: lessonId,
      originalDate: planDate,
      revision: await revisionNow(),
    })
  ).json();
  assert.equal(attended.value.lessonSessions.length, 1);
  assert.equal(attended.value.lessonSessions[0].status, "done");
  const duplicateAttendance = await request({
    action: "lessonSession",
    command: "complete",
    id: lessonId,
    originalDate: planDate,
    revision: await revisionNow(),
  });
  assert.equal(duplicateAttendance.status, 400);
  const undone = await (
    await request({
      action: "lessonSession",
      command: "undo",
      id: lessonId,
      sessionId: attended.value.lessonSessions[0].id,
      revision: await revisionNow(),
    })
  ).json();
  assert.equal(undone.ok, true);
  const moved = await (
    await request({
      action: "lessonSession",
      command: "save",
      id: lessonId,
      originalDate: planDate,
      date: shiftDate(planDate, 2),
      time: "19:00",
      revision: await revisionNow(),
    })
  ).json();
  assert.equal(moved.ok, true);
  assert.equal(moved.value.lessonSessions[0].date, shiftDate(planDate, 2));
  const restored = await (
    await request({
      action: "lessonSession",
      command: "restore",
      id: lessonId,
      originalDate: planDate,
      revision: await revisionNow(),
    })
  ).json();
  assert.equal(restored.value.lessonSessions[0].date, planDate);
  const termLesson = await (
    await request({
      action: "lesson",
      revision: await revisionNow(),
      item: {
        title: "Synthetic term",
        participant: "Child",
        weekdays: [1],
        time: "10:00",
        effective: planDate,
        mode: "term",
      },
      term: { start: planDate, end: shiftDate(planDate, 13), purchased: 4 },
    })
  ).json();
  assert.equal(termLesson.ok, true);
  const termId = termLesson.value.lessons.find(
    (x) => x.title === "Synthetic term",
  ).id;
  const outsideTerm = await request({
    action: "lessonSession",
    command: "complete",
    id: termId,
    originalDate: shiftDate(planDate, 21),
    revision: await revisionNow(),
  });
  assert.equal(outsideTerm.status, 400);
  const agentLessons = await tool.execute({
    action: "read",
    collection: "lessons",
  });
  assert.equal(agentLessons.lessons.total, 2);
  const agentSessions = await tool.execute({
    action: "read",
    collection: "lessonSessions",
  });
  assert.equal(agentSessions.lessonSessions.items.length, 1);
  console.log(
    "lessons: home modules, credit balance, duplicate protection, undo, reschedule, restore and term boundary passed",
  );

  const post = async (action) => {
    const res = await request({ revision: await revisionNow(), ...action });
    const body = await res.json();
    assert.equal(body.ok, true, body.error);
    return body.value;
  };
  for (const deduction of [2, 3]) {
    const written = await post({
      action: "lessonSession",
      command: "complete",
      id: lessonId,
      originalDate: planDate,
      deduction,
    });
    const row = written.lessonSessions[0];
    const undoneAgain = await post({
      action: "lessonSession",
      command: "undo",
      id: lessonId,
      sessionId: row.id,
    });
    const ledger = undoneAgain.lessonCharges.filter(
      (x) => !x.deletedAt && x.lessonId === lessonId,
    );
    assert.equal(
      ledger.reduce((n, x) => n + x.delta, 0),
      8,
    );
    assert.equal(ledger.at(-1).reversesId, row.chargeId);
  }
  const futureDate = new Date(Date.now() + 3 * 86400000)
    .toISOString()
    .slice(0, 10);
  const scheduled = await post({
    action: "lesson",
    id: lessonId,
    from: futureDate,
    confirm: true,
    item: { time: "20:00" },
  });
  assert.equal(
    scheduled.lessons.find((x) => x.id === lessonId).scheduleHistory.length,
    2,
  );
  assert.equal(scheduled.lessonSessions[0].time, "18:00");
  const backup = (await (await request({ action: "backup" })).json()).value;
  await post({
    action: "settings",
    item: { homeModules: { hidden: ["timer"], order: [], folded: [] } },
  });
  const restoredAll = await post({
    action: "restoreBackup",
    backup,
    confirm: true,
  });
  assert.deepEqual(restoredAll.lessonCharges, backup.state.lessonCharges);
  assert.deepEqual(restoredAll.lessons, backup.state.lessons);
  assert.deepEqual(
    restoredAll.settings.homeModules,
    backup.state.settings.homeModules,
  );
  assert.equal(restoredAll.dataEpoch, backup.state.dataEpoch + 1);
  const staleDraft = await request({
    action: "lesson",
    id: lessonId,
    dataEpoch: backup.state.dataEpoch,
    revision: await revisionNow(),
    item: { note: "stale" },
  });
  assert.equal(staleDraft.status, 400);
  for (const action of [
    "lesson",
    "lessonTerm",
    "lessonSession",
    "lessonCharge",
  ])
    assert.ok(tool.parameters.properties.action.enum.includes(action));
  const receipt = await tool.execute({
    action: "settings",
    revision: await revisionNow(),
    item: { focusMinutes: 25 },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), receipt);
  console.log(
    "reliability: varying attendance reversals, audit links, schedule history, complete backup restore, stale draft protection and lossless Agent receipt passed",
  );

  for (const callback of disposers.splice(0).reverse())
    if (typeof callback === "function") await callback();
  const reopened = await backend.kv.open({
    name: "life_desk_v1",
    version: 1,
    tables: ["backups"],
    hasGlobal: true,
    layout: "single",
  });
  assert.ok(UNIT_NAME_RE.test("life_desk_v1"));
  assert.equal(
    (await reopened.loadAll()).global.tasks[0].title,
    "Runtime test",
  );
  const storedReview = (await reopened.loadAll()).global;
  assert.equal(storedReview.reviews[0].text, "Edited synthetic review");
  assert.equal(storedReview.habitLogs.length, 1);
  assert.ok(storedReview.settings.reviewTemplate.includes("收获"));
  assert.deepEqual(storedReview.settings.homeModules.hidden, ["due"]);
  assert.equal(storedReview.lessons.length, 2);
  assert.equal(storedReview.lessonSessions.length, 1);
  assert.equal(storedReview.lessonTerms.length, 1);
  assert.equal(
    storedReview.lessons.find((x) => x.id === lessonId).scheduleHistory.length,
    2,
  );
  assert.deepEqual(storedReview.lessonCharges, backup.state.lessonCharges);
  await reopened.close();
  console.log(
    "PASS: real installed storage + real Connection route read/write + persistent reopen",
  );
} finally {
  for (const callback of disposers.reverse())
    if (typeof callback === "function") await callback();
  await root.fiber.dispose();
  await backend.close();
  const resolved = await realpath(temp);
  assert.equal(path.dirname(resolved), workspace);
  assert.ok(path.basename(resolved).startsWith(".life-desk-runtime-test-"));
  await rm(resolved, { recursive: true, force: true });
}
