import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/model.js";
function unit() {
  let global = null;
  const tables = { backups: {} };
  return {
    async loadAll() {
      return structuredClone({ global, tables });
    },
    async setGlobal(v) {
      global = structuredClone(v);
    },
    async putRecord(t, k, v) {
      tables[t][k] = structuredClone(v);
    },
    async close() {},
  };
}
test("renamed package exports new format and accepts old backups without losing IDs", async () => {
  const service = await createService(unit());
  let s = await service.operate({
    action: "save",
    revision: 0,
    collection: "tasks",
    item: { title: "Compatibility fixture" },
  });
  const id = s.tasks[0].id;
  const backup = await service.operate({ action: "backup" });
  assert.equal(backup.format, "dsh-time-desk");
  s = await service.operate({
    action: "restoreBackup",
    revision: s.revision,
    confirm: true,
    backup: { ...backup, format: "dsh-life-desk" },
  });
  assert.equal(s.tasks[0].id, id);
  s = await service.operate({
    action: "restoreBackup",
    revision: s.revision,
    confirm: true,
    backup,
  });
  assert.equal(s.tasks[0].id, id);
  await assert.rejects(
    service.operate({
      action: "restoreBackup",
      revision: s.revision,
      confirm: true,
      backup: { ...backup, format: "other-app" },
    }),
    /备份格式/,
  );
  assert.equal((await service.operate({ action: "read" })).tasks[0].id, id);
  await service.close();
});
