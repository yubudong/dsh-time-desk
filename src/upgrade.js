// Stores local workspace snapshots; DSH owns installation and code rollback.
import { randomUUID } from "node:crypto";
import { compareVersions, parseVersion } from "./update-core.js";
export const MAX_SNAPSHOTS = 3;
export const MAX_STATE_CHARS = 2 * 1024 * 1024; // Historical export; limit is UTF-8 bytes.
function summary(x) {
  const { id, fromVersion, targetVersion, createdAt, bytes, counts } = x;
  return { id, fromVersion, targetVersion, createdAt, bytes, counts };
}
export function createUpgradeService({
  unit,
  readState,
  restoreState,
  currentVersion = null,
  isBusy = async () => false,
  clock = () => Date.now(),
}) {
  let global = { pending: null, snapshots: [] };
  let queue = Promise.resolve();
  const view = () =>
    structuredClone({
      pending: global.pending,
      snapshots: global.snapshots.map(summary),
      currentVersion,
    });
  async function commit(next) {
    await unit.setGlobal(structuredClone(next));
    global = next;
  }
  return {
    async init() {
      const stored = (await unit.loadAll())?.global;
      if (stored && typeof stored === "object")
        global = {
          pending:
            stored.pending && typeof stored.pending === "object"
              ? stored.pending
              : null,
          snapshots: Array.isArray(stored.snapshots)
            ? stored.snapshots
                .filter((x) => x && typeof x.id === "string" && x.state)
                .slice(-MAX_SNAPSHOTS)
            : [],
        };
      return view();
    },
    operate(a) {
      const run = queue.then(async () => {
        if (a.command === "preflight" || a.command === "prepare") {
          const state = await readState();
          const blockers = [];
          if (state.timer)
            blockers.push({
              code: "timer",
              phase: state.timer.phase,
              status: state.timer.status,
            });
          if (await isBusy()) blockers.push({ code: "assistant" });
          if (a.command === "preflight")
            return {
              ok: !blockers.length,
              blockers,
              revision: state.revision,
              timer: state.timer
                ? { phase: state.timer.phase, status: state.timer.status }
                : null,
            };
          if (blockers.some((x) => x.code === "timer"))
            throw Error("请先结束当前计时，再准备升级");
          if (blockers.length) throw Error("时间精灵正在处理请求，请稍后再试");
          if (a.revision !== undefined && a.revision !== state.revision)
            throw Error("数据已更新，请刷新后重新准备升级");
          const from = currentVersion || a.fromVersion || "unknown",
            target = a.targetVersion;
          if (!parseVersion(target)) throw Error("目标版本号无效");
          if (parseVersion(from) && compareVersions(target, from) <= 0)
            throw Error("目标版本必须高于当前版本");
          for (const key of ["projects", "tasks", "habits", "focusLogs"])
            if (!Array.isArray(state[key]))
              throw Error("快照数据缺少 " + key + "，请刷新后重试");
          const bytes = Buffer.byteLength(JSON.stringify(state), "utf8");
          if (bytes > MAX_STATE_CHARS)
            throw Error("工作台数据过大，无法创建升级前快照");
          const record = {
            id: "snapshot-" + randomUUID(),
            fromVersion: from,
            targetVersion: target,
            createdAt: clock(),
            bytes,
            counts: Object.fromEntries(
              ["projects", "tasks", "habits", "focusLogs"].map((k) => [
                k,
                state[k].filter((x) => !x.deletedAt).length,
              ]),
            ),
            state,
          };
          await commit({
            ...global,
            snapshots: [...global.snapshots, record].slice(-MAX_SNAPSHOTS),
            pending: {
              targetVersion: target,
              fromVersion: from,
              preparedAt: record.createdAt,
              snapshotId: record.id,
            },
          });
          return { ok: true, prepared: summary(record), ...view() };
        }
        if (a.command === "clearPending")
          await commit({ ...global, pending: null });
        if (a.command === "restoreSnapshot") {
          if (a.confirm !== true) throw Error("恢复需要确认");
          if (await isBusy()) throw Error("时间精灵正在处理请求，请稍后再恢复");
          const record = global.snapshots.find((x) => x.id === a.id);
          if (!record) throw Error("快照不存在");
          await restoreState({
            backup: {
              format: "dsh-time-desk",
              exportedAt: new Date(record.createdAt).toISOString(),
              state: record.state,
            },
            revision: a.revision,
            confirm: true,
          });
          // Workspace restore already committed. Metadata failure must not claim
          // the restore failed or invite an accidental retry over newer data.
          let warning = null;
          try {
            await commit({ ...global, pending: null });
          } catch {
            warning = "数据已恢复，但升级提示未能清除，请刷新后核对";
          }
          return { ok: true, restored: summary(record), warning, ...view() };
        }
        return view();
      });
      queue = run.catch(() => {});
      return run;
    },
    async close() {
      await queue;
      await unit.close();
    },
  };
}
