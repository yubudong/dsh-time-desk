import test from "node:test";
import assert from "node:assert/strict";
import { blankState, Settings } from "../src/schema.js";
import { applyAction } from "../src/model.js";
import {
  HOME_MODULES,
  HOME_MODULE_IDS,
  homeModules,
  isFolded,
} from "../src/home-modules.js";
const NOW = Date.parse("2026-11-17T02:00:00Z");
test("default home shows every module in registry order", () => {
  const s = blankState("home");
  assert.deepEqual(
    homeModules(s.settings, "main").map((x) => x.id),
    HOME_MODULES.filter((x) => x.region === "main").map((x) => x.id),
  );
  assert.deepEqual(
    homeModules(s.settings, "support").map((x) => x.id),
    HOME_MODULES.filter((x) => x.region === "support").map((x) => x.id),
  );
});
test("hiding a module removes it entirely without touching other data", () => {
  let s = blankState("home");
  s.tasks.push({
    id: "t",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    version: 1,
    deletedAt: null,
    title: "Keep me",
    area: "inbox",
    projectId: "",
    status: "todo",
    date: "2026-11-17",
    deadline: "",
    time: "",
    minutes: 0,
    pomodoros: 0,
    note: "",
    priorityDate: "",
    event: false,
    tag: "",
    reminderMinutes: null,
    reminderTime: "09:00",
    repeat: {
      kind: "none",
      interval: 1,
      days: [1],
      until: "",
      monthMode: "date",
      missing: "last",
      month: 1,
      day: 1,
      leap: "regular",
      leapFallback: "regular",
      unit: "months",
    },
    steps: [],
  });
  s = applyAction(
    s,
    {
      action: "settings",
      revision: s.revision,
      item: {
        homeModules: { hidden: ["priority", "due"], order: [], folded: [] },
      },
    },
    NOW,
  );
  const ids = homeModules(s.settings, "main").map((x) => x.id);
  assert.equal(ids.includes("priority"), false);
  assert.equal(ids.includes("due"), false);
  assert.equal(s.tasks[0].title, "Keep me");
});
test("order reorders only the listed modules and keeps the rest after them", () => {
  const s = blankState("home");
  const settings = Settings.parse({
    ...s.settings,
    homeModules: {
      hidden: [],
      order: ["inbox", "lessons", "plan"],
      folded: [],
    },
  });
  assert.deepEqual(
    homeModules(settings, "main")
      .slice(0, 3)
      .map((x) => x.id),
    ["inbox", "lessons", "plan"],
  );
  assert.deepEqual(
    homeModules(settings, "main")
      .slice(3)
      .map((x) => x.id),
    ["priority", "schedule", "planned", "carry", "due", "previous", "done"],
  );
});
test("folding is a separate preference from visibility", () => {
  const s = blankState("home");
  const settings = Settings.parse({
    ...s.settings,
    homeModules: {
      hidden: ["due"],
      order: [],
      folded: ["priority", "habits"],
    },
  });
  assert.equal(isFolded(settings, "priority"), true);
  assert.equal(isFolded(settings, "due"), false);
  assert.equal(isFolded(settings, "inbox"), false);
  assert.equal(
    homeModules(settings, "support").some((x) => x.id === "habits"),
    true,
  );
});
test("only known module ids can be stored and reset clears all preferences", () => {
  let s = blankState("home");
  assert.throws(
    () =>
      Settings.parse({
        ...s.settings,
        homeModules: { hidden: ["unknown"], order: [], folded: [] },
      }),
    /Invalid|invalid|option/i,
  );
  s = applyAction(
    s,
    {
      action: "settings",
      revision: s.revision,
      item: {
        homeModules: {
          hidden: ["due"],
          order: ["inbox"],
          folded: ["priority"],
        },
      },
    },
    NOW,
  );
  s = applyAction(
    s,
    {
      action: "settings",
      revision: s.revision,
      item: { homeModules: { hidden: [], order: [], folded: [] } },
    },
    NOW,
  );
  assert.deepEqual(s.settings.homeModules, {
    hidden: [],
    order: [],
    folded: [],
  });
  assert.equal(HOME_MODULE_IDS.length, 14);
});
