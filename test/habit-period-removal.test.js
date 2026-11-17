import test from "node:test";
import assert from "node:assert/strict";
import { blankState } from "../src/schema.js";
import { createService } from "../src/model.js";

function unitWith(state) {
  let global = state;
  return {
    async loadAll() {
      return { global: structuredClone(global), tables: { backups: {} } };
    },
    async setGlobal(value) {
      global = structuredClone(value);
    },
    async putRecord(t, k, v) {
      (this.tables ||= {})[t] ||= {};
      this.tables[t][k] = structuredClone(v);
    },
    async close() {},
    get value() {
      return global;
    },
  };
}
function legacyState() {
  const state = blankState("legacy");
  state.revision = 7;
  state.habits.push({
    id: "h-legacy",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    version: 1,
    deletedAt: null,
    title: "早起",
    note: "",
    period: "morning",
    reviewLinked: true,
    plannedDates: [],
    rules: [
      {
        effective: "2026-11-01",
        mode: "daily",
        days: [0, 1, 2, 3, 4, 5, 6],
        target: 1,
        unit: "次",
        paused: false,
      },
    ],
  });
  return state;
}

test("legacy habit period is removed once, without touching other records", async () => {
  const unit = unitWith(legacyState());
  const service = await createService(unit, () =>
    Date.parse("2026-11-17T02:00:00Z"),
  );
  const current = await service.operate({ action: "read" });
  assert.equal("period" in current.habits[0], false);
  assert.equal(current.habits[0].title, "早起");
  assert.equal(current.revision, 8);
  const persisted = unit.value;
  assert.equal("period" in persisted.habits[0], false);
  assert.equal(persisted.revision, 8);
  await service.close();

  const reopened = await createService(unit, () =>
    Date.parse("2026-11-17T02:00:00Z"),
  );
  const again = await reopened.operate({ action: "read" });
  assert.equal(
    again.revision,
    8,
    "a second start must not bump the revision again",
  );
  assert.equal("period" in again.habits[0], false);
  await reopened.close();
});

test("restoring an older backup strips the removed field and keeps the habit", async () => {
  const unit = unitWith(null);
  const service = await createService(unit);
  const backup = {
    format: "dsh-time-desk",
    exportedAt: "2026-11-01T00:00:00.000Z",
    state: legacyState(),
  };
  const restored = await service.operate({
    action: "restoreBackup",
    revision: 0,
    confirm: true,
    backup,
  });
  assert.equal("period" in restored.habits[0], false);
  assert.equal(restored.habits[0].reviewLinked, true);
  assert.equal(restored.habits[0].rules.length, 1);
  assert.equal(unit.value.habits[0].title, "早起");
  await service.close();
});
